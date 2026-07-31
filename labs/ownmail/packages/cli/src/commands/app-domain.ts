import * as p from '@clack/prompts'
import { NylasV3Client } from '@nylas-labs/cli-kit'
import { TEMPORARY_API_KEY_LIFETIME_DAYS } from '../api-key-lifecycle.js'
import { checkAppHealth } from '../deploy/app-health.js'
import { loadManifest, materialize } from '../deploy/materialize.js'
import { attachVercelDomain, configureNetlifyDomain } from '../deploy/provider-cli.js'
import { setupRealtimeWebhook } from '../deploy/webhook.js'
import { deploy } from '../deploy/wrangler.js'
import { apiBaseUrl, deployedApiBaseUrl } from '../nylas-env.js'
import {
	addProjectAppDomain,
	assertProjectAppDomainCapacity,
	isAppDomain,
	normalizeAppDomain,
	projectAppDomains,
} from '../state/app-domains.js'
import { acquireProjectLock } from '../state/project-lock.js'
import type { ProjectState } from '../state/schema.js'
import { configuredSiteName } from '../state/site-name.js'
import { saveProject } from '../state/store.js'
import { createContext, requireGateway, tokens } from '../steps/context.js'
import { ensureCloudflareAuth } from '../steps/deploy.js'
import { CancelledError } from '../steps/provision.js'
import { OWNMAIL_USER_AGENT } from '../usage-attribution.js'
import { pickExistingProject, supportReference } from './shared.js'

type AppDomainOptions = {
	name?: string
	domain?: string
	primary?: boolean
	secondary?: boolean
}

/**
 * Attaches a domain to the hosted mailbox app, registers Nylas Connect, and
 * moves the one application-level realtime webhook when the domain is primary.
 * The previous primary remains active until the new origin is healthy.
 */
export async function runAppDomain(opts: AppDomainOptions): Promise<void> {
	p.intro('ownmail app domain')
	if (opts.primary && opts.secondary) {
		throw new Error('Choose either --primary or --secondary, not both.')
	}
	const project = await pickExistingProject(opts.name)
	const releaseLock = acquireProjectLock(project.slug)
	try {
		await runAppDomainLocked(project, opts)
	} finally {
		releaseLock()
	}
}

async function runAppDomainLocked(project: ProjectState, opts: AppDomainOptions): Promise<void> {
	preflightProject(project)
	const domain = await resolveDomain(opts.domain, project.slug)
	const primary = await resolveDomainRole(project, domain, opts)
	assertProjectAppDomainCapacity(project, domain)
	const retryCommand = `npx ownmail app domain ${domain} --name ${project.slug} --${
		primary ? 'primary' : 'secondary'
	}`
	const currentPrimary = project.appDomain ? `https://${project.appDomain}` : project.providerAppUrl
	p.note(
		[
			`Project: ${project.slug}`,
			`Mailbox: ${project.inboxEmail ?? 'not recorded'}`,
			`Current primary app URL: ${currentPrimary ?? 'provider fallback'}`,
			`New app URL: https://${domain}`,
			primary
				? 'Role: primary — used for sign-in, status, and Nylas instant updates'
				: `Role: additional — https://${project.appDomain} remains primary`,
		].join('\n'),
		'Custom domain plan',
	)

	const ctx = await createContext(project)
	if (!ctx.auth) {
		throw new Error(
			`Nylas sign-in is required to register login and instant-update callbacks. Run \`npx ownmail auth login\`, then retry. No provider changes were made.`,
		)
	}
	const gateway = requireGateway(ctx)
	let temporaryKeyId: string | undefined
	try {
		const key = await gateway.createApiKey(tokens(ctx), project.region, requireApplicationId(project), {
			name: `ownmail app-domain ${new Date().toISOString()}`,
			expiresIn: TEMPORARY_API_KEY_LIFETIME_DAYS,
		})
		temporaryKeyId = key.id
		const v3 = new NylasV3Client(
			key.apiKey,
			project.region,
			fetch,
			apiBaseUrl(project.region),
			OWNMAIL_USER_AGENT,
		)

		project.pendingAppDomain = { domain, primary }
		saveProject(project)
		await attachDomain(project, domain)
		addProjectAppDomain(project, domain)
		saveProject(project)

		const appUrl = `https://${domain}`
		const spinner = p.spinner()
		spinner.start(`Checking DNS and TLS for ${appUrl}…`)
		const healthy = await checkAppHealth(appUrl)
		spinner.stop(
			healthy
				? `${appUrl} is reachable over HTTPS.`
				: `${appUrl} is attached, but DNS or TLS is still provisioning.`,
		)
		if (!healthy) {
			throw new Error(
				`Domain setup is pending. Your existing app URL still works. DNS verification or records may require action in ${providerDomainSettings(
					project,
				)}. Retry when DNS and TLS are ready:\n${retryCommand}`,
			)
		}

		await v3.ensureRedirectUris([`${appUrl}/auth/callback`])
		p.log.step('Login callback: registered')

		if (primary) {
			const webhook = await setupRealtimeWebhook(project, v3, {
				baseUrl: appUrl,
				checkHealth: false,
			})
			if (webhook.status !== 'registered') {
				const reference =
					webhook.status === 'failed' && webhook.requestId
						? `\n\nRequest ID: ${webhook.requestId}. Include this ID if you contact Nylas Support.`
						: ''
				throw new Error(
					`The domain is attached, but Nylas instant updates are not ready.${reference}\nRetry:\n${retryCommand}`,
				)
			}
			p.log.step('Instant updates: registered on the primary domain')
		}

		if (project.hostingProvider === 'netlify' && primary) {
			await configureNetlifyDomain(domain, requireNetlifySiteId(project), true)
		}
		if (primary) project.appDomain = domain
		project.pendingAppDomain = undefined
		saveProject(project)
		p.outro(
			primary
				? `Primary app domain ready: ${appUrl}\nYour provider URL remains available as a fallback.`
				: `Additional app domain ready: ${appUrl}\nNylas instant updates remain on the primary domain.`,
		)
	} finally {
		if (temporaryKeyId) {
			try {
				await gateway.revokeApiKey(tokens(ctx), project.region, requireApplicationId(project), temporaryKeyId)
			} catch (err) {
				const reference = supportReference(err)
				const message = `Could not revoke the temporary Nylas API key. Revoke it in the Nylas Dashboard.${
					reference ? `\n\n${reference}` : ''
				}`
				p.log.warn(message)
			}
		}
	}
}

async function resolveDomain(value: string | undefined, slug: string): Promise<string> {
	if (!value && !process.stdin.isTTY) {
		throw new Error(`Usage: ownmail app domain <hostname> --name ${slug}`)
	}
	let entered = value
	if (!entered) {
		const typed = await p.text({
			message: 'App hostname',
			placeholder: 'mail.example.com',
			validate: (candidate) =>
				isAppDomain((candidate ?? '').trim().toLowerCase().replace(/\.$/, ''))
					? undefined
					: 'Enter a hostname such as mail.example.com (no https://, path, port, or wildcard).',
		})
		if (p.isCancel(typed)) throw new CancelledError()
		entered = typed
	}
	return normalizeAppDomain(entered)
}

async function resolveDomainRole(
	project: ProjectState,
	domain: string,
	opts: AppDomainOptions,
): Promise<boolean> {
	if (project.pendingAppDomain && project.pendingAppDomain.domain !== domain) {
		const pending = project.pendingAppDomain
		throw new Error(
			`Finish the pending setup for ${pending.domain} before adding another domain:\nnpx ownmail app domain ${pending.domain} --name ${project.slug} --${
				pending.primary ? 'primary' : 'secondary'
			}`,
		)
	}
	if (project.pendingAppDomain?.domain === domain) {
		const requestedRole = opts.primary ? true : opts.secondary ? false : undefined
		if (requestedRole !== undefined && requestedRole !== project.pendingAppDomain.primary) {
			throw new Error(
				`This pending domain was started as --${
					project.pendingAppDomain.primary ? 'primary' : 'secondary'
				}. Retry with the same role.`,
			)
		}
		return project.pendingAppDomain.primary
	}
	if (opts.primary) return true
	if (opts.secondary) return false
	if (!project.appDomain || project.appDomain === domain) return true
	if (!process.stdin.isTTY) {
		throw new Error('Choose --primary or --secondary when adding another app domain.')
	}
	const selected = await p.select({
		message: `How should OwnMail use https://${domain}?`,
		options: [
			{
				value: 'primary',
				label: 'Primary app domain — use for sign-in, status, and Nylas instant updates',
			},
			{
				value: 'secondary',
				label: `Additional app domain — keep https://${project.appDomain} as primary`,
			},
		],
	})
	if (p.isCancel(selected)) throw new CancelledError()
	return selected === 'primary'
}

function preflightProject(project: ProjectState): void {
	if (project.ejected) {
		throw new Error(
			'Ejected projects own their hosting configuration. Add the domain in your provider and update the exported app configuration.',
		)
	}
	if (project.hostingProvider === 'local') {
		throw new Error('Local hosting cannot receive a public HTTPS custom domain. Deploy the app first.')
	}
	if (project.hostingProvider === 'manual') {
		throw new Error(
			'OwnMail cannot automate custom domains for manual hosting. Configure the domain, Nylas Connect callback, and Nylas webhook in your hosting and Nylas dashboards.',
		)
	}
	requireApplicationId(project)
	if (!project.completedSteps.includes('deploy')) {
		throw new Error('The mailbox app has not finished deploying. Run `npx ownmail` to resume setup first.')
	}
	if (
		(project.hostingProvider === 'cloudflare' || !project.hostingProvider) &&
		(!project.workerName || !project.kvNamespaceId)
	) {
		throw new Error(
			'Cloudflare deployment details are missing. Run `npx ownmail` to repair the project first.',
		)
	}
	if (project.hostingProvider === 'vercel' && (!project.vercelProjectId || !project.vercelOrgId)) {
		throw new Error('Vercel project details are missing. Run `npx ownmail app update` to repair them first.')
	}
	if (project.hostingProvider === 'netlify' && !project.netlifySiteId) {
		throw new Error('Netlify site details are missing. Run `npx ownmail app update` to repair them first.')
	}
	if ((project.hostingProvider === 'cloudflare' || !project.hostingProvider) && !project.workersDevUrl) {
		throw new Error('The Cloudflare app URL is missing. Run `npx ownmail app update` to repair it first.')
	}
	if (
		(project.hostingProvider === 'vercel' || project.hostingProvider === 'netlify') &&
		!project.providerAppUrl
	) {
		throw new Error('The hosted app URL is missing. Run `npx ownmail app update` to repair it first.')
	}
}

async function attachDomain(project: ProjectState, domain: string): Promise<void> {
	if (project.hostingProvider === 'vercel') {
		await attachVercelDomain(domain, project.vercelProjectId as string, project.vercelOrgId as string)
		return
	}
	if (project.hostingProvider === 'netlify') {
		// Stage the hostname as an alias. Promotion happens only after health and
		// Nylas reconciliation succeed, preserving the previous primary.
		await configureNetlifyDomain(domain, requireNetlifySiteId(project), false)
		return
	}
	await ensureCloudflareAuth()
	const manifest = loadManifest()
	const runtimeApiBaseUrl = deployedApiBaseUrl(project.region)
	const domains = [...new Set([...projectAppDomains(project), domain])]
	const { configPath } = materialize({
		slug: project.slug,
		workerName: project.workerName as string,
		kvNamespaceId: project.kvNamespaceId as string,
		appDomains: domains,
		vars: {
			NYLAS_CLIENT_ID: requireApplicationId(project),
			NYLAS_REGION: project.region,
			...(runtimeApiBaseUrl ? { NYLAS_API_BASE_URL: runtimeApiBaseUrl } : {}),
			APP_NAME: project.slug,
			OWNMAIL_SITE_NAME: configuredSiteName(project),
			INBOX_EMAIL: project.inboxEmail ?? '',
			TEMPLATE_VERSION: manifest.templateVersion,
		},
	})
	const spinner = p.spinner()
	spinner.start(`Attaching ${domain} to Cloudflare Workers…`)
	try {
		await deploy(configPath)
		project.templateVersion = manifest.templateVersion
		spinner.stop(`Cloudflare accepted ${domain}.`)
	} catch (err) {
		spinner.stop(`Cloudflare could not attach ${domain}; the existing app URL is unchanged.`)
		throw err
	}
}

function requireApplicationId(project: ProjectState): string {
	if (!project.applicationId?.trim()) {
		throw new Error('Nylas application details are missing. Run `npx ownmail` to repair the project first.')
	}
	return project.applicationId
}

function requireNetlifySiteId(project: ProjectState): string {
	if (!project.netlifySiteId) throw new Error('Netlify site details are missing.')
	return project.netlifySiteId
}

function providerDomainSettings(project: ProjectState): string {
	if (project.hostingProvider === 'vercel') {
		return `Vercel Dashboard → project ${project.vercelProjectId} → Settings → Domains`
	}
	if (project.hostingProvider === 'netlify') {
		return `Netlify Dashboard → site ${project.netlifySiteId} → Domain management`
	}
	return `Cloudflare Dashboard → Workers & Pages → ${project.workerName} → Settings → Domains & Routes`
}

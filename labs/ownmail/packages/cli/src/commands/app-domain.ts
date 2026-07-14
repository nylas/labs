import * as p from '@clack/prompts'
import { NylasV3Client } from '@nylas-labs/cli-kit'
import { loadManifest, materialize } from '../deploy/materialize.js'
import { deploy } from '../deploy/wrangler.js'
import { apiBaseUrl, deployedApiBaseUrl } from '../nylas-env.js'
import { saveProject } from '../state/store.js'
import { createContext, requireGateway, tokens } from '../steps/context.js'
import { ensureCloudflareAuth } from '../steps/deploy.js'
import { CancelledError } from '../steps/provision.js'
import { pickExistingProject } from './shared.js'

const APP_DOMAIN_PATTERN = /^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/

function isAppDomain(value: string): boolean {
	return APP_DOMAIN_PATTERN.test(value)
}

/**
 * Serves the app on the user's own domain (e.g. mail.acme.com) via a
 * Cloudflare custom-domain route. The domain's zone must already be on the
 * user's Cloudflare account — Cloudflare creates the DNS + cert automatically.
 */
export async function runAppDomain(opts: { name?: string; domain?: string }): Promise<void> {
	p.intro('ownmail app-domain')
	const project = await pickExistingProject(opts.name)
	if (project.ejected) throw new Error('Ejected projects manage their own wrangler routes.')
	if (!project.workerName || !project.kvNamespaceId || !project.applicationId) {
		throw new Error('This project hasn’t deployed yet — run `npx ownmail` first.')
	}

	let domain = opts.domain
	if (!domain) {
		const typed = await p.text({
			message: 'Domain for your app (its DNS zone must be on your Cloudflare account)',
			placeholder: 'mail.your-company.com',
			validate: (v) => (isAppDomain(v ?? '') ? undefined : 'Enter a domain like mail.your-company.com'),
		})
		if (p.isCancel(typed)) throw new CancelledError()
		domain = typed
	}
	if (!domain || !isAppDomain(domain)) {
		throw new Error('Enter a domain like mail.your-company.com')
	}

	await ensureCloudflareAuth()

	const manifest = loadManifest()
	const runtimeApiBaseUrl = deployedApiBaseUrl(project.region)
	const spinner = p.spinner()
	spinner.start(`Attaching ${domain} and redeploying…`)
	project.appDomain = domain
	const { configPath } = materialize({
		slug: project.slug,
		workerName: project.workerName,
		kvNamespaceId: project.kvNamespaceId,
		appDomain: domain,
		vars: {
			NYLAS_CLIENT_ID: project.applicationId,
			NYLAS_REGION: project.region,
			...(runtimeApiBaseUrl ? { NYLAS_API_BASE_URL: runtimeApiBaseUrl } : {}),
			APP_NAME: project.slug,
			INBOX_EMAIL: project.inboxEmail ?? '',
			TEMPLATE_VERSION: manifest.templateVersion,
		},
	})
	try {
		await deploy(configPath)
		project.templateVersion = manifest.templateVersion
		saveProject(project)
		spinner.stop(`App attached to https://${domain} (certificate provisions in a few minutes).`)
	} catch (err) {
		spinner.stop('Cloudflare domain setup needs attention; retry `npx ownmail app-domain` when ready.')
		throw err
	}

	// Hosted-auth must accept the new callback URL.
	const ctx = await createContext(project)
	if (ctx.auth) {
		try {
			const key = await requireGateway(ctx).createApiKey(tokens(ctx), project.region, project.applicationId, {
				name: `ownmail app-domain ${Date.now()}`,
			})
			await new NylasV3Client(
				key.apiKey,
				project.region,
				fetch,
				apiBaseUrl(project.region),
			).ensureRedirectUris([`https://${domain}/auth/callback`])
			p.log.step('Login redirect registered for the new domain.')
		} catch {
			p.log.warn('Could not register the login redirect — run `npx ownmail login`, then `npx ownmail doctor --fix`.')
		}
	} else {
		p.log.warn('Not logged into Nylas — run `npx ownmail login`, then `npx ownmail doctor --fix` to register the login redirect.')
	}
	p.outro(`Done. Your app: https://${domain} (workers.dev URL keeps working too).`)
}

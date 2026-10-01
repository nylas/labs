import * as p from '@clack/prompts'
import type { Grant, NylasV3Client } from '@nylas-labs/cli-kit'
import { isAppDomain } from '../state/app-domains.js'
import { DEFAULT_SITE_NAME, type ProjectState } from '../state/schema.js'
import { normalizeSiteName, siteNameValidationError } from '../state/site-name.js'
import { saveProject } from '../state/store.js'
import { requireDashboard, requireGateway, requireV3, type StepContext, tokens } from './context.js'
import { CancelledError, isFullyVerified, planDomain, stepApiKey } from './provision.js'

/**
 * Rebuilds local state for a project adopted from its live deployment
 * (typically on a new computer). Everything durable lives remotely: the
 * deployment on the hosting provider, the app, inbox, and domain on Nylas, and
 * custom app domains in its redirect URIs and realtime webhook. The deployment
 * API key only ever lived in the old machine's keychain, so a replacement is
 * minted. The old key is revoked after the next deploy lands on the adopted URL.
 */
export async function stepRecover(ctx: StepContext): Promise<void> {
	if (!ctx.project.adoptedFromAccount) return
	p.log.info(`Rebuilding “${ctx.project.slug}” from your Nylas account…`)

	// Identify the live key before minting one, so a retry cannot mistake an earlier replacement for it.
	if (!ctx.project.apiKeyId) await identifyDeployedKey(ctx)
	await stepApiKey(ctx)
	const v3 = requireV3(ctx)

	if (!ctx.project.grantId) await recoverInbox(ctx, v3)
	if (!ctx.project.domainId && !ctx.project.plannedDomainAddress) await recoverDomain(ctx)
	await recoverAppDomains(ctx, v3)
	if (!ctx.project.siteName && ctx.project.recoveredAppUrl) {
		const siteName = await fetchLiveSiteName(ctx.project.recoveredAppUrl)
		if (siteName) {
			ctx.project.siteName = siteName
			p.log.info(`Found the display name “${siteName}” on your app.`)
		}
	}
	if (ctx.project.recoveredAppUrl) {
		scheduleDeployedKeyRevocation(ctx.project)
	} else {
		delete ctx.project.recoveredDeployedKeyId
		p.log.warn(
			`OwnMail could not confirm where this app is deployed, so it will not revoke the app's previous API key. Once the app works, revoke the older “ownmail ${ctx.project.slug}” key in the Nylas dashboard.`,
		)
	}

	delete ctx.project.adoptedFromAccount
	saveProject(ctx.project)
	if (!ctx.project.siteName) {
		p.log.info(
			'OwnMail could not read the display name from the deployed app. Confirm it next — the app will be redeployed with it.',
		)
	}
}

/** Record the key the live app runs on. Runs before recovery mints its replacement. */
async function identifyDeployedKey(ctx: StepContext): Promise<void> {
	const applicationId = ctx.project.applicationId
	if (!applicationId) throw new Error('Nylas application unavailable — rerun ownmail setup')
	const keys = await requireGateway(ctx).listApiKeys(await tokens(ctx), ctx.project.region, applicationId)
	const deployed = keys.filter(
		(key) => key.status.trim().toLowerCase() === 'active' && isDeploymentKeyName(key.name, ctx.project.slug),
	)
	if (deployed.length === 1) {
		ctx.project.recoveredDeployedKeyId = (deployed[0] as (typeof deployed)[number]).id
		saveProject(ctx.project)
		return
	}
	if (deployed.length > 1) {
		p.log.warn(
			'Found more than one active OwnMail API key for this app, so none will be revoked automatically. Revoke unused keys in the Nylas dashboard.',
		)
	}
}

/** Schedule the live key for revocation once the verified redeploy installs its replacement. */
function scheduleDeployedKeyRevocation(project: ProjectState): void {
	const previousKeyId = project.recoveredDeployedKeyId
	const replacementKeyId = project.apiKeyId
	if (!previousKeyId || !replacementKeyId) return
	const interimKeyId = project.pendingApiKeyRotation?.previousKeyId
	if (interimKeyId && interimKeyId !== previousKeyId) {
		p.log.warn(
			`An API key from an earlier interrupted attempt (${interimKeyId}) was never deployed. Revoke it in the Nylas dashboard if it is still active.`,
		)
	}
	project.pendingApiKeyRotation = { previousKeyId, replacementKeyId }
	delete project.recoveredDeployedKeyId
	saveProject(project)
}

/** Names given to deployment keys by setup, `auth rotate-key`, and `project doctor`. */
export function isDeploymentKeyName(name: string, slug: string): boolean {
	const prefix = `ownmail ${slug} `
	if (!name.startsWith(prefix)) return false
	const rest = name.slice(prefix.length)
	return (
		/^\d{4}-\d{2}-\d{2}T/.test(rest) || rest.startsWith('(rotated ') || rest.startsWith('(doctor repair ')
	)
}

async function recoverInbox(ctx: StepContext, v3: NylasV3Client): Promise<void> {
	const listed = await v3.listGrants({ limit: 50 })
	const inboxes = (listed.data ?? []).filter(
		(grant): grant is Grant & { email: string } => grant.provider === 'nylas' && Boolean(grant.email),
	)
	if (inboxes.length === 0) {
		p.log.info('No inbox found on this app yet; setup will create one.')
		return
	}
	let inbox = inboxes[0] as (typeof inboxes)[number]
	if (inboxes.length > 1) {
		const picked = await p.select({
			message: 'Which inbox does this app open by default?',
			options: inboxes.map((grant) => ({ value: grant.id, label: grant.email })),
		})
		if (p.isCancel(picked)) throw new CancelledError()
		inbox = inboxes.find((grant) => grant.id === picked) as (typeof inboxes)[number]
	}
	ctx.project.grantId = inbox.id
	ctx.project.inboxEmail = inbox.email
	saveProject(ctx.project)
	p.log.info(`Found inbox ${inbox.email}.`)
}

async function recoverDomain(ctx: StepContext): Promise<void> {
	const host = ctx.project.inboxEmail?.split('@')[1]?.toLowerCase()
	if (!host) {
		await planDomain(ctx)
		return
	}
	const domains = await requireDashboard(ctx).listInboxDomains(await tokens(ctx), { limit: 100 })
	const domain = domains.find(
		(candidate) => candidate.domainAddress.toLowerCase() === host && candidate.region === ctx.project.region,
	)
	if (!domain) {
		throw new Error(
			`Could not find the email domain ${host} in this Nylas organization. Check that you are logged into the organization that owns ${ctx.project.inboxEmail}, then re-run ownmail.`,
		)
	}
	ctx.project.domainId = domain.id
	ctx.project.domainAddress = domain.domainAddress
	ctx.project.domainBranded = domain.branded
	ctx.project.domainVerified = isFullyVerified(domain)
	saveProject(ctx.project)
}

/**
 * Setup registers every app URL as a redirect URI and points the realtime
 * webhook at the primary one, so their non-provider hosts are the app's custom
 * domains. The next redeploy must keep serving them.
 */
async function recoverAppDomains(ctx: StepContext, v3: NylasV3Client): Promise<void> {
	const [redirects, webhooks] = await Promise.all([v3.listRedirectUris(), v3.listWebhooks()])
	const domains = inferAppDomains(
		(redirects.data ?? []).map((uri) => uri.url),
		(webhooks.data ?? [])
			.filter(
				(webhook) =>
					webhook.description === 'ownmail realtime' &&
					(webhook.status === undefined || webhook.status === 'active'),
			)
			.map((webhook) => webhook.webhook_url ?? webhook.callback_url)
			.filter((url): url is string => Boolean(url)),
	)
	ctx.project.appDomains = domains.appDomains
	if (domains.appDomain) ctx.project.appDomain = domains.appDomain
	saveProject(ctx.project)
}

export function inferAppDomains(
	redirectUrls: string[],
	activeWebhookUrls: string[],
): { appDomain?: string; appDomains: string[] } {
	const webhookHosts = httpsOrigins(activeWebhookUrls).map((origin) => new URL(origin).hostname)
	// Several destinations (e.g. one left behind after a domain change) cannot identify the primary.
	const liveHost = webhookHosts.length === 1 ? webhookHosts[0] : undefined
	const appDomains = httpsOrigins([...activeWebhookUrls, ...redirectUrls])
		.map((origin) => new URL(origin).hostname)
		.filter((host, index, hosts) => hosts.indexOf(host) === index)
		.filter((host) => !isProviderHost(host) && isAppDomain(host))
	return {
		...(liveHost && appDomains.includes(liveHost) ? { appDomain: liveHost } : {}),
		appDomains,
	}
}

const PROBE_TIMEOUT_MS = 5000

/** The app renders its display name into the public login page's head. */
async function fetchLiveSiteName(url: string): Promise<string | undefined> {
	try {
		const res = await fetch(`${url}/login`, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) })
		if (!res.ok) return undefined
		return parseSiteName(await res.text())
	} catch {
		return undefined
	}
}

const HTML_ENTITIES: Record<string, string> = {
	amp: '&',
	lt: '<',
	gt: '>',
	quot: '"',
	'#39': "'",
	'#x27': "'",
}

export function parseSiteName(html: string): string | undefined {
	const match = /<meta\s+name="apple-mobile-web-app-title"\s+content="([^"]*)"/i.exec(html)
	if (!match) return undefined
	const decoded = (match[1] as string).replace(/&(amp|lt|gt|quot|#39|#x27);/gi, (_, name: string) => {
		return HTML_ENTITIES[name.toLowerCase()] as string
	})
	// The app falls back to the default for unset or invalid names, so the default is not a user choice.
	if (decoded === DEFAULT_SITE_NAME || siteNameValidationError(decoded)) return undefined
	return normalizeSiteName(decoded)
}

const PROVIDER_HOST_SUFFIXES = ['.workers.dev', '.vercel.app', '.netlify.app']

function isProviderHost(host: string): boolean {
	return PROVIDER_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))
}

function httpsOrigins(urls: string[]): string[] {
	const origins: string[] = []
	for (const raw of urls) {
		try {
			const url = new URL(raw)
			if (url.protocol === 'https:' && !origins.includes(url.origin)) origins.push(url.origin)
		} catch {
			// Not a URL OwnMail registered; ignore it.
		}
	}
	return origins
}

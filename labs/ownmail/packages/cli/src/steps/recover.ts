import * as p from '@clack/prompts'
import type { Grant, NylasV3Client } from '@nylas-labs/cli-kit'
import { isAppDomain } from '../state/app-domains.js'
import { hasPendingSecret } from '../state/pending-secrets.js'
import type { ProjectState } from '../state/schema.js'
import { saveProject } from '../state/store.js'
import { requireDashboard, requireGateway, requireV3, type StepContext, tokens } from './context.js'
import { CancelledError, isFullyVerified, planDomain, stepApiKey } from './provision.js'

type HostedProvider = 'cloudflare' | 'vercel' | 'netlify'

export type InferredHosting = {
	provider?: HostedProvider
	providerUrl?: string
	appDomain?: string
	appDomains: string[]
}

const PROVIDER_HOST_SUFFIXES: [HostedProvider, string][] = [
	['cloudflare', '.workers.dev'],
	['vercel', '.vercel.app'],
	['netlify', '.netlify.app'],
]

/**
 * Rebuilds local state for a project adopted from the Nylas account (typically
 * on a new computer). Everything durable lives remotely: the app, inbox, and
 * domain on Nylas, and the app URLs in its redirect URIs and realtime webhook.
 * The deployment API key only ever lived in the old machine's keychain, so a
 * replacement is minted and the old key is revoked after the next deploy.
 */
export async function stepRecover(ctx: StepContext): Promise<void> {
	if (!ctx.project.adoptedFromAccount) return
	p.log.info(`Rebuilding “${ctx.project.slug}” from your Nylas account…`)

	if (!ctx.project.apiKeyId && !hasPendingSecret(ctx.project, 'apiKey')) {
		await trackDeployedApiKey(ctx)
	}
	await stepApiKey(ctx)
	const v3 = requireV3(ctx)

	if (!ctx.project.grantId) await recoverInbox(ctx, v3)
	if (!ctx.project.domainId && !ctx.project.plannedDomainAddress) await recoverDomain(ctx)
	if (!ctx.project.hostingProvider) await recoverHosting(ctx, v3)

	delete ctx.project.adoptedFromAccount
	saveProject(ctx.project)
	p.log.info(
		'OwnMail could not read the display name from the deployed app. Confirm it next — the app will be redeployed with it.',
	)
}

/** Record the key the deployed app runs on so the replacement flow revokes it after redeploying. */
async function trackDeployedApiKey(ctx: StepContext): Promise<void> {
	const applicationId = ctx.project.applicationId
	if (!applicationId) throw new Error('Nylas application unavailable — rerun ownmail setup')
	const keys = await requireGateway(ctx).listApiKeys(tokens(ctx), ctx.project.region, applicationId)
	const deployed = keys.filter(
		(key) => key.status.trim().toLowerCase() === 'active' && isDeploymentKeyName(key.name, ctx.project.slug),
	)
	if (deployed.length === 1) {
		ctx.project.apiKeyId = (deployed[0] as (typeof deployed)[number]).id
		saveProject(ctx.project)
		return
	}
	if (deployed.length > 1) {
		p.log.warn(
			'Found more than one active OwnMail API key for this app, so none will be revoked automatically. Revoke unused keys in the Nylas dashboard.',
		)
	}
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
	const domains = await requireDashboard(ctx).listInboxDomains(tokens(ctx), { limit: 100 })
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

async function recoverHosting(ctx: StepContext, v3: NylasV3Client): Promise<void> {
	const [redirects, webhooks] = await Promise.all([v3.listRedirectUris(), v3.listWebhooks()])
	const hosting = inferHosting(
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
	applyInferredHosting(ctx.project, hosting)
	saveProject(ctx.project)
	if (hosting.provider && hosting.providerUrl) {
		p.log.info(`Found your app at ${hosting.providerUrl}.`)
	} else {
		p.log.info('Could not tell where this app was hosted. Choose the same provider you used before.')
	}
}

/**
 * Setup registers every app URL as a redirect URI and points the realtime
 * webhook at the primary one, so their hosts identify the provider and any
 * custom app domains. Recovery redeploys to the chosen URL and then revokes
 * the old key, so an ambiguous result is left for the user to choose.
 */
export function inferHosting(redirectUrls: string[], activeWebhookUrls: string[]): InferredHosting {
	const webhookOrigins = httpsOrigins(activeWebhookUrls)
	// Several destinations (e.g. one left behind after switching providers) cannot identify the live app.
	const liveOrigin = webhookOrigins.length === 1 ? webhookOrigins[0] : undefined
	const origins = httpsOrigins([...(liveOrigin ? [liveOrigin] : []), ...redirectUrls])
	const providerOrigins = origins.flatMap((origin) => {
		const provider = providerForHost(new URL(origin).hostname)
		return provider ? [{ provider, origin }] : []
	})
	const appDomains = origins
		.map((origin) => new URL(origin).hostname)
		.filter((host) => !providerForHost(host) && isAppDomain(host))

	const liveProvider = providerOrigins.find((entry) => entry.origin === liveOrigin)
	const chosen = liveProvider ?? (providerOrigins.length === 1 ? providerOrigins[0] : undefined)

	const liveHost = liveOrigin ? new URL(liveOrigin).hostname : undefined
	const appDomain = liveHost && appDomains.includes(liveHost) ? liveHost : undefined
	return {
		...(chosen ? { provider: chosen.provider, providerUrl: chosen.origin } : {}),
		...(appDomain ? { appDomain } : {}),
		appDomains,
	}
}

function applyInferredHosting(project: ProjectState, hosting: InferredHosting): void {
	project.appDomains = hosting.appDomains
	if (hosting.appDomain) project.appDomain = hosting.appDomain
	if (!hosting.provider || !hosting.providerUrl) return
	project.hostingProvider = hosting.provider
	project.recoveredAppUrl = hosting.providerUrl
	if (hosting.provider === 'cloudflare') {
		project.workersDevUrl = hosting.providerUrl
		// <worker>.<account-subdomain>.workers.dev
		project.workerName = new URL(hosting.providerUrl).hostname.split('.')[0]
	} else {
		project.providerAppUrl = hosting.providerUrl
	}
}

function providerForHost(host: string): HostedProvider | undefined {
	return PROVIDER_HOST_SUFFIXES.find(([, suffix]) => host.endsWith(suffix))?.[0]
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

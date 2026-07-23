import { rmSync } from 'node:fs'
import type { NylasV3Client } from '@nylas-labs/cli-kit'
import { projectAppDomains } from '../state/app-domains.js'
import type { ProjectState } from '../state/schema.js'
import { type AppHealthOptions, checkAppHealth } from './app-health.js'
import { materializeNetlify, materializeVercel } from './materialize.js'
import {
	deployNetlify,
	deployVercel,
	ensureNetlifySite,
	ensureVercelProject,
	ensureVercelRealtimeStore,
	setNetlifyEnvironment,
	setVercelEnvironment,
} from './provider-cli.js'
import { putSecret } from './wrangler.js'

export const WEBHOOK_TRIGGER_TYPES = [
	'message.created',
	'message.updated',
	'message.deleted',
	'folder.created',
	'folder.updated',
	'folder.deleted',
	'contact.updated',
	'contact.deleted',
	'calendar.created',
	'calendar.updated',
	'calendar.deleted',
	'event.created',
	'event.updated',
	'event.deleted',
]

export type RealtimeWebhookResult =
	| { status: 'registered'; callbackUrl: string; secretStored: boolean }
	| {
			status: 'skipped'
			reason: 'manual-hosting' | 'non-cloudflare-hosting' | 'missing-app-url' | 'unhealthy-app'
	  }
	| {
			status: 'failed'
			callbackUrl: string
			requestId?: string
			reason?:
				| 'ambiguous-ownmail-destinations'
				| 'tracked-destination-ownership-mismatch'
				| 'unrecognized-callback-destination'
	  }

export type RealtimeWebhookOptions = AppHealthOptions & {
	checkHealth?: boolean
	baseUrl?: string
}

type RealtimeWebhookClient = {
	reconcileWebhook?: NylasV3Client['reconcileWebhook']
	rotateWebhookSecret?: NylasV3Client['rotateWebhookSecret']
	deleteWebhook?: NylasV3Client['deleteWebhook']
	/** Compatibility for injected clients created before reconciliation shipped. */
	ensureWebhook?: NylasV3Client['ensureWebhook']
}

export async function setupRealtimeWebhook(
	project: ProjectState,
	v3: RealtimeWebhookClient,
	options: RealtimeWebhookOptions = {},
): Promise<RealtimeWebhookResult> {
	if (project.hostingProvider === 'manual') {
		return { status: 'skipped', reason: 'manual-hosting' }
	}
	if (project.hostingProvider === 'local') {
		return { status: 'skipped', reason: 'non-cloudflare-hosting' }
	}

	const url = options.baseUrl ? normalizedHttpsBaseUrl(options.baseUrl) : webhookBaseUrl(project)
	if (!url) {
		return { status: 'skipped', reason: 'missing-app-url' }
	}

	if (options.checkHealth !== false && !(await checkAppHealth(url, options))) {
		return { status: 'skipped', reason: 'unhealthy-app' }
	}

	const callbackUrl = `${url}/api/webhooks/nylas`
	try {
		const knownCallbackUrls = knownWebhookCallbackUrls(project)
		const reconciled = v3.reconcileWebhook
			? await v3.reconcileWebhook(callbackUrl, WEBHOOK_TRIGGER_TYPES, {
					...(project.realtimeWebhookId ? { webhookId: project.realtimeWebhookId } : {}),
					knownCallbackUrls,
				})
			: await ensureLegacyWebhook(v3, callbackUrl)
		const { webhook, operation, adopted } = reconciled
		const needsSecretInstall =
			operation === 'created' || (adopted && !project.completedSteps.includes('webhook'))
		if (needsSecretInstall) {
			const secret =
				operation === 'created'
					? webhook.webhook_secret
					: (await v3.rotateWebhookSecret?.(webhook.id))?.data.webhook_secret
			if (!secret) {
				if (operation === 'created') await bestEffortDelete(v3, webhook.id)
				return { status: 'failed', callbackUrl }
			}
			try {
				await storeWebhookSecret(project, secret)
			} catch (err) {
				if (operation === 'created') {
					await bestEffortDelete(v3, webhook.id)
				}
				throw err
			}
		}
		project.realtimeWebhookId = webhook.id
		return { status: 'registered', callbackUrl, secretStored: true }
	} catch (err) {
		const requestId = requestIdFromError(err)
		const reason = reconcileReasonFromError(err)
		return {
			status: 'failed',
			callbackUrl,
			...(requestId ? { requestId } : {}),
			...(reason ? { reason } : {}),
		}
	}
}

async function storeWebhookSecret(project: ProjectState, secret: string): Promise<void> {
	if (project.hostingProvider === 'cloudflare' || !project.hostingProvider) {
		await putSecret(requireWorkerName(project), 'NYLAS_WEBHOOK_SECRET', secret)
		return
	}
	if (project.hostingProvider === 'netlify') {
		if (!project.netlifySiteId) throw new Error('Netlify site identifier is missing.')
		const materialized = materializeNetlify(project.slug)
		try {
			await ensureNetlifySite(materialized.dir, `${project.slug}-ownmail`, project.netlifySiteId)
			await setNetlifyEnvironment(
				materialized.dir,
				project.netlifySiteId,
				{ NYLAS_WEBHOOK_SECRET: secret },
				new Set(['NYLAS_WEBHOOK_SECRET']),
			)
			const deployedUrl = await deployNetlify(materialized.dir, project.netlifySiteId)
			if (project.providerAppUrl && deployedUrl !== project.providerAppUrl) {
				throw new Error('Netlify production URL changed while enabling instant updates.')
			}
		} finally {
			rmSync(materialized.dir, { recursive: true, force: true })
		}
		return
	}
	if (!project.vercelProjectId || !project.vercelOrgId) {
		throw new Error('Vercel project identifiers are missing.')
	}
	const materialized = materializeVercel(project.slug)
	try {
		await ensureVercelProject(materialized.dir, `${project.slug}-ownmail`, project.vercelOrgId, {
			projectId: project.vercelProjectId,
			orgId: project.vercelOrgId,
		})
		await ensureVercelRealtimeStore(materialized.dir, `${project.slug}-realtime`, project.region)
		await setVercelEnvironment(
			materialized.dir,
			{ NYLAS_WEBHOOK_SECRET: secret },
			new Set(['NYLAS_WEBHOOK_SECRET']),
		)
		const deployedUrl = await deployVercel(materialized.dir, project.vercelOrgId)
		if (project.providerAppUrl && deployedUrl !== project.providerAppUrl) {
			throw new Error('Vercel production URL changed while enabling instant updates.')
		}
	} finally {
		rmSync(materialized.dir, { recursive: true, force: true })
	}
}

export function projectAppUrl(project: ProjectState): string | undefined {
	if (project.appDomain) return `https://${project.appDomain}`
	switch (project.hostingProvider) {
		case 'local':
			return project.localAppUrl
		case 'vercel':
		case 'netlify':
			return project.providerAppUrl
		case 'manual':
			return project.manualAppUrl
		default:
			return project.manualAppUrl ?? project.workersDevUrl ?? project.providerAppUrl ?? project.localAppUrl
	}
}

export function projectCustomAppUrls(project: ProjectState): string[] {
	return projectAppDomains(project).map((domain) => `https://${domain}`)
}

export function webhookBaseUrl(project: ProjectState): string | null {
	return normalizedHttpsBaseUrl(projectAppUrl(project))
}

function normalizedHttpsBaseUrl(value: string | undefined): string | null {
	const raw = value?.trim()
	if (!raw) return null
	try {
		const url = new URL(raw)
		if (url.protocol !== 'https:') return null
		url.hash = ''
		url.search = ''
		return url.toString().replace(/\/$/, '')
	} catch {
		return null
	}
}

function knownWebhookCallbackUrls(project: ProjectState): string[] {
	const bases = new Set(
		[
			project.workersDevUrl,
			project.providerAppUrl,
			project.manualAppUrl,
			project.localAppUrl,
			...projectCustomAppUrls(project),
		]
			.map(normalizedHttpsBaseUrl)
			.filter((url): url is string => Boolean(url)),
	)
	return [...bases].map((base) => `${base}/api/webhooks/nylas`)
}

async function bestEffortDelete(v3: RealtimeWebhookClient, webhookId: string | undefined): Promise<void> {
	if (!webhookId || !v3.deleteWebhook) return
	try {
		await v3.deleteWebhook(webhookId)
	} catch {
		// The original failure is more useful. A retry will reconcile any
		// recognizable OwnMail destination without touching unrelated webhooks.
	}
}

async function ensureLegacyWebhook(
	v3: RealtimeWebhookClient,
	callbackUrl: string,
): Promise<{
	webhook: Awaited<ReturnType<NylasV3Client['ensureWebhook']>>
	operation: 'created' | 'unchanged'
	adopted: boolean
}> {
	if (!v3.ensureWebhook) throw new Error('The Nylas webhook client is unavailable.')
	const webhook = await v3.ensureWebhook(callbackUrl, WEBHOOK_TRIGGER_TYPES)
	return {
		webhook,
		operation: webhook.webhook_secret ? 'created' : 'unchanged',
		adopted: !webhook.webhook_secret,
	}
}

function reconcileReasonFromError(
	err: unknown,
):
	| 'ambiguous-ownmail-destinations'
	| 'tracked-destination-ownership-mismatch'
	| 'unrecognized-callback-destination'
	| undefined {
	if (typeof err !== 'object' || err === null || !('code' in err)) return undefined
	const code = err.code
	return code === 'ambiguous-ownmail-destinations' ||
		code === 'tracked-destination-ownership-mismatch' ||
		code === 'unrecognized-callback-destination'
		? code
		: undefined
}

function requireWorkerName(project: ProjectState): string {
	if (!project.workerName?.trim()) {
		throw new Error('Cloudflare worker name is missing.')
	}
	return project.workerName.trim()
}

function requestIdFromError(err: unknown): string | undefined {
	if (typeof err !== 'object' || err === null || !('requestId' in err)) return undefined
	const requestId = err.requestId
	return typeof requestId === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(requestId)
		? requestId
		: undefined
}

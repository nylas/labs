import { rmSync } from 'node:fs'
import type { NylasV3Client } from '@nylas-labs/cli-kit'
import type { ProjectState } from '../state/schema.js'
import { type AppHealthOptions, checkAppHealth } from './app-health.js'
import { materializeVercel } from './materialize.js'
import {
	deployVercel,
	ensureVercelProject,
	ensureVercelRealtimeStore,
	setVercelEnvironment,
} from './provider-cli.js'
import { putSecret } from './wrangler.js'

const WEBHOOK_TRIGGER_TYPES = ['message.created', 'message.updated', 'thread.replied']

export type RealtimeWebhookResult =
	| { status: 'registered'; callbackUrl: string; secretStored: boolean }
	| {
			status: 'skipped'
			reason: 'manual-hosting' | 'non-cloudflare-hosting' | 'missing-app-url' | 'unhealthy-app'
	  }
	| { status: 'failed'; callbackUrl: string }

export type RealtimeWebhookOptions = AppHealthOptions & {
	checkHealth?: boolean
}

export async function setupRealtimeWebhook(
	project: ProjectState,
	v3: Pick<NylasV3Client, 'ensureWebhook' | 'rotateWebhookSecret'>,
	options: RealtimeWebhookOptions = {},
): Promise<RealtimeWebhookResult> {
	if (project.hostingProvider === 'manual') {
		return { status: 'skipped', reason: 'manual-hosting' }
	}
	if (
		project.hostingProvider &&
		project.hostingProvider !== 'cloudflare' &&
		project.hostingProvider !== 'vercel'
	) {
		return { status: 'skipped', reason: 'non-cloudflare-hosting' }
	}

	const url = webhookBaseUrl(project)
	if (!url) {
		return { status: 'skipped', reason: 'missing-app-url' }
	}

	if (options.checkHealth !== false && !(await checkAppHealth(url, options))) {
		return { status: 'skipped', reason: 'unhealthy-app' }
	}

	const callbackUrl = `${url}/api/webhooks/nylas`
	try {
		const webhook = await v3.ensureWebhook(callbackUrl, WEBHOOK_TRIGGER_TYPES)
		const secret =
			webhook.webhook_secret ??
			(webhook.id ? (await v3.rotateWebhookSecret(webhook.id)).data.webhook_secret : undefined)
		if (!secret) return { status: 'failed', callbackUrl }
		await storeWebhookSecret(project, secret, url)
		return { status: 'registered', callbackUrl, secretStored: true }
	} catch {
		return { status: 'failed', callbackUrl }
	}
}

async function storeWebhookSecret(project: ProjectState, secret: string, expectedUrl: string): Promise<void> {
	if (project.hostingProvider !== 'vercel') {
		await putSecret(requireWorkerName(project), 'NYLAS_WEBHOOK_SECRET', secret)
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
		if (deployedUrl !== expectedUrl) {
			throw new Error('Vercel production URL changed while enabling instant updates.')
		}
	} finally {
		rmSync(materialized.dir, { recursive: true, force: true })
	}
}

export function projectAppUrl(project: ProjectState): string | undefined {
	switch (project.hostingProvider) {
		case 'local':
			return project.localAppUrl
		case 'vercel':
		case 'netlify':
			return project.providerAppUrl
		case 'manual':
			return project.manualAppUrl
		default:
			if (project.appDomain) return `https://${project.appDomain}`
			return project.manualAppUrl ?? project.workersDevUrl ?? project.providerAppUrl ?? project.localAppUrl
	}
}

export function webhookBaseUrl(project: ProjectState): string | null {
	const raw = projectAppUrl(project)?.trim()
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

function requireWorkerName(project: ProjectState): string {
	if (!project.workerName?.trim()) {
		throw new Error('Cloudflare worker name is missing.')
	}
	return project.workerName.trim()
}

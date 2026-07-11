import type { NylasV3Client } from '@nylas-labs/cli-kit'
import type { ProjectState } from '../state/schema.js'
import { type AppHealthOptions, checkAppHealth } from './app-health.js'
import { putSecret } from './wrangler.js'

const WEBHOOK_TRIGGER_TYPES = ['message.created', 'message.updated', 'thread.replied']

export type RealtimeWebhookResult =
	| { status: 'registered'; callbackUrl: string; secretStored: boolean }
	| { status: 'skipped'; reason: 'manual-hosting' | 'missing-app-url' | 'unhealthy-app' }
	| { status: 'failed'; callbackUrl: string }

export type RealtimeWebhookOptions = AppHealthOptions & {
	checkHealth?: boolean
}

export async function setupRealtimeWebhook(
	project: ProjectState,
	v3: Pick<NylasV3Client, 'ensureWebhook'>,
	options: RealtimeWebhookOptions = {},
): Promise<RealtimeWebhookResult> {
	if (project.hostingProvider === 'manual') {
		return { status: 'skipped', reason: 'manual-hosting' }
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
		let secretStored = false
		if (webhook.webhook_secret) {
			await putSecret(requireWorkerName(project), 'NYLAS_WEBHOOK_SECRET', webhook.webhook_secret)
			secretStored = true
		}
		return { status: 'registered', callbackUrl, secretStored }
	} catch {
		return { status: 'failed', callbackUrl }
	}
}

export function projectAppUrl(project: ProjectState): string | undefined {
	if (project.appDomain) return `https://${project.appDomain}`
	return project.manualAppUrl ?? project.workersDevUrl
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

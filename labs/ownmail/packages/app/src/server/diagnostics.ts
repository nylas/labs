import { OWNMAIL_VERSION } from '#shared/lib/version'

export const FAILURE_CODES = [
	'unknown',
	'unauthorized',
	'invalid_token',
	'invalid_url',
	'blocked_address',
	'dns',
	'timeout',
	'transport',
	'upstream_status',
	'redirect',
	'missing_body',
	'size_limit',
	'processing',
	'session',
	'provider',
] as const
export type FailureCode = (typeof FAILURE_CODES)[number]
export const DIAGNOSTIC_STAGES = [
	'request',
	'session',
	'token',
	'dns',
	'fetch',
	'body',
	'processing',
	'mailbox',
	'renewal',
] as const
export type DiagnosticStage = (typeof DIAGNOSTIC_STAGES)[number]

/** Carries only bounded diagnostic metadata. Never retain the upstream error or URL. */
export class OperationFailure extends Error {
	constructor(
		public readonly code: FailureCode,
		public readonly stage: DiagnosticStage,
		public readonly status?: number,
	) {
		super('Image unavailable')
	}
}

type Diagnostic = {
	event: 'image.failed' | 'mailbox.failed' | 'session.failed' | 'request.completed' | 'request.failed'
	stage: DiagnosticStage
	code?: FailureCode
	requestId?: string
	status?: number
	durationMs?: number
}

/** Pick fields explicitly even when the caller passes an object with extra properties. */
export function diagnostic(input: Diagnostic): void {
	const record = {
		event: [
			'image.failed',
			'mailbox.failed',
			'session.failed',
			'request.completed',
			'request.failed',
		].includes(input.event)
			? input.event
			: 'request.failed',
		stage: DIAGNOSTIC_STAGES.includes(input.stage) ? input.stage : 'request',
		release: OWNMAIL_VERSION,
		...(input.code && FAILURE_CODES.includes(input.code) ? { code: input.code } : {}),
		...(input.requestId && /^[a-f0-9-]{36}$/.test(input.requestId) ? { requestId: input.requestId } : {}),
		...(Number.isInteger(input.status) && Number(input.status) >= 100 && Number(input.status) <= 599
			? { status: input.status }
			: {}),
		...(Number.isFinite(input.durationMs) && Number(input.durationMs) >= 0
			? { durationMs: Math.round(Math.min(Number(input.durationMs), 300_000)) }
			: {}),
	}
	console.info(JSON.stringify(record))
}

/** Bounds even APIs such as DNS that cannot accept an AbortSignal. */
export function untilAborted<T>(
	operation: Promise<T>,
	signal: AbortSignal,
	stage: DiagnosticStage,
): Promise<T> {
	return new Promise((resolve, reject) => {
		const aborted = () => reject(new OperationFailure('timeout', stage))
		if (signal.aborted) aborted()
		else signal.addEventListener('abort', aborted, { once: true })
		operation.then(resolve, reject).finally(() => signal.removeEventListener('abort', aborted))
	})
}

/** Best-effort stream disposal must not replace the original failure. */
export function ignoreCleanupFailure(): void {}

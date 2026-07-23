const USER_AGENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/
const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const REQUEST_ID_HEADERS = ['x-request-id', 'x-nylas-request-id', 'request-id'] as const

/**
 * Builds a conservative, injection-safe User-Agent header for server-side
 * requests. Browser-controlled or user-provided values must never reach here.
 */
export function userAgentHeader(userAgent?: string): Record<string, string> {
	if (userAgent === undefined) return {}
	if (!USER_AGENT_PATTERN.test(userAgent)) {
		throw new Error('userAgent must be 1-128 letters, digits, dots, underscores, slashes, or hyphens')
	}
	return { 'User-Agent': userAgent }
}

/** Returns a display-safe upstream request ID, rejecting control characters and unbounded values. */
export function sanitizeRequestId(value: unknown): string | undefined {
	return typeof value === 'string' && REQUEST_ID_PATTERN.test(value) ? value : undefined
}

/** Extracts a request/support ID from known Nylas response headers and JSON envelope fields. */
export function responseRequestId(response: Response, body?: unknown): string | undefined {
	for (const name of REQUEST_ID_HEADERS) {
		const requestId = sanitizeRequestId(response.headers.get(name))
		if (requestId) return requestId
	}
	return bodyRequestId(body)
}

export function bodyRequestId(body: unknown): string | undefined {
	if (!isRecord(body)) return undefined
	for (const field of ['request_id', 'requestId', 'support_id', 'supportId'] as const) {
		const requestId = sanitizeRequestId(body[field])
		if (requestId) return requestId
	}
	if (isRecord(body.error)) {
		const nested = bodyRequestId(body.error)
		if (nested) return nested
	}
	if (Array.isArray(body.errors)) {
		for (const error of body.errors) {
			if (!isRecord(error)) continue
			const direct = bodyRequestId(error)
			if (direct) return direct
			const extensions = bodyRequestId(error.extensions)
			if (extensions) return extensions
		}
	}
	return undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

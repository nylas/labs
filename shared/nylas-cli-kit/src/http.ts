const USER_AGENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/

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

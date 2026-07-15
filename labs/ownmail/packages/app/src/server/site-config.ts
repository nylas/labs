import type { AppEnv } from './platform.js'

export const DEFAULT_SITE_NAME = 'ownmail'
const MAX_SITE_NAME_LENGTH = 80
const SITE_NAME_RE = /^[\p{L}\p{N}][\p{L}\p{N} .,'&()!_-]*$/u

/**
 * Turns the optional deployment setting into display-safe branding. Keep this
 * separate from APP_NAME, which identifies the deployed worker/project.
 */
export function siteNameFromEnv(env: Pick<AppEnv, 'OWNMAIL_SITE_NAME'>): string {
	const value = env.OWNMAIL_SITE_NAME?.trim().replace(/\s+/g, ' ')
	if (!value || value.length > MAX_SITE_NAME_LENGTH || !SITE_NAME_RE.test(value)) return DEFAULT_SITE_NAME
	return value
}

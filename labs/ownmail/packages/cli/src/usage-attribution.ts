import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const packageMetadata: unknown = require('../package.json')
const PACKAGE_VERSION_PATTERN = /^[0-9A-Za-z][0-9A-Za-z.-]{0,63}$/

export function requireOwnmailPackageVersion(value: unknown): string {
	if (
		typeof value !== 'object' ||
		value === null ||
		!('version' in value) ||
		typeof value.version !== 'string' ||
		!PACKAGE_VERSION_PATTERN.test(value.version)
	) {
		throw new Error('OwnMail package version is invalid')
	}
	return value.version
}

/** Published release shared by the CLI and generated app manifests. */
export const OWNMAIL_VERSION = requireOwnmailPackageVersion(packageMetadata)

/** Stable, non-identifying marker used to find OwnMail traffic by release in Nylas logs. */
export const OWNMAIL_USER_AGENT = `ownmail/${OWNMAIL_VERSION}`

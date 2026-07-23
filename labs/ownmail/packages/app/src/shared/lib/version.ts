import appPackage from '../../../package.json'

const PACKAGE_VERSION_PATTERN = /^[0-9A-Za-z][0-9A-Za-z.-]{0,63}$/

export function requireOwnmailPackageVersion(value: unknown): string {
	if (typeof value !== 'string' || !PACKAGE_VERSION_PATTERN.test(value)) {
		throw new Error('OwnMail package version is invalid')
	}
	return value
}

/** Public build version shared by the UI and server-side request attribution. */
export const OWNMAIL_VERSION = requireOwnmailPackageVersion(appPackage.version)

import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { friendly, requireMailbox } from '#server/mailbox-boundary'
import { nylas } from '#server/nylas'
import { platform, usingDevMocks } from '#server/platform'
import { sessionAccountSummaries } from '#server/session'
import { siteNameFromEnv } from '#server/site-config'

const MAX_DISPLAY_NAME_LENGTH = 120

export const getMailboxInfo = createServerFn({ method: 'GET' }).handler(async () => {
	const { platform } = await import('#server/platform')
	const { env } = await platform()
	const { email, displayName: devDisplayName, grantId } = await requireMailbox()
	let displayName = devDisplayName
	if (!(await usingDevMocks())) {
		try {
			displayName = displayNameFromGrantResponse(await (await nylas()).getGrant(grantId), grantId)
		} catch (err) {
			throw friendly(err)
		}
	}
	const accounts = await sessionAccountSummaries(getRequest())
	return {
		email,
		...(displayName ? { displayName } : {}),
		appName: siteNameFromEnv(env),
		accounts: accounts ?? [],
	}
})

function normalizeDisplayNameInput(input: unknown): { displayName: string } {
	if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid display name')
	if (Object.keys(input).some((key) => key !== 'displayName')) throw new Error('Invalid display name')
	const value = (input as { displayName?: unknown }).displayName
	if (typeof value !== 'string') throw new Error('Invalid display name')
	const displayName = value.trim()
	if (
		displayName.length < 1 ||
		displayName.length > MAX_DISPLAY_NAME_LENGTH ||
		hasAsciiControlCharacter(displayName)
	) {
		throw new Error('Invalid display name')
	}
	return { displayName }
}

function hasAsciiControlCharacter(value: string): boolean {
	return [...value].some((character) => {
		const codePoint = character.codePointAt(0)
		return codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f)
	})
}

function displayNameFromGrantResponse(response: unknown, expectedGrantId: string): string | undefined {
	if (!response || typeof response !== 'object' || Array.isArray(response)) {
		throw new Error('Invalid account response')
	}
	const data = (response as { data?: unknown }).data
	if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid account response')
	const grant = data as { id?: unknown; name?: unknown }
	if (grant.id !== expectedGrantId) throw new Error('Invalid account response')
	if (grant.name === undefined || grant.name === null || grant.name === '') return undefined
	if (typeof grant.name !== 'string') throw new Error('Invalid account response')
	return normalizeDisplayNameInput({ displayName: grant.name }).displayName
}

/**
 * Renames only the authenticated session's active account. The client cannot
 * supply a grant id, and the follow-up read verifies that Nylas persisted the
 * requested name on that same grant before the UI adopts it.
 */
export const updateMailboxDisplayName = createServerFn({ method: 'POST' })
	.validator(normalizeDisplayNameInput)
	.handler(async ({ data }) => {
		const { grantId } = await requireMailbox()
		if (await usingDevMocks()) return { displayName: data.displayName }
		try {
			const client = await nylas()
			await client.updateGrant(grantId, { name: data.displayName })
			const persisted = displayNameFromGrantResponse(await client.getGrant(grantId), grantId)
			if (persisted !== data.displayName) throw new Error('Account update was not persisted')
			return { displayName: persisted }
		} catch {
			throw new Error('We could not update this account. Try again.')
		}
	})

/** Deliberately fail closed: administrators must explicitly opt in to web password changes. */
export const getAccountCapabilities = createServerFn({ method: 'GET' }).handler(async () => {
	const { env } = await platform()
	await requireMailbox()
	return { passwordResetEnabled: env.OWNMAIL_ALLOW_PASSWORD_RESET === 'true' }
})

function normalizePasswordResetInput(input: unknown): { password: string } {
	if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid password')
	const password = (input as { password?: unknown }).password
	if (
		typeof password !== 'string' ||
		password.length < 18 ||
		password.length > 40 ||
		/\s/.test(password) ||
		!/[a-z]/.test(password) ||
		!/[A-Z]/.test(password) ||
		!/[0-9]/.test(password) ||
		!/[^A-Za-z0-9]/.test(password)
	) {
		throw new Error('Password does not meet the required security rules')
	}
	return { password }
}

/**
 * Changes only the authenticated session's own Agent Account password. The
 * grant id is resolved server-side, so a client cannot target another mailbox.
 */
export const resetMailboxPassword = createServerFn({ method: 'POST' })
	.validator(normalizePasswordResetInput)
	.handler(async ({ data }) => {
		const { env } = await platform()
		if (env.OWNMAIL_ALLOW_PASSWORD_RESET !== 'true') throw new Error('Password changes are unavailable')
		const { grantId, email } = await requireMailbox()
		try {
			if (!(await usingDevMocks())) {
				await (await nylas()).updateGrant(grantId, { settings: { email, app_password: data.password } })
			}
		} catch (err) {
			throw friendly(err)
		}
		return { ok: true }
	})

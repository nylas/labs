const MAX_ACCOUNT_KEY_LENGTH = 320

/**
 * The normalized identity of a mailbox, used wherever account-owned data is
 * partitioned: query keys, optimistic journals and persisted preferences.
 *
 * The email arrives from a server response or from storage, so it is treated
 * as untrusted input: trimmed, lower-cased and validated. An unusable value
 * yields `undefined` rather than a guessed key. The key is an email address;
 * never log it.
 */
export function accountKey(email: unknown): string | undefined {
	if (typeof email !== 'string') return undefined
	const key = email.trim().toLowerCase()
	return key.length > 0 && key.length <= MAX_ACCOUNT_KEY_LENGTH && key.includes('@') && !/[\r\n]/.test(key)
		? key
		: undefined
}

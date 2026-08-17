const STORAGE_KEY = 'ownmail:trusted-image-senders:v1'
const MAX_TRUSTED_SENDERS = 200
const MAX_SENDER_LENGTH = 320
const encoder = new TextEncoder()

function canonicalSender(value: string | null | undefined): string | null {
	if (!value || value.length > MAX_SENDER_LENGTH || /[\r\n\0\s]/.test(value)) return null
	const normalized = value.trim().toLowerCase()
	return /^[^@]+@[^@]+\.[^@]+$/.test(normalized) ? normalized : null
}

function base64url(bytes: Uint8Array): string {
	let binary = ''
	for (const byte of bytes) binary += String.fromCharCode(byte)
	return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

export async function trustedImageSenderKey(sender: string | null | undefined): Promise<string | null> {
	const canonical = canonicalSender(sender)
	if (!canonical || !crypto.subtle) return null
	return base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(canonical))))
}

function readTrustedSenderKeys(storage: Storage): string[] {
	try {
		const parsed = JSON.parse(storage.getItem(STORAGE_KEY) ?? '[]') as unknown
		if (!Array.isArray(parsed)) return []
		return parsed
			.filter((value): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value))
			.slice(0, MAX_TRUSTED_SENDERS)
	} catch {
		return []
	}
}

export async function senderImagesTrusted(
	sender: string | null | undefined,
	storage: Storage = localStorage,
): Promise<boolean> {
	const key = await trustedImageSenderKey(sender)
	return key ? readTrustedSenderKeys(storage).includes(key) : false
}

export async function trustSenderImages(
	sender: string | null | undefined,
	storage: Storage = localStorage,
): Promise<boolean> {
	const key = await trustedImageSenderKey(sender)
	if (!key) return false
	try {
		const keys = readTrustedSenderKeys(storage).filter((candidate) => candidate !== key)
		storage.setItem(STORAGE_KEY, JSON.stringify([key, ...keys].slice(0, MAX_TRUSTED_SENDERS)))
		return true
	} catch {
		return false
	}
}

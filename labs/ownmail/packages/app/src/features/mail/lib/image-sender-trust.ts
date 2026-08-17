const STORAGE_KEY = 'ownmail:trusted-image-senders:v2'
const LEGACY_STORAGE_KEY = 'ownmail:trusted-image-senders:v1'
const DATABASE_NAME = 'ownmail-sender-trust'
const DATABASE_VERSION = 1
const KEY_STORE_NAME = 'keys'
const KEY_ID = 'sender-trust-aes-gcm-v1'
const MAX_TRUSTED_SENDERS = 200
const MAX_SENDER_LENGTH = 320
const MAX_ENCRYPTED_BYTES = 128 * 1024
const IV_BYTES = 12
const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8', { fatal: true })
const additionalData = encoder.encode(STORAGE_KEY)

interface EncryptedSenderRecord {
	v: 1
	iv: string
	ciphertext: string
}

export interface SenderTrustKeyStore {
	getOrCreateKey(): Promise<CryptoKey | null>
}

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

function decodeBase64url(value: string, maxBytes: number): Uint8Array<ArrayBuffer> | null {
	if (!value || value.length > Math.ceil((maxBytes * 4) / 3) || !/^[A-Za-z0-9_-]+$/.test(value)) {
		return null
	}
	try {
		const standard = value.replaceAll('-', '+').replaceAll('_', '/')
		const binary = atob(`${standard}${'='.repeat((4 - (standard.length % 4)) % 4)}`)
		const bytes = new Uint8Array(binary.length)
		for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
		return bytes
	} catch {
		return null
	}
}

function isEncryptedSenderRecord(value: unknown): value is EncryptedSenderRecord {
	if (!value || typeof value !== 'object') return false
	const candidate = value as Partial<EncryptedSenderRecord>
	return candidate.v === 1 && typeof candidate.iv === 'string' && typeof candidate.ciphertext === 'string'
}

function isSenderTrustKey(value: unknown): value is CryptoKey {
	if (!value || typeof value !== 'object') return false
	const candidate = value as Partial<CryptoKey>
	return (
		candidate.type === 'secret' &&
		candidate.extractable === false &&
		(candidate.algorithm as KeyAlgorithm | undefined)?.name === 'AES-GCM' &&
		Array.isArray(candidate.usages) &&
		candidate.usages.includes('encrypt') &&
		candidate.usages.includes('decrypt')
	)
}

function openKeyDatabase(database: IDBFactory): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const request = database.open(DATABASE_NAME, DATABASE_VERSION)
		request.onupgradeneeded = () => {
			request.result.createObjectStore(KEY_STORE_NAME)
		}
		request.onsuccess = () => resolve(request.result)
		request.onerror = reject
		request.onblocked = reject
	})
}

function selectOrPersistKey(database: IDBDatabase, generatedKey: CryptoKey): Promise<CryptoKey> {
	return new Promise((resolve, reject) => {
		const transaction = database.transaction(KEY_STORE_NAME, 'readwrite')
		const store = transaction.objectStore(KEY_STORE_NAME)
		const request = store.get(KEY_ID)
		let selectedKey = generatedKey

		request.onsuccess = () => {
			if (isSenderTrustKey(request.result)) selectedKey = request.result
			else store.put(generatedKey, KEY_ID)
		}
		request.onerror = reject
		transaction.oncomplete = () => resolve(selectedKey)
		transaction.onerror = reject
		transaction.onabort = reject
	})
}

async function loadOrCreateKey(database: IDBFactory, webCrypto: Crypto): Promise<CryptoKey> {
	const generatedKey = (await webCrypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
		'encrypt',
		'decrypt',
	])) as CryptoKey
	const keyDatabase = await openKeyDatabase(database)
	try {
		return await selectOrPersistKey(keyDatabase, generatedKey)
	} finally {
		keyDatabase.close()
	}
}

export function createSenderTrustKeyStore(
	database: IDBFactory | undefined = globalThis.indexedDB,
	webCrypto: Crypto | undefined = globalThis.crypto,
): SenderTrustKeyStore {
	let keyPromise: Promise<CryptoKey | null> | null = null
	return {
		getOrCreateKey() {
			if (!webCrypto?.subtle) return Promise.resolve(null)
			keyPromise ??= database
				? loadOrCreateKey(database, webCrypto).catch(() => null)
				: webCrypto.subtle
						.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
						.then((key) => key as CryptoKey)
						.catch(() => null)
			return keyPromise
		},
	}
}

const browserKeyStore = createSenderTrustKeyStore()

function boundedSenders(value: unknown): string[] {
	if (!Array.isArray(value)) return []
	const senders: string[] = []
	for (const valueSender of value) {
		const sender = typeof valueSender === 'string' ? canonicalSender(valueSender) : null
		if (sender && sender === valueSender && !senders.includes(sender)) senders.push(sender)
		if (senders.length === MAX_TRUSTED_SENDERS) break
	}
	return senders
}

async function readTrustedSenders(storage: Storage, key: CryptoKey): Promise<string[]> {
	try {
		const serialized = storage.getItem(STORAGE_KEY)
		if (!serialized || serialized.length > MAX_ENCRYPTED_BYTES * 2) return []
		const record: unknown = JSON.parse(serialized)
		if (!isEncryptedSenderRecord(record)) return []
		const iv = decodeBase64url(record.iv, IV_BYTES)
		const ciphertext = decodeBase64url(record.ciphertext, MAX_ENCRYPTED_BYTES)
		if (iv?.length !== IV_BYTES || !ciphertext || ciphertext.length < 16) return []
		const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData }, key, ciphertext)
		return boundedSenders(JSON.parse(decoder.decode(plaintext)) as unknown)
	} catch {
		return []
	}
}

async function writeTrustedSenders(storage: Storage, key: CryptoKey, senders: string[]): Promise<boolean> {
	try {
		const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
		const ciphertext = await crypto.subtle.encrypt(
			{ name: 'AES-GCM', iv, additionalData },
			key,
			encoder.encode(JSON.stringify(senders)),
		)
		storage.setItem(
			STORAGE_KEY,
			JSON.stringify({ v: 1, iv: base64url(iv), ciphertext: base64url(new Uint8Array(ciphertext)) }),
		)
		storage.removeItem(LEGACY_STORAGE_KEY)
		return true
	} catch {
		return false
	}
}

export async function senderImagesTrusted(
	sender: string | null | undefined,
	storage: Storage = localStorage,
	keyStore: SenderTrustKeyStore = browserKeyStore,
): Promise<boolean> {
	const canonical = canonicalSender(sender)
	const key = canonical ? await keyStore.getOrCreateKey() : null
	return key && canonical ? (await readTrustedSenders(storage, key)).includes(canonical) : false
}

export async function trustSenderImages(
	sender: string | null | undefined,
	storage: Storage = localStorage,
	keyStore: SenderTrustKeyStore = browserKeyStore,
): Promise<boolean> {
	const canonical = canonicalSender(sender)
	const key = canonical ? await keyStore.getOrCreateKey() : null
	if (!canonical || !key) return false
	const senders = (await readTrustedSenders(storage, key)).filter((candidate) => candidate !== canonical)
	return writeTrustedSenders(storage, key, [canonical, ...senders].slice(0, MAX_TRUSTED_SENDERS))
}

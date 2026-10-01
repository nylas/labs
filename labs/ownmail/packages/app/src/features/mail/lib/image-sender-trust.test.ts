// @vitest-environment jsdom
import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, it } from 'vitest'
import {
	clearTrustedImageSenders,
	createSenderTrustKeyStore,
	originalColorSenders,
	type SenderTrustKeyStore,
	senderImagesTrusted,
	setSenderOriginalColors,
	trustSenderImages,
} from './image-sender-trust.js'

const ADA = 'ada@ownmail.com'
const GRACE = 'grace@ownmail.com'
const STORAGE_KEY = `ownmail:trusted-image-senders:v3:${ADA}`
const LEGACY_SHARED_KEYS = [
	'ownmail:trusted-image-senders:v1',
	'ownmail:trusted-image-senders:v2',
	'ownmail:original-color-senders:v1',
]

function testKeyStore(database = new IDBFactory()) {
	return createSenderTrustKeyStore(database, crypto)
}

function encoded(bytes: Uint8Array): string {
	let binary = ''
	for (const byte of bytes) binary += String.fromCharCode(byte)
	return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

async function storeEncryptedPayload(keyStore: SenderTrustKeyStore, value: unknown) {
	const key = await keyStore.getOrCreateKey()
	if (!key) throw new Error('Expected a test encryption key.')
	const iv = crypto.getRandomValues(new Uint8Array(12))
	const ciphertext = await crypto.subtle.encrypt(
		{ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(STORAGE_KEY) },
		key,
		new TextEncoder().encode(JSON.stringify(value)),
	)
	localStorage.setItem(
		STORAGE_KEY,
		JSON.stringify({ v: 1, iv: encoded(iv), ciphertext: encoded(new Uint8Array(ciphertext)) }),
	)
}

beforeEach(() => localStorage.clear())

describe('trusted image senders', () => {
	it('encrypts normalized identities with a durable non-extractable browser key', async () => {
		const database = new IDBFactory()
		const keyStore = testKeyStore(database)
		await expect(senderImagesTrusted('News@Example.com', ADA, localStorage, keyStore)).resolves.toBe(false)
		await expect(trustSenderImages('News@Example.com', ADA, localStorage, keyStore)).resolves.toBe(true)
		await expect(senderImagesTrusted('news@example.com', ADA, localStorage, keyStore)).resolves.toBe(true)

		const stored = localStorage.getItem(STORAGE_KEY) ?? ''
		expect(stored).not.toContain('news@example.com')
		expect(stored).toMatch(/^\{"v":1,"iv":"[A-Za-z0-9_-]+","ciphertext":"[A-Za-z0-9_-]+"\}$/)
		await expect(
			senderImagesTrusted('NEWS@example.com', ADA, localStorage, testKeyStore(database)),
		).resolves.toBe(true)

		const key = await keyStore.getOrCreateKey()
		expect(key).toMatchObject({ type: 'secret', extractable: false, usages: ['encrypt', 'decrypt'] })
	})

	it('rejects malformed or oversized sender identities without accessing the key store', async () => {
		const rejectingKeyStore: SenderTrustKeyStore = {
			getOrCreateKey: () => Promise.reject(new Error('must not be called')),
		}
		for (const sender of [undefined, '', 'not-an-email', 'a b@example.com', `a@${'x'.repeat(321)}.com`]) {
			await expect(senderImagesTrusted(sender, ADA, localStorage, rejectingKeyStore)).resolves.toBe(false)
			await expect(trustSenderImages(sender, ADA, localStorage, rejectingKeyStore)).resolves.toBe(false)
		}
	})

	it('recovers from malformed and unavailable storage without trusting a sender', async () => {
		const keyStore = testKeyStore()
		for (const malformed of [
			'{bad',
			'null',
			JSON.stringify({ v: 2, iv: 'invalid', ciphertext: 'invalid' }),
			JSON.stringify({ v: 1, iv: 'invalid!', ciphertext: 'invalid' }),
			JSON.stringify({ v: 1, iv: 'a'.repeat(200), ciphertext: 'invalid' }),
			JSON.stringify({ v: 1, iv: 'AAAAAAAAAAAAAAAA', ciphertext: 'short' }),
		]) {
			localStorage.setItem(STORAGE_KEY, malformed)
			await expect(senderImagesTrusted('news@example.com', ADA, localStorage, keyStore)).resolves.toBe(false)
		}

		localStorage.setItem(STORAGE_KEY, 'x'.repeat(128 * 1024 * 2 + 1))
		await expect(senderImagesTrusted('news@example.com', ADA, localStorage, keyStore)).resolves.toBe(false)

		const throwingStorage = {
			getItem: () => {
				throw new Error('blocked')
			},
			setItem: () => {
				throw new Error('blocked')
			},
			removeItem: () => {
				throw new Error('blocked')
			},
		} as unknown as Storage
		await expect(senderImagesTrusted('news@example.com', ADA, throwingStorage, keyStore)).resolves.toBe(false)
		await expect(trustSenderImages('news@example.com', ADA, throwingStorage, keyStore)).resolves.toBe(false)
	})

	it('fails closed without cryptography and uses a non-persistent key when IndexedDB is unavailable', async () => {
		const unavailable: SenderTrustKeyStore = { getOrCreateKey: () => Promise.resolve(null) }
		await expect(senderImagesTrusted('news@example.com', ADA, localStorage, unavailable)).resolves.toBe(false)
		await expect(trustSenderImages('news@example.com', ADA, localStorage, unavailable)).resolves.toBe(false)
		await expect(createSenderTrustKeyStore(undefined, {} as Crypto).getOrCreateKey()).resolves.toBeNull()

		const memoryKeyStore = createSenderTrustKeyStore(undefined, crypto)
		await expect(trustSenderImages('news@example.com', ADA, localStorage, memoryKeyStore)).resolves.toBe(true)
		await expect(senderImagesTrusted('news@example.com', ADA, localStorage, memoryKeyStore)).resolves.toBe(
			true,
		)
	})

	it('clears current and legacy remembered sender permissions without reading their contents', async () => {
		localStorage.setItem(STORAGE_KEY, 'encrypted-record')
		localStorage.setItem('ownmail:trusted-image-senders:v1', 'legacy-record')

		expect(clearTrustedImageSenders(ADA)).toBe(true)
		expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
		expect(localStorage.getItem('ownmail:trusted-image-senders:v1')).toBeNull()

		const unavailable = {
			removeItem: () => {
				throw new Error('storage unavailable')
			},
		} as unknown as Storage
		expect(clearTrustedImageSenders(ADA, unavailable)).toBe(false)
		// Without a usable account there is no list to clear.
		expect(clearTrustedImageSenders('not-an-account')).toBe(false)
	})

	it('fails closed when browser key persistence or ephemeral key generation fails', async () => {
		const request = {} as IDBOpenDBRequest
		const failingDatabase = {
			open: () => {
				queueMicrotask(() => request.onerror?.(new Event('error')))
				return request
			},
		} as unknown as IDBFactory
		await expect(createSenderTrustKeyStore(failingDatabase, crypto).getOrCreateKey()).resolves.toBeNull()

		const failingCrypto = {
			subtle: { generateKey: () => Promise.reject(new Error('blocked')) },
		} as unknown as Crypto
		await expect(
			createSenderTrustKeyStore(null as unknown as IDBFactory, failingCrypto).getOrCreateKey(),
		).resolves.toBeNull()
	})

	it('accepts only canonical, unique identities from authenticated storage', async () => {
		const keyStore = testKeyStore()
		await storeEncryptedPayload(keyStore, { sender: 'news@example.com' })
		await expect(senderImagesTrusted('news@example.com', ADA, localStorage, keyStore)).resolves.toBe(false)

		await storeEncryptedPayload(keyStore, [null, 'NEWS@example.com', 'news@example.com', 'news@example.com'])
		await expect(senderImagesTrusted('news@example.com', ADA, localStorage, keyStore)).resolves.toBe(true)
	})

	it('bounds the encrypted list, de-duplicates entries, and removes the legacy digest list', async () => {
		const keyStore = testKeyStore()
		localStorage.setItem('ownmail:trusted-image-senders:v1', JSON.stringify(['legacy-digest']))
		for (let index = 0; index < 201; index += 1) {
			await expect(
				trustSenderImages(`sender-${index}@example.com`, ADA, localStorage, keyStore),
			).resolves.toBe(true)
		}
		await expect(senderImagesTrusted('sender-0@example.com', ADA, localStorage, keyStore)).resolves.toBe(
			false,
		)
		await expect(senderImagesTrusted('sender-200@example.com', ADA, localStorage, keyStore)).resolves.toBe(
			true,
		)
		await expect(trustSenderImages('sender-200@example.com', ADA, localStorage, keyStore)).resolves.toBe(true)
		expect(localStorage.getItem('ownmail:trusted-image-senders:v1')).toBeNull()
	})
})

describe('original color senders', () => {
	it('remembers and forgets senders in an encrypted list bound to its own storage key', async () => {
		const keyStore = testKeyStore()
		await expect(originalColorSenders(ADA, localStorage, keyStore)).resolves.toEqual([])
		await expect(
			setSenderOriginalColors('Brand@Example.com', true, ADA, localStorage, keyStore),
		).resolves.toBe(true)
		await expect(
			setSenderOriginalColors('news@example.com', true, ADA, localStorage, keyStore),
		).resolves.toBe(true)
		await expect(originalColorSenders(ADA, localStorage, keyStore)).resolves.toEqual([
			'news@example.com',
			'brand@example.com',
		])
		const stored = localStorage.getItem(`ownmail:original-color-senders:v2:${ADA}`) ?? ''
		expect(stored).not.toContain('example.com')

		await expect(
			setSenderOriginalColors('brand@example.com', false, ADA, localStorage, keyStore),
		).resolves.toBe(true)
		await expect(originalColorSenders(ADA, localStorage, keyStore)).resolves.toEqual(['news@example.com'])
		await expect(senderImagesTrusted('news@example.com', ADA, localStorage, keyStore)).resolves.toBe(false)

		localStorage.setItem(STORAGE_KEY, stored)
		await expect(senderImagesTrusted('news@example.com', ADA, localStorage, keyStore)).resolves.toBe(false)
	})

	it('fails closed for malformed senders and unavailable cryptography', async () => {
		const unavailable: SenderTrustKeyStore = { getOrCreateKey: async () => null }
		await expect(
			setSenderOriginalColors('not an address', true, ADA, localStorage, testKeyStore()),
		).resolves.toBe(false)
		await expect(
			setSenderOriginalColors('a@example.com', true, ADA, localStorage, unavailable),
		).resolves.toBe(false)
		await expect(originalColorSenders(ADA, localStorage, unavailable)).resolves.toEqual([])
	})
})

describe('per-inbox sender choices', () => {
	it('never applies a choice made in one inbox to another', async () => {
		const keyStore = testKeyStore()
		await expect(trustSenderImages('news@example.com', ADA, localStorage, keyStore)).resolves.toBe(true)
		await expect(
			setSenderOriginalColors('news@example.com', true, ADA, localStorage, keyStore),
		).resolves.toBe(true)

		// Grace never chose to load this sender's images or keep its colours.
		await expect(senderImagesTrusted('news@example.com', GRACE, localStorage, keyStore)).resolves.toBe(false)
		await expect(originalColorSenders(GRACE, localStorage, keyStore)).resolves.toEqual([])
		// The same mailbox is the same list however its address is written.
		await expect(
			senderImagesTrusted('news@example.com', ' ADA@OwnMail.com ', localStorage, keyStore),
		).resolves.toBe(true)

		// Clearing Grace's choices leaves Ada's alone.
		expect(clearTrustedImageSenders(GRACE)).toBe(true)
		await expect(senderImagesTrusted('news@example.com', ADA, localStorage, keyStore)).resolves.toBe(true)
	})

	it('cannot replay one inbox’s encrypted list as another’s', async () => {
		const keyStore = testKeyStore()
		await trustSenderImages('news@example.com', ADA, localStorage, keyStore)

		// The list is bound to its storage key, so copying the record fails to decrypt.
		localStorage.setItem(`ownmail:trusted-image-senders:v3:${GRACE}`, localStorage.getItem(STORAGE_KEY) ?? '')

		await expect(senderImagesTrusted('news@example.com', GRACE, localStorage, keyStore)).resolves.toBe(false)
	})

	it('drops lists saved before choices were per-inbox instead of applying them to the active inbox', async () => {
		const keyStore = testKeyStore()
		for (const legacyKey of LEGACY_SHARED_KEYS) localStorage.setItem(legacyKey, 'shared-record')

		// A shared list cannot be attributed to an inbox, so it is never read.
		await expect(senderImagesTrusted('news@example.com', ADA, localStorage, keyStore)).resolves.toBe(false)
		await expect(originalColorSenders(ADA, localStorage, keyStore)).resolves.toEqual([])

		await trustSenderImages('news@example.com', ADA, localStorage, keyStore)
		for (const legacyKey of LEGACY_SHARED_KEYS) expect(localStorage.getItem(legacyKey)).toBeNull()
	})

	it('fails closed, without touching the key store, when the account is unknown', async () => {
		const rejectingKeyStore: SenderTrustKeyStore = {
			getOrCreateKey: () => Promise.reject(new Error('must not be called')),
		}
		for (const account of [undefined, null, '', 'unknown', 'server']) {
			await expect(
				senderImagesTrusted('news@example.com', account, localStorage, rejectingKeyStore),
			).resolves.toBe(false)
			await expect(
				trustSenderImages('news@example.com', account, localStorage, rejectingKeyStore),
			).resolves.toBe(false)
			await expect(originalColorSenders(account, localStorage, rejectingKeyStore)).resolves.toEqual([])
			await expect(
				setSenderOriginalColors('news@example.com', true, account, localStorage, rejectingKeyStore),
			).resolves.toBe(false)
		}
		expect(localStorage.length).toBe(0)
	})
})

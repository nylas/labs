// @vitest-environment jsdom
import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, it } from 'vitest'
import {
	clearTrustedImageSenders,
	createSenderTrustKeyStore,
	type SenderTrustKeyStore,
	senderImagesTrusted,
	trustSenderImages,
} from './image-sender-trust.js'

const STORAGE_KEY = 'ownmail:trusted-image-senders:v2'

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
		await expect(senderImagesTrusted('News@Example.com', localStorage, keyStore)).resolves.toBe(false)
		await expect(trustSenderImages('News@Example.com', localStorage, keyStore)).resolves.toBe(true)
		await expect(senderImagesTrusted('news@example.com', localStorage, keyStore)).resolves.toBe(true)

		const stored = localStorage.getItem(STORAGE_KEY) ?? ''
		expect(stored).not.toContain('news@example.com')
		expect(stored).toMatch(/^\{"v":1,"iv":"[A-Za-z0-9_-]+","ciphertext":"[A-Za-z0-9_-]+"\}$/)
		await expect(senderImagesTrusted('NEWS@example.com', localStorage, testKeyStore(database))).resolves.toBe(
			true,
		)

		const key = await keyStore.getOrCreateKey()
		expect(key).toMatchObject({ type: 'secret', extractable: false, usages: ['encrypt', 'decrypt'] })
	})

	it('rejects malformed or oversized sender identities without accessing the key store', async () => {
		const rejectingKeyStore: SenderTrustKeyStore = {
			getOrCreateKey: () => Promise.reject(new Error('must not be called')),
		}
		for (const sender of [undefined, '', 'not-an-email', 'a b@example.com', `a@${'x'.repeat(321)}.com`]) {
			await expect(senderImagesTrusted(sender, localStorage, rejectingKeyStore)).resolves.toBe(false)
			await expect(trustSenderImages(sender, localStorage, rejectingKeyStore)).resolves.toBe(false)
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
			await expect(senderImagesTrusted('news@example.com', localStorage, keyStore)).resolves.toBe(false)
		}

		localStorage.setItem(STORAGE_KEY, 'x'.repeat(128 * 1024 * 2 + 1))
		await expect(senderImagesTrusted('news@example.com', localStorage, keyStore)).resolves.toBe(false)

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
		await expect(senderImagesTrusted('news@example.com', throwingStorage, keyStore)).resolves.toBe(false)
		await expect(trustSenderImages('news@example.com', throwingStorage, keyStore)).resolves.toBe(false)
	})

	it('fails closed without cryptography and uses a non-persistent key when IndexedDB is unavailable', async () => {
		const unavailable: SenderTrustKeyStore = { getOrCreateKey: () => Promise.resolve(null) }
		await expect(senderImagesTrusted('news@example.com', localStorage, unavailable)).resolves.toBe(false)
		await expect(trustSenderImages('news@example.com', localStorage, unavailable)).resolves.toBe(false)
		await expect(createSenderTrustKeyStore(undefined, {} as Crypto).getOrCreateKey()).resolves.toBeNull()

		const memoryKeyStore = createSenderTrustKeyStore(undefined, crypto)
		await expect(trustSenderImages('news@example.com', localStorage, memoryKeyStore)).resolves.toBe(true)
		await expect(senderImagesTrusted('news@example.com', localStorage, memoryKeyStore)).resolves.toBe(true)
	})

	it('clears current and legacy remembered sender permissions without reading their contents', async () => {
		localStorage.setItem(STORAGE_KEY, 'encrypted-record')
		localStorage.setItem('ownmail:trusted-image-senders:v1', 'legacy-record')

		expect(clearTrustedImageSenders()).toBe(true)
		expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
		expect(localStorage.getItem('ownmail:trusted-image-senders:v1')).toBeNull()

		const unavailable = {
			removeItem: () => {
				throw new Error('storage unavailable')
			},
		} as unknown as Storage
		expect(clearTrustedImageSenders(unavailable)).toBe(false)
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
		await expect(senderImagesTrusted('news@example.com', localStorage, keyStore)).resolves.toBe(false)

		await storeEncryptedPayload(keyStore, [null, 'NEWS@example.com', 'news@example.com', 'news@example.com'])
		await expect(senderImagesTrusted('news@example.com', localStorage, keyStore)).resolves.toBe(true)
	})

	it('bounds the encrypted list, de-duplicates entries, and removes the legacy digest list', async () => {
		const keyStore = testKeyStore()
		localStorage.setItem('ownmail:trusted-image-senders:v1', JSON.stringify(['legacy-digest']))
		for (let index = 0; index < 201; index += 1) {
			await expect(trustSenderImages(`sender-${index}@example.com`, localStorage, keyStore)).resolves.toBe(
				true,
			)
		}
		await expect(senderImagesTrusted('sender-0@example.com', localStorage, keyStore)).resolves.toBe(false)
		await expect(senderImagesTrusted('sender-200@example.com', localStorage, keyStore)).resolves.toBe(true)
		await expect(trustSenderImages('sender-200@example.com', localStorage, keyStore)).resolves.toBe(true)
		expect(localStorage.getItem('ownmail:trusted-image-senders:v1')).toBeNull()
	})
})

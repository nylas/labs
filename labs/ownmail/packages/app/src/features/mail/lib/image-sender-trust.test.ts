// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { senderImagesTrusted, trustedImageSenderKey, trustSenderImages } from './image-sender-trust.js'

beforeEach(() => localStorage.clear())

describe('trusted image senders', () => {
	it('stores only a one-way canonical sender digest', async () => {
		await expect(senderImagesTrusted('News@Example.com')).resolves.toBe(false)
		await expect(trustSenderImages('News@Example.com')).resolves.toBe(true)
		await expect(senderImagesTrusted('news@example.com')).resolves.toBe(true)
		const stored = localStorage.getItem('ownmail:trusted-image-senders:v1') ?? ''
		expect(stored).not.toContain('news@example.com')
		expect(JSON.parse(stored)).toEqual([await trustedImageSenderKey('news@example.com')])
	})

	it('rejects malformed or oversized sender identities', async () => {
		for (const sender of [undefined, '', 'not-an-email', 'a b@example.com', `a@${'x'.repeat(321)}.com`]) {
			await expect(trustedImageSenderKey(sender)).resolves.toBeNull()
			await expect(trustSenderImages(sender)).resolves.toBe(false)
		}
	})

	it('recovers from malformed and unavailable storage without trusting a sender', async () => {
		localStorage.setItem('ownmail:trusted-image-senders:v1', '{bad')
		await expect(senderImagesTrusted('news@example.com')).resolves.toBe(false)
		const throwingStorage = {
			getItem: () => {
				throw new Error('blocked')
			},
			setItem: () => {
				throw new Error('blocked')
			},
		} as unknown as Storage
		await expect(senderImagesTrusted('news@example.com', throwingStorage)).resolves.toBe(false)
		await expect(trustSenderImages('news@example.com', throwingStorage)).resolves.toBe(false)
	})

	it('ignores invalid stored values, bounds the list, and de-duplicates the current sender', async () => {
		const key = await trustedImageSenderKey('news@example.com')
		localStorage.setItem(
			'ownmail:trusted-image-senders:v1',
			JSON.stringify([null, 'invalid', key, ...Array.from({ length: 220 }, () => 'a'.repeat(43))]),
		)
		await expect(senderImagesTrusted('news@example.com')).resolves.toBe(true)
		await expect(trustSenderImages('news@example.com')).resolves.toBe(true)
		const stored = JSON.parse(localStorage.getItem('ownmail:trusted-image-senders:v1') ?? '[]')
		expect(stored).toHaveLength(200)
		expect(stored.filter((candidate: string) => candidate === key)).toHaveLength(1)

		localStorage.setItem('ownmail:trusted-image-senders:v1', JSON.stringify({ key }))
		await expect(senderImagesTrusted('news@example.com')).resolves.toBe(false)
	})
})

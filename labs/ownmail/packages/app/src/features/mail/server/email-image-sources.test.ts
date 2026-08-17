import type { Message } from '@nylas-labs/cli-kit/v3'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('#server/platform', () => ({
	platform: vi.fn(async () => ({ env: { SESSION_SECRET: 'test-session-secret-long-enough' } })),
}))

import {
	protectMessageImageSources,
	signEmailImageSource,
	verifyEmailImageSource,
} from './email-image-sources.js'

function message(input: Partial<Message> = {}): Message {
	return {
		id: 'message-1',
		thread_id: 'thread-1',
		grant_id: 'provider-grant',
		date: 1,
		folders: ['inbox'],
		starred: false,
		unread: false,
		...input,
	} as Message
}

function tokensFromHtml(html: string): string[] {
	return Array.from(
		html.matchAll(/\/email-images\/([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)/g),
		(match) => match[1] as string,
	)
}

function base64url(value: Uint8Array): string {
	let binary = ''
	for (const byte of value) binary += String.fromCharCode(byte)
	return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

async function signedRawPayload(value: string, secret = 'test-session-secret-long-enough'): Promise<string> {
	const payload = new TextEncoder().encode(value)
	const key = await crypto.subtle.importKey(
		'raw',
		new TextEncoder().encode(secret),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign'],
	)
	const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, payload))
	return `${base64url(payload)}.${base64url(signature)}`
}

beforeEach(() => vi.clearAllMocks())

describe('email image source tokens', () => {
	it('signs and verifies strict remote and attachment sources', async () => {
		const expiresAt = Date.now() + 60_000
		const remote = {
			version: 1,
			kind: 'remote',
			url: 'https://images.example/logo.png',
			trackingHint: false,
			expiresAt,
		} as const
		const attachment = {
			version: 1,
			kind: 'attachment',
			attachmentId: 'attachment-1',
			messageId: 'message-1',
			expiresAt,
		} as const

		await expect(verifyEmailImageSource(await signEmailImageSource(remote))).resolves.toEqual(remote)
		await expect(verifyEmailImageSource(await signEmailImageSource(attachment))).resolves.toEqual(attachment)
	})

	it('rejects malformed, tampered, expired, and implausibly future tokens', async () => {
		const now = Date.now()
		const valid = await signEmailImageSource({
			version: 1,
			kind: 'remote',
			url: 'https://images.example/a.png',
			trackingHint: false,
			expiresAt: now + 1_000,
		})
		await expect(verifyEmailImageSource('bad')).resolves.toBeNull()
		await expect(verifyEmailImageSource(`a.${'a'.repeat(43)}`)).resolves.toBeNull()
		await expect(verifyEmailImageSource(`${'a'.repeat(12_001)}.abc`)).resolves.toBeNull()
		await expect(verifyEmailImageSource(`${valid.slice(0, -1)}x`)).resolves.toBeNull()
		await expect(
			verifyEmailImageSource(await signedRawPayload('{"version":1}', 'different-test-secret')),
		).resolves.toBeNull()
		await expect(verifyEmailImageSource(valid, now + 2_000)).resolves.toBeNull()
		await expect(verifyEmailImageSource(valid, now - 15 * 24 * 60 * 60 * 1000)).resolves.toBeNull()
	})

	it('rejects signed payloads with unsupported fields and invalid source values', async () => {
		const expiresAt = Date.now() + 10_000
		await expect(verifyEmailImageSource(await signedRawPayload('{not-json'))).resolves.toBeNull()
		const invalid = [
			null,
			[],
			{ version: 2, kind: 'remote', url: 'https://x.test/a', trackingHint: false, expiresAt },
			{ version: 1, kind: 'remote', url: '', trackingHint: false, expiresAt },
			{ version: 1, kind: 'remote', url: 'http://%', trackingHint: false, expiresAt },
			{
				version: 1,
				kind: 'remote',
				url: `https://x.test/${'a'.repeat(4_096)}`,
				trackingHint: false,
				expiresAt,
			},
			{ version: 1, kind: 'remote', url: 'file:///tmp/a', trackingHint: false, expiresAt },
			{ version: 1, kind: 'remote', url: 'https://u:p@x.test/a', trackingHint: false, expiresAt },
			{ version: 1, kind: 'remote', url: 'https://x.test/a', trackingHint: 'no', expiresAt },
			{ version: 1, kind: 'remote', url: 'https://x.test/a', trackingHint: false, expiresAt, extra: true },
			{ version: 1, kind: 'attachment', attachmentId: '', messageId: 'm', expiresAt },
			{ version: 1, kind: 'attachment', attachmentId: 'a'.repeat(1_001), messageId: 'm', expiresAt },
			{ version: 1, kind: 'attachment', attachmentId: 'a', messageId: 'm\n', expiresAt },
			{ version: 1, kind: 'attachment', attachmentId: 'a', messageId: 'm', expiresAt, extra: true },
			{ version: 1, kind: 'unknown', expiresAt },
		]
		for (const source of invalid) {
			await expect(verifyEmailImageSource(await signEmailImageSource(source as never))).resolves.toBeNull()
		}
	})
})

describe('protectMessageImageSources', () => {
	it('keeps signed source identifiers stable within one cache window', async () => {
		vi.useFakeTimers()
		try {
			vi.setSystemTime(new Date('2026-08-17T00:00:00Z'))
			const first = await protectMessageImageSources(
				message({ body: '<img src="https://images.example/logo.png">' }),
			)
			vi.setSystemTime(new Date('2026-08-17T01:00:00Z'))
			const second = await protectMessageImageSources(
				message({ body: '<img src="https://images.example/logo.png">' }),
			)
			expect(tokensFromHtml(first.body ?? '')).toEqual(tokensFromHtml(second.body ?? ''))
		} finally {
			vi.useRealTimers()
		}
	})

	it('rewrites image attributes, srcset, CSS, and SVG images while preserving links', async () => {
		const result = await protectMessageImageSources(
			message({
				body: `
					<a href="https://links.example/read">Read</a>
					<img src="file:///tmp/blocked.png" style="background-image:url(data:image/png;base64,abc)">
					<img src="https://images.example/logo.png" srcset="https://images.example/small.png 1x, https://images.example/large.png 2x">
					<table background="//images.example/background.jpg"><tr><td style="background-image:url('https://images.example/card.png')">Card</td></tr></table>
					<style>.hero{background:url(https://images.example/hero.webp)}</style>
					<svg><image href="https://images.example/vector.png"></image></svg>
				`,
			}),
		)

		expect(result.ownmailImagesAttested).toBe(true)
		expect(result.body).toContain('href="https://links.example/read"')
		expect(result.body).not.toContain('https://images.example/')
		expect(tokensFromHtml(result.body ?? '')).toHaveLength(7)
		for (const token of tokensFromHtml(result.body ?? '')) {
			const source = await verifyEmailImageSource(token)
			expect(source?.kind).toBe('remote')
		}
	})

	it('marks obvious tracking sources before any proxy fetch', async () => {
		const result = await protectMessageImageSources(
			message({ body: '<img width="1" height="1" src="https://metrics.example/open/pixel.gif">' }),
		)
		const [token] = tokensFromHtml(result.body ?? '')
		const source = await verifyEmailImageSource(token ?? '')
		expect(source).toMatchObject({ kind: 'remote', trackingHint: true })
	})

	it('recognizes CSS-sized tracking images and protocol-relative image sources', async () => {
		const result = await protectMessageImageSources(
			message({ body: '<img style="width: 2px; height: 10px" src="//images.example/a.gif">' }),
		)
		const [token] = tokensFromHtml(result.body ?? '')
		await expect(verifyEmailImageSource(token ?? '')).resolves.toMatchObject({
			kind: 'remote',
			trackingHint: true,
			url: 'https://images.example/a.gif',
		})
	})

	it('attests inline attachments and removes provider-spoofed OwnMail fields', async () => {
		const result = await protectMessageImageSources(
			message({
				body: '<p>Inline</p>',
				attachments: [
					{ id: 'inline-1', is_inline: true, content_id: 'logo@example' },
					{ id: 'regular-1', is_inline: false },
				],
				...({
					ownmailImageTokens: { attacker: 'forged' },
					ownmailImagesAttested: true,
				} as never),
			}),
		)

		expect(Object.keys(result.ownmailImageTokens ?? {})).toEqual(['inline-1'])
		const source = await verifyEmailImageSource(result.ownmailImageTokens?.['inline-1'] ?? '')
		expect(source).toMatchObject({
			kind: 'attachment',
			attachmentId: 'inline-1',
			messageId: 'message-1',
		})
	})

	it('returns attested messages unchanged when bodies or eligible sources are absent', async () => {
		await expect(protectMessageImageSources(message({ body: undefined }))).resolves.toMatchObject({
			id: 'message-1',
		})
		const plain = await protectMessageImageSources(message({ body: '<p>No images</p>' }))
		expect(plain.body).toBe('<p>No images</p>')
		expect(plain.ownmailImagesAttested).toBeUndefined()
		const attachmentOnly = await protectMessageImageSources(
			message({
				body: undefined,
				attachments: [{ id: 'inline-1', is_inline: true, content_id: 'logo@example' }],
			}),
		)
		expect(attachmentOnly.ownmailImagesAttested).toBe(true)
		expect(attachmentOnly.ownmailImageTokens).toHaveProperty('inline-1')
	})

	it('leaves invalid, credentialed, and non-HTTP sources for the client sanitizer to block', async () => {
		const body = '<img src="file:///tmp/a"><img src="https://user:pass@images.example/a.png">'
		const result = await protectMessageImageSources(message({ body }))
		expect(result.body).toBe(body)
	})

	it('handles quoted srcset candidates and bounds unique sources per message', async () => {
		const many = Array.from(
			{ length: 270 },
			(_, index) => `<img src="https://images.example/${index}.png">`,
		).join('')
		const result = await protectMessageImageSources(
			message({
				body: `<img srcset=", 'https://images.example/a.png' 1x, https://images.example/b.png?size=(1,2) 2x">${many}<div style="background:url(https://images.example/late.png)"></div><style>.late{background:url(https://images.example/later.png)}</style>`,
			}),
		)
		expect(tokensFromHtml(result.body ?? '')).toHaveLength(256)
		expect(result.body).toContain('https://images.example/269.png')
	})

	it('returns both inline attachment tokens and remote proxy references together', async () => {
		const result = await protectMessageImageSources(
			message({
				body: '<img src="https://images.example/logo.png">',
				attachments: [{ id: 'inline-1', is_inline: true, content_id: 'logo@example' }],
			}),
		)
		expect(result.ownmailImageTokens).toHaveProperty('inline-1')
		expect(tokensFromHtml(result.body ?? '')).toHaveLength(1)
	})
})

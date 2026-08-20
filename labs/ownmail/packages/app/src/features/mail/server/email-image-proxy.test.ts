import { deflateSync } from 'node:zlib'
import sharp from 'sharp'
import { describe, expect, it, vi } from 'vitest'

const dnsMocks = vi.hoisted(() => ({
	resolve4: vi.fn(),
	resolve6: vi.fn(),
}))

vi.mock('node:dns', () => ({ promises: dnsMocks }))

import {
	fetchRemoteImage,
	processEmailImage,
	publicIpAddress,
	validatePublicImageUrl,
} from './email-image-proxy.js'

function bytes(value: string): Uint8Array {
	return new TextEncoder().encode(value)
}

function binaryChunk(type: string, data: Uint8Array): Uint8Array {
	const output = new Uint8Array(data.length + 12)
	new DataView(output.buffer).setUint32(0, data.length)
	output.set(bytes(type), 4)
	output.set(data, 8)
	return output
}

function riffChunk(type: string, data: Uint8Array): Uint8Array {
	const output = new Uint8Array(8 + data.length + (data.length % 2))
	output.set(bytes(type))
	new DataView(output.buffer).setUint32(4, data.length, true)
	output.set(data, 8)
	return output
}

function customPng(
	width: number,
	height: number,
	colorType: 0 | 2 | 3 | 4 | 6,
	filtered: Uint8Array,
	extras: Uint8Array[] = [],
): Uint8Array {
	const ihdr = new Uint8Array(13)
	const view = new DataView(ihdr.buffer)
	view.setUint32(0, width)
	view.setUint32(4, height)
	ihdr.set([8, colorType, 0, 0, 0], 8)
	const chunks = [
		binaryChunk('IHDR', ihdr),
		...extras,
		binaryChunk('IDAT', deflateSync(filtered)),
		binaryChunk('IEND', new Uint8Array()),
	]
	const output = new Uint8Array(8 + chunks.reduce((sum, chunk) => sum + chunk.length, 0))
	output.set(Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10))
	let offset = 8
	for (const chunk of chunks) {
		output.set(chunk, offset)
		offset += chunk.length
	}
	return output
}

async function png(
	width: number,
	height: number,
	channels: 3 | 4,
	pixel: (index: number) => number[],
): Promise<Uint8Array> {
	const data = Uint8Array.from({ length: width * height * channels }, (_, offset) => {
		const index = Math.floor(offset / channels)
		return pixel(index)[offset % channels] ?? 0
	})
	return new Uint8Array(await sharp(data, { raw: { width, height, channels } }).png().toBuffer())
}

describe('public image destination validation', () => {
	it.each([
		['8.8.8.8', true],
		['1.1.1.1', true],
		['10.0.0.1', false],
		['127.0.0.1', false],
		['169.254.169.254', false],
		['172.16.0.1', false],
		['192.168.0.1', false],
		['100.64.0.1', false],
		['192.0.2.1', false],
		['0.1.1.1', false],
		['192.0.0.1', false],
		['192.88.99.1', false],
		['198.18.0.1', false],
		['198.51.100.1', false],
		['203.0.113.1', false],
		['224.0.0.1', false],
		['2606:4700:4700::1111', true],
		['::1', false],
		['::', false],
		['fc00::1', false],
		['fe80::1', false],
		['ff02::1', false],
		['::ffff:10.0.0.1', false],
		['::ffff:8.8.8.8', true],
		['2001:db8::1', false],
		['2001::1', false],
		['2001:10::1', false],
		['2001:20::1', false],
		['100::1', false],
		['64:ff9b::1', false],
		['2606:4700:4700::1111%eth0', true],
		['2002::1', false],
		['1.2.3', false],
		['256.1.1.1', false],
		['1::2::3', false],
		['1:2:3:4:5:6:7', false],
		['1:2:3:4:5:6:7:10000', false],
		['::ffff:999.1.1.1', false],
		['not-an-ip', false],
	])('classifies %s as public=%s', (address, expected) => {
		expect(publicIpAddress(address)).toBe(expected)
	})

	it('accepts only credential-free HTTP(S) default-port destinations with wholly public DNS', async () => {
		const resolve = vi.fn(async () => ['8.8.8.8', '2606:4700:4700::1111'])
		await expect(validatePublicImageUrl('https://images.example/a.png', resolve)).resolves.toMatchObject({
			hostname: 'images.example',
		})
		for (const value of [
			'not a url',
			'file:///tmp/a',
			'https://user:pass@images.example/a',
			'https://localhost/a',
			'https://host.local/a',
			'https://images.example:8443/a',
		]) {
			await expect(validatePublicImageUrl(value, resolve)).rejects.toThrow('Image unavailable')
		}
		await expect(validatePublicImageUrl('https://images.example/a', async () => [])).rejects.toThrow()
		await expect(
			validatePublicImageUrl('https://images.example/a', async () => ['8.8.8.8', '127.0.0.1']),
		).rejects.toThrow()
		await expect(
			validatePublicImageUrl('https://mail.example/a', resolve, 'https://mail.example'),
		).rejects.toThrow()
		await expect(
			validatePublicImageUrl('https://images.example/a', resolve, 'https://mail.example'),
		).resolves.toMatchObject({ hostname: 'images.example' })
		await expect(validatePublicImageUrl('https://8.8.8.8/a')).resolves.toMatchObject({
			hostname: '8.8.8.8',
		})
	})

	it('resolves both address families with the runtime DNS implementation', async () => {
		dnsMocks.resolve4.mockResolvedValueOnce(['8.8.8.8']).mockRejectedValueOnce(new Error('no A'))
		dnsMocks.resolve6
			.mockRejectedValueOnce(new Error('no AAAA'))
			.mockResolvedValueOnce(['2606:4700:4700::1111'])
		await expect(validatePublicImageUrl('https://v4.example/a')).resolves.toBeInstanceOf(URL)
		await expect(validatePublicImageUrl('https://v6.example/a')).resolves.toBeInstanceOf(URL)
	})
})

describe('remote image fetch policy', () => {
	it('follows a bounded validated redirect without forwarding user headers', async () => {
		const fetcher = vi
			.fn()
			.mockResolvedValueOnce(new Response(null, { status: 302, headers: { Location: '/final.png' } }))
			.mockResolvedValueOnce(new Response(bytes('safe-image')))
		const resolveHost = vi.fn(async () => ['8.8.8.8'])

		await expect(fetchRemoteImage('https://images.example/start', { fetcher, resolveHost })).resolves.toEqual(
			bytes('safe-image'),
		)
		expect(fetcher).toHaveBeenCalledTimes(2)
		const init = fetcher.mock.calls[0]?.[1] as RequestInit
		expect(init.credentials).toBe('omit')
		expect(init.redirect).toBe('manual')
		const headers = new Headers(init.headers)
		expect(headers.has('cookie')).toBe(false)
		expect(headers.get('accept')).toBe('image/webp,image/png,image/jpeg,image/gif;q=0.9')
		expect(headers.get('accept')).not.toContain('avif')
		expect(resolveHost).toHaveBeenCalledTimes(3)
	})

	it('rejects redirects to private DNS, redirect loops, failures, missing bodies, and oversized bodies', async () => {
		const redirect = vi.fn(
			async () => new Response(null, { status: 302, headers: { Location: 'http://private.test/a' } }),
		)
		await expect(
			fetchRemoteImage('https://public.test/a', {
				fetcher: redirect,
				resolveHost: async (host) => (host === 'private.test' ? ['127.0.0.1'] : ['8.8.8.8']),
			}),
		).rejects.toThrow('Image unavailable')

		const loop = vi.fn(async () => new Response(null, { status: 302, headers: { Location: '/again' } }))
		await expect(
			fetchRemoteImage('https://public.test/a', { fetcher: loop, resolveHost: async () => ['8.8.8.8'] }),
		).rejects.toThrow()
		expect(loop).toHaveBeenCalledTimes(4)
		await expect(
			fetchRemoteImage('https://public.test/a', {
				fetcher: async () => new Response(null, { status: 302 }),
				resolveHost: async () => ['8.8.8.8'],
			}),
		).rejects.toThrow()

		for (const response of [
			new Response('no', { status: 500 }),
			new Response(null, { status: 200 }),
			new Response('x', { headers: { 'Content-Length': String(9 * 1024 * 1024) } }),
		]) {
			await expect(
				fetchRemoteImage('https://public.test/a', {
					fetcher: async () => response,
					resolveHost: async () => ['8.8.8.8'],
				}),
			).rejects.toThrow()
		}

		const oversizedStream = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(new Uint8Array(8 * 1024 * 1024))
				controller.enqueue(new Uint8Array([1]))
				controller.close()
			},
		})
		await expect(
			fetchRemoteImage('https://public.test/a', {
				fetcher: async () => new Response(oversizedStream),
				resolveHost: async () => ['8.8.8.8'],
			}),
		).rejects.toThrow()
	})

	it('aborts a stalled upstream request at the fixed deadline', async () => {
		vi.useFakeTimers()
		try {
			const pending = fetchRemoteImage('https://public.test/a', {
				resolveHost: async () => ['8.8.8.8'],
				fetcher: async (_input, init) =>
					new Promise<Response>((_resolve, reject) => {
						init.signal?.addEventListener('abort', () => reject(new Error('aborted')))
					}),
			})
			const rejection = expect(pending).rejects.toThrow('Image unavailable')
			await vi.advanceTimersByTimeAsync(8_000)
			await rejection
		} finally {
			vi.useRealTimers()
		}
	})

	it('uses hardened defaults when no fetch dependencies are injected', async () => {
		const fetcher = vi.fn(async () => new Response(bytes('image')))
		vi.stubGlobal('fetch', fetcher)
		vi.stubGlobal('navigator', { userAgent: 'Cloudflare-Workers' })
		try {
			await expect(fetchRemoteImage('https://8.8.8.8/a.png')).resolves.toEqual(bytes('image'))
			expect(fetcher).toHaveBeenCalledOnce()
		} finally {
			vi.unstubAllGlobals()
		}
	})

	it('allows rotating public CDN pools while rejecting private or mixed post-transfer DNS', async () => {
		const rotatingPublic = vi
			.fn()
			.mockResolvedValueOnce(['8.8.8.8', '1.1.1.1'])
			.mockResolvedValueOnce(['9.9.9.9', '2606:4700:4700::1111'])
		const fetcher = vi.fn(async () => new Response(bytes('image')))
		await expect(
			fetchRemoteImage('https://images.example/a.png', {
				fetcher,
				resolveHost: rotatingPublic,
			}),
		).resolves.toEqual(bytes('image'))
		expect(rotatingPublic).toHaveBeenCalledTimes(2)
		expect(fetcher).toHaveBeenCalledWith('https://images.example/a.png', expect.any(Object), [
			'1.1.1.1',
			'8.8.8.8',
		])

		for (const rebound of [['127.0.0.1'], ['1.1.1.1', '10.0.0.1'], []]) {
			const resolveHost = vi.fn().mockResolvedValueOnce(['8.8.8.8']).mockResolvedValueOnce(rebound)
			await expect(
				fetchRemoteImage('https://images.example/a.png', {
					fetcher: async () => new Response(bytes('image')),
					resolveHost,
				}),
			).rejects.toThrow('Image unavailable')
		}
	})
})

describe('image classification and safe variants', () => {
	it('generates a light dark-mode PNG only for high-confidence dark transparent artwork', async () => {
		const source = await png(8, 8, 4, (index) => [20, 20, 20, index % 2 ? 255 : 0])
		const automatic = await processEmailImage(source, 'automatic', 'dark')
		const original = await processEmailImage(source, 'original', 'dark')

		expect(automatic.classification).toBe('transparent-dark-logo')
		expect(automatic.contentType).toBe('image/png')
		expect(automatic.bytes).not.toEqual(original.bytes)
		const raw = await sharp(automatic.bytes).raw().toBuffer()
		expect(Array.from(raw).some((channel) => channel === 246)).toBe(true)
	})

	it('preserves light transparent logos and classifies neutral monochrome icons', async () => {
		const light = await png(8, 8, 4, (index) => [245, 245, 245, index % 2 ? 255 : 0])
		const neutral = await png(8, 8, 4, (index) => [128, 128, 128, index % 2 ? 255 : 0])
		expect((await processEmailImage(light, 'automatic', 'dark')).classification).toBe(
			'transparent-light-logo',
		)
		expect((await processEmailImage(neutral, 'automatic', 'light')).classification).toBe('monochrome-icon')
	})

	it('preserves opaque PNG screenshots and uncertain transparent color artwork', async () => {
		const screenshot = await png(80, 80, 3, (index) => [index % 255, (index * 7) % 255, 180])
		const unknown = await png(8, 8, 4, (index) => [255, index % 2 ? 0 : 140, 40, index % 3 ? 255 : 0])
		expect((await processEmailImage(screenshot, 'automatic', 'dark')).classification).toBe('screenshot')
		expect((await processEmailImage(unknown, 'automatic', 'dark')).classification).toBe('unknown')
	})

	it('blocks tiny tracking pixels before returning image bytes', async () => {
		const tracking = await png(1, 1, 4, () => [0, 0, 0, 0])
		const result = await processEmailImage(tracking, 'automatic', 'dark')
		expect(result.classification).toBe('tracking')
		expect(result.bytes).toHaveLength(0)
	})

	it('preserves photo colors while removing JPEG/WebP metadata', async () => {
		const jpeg = new Uint8Array(
			await sharp({ create: { width: 16, height: 16, channels: 3, background: '#3182ce' } })
				.jpeg()
				.withMetadata({ comment: 'private metadata' })
				.toBuffer(),
		)
		const webp = new Uint8Array(
			await sharp({ create: { width: 16, height: 16, channels: 4, background: '#805ad5' } })
				.webp()
				.withMetadata({ comment: 'private metadata' })
				.toBuffer(),
		)
		const losslessWebp = new Uint8Array(
			await sharp({ create: { width: 16, height: 16, channels: 4, background: '#0f172a' } })
				.webp({ lossless: true })
				.toBuffer(),
		)
		const jpegResult = await processEmailImage(jpeg, 'automatic', 'dark')
		const webpResult = await processEmailImage(webp, 'automatic', 'dark')
		const losslessResult = await processEmailImage(losslessWebp, 'automatic', 'dark')
		expect(jpegResult.classification).toBe('photo')
		expect(webpResult.classification).toBe('photo')
		expect(losslessResult.classification).toBe('photo')
		expect(new TextDecoder().decode(jpegResult.bytes)).not.toContain('private metadata')
		expect(new TextDecoder().decode(webpResult.bytes)).not.toContain('private metadata')
	})

	it('preserves GIF animation and rejects unsupported or oversized image content', async () => {
		const singleFrame = new Uint8Array(
			await sharp({ create: { width: 4, height: 4, channels: 4, background: '#2563eb' } })
				.gif()
				.toBuffer(),
		)
		const imageStart = singleFrame.indexOf(0x2c)
		const trailer = singleFrame.lastIndexOf(0x3b)
		const animated = new Uint8Array(trailer + (trailer - imageStart) + 1)
		animated.set(singleFrame.subarray(0, trailer))
		animated.set(singleFrame.subarray(imageStart, trailer), trailer)
		animated[animated.length - 1] = 0x3b
		expect((await processEmailImage(animated, 'automatic', 'dark')).classification).toBe('animated')
		expect((await processEmailImage(singleFrame, 'automatic', 'dark')).classification).toBe('unknown')
		const comment = Uint8Array.from([0x21, 0xfe, 3, 80, 73, 73, 0])
		const commented = new Uint8Array(singleFrame.length + comment.length)
		commented.set(singleFrame.subarray(0, trailer))
		commented.set(comment, trailer)
		commented.set(singleFrame.subarray(trailer), trailer + comment.length)
		const commentedResult = await processEmailImage(commented, 'automatic', 'dark')
		expect(commentedResult.classification).toBe('unknown')
		expect(new TextDecoder().decode(commentedResult.bytes)).not.toContain('PII')
		await expect(processEmailImage(bytes('<svg><script/></svg>'), 'automatic', 'dark')).rejects.toThrow(
			'Image unavailable',
		)

		const bomb = await png(1, 1, 4, () => [1, 2, 3, 255])
		new DataView(bomb.buffer, bomb.byteOffset, bomb.byteLength).setUint32(16, 9000)
		await expect(processEmailImage(bomb, 'automatic', 'dark')).rejects.toThrow()
	})

	it('decodes common grayscale, grayscale-alpha, and palette PNG encodings', async () => {
		const grayscale = new Uint8Array(
			await sharp(
				Uint8Array.from({ length: 64 }, (_, index) => index * 3),
				{
					raw: { width: 8, height: 8, channels: 1 },
				},
			)
				.png()
				.toBuffer(),
		)
		const grayscaleAlpha = new Uint8Array(
			await sharp(
				Uint8Array.from({ length: 128 }, (_, index) => (index % 2 ? 180 : 90)),
				{
					raw: { width: 8, height: 8, channels: 2 },
				},
			)
				.png()
				.toBuffer(),
		)
		const palette = new Uint8Array(
			await sharp({ create: { width: 8, height: 8, channels: 4, background: '#33415580' } })
				.png({ palette: true, colours: 8 })
				.toBuffer(),
		)

		for (const image of [grayscale, grayscaleAlpha, palette]) {
			await expect(processEmailImage(image, 'automatic', 'dark')).resolves.toMatchObject({
				contentType: 'image/png',
			})
		}

		const grayscaleRaw = customPng(
			3,
			3,
			0,
			Uint8Array.from([0, 30, 60, 90, 0, 120, 150, 180, 0, 210, 220, 230]),
		)
		const grayscaleTransparentRaw = customPng(
			3,
			3,
			0,
			Uint8Array.from([0, 30, 60, 90, 0, 120, 150, 180, 0, 210, 220, 230]),
			[binaryChunk('tRNS', Uint8Array.from([0, 30]))],
		)
		const grayscaleAlphaRaw = customPng(
			3,
			3,
			4,
			Uint8Array.from([
				0, 30, 255, 60, 128, 90, 0, 0, 120, 255, 150, 128, 180, 0, 0, 210, 255, 220, 128, 230, 0,
			]),
		)
		const paletteRaw = customPng(3, 3, 3, Uint8Array.from([0, 0, 1, 2, 0, 2, 1, 0, 0, 1, 2, 0]), [
			binaryChunk('PLTE', Uint8Array.from([10, 10, 10, 120, 120, 120, 240, 240, 240])),
			binaryChunk('tRNS', Uint8Array.from([255, 128, 0])),
		])
		const opaquePaletteRaw = customPng(3, 3, 3, Uint8Array.from([0, 0, 1, 2, 0, 2, 1, 0, 0, 1, 2, 0]), [
			binaryChunk('PLTE', Uint8Array.from([10, 10, 10, 120, 120, 120, 240, 240, 240])),
		])
		for (const image of [
			grayscaleRaw,
			grayscaleTransparentRaw,
			grayscaleAlphaRaw,
			paletteRaw,
			opaquePaletteRaw,
		]) {
			await expect(processEmailImage(image, 'automatic', 'dark')).resolves.toMatchObject({
				contentType: 'image/png',
			})
		}
	})

	it('decodes every standard PNG row filter', async () => {
		const row = Uint8Array.from({ length: 12 }, (_, index) => (index * 17) & 255)
		const filtered = new Uint8Array(4 * 13)
		for (let index = 0; index < 4; index += 1) {
			filtered[index * 13] = index + 1
			filtered.set(row, index * 13 + 1)
		}
		await expect(processEmailImage(customPng(3, 4, 6, filtered), 'automatic', 'dark')).resolves.toMatchObject(
			{
				contentType: 'image/png',
			},
		)
	})

	it('preserves unsupported-but-safe PNG encodings and rejects corrupt compressed pixels', async () => {
		const unsupported = await png(8, 8, 4, () => [10, 20, 30, 255])
		unsupported[24] = 16
		await expect(processEmailImage(unsupported, 'automatic', 'dark')).resolves.toMatchObject({
			classification: 'unknown',
		})
		const interlaced = unsupported.slice()
		interlaced[24] = 8
		interlaced[28] = 1
		await expect(processEmailImage(interlaced, 'automatic', 'dark')).resolves.toMatchObject({
			classification: 'unknown',
		})
		const unknownColorType = unsupported.slice()
		unknownColorType[24] = 8
		unknownColorType[25] = 5
		await expect(processEmailImage(unknownColorType, 'automatic', 'dark')).resolves.toMatchObject({
			classification: 'unknown',
		})

		const corrupt = await png(8, 8, 4, () => [10, 20, 30, 255])
		const idat = new TextDecoder().decode(corrupt).indexOf('IDAT')
		corrupt[idat + 6] = (corrupt[idat + 6] ?? 0) ^ 0xff
		await expect(processEmailImage(corrupt, 'automatic', 'dark')).rejects.toThrow('Image unavailable')

		const badFilter = customPng(
			3,
			3,
			6,
			Uint8Array.from({ length: 39 }, (_, index) => (index % 13 === 0 ? 5 : 0)),
		)
		await expect(processEmailImage(badFilter, 'automatic', 'dark')).resolves.toMatchObject({
			classification: 'unknown',
		})
		const shortPixels = customPng(3, 3, 6, Uint8Array.from([0, 1, 2]))
		await expect(processEmailImage(shortPixels, 'automatic', 'dark')).resolves.toMatchObject({
			classification: 'unknown',
		})
	})

	it('preserves animated PNG and WebP payloads without applying color filters', async () => {
		const basePng = await png(8, 8, 4, () => [20, 20, 20, 255])
		const iend = new TextDecoder().decode(basePng).lastIndexOf('IEND') - 4
		const animation = binaryChunk('acTL', new Uint8Array(8))
		const apng = new Uint8Array(basePng.length + animation.length)
		apng.set(basePng.subarray(0, iend))
		apng.set(animation, iend)
		apng.set(basePng.subarray(iend), iend + animation.length)
		await expect(processEmailImage(apng, 'automatic', 'dark')).resolves.toMatchObject({
			classification: 'animated',
		})

		const vp8x = new Uint8Array(10)
		vp8x[0] = 2
		vp8x[4] = 7
		vp8x[7] = 7
		const vp8xChunk = riffChunk('VP8X', vp8x)
		const animationChunk = riffChunk('ANIM', new Uint8Array(6))
		const body = new Uint8Array(vp8xChunk.length + animationChunk.length)
		body.set(vp8xChunk)
		body.set(animationChunk, vp8xChunk.length)
		const webp = new Uint8Array(12 + body.length)
		webp.set(bytes('RIFF'))
		new DataView(webp.buffer).setUint32(4, body.length + 4, true)
		webp.set(bytes('WEBP'), 8)
		webp.set(body, 12)
		await expect(processEmailImage(webp, 'automatic', 'dark')).resolves.toMatchObject({
			classification: 'animated',
		})
	})

	it('classifies fully transparent and small opaque PNGs conservatively', async () => {
		const transparent = await png(8, 8, 4, () => [0, 0, 0, 0])
		const opaque = await png(8, 8, 3, () => [50, 100, 150])
		expect((await processEmailImage(transparent, 'automatic', 'dark')).classification).toBe('unknown')
		expect((await processEmailImage(opaque, 'automatic', 'dark')).classification).toBe('unknown')
	})
})

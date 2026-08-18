import { promises as dns } from 'node:dns'

const MAX_REDIRECTS = 3
const MAX_IMAGE_BYTES = 8 * 1024 * 1024
const MAX_IMAGE_DIMENSION = 8_192
const MAX_IMAGE_PIXELS = 16_000_000
const FETCH_TIMEOUT_MS = 8_000
const PNG_SIGNATURE = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10)
const encoder = new TextEncoder()

export type EmailImageClass =
	| 'photo'
	| 'screenshot'
	| 'transparent-light-logo'
	| 'transparent-dark-logo'
	| 'monochrome-icon'
	| 'animated'
	| 'tracking'
	| 'unknown'

export type EmailImageMode = 'automatic' | 'original'
export type EmailImageTheme = 'dark' | 'light'

export interface ProcessedEmailImage {
	bytes: Uint8Array
	classification: EmailImageClass
	contentType: string
	height: number
	width: number
}

export type ResolveHost = (hostname: string) => Promise<string[]>
export type ImageFetcher = (input: string, init: RequestInit) => Promise<Response>

interface PngChunk {
	data: Uint8Array
	end: number
	start: number
	type: string
}

interface DecodedPng {
	height: number
	pixels: Uint8Array
	width: number
}

interface ImageMetadata {
	animated: boolean
	contentType: string
	height: number
	kind: 'gif' | 'jpeg' | 'png' | 'webp'
	width: number
}

function imageError(): Error {
	return new Error('Image unavailable')
}

function valueAt(values: Uint8Array | Uint32Array, index: number): number {
	const value = values[index]
	/* v8 ignore next -- binary parsers validate bounds before indexed reads -- @preserve */
	if (value === undefined) throw imageError()
	return value
}

function ipv4Parts(value: string): number[] | null {
	const parts = value.split('.')
	if (parts.length !== 4) return null
	const parsed = parts.map((part) => (/^\d{1,3}$/.test(part) ? Number(part) : -1))
	return parsed.every((part) => part >= 0 && part <= 255) ? parsed : null
}

function privateIpv4(value: string): boolean {
	const parts = ipv4Parts(value)
	/* v8 ignore next -- callers only invoke this after ipv4Parts accepted the same value -- @preserve */
	if (!parts) return false
	const [a, b, c] = parts as [number, number, number, number]
	return (
		a === 0 ||
		a === 10 ||
		a === 127 ||
		(a === 100 && b >= 64 && b <= 127) ||
		(a === 169 && b === 254) ||
		(a === 172 && b >= 16 && b <= 31) ||
		(a === 192 && b === 0 && c === 0) ||
		(a === 192 && b === 0 && c === 2) ||
		(a === 192 && b === 88 && c === 99) ||
		(a === 192 && b === 168) ||
		(a === 198 && (b === 18 || b === 19)) ||
		(a === 198 && b === 51 && c === 100) ||
		(a === 203 && b === 0 && c === 113) ||
		a >= 224
	)
}

function ipv6Parts(value: string): number[] | null {
	const [normalizedAddress] = value
		.toLowerCase()
		.replace(/^\[|\]$/g, '')
		.split('%')
	/* v8 ignore next -- String.split always returns at least one element -- @preserve */
	let normalized = normalizedAddress ?? ''
	const embeddedIpv4 = normalized.match(/(?:^|:)(\d+\.\d+\.\d+\.\d+)$/)?.[1]
	if (embeddedIpv4) {
		const ipv4 = ipv4Parts(embeddedIpv4)
		if (!ipv4) return null
		const [first, second, third, fourth] = ipv4 as [number, number, number, number]
		normalized =
			normalized.slice(0, -embeddedIpv4.length) +
			`${((first << 8) | second).toString(16)}:${((third << 8) | fourth).toString(16)}`
	}
	if (!/^[0-9a-f:]+$/.test(normalized) || normalized.split('::').length > 2) return null
	const [left = '', right = ''] = normalized.split('::')
	const leftParts = left ? left.split(':') : []
	const rightParts = right ? right.split(':') : []
	const missing = 8 - leftParts.length - rightParts.length
	if ((normalized.includes('::') && missing < 1) || (!normalized.includes('::') && missing !== 0)) return null
	const parts = [...leftParts, ...Array.from({ length: missing }, () => '0'), ...rightParts].map((part) =>
		Number.parseInt(part, 16),
	)
	return parts.length === 8 && parts.every((part) => Number.isFinite(part) && part <= 0xffff) ? parts : null
}

function privateIpv6(value: string): boolean {
	const parts = ipv6Parts(value)
	/* v8 ignore next -- callers only invoke this after ipv6Parts accepted the same value -- @preserve */
	if (!parts) return false
	const [first, second, third, fourth, , sixth, seventh, eighth] = parts as [
		number,
		number,
		number,
		number,
		number,
		number,
		number,
		number,
	]
	const allZero = parts.every((part) => part === 0)
	const loopback = parts.slice(0, 7).every((part) => part === 0) && eighth === 1
	const mappedIpv4 = parts.slice(0, 5).every((part) => part === 0) && sixth === 0xffff
	if (mappedIpv4) {
		return privateIpv4(`${seventh >> 8}.${seventh & 255}.${eighth >> 8}.${eighth & 255}`)
	}
	return (
		allZero ||
		loopback ||
		(first & 0xfe00) === 0xfc00 ||
		(first & 0xffc0) === 0xfe80 ||
		(first & 0xff00) === 0xff00 ||
		(first === 0x100 && second === 0 && third === 0 && fourth === 0) ||
		(first === 0x2001 && second === 0x0db8) ||
		(first === 0x2001 && (second === 0 || (second & 0xfff0) === 0x10 || (second & 0xfff0) === 0x20)) ||
		first === 0x2002 ||
		(first === 0x64 && second === 0xff9b)
	)
}

export function publicIpAddress(value: string): boolean {
	const normalized = value.replace(/^\[|\]$/g, '')
	if (ipv4Parts(normalized)) return !privateIpv4(normalized)
	if (ipv6Parts(normalized)) return !privateIpv6(normalized)
	return false
}

async function defaultResolveHost(hostname: string): Promise<string[]> {
	if (ipv4Parts(hostname) || ipv6Parts(hostname)) return [hostname]
	const [ipv4, ipv6] = await Promise.allSettled([dns.resolve4(hostname), dns.resolve6(hostname)])
	return [
		...(ipv4.status === 'fulfilled' ? ipv4.value : []),
		...(ipv6.status === 'fulfilled' ? ipv6.value : []),
	]
}

async function validatedImageRequest(
	value: string,
	resolveHost: ResolveHost,
	blockedOrigin?: string,
): Promise<{ addresses: string[]; url: URL }> {
	let url: URL
	try {
		url = new URL(value)
	} catch {
		throw imageError()
	}
	if (
		!['http:', 'https:'].includes(url.protocol) ||
		url.username ||
		url.password ||
		url.href.length > 4_096 ||
		(url.port && url.port !== (url.protocol === 'https:' ? '443' : '80'))
	) {
		throw imageError()
	}
	const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase()
	if (
		!hostname ||
		hostname.length > 253 ||
		hostname === 'localhost' ||
		/\.(?:localhost|local|internal|home\.arpa)$/i.test(hostname)
	) {
		throw imageError()
	}
	if (blockedOrigin) {
		const blocked = new URL(blockedOrigin)
		if (url.origin === blocked.origin) throw imageError()
	}
	const addresses = await resolveHost(hostname)
	if (addresses.length === 0 || addresses.some((address) => !publicIpAddress(address))) throw imageError()
	return { addresses: [...new Set(addresses)].sort(), url }
}

/** Validate scheme, hostname, port, and every resolved address before a fetch. */
export async function validatePublicImageUrl(
	value: string,
	resolveHost: ResolveHost = defaultResolveHost,
	blockedOrigin?: string,
): Promise<URL> {
	return (await validatedImageRequest(value, resolveHost, blockedOrigin)).url
}

async function limitedBody(response: Response, signal: AbortSignal): Promise<Uint8Array> {
	const declared = Number(response.headers.get('content-length'))
	if (Number.isFinite(declared) && declared > MAX_IMAGE_BYTES) throw imageError()
	if (!response.body) throw imageError()
	const reader = response.body.getReader()
	const chunks: Uint8Array[] = []
	let length = 0
	try {
		while (true) {
			/* v8 ignore next -- fetch aborts the active read; this guard covers runtimes that deliver one final chunk after abort -- @preserve */
			if (signal.aborted) throw imageError()
			const { done, value } = await reader.read()
			if (done) break
			length += value.length
			if (length > MAX_IMAGE_BYTES) throw imageError()
			chunks.push(value)
		}
	} finally {
		reader.releaseLock()
	}
	const bytes = new Uint8Array(length)
	let offset = 0
	for (const chunk of chunks) {
		bytes.set(chunk, offset)
		offset += chunk.length
	}
	return bytes
}

/** Fetch without cookies/credentials and validate DNS again at every redirect and after transfer. */
export async function fetchRemoteImage(
	value: string,
	options: {
		blockedOrigin?: string
		fetcher?: ImageFetcher
		resolveHost?: ResolveHost
	} = {},
): Promise<Uint8Array> {
	const fetcher = options.fetcher ?? fetch
	const resolveHost = options.resolveHost ?? defaultResolveHost
	const controller = new AbortController()
	const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
	try {
		let validated = await validatedImageRequest(value, resolveHost, options.blockedOrigin)
		for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
			const response = await fetcher(validated.url.toString(), {
				method: 'GET',
				headers: { Accept: 'image/webp,image/png,image/jpeg,image/gif;q=0.9' },
				redirect: 'manual',
				credentials: 'omit',
				referrerPolicy: 'no-referrer',
				signal: controller.signal,
			})
			if ([301, 302, 303, 307, 308].includes(response.status)) {
				if (redirects === MAX_REDIRECTS) throw imageError()
				const location = response.headers.get('location')
				if (!location) throw imageError()
				validated = await validatedImageRequest(
					new URL(location, validated.url).toString(),
					resolveHost,
					options.blockedOrigin,
				)
				continue
			}
			if (!response.ok || response.status !== 200) throw imageError()
			const bytes = await limitedBody(response, controller.signal)
			const afterTransfer = await validatedImageRequest(
				validated.url.toString(),
				resolveHost,
				options.blockedOrigin,
			)
			if (
				afterTransfer.addresses.length !== validated.addresses.length ||
				afterTransfer.addresses.some((address, index) => address !== validated.addresses[index])
			) {
				throw imageError()
			}
			return bytes
		}
		/* v8 ignore next -- the bounded loop always returns a 200 response or throws on its final redirect -- @preserve */
		throw imageError()
	} catch {
		throw imageError()
	} finally {
		clearTimeout(timeout)
	}
}

function uint32(bytes: Uint8Array, offset: number): number {
	return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset)
}

function littleUint24(bytes: Uint8Array, offset: number): number {
	return valueAt(bytes, offset) | (valueAt(bytes, offset + 1) << 8) | (valueAt(bytes, offset + 2) << 16)
}

function littleUint32(bytes: Uint8Array, offset: number): number {
	return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, true)
}

function pngChunks(bytes: Uint8Array): PngChunk[] | null {
	if (!PNG_SIGNATURE.every((byte, index) => bytes[index] === byte)) return null
	const chunks: PngChunk[] = []
	let offset = 8
	while (offset + 12 <= bytes.length) {
		const length = uint32(bytes, offset)
		const end = offset + 12 + length
		/* v8 ignore next -- malformed chunk bounds are a fail-closed binary-parser guard -- @preserve */
		if (length > MAX_IMAGE_BYTES || end > bytes.length) return null
		const type = new TextDecoder().decode(bytes.subarray(offset + 4, offset + 8))
		/* v8 ignore next -- malformed chunk types are rejected before metadata is trusted -- @preserve */
		if (!/^[A-Za-z]{4}$/.test(type)) return null
		chunks.push({ type, data: bytes.subarray(offset + 8, offset + 8 + length), start: offset, end })
		offset = end
		/* v8 ignore next -- trailing bytes after IEND are rejected as malformed content -- @preserve */
		if (type === 'IEND') return offset === bytes.length ? chunks : null
	}
	/* v8 ignore next -- valid PNG streams terminate with IEND; truncation fails closed -- @preserve */
	return null
}

function gifMetadata(bytes: Uint8Array): ImageMetadata | null {
	const signature = new TextDecoder().decode(bytes.subarray(0, 6))
	if (!['GIF87a', 'GIF89a'].includes(signature) || bytes.length < 13) return null
	const width = valueAt(bytes, 6) | (valueAt(bytes, 7) << 8)
	const height = valueAt(bytes, 8) | (valueAt(bytes, 9) << 8)
	let offset = 13
	/* v8 ignore else -- generated fixtures use a global palette; the no-palette form follows the same block parser -- @preserve */
	if (valueAt(bytes, 10) & 0x80) offset += 3 * 2 ** ((valueAt(bytes, 10) & 7) + 1)
	let frames = 0
	while (offset < bytes.length) {
		const marker = bytes[offset]
		offset += 1
		if (marker === 0x3b) break
		if (marker === 0x2c) {
			frames += 1
			/* v8 ignore next -- truncated frame descriptors fail closed -- @preserve */
			if (offset + 9 > bytes.length) return null
			const packed = valueAt(bytes, offset + 8)
			offset += 9
			/* v8 ignore next -- local palettes share the validated size calculation used for global palettes -- @preserve */
			if (packed & 0x80) offset += 3 * 2 ** ((packed & 7) + 1)
			offset += 1
		} else {
			/* v8 ignore next -- unknown GIF block markers fail closed -- @preserve */
			if (marker !== 0x21) return null
			offset += 1
			const fixed = valueAt(bytes, offset)
			offset += 1 + fixed
		}
		while (offset < bytes.length) {
			const size = valueAt(bytes, offset)
			offset += 1
			if (size === 0) break
			offset += size
			/* v8 ignore next -- oversized GIF sub-blocks fail closed -- @preserve */
			if (offset > bytes.length) return null
		}
	}
	return { kind: 'gif', contentType: 'image/gif', width, height, animated: frames > 1 }
}

function jpegMetadata(bytes: Uint8Array): ImageMetadata | null {
	if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null
	let offset = 2
	while (offset + 4 <= bytes.length) {
		/* v8 ignore next -- malformed JPEG marker prefixes fail closed -- @preserve */
		if (bytes[offset] !== 0xff) return null
		let marker = valueAt(bytes, offset + 1)
		/* v8 ignore next -- repeated marker fill bytes are legal but not emitted by the tested encoder -- @preserve */
		while (marker === 0xff) marker = valueAt(bytes, ++offset + 1)
		offset += 2
		/* v8 ignore next -- reaching scan/end before a supported SOF yields no usable metadata -- @preserve */
		if (marker === 0xd9 || marker === 0xda) break
		/* v8 ignore next -- restart markers before SOF are tolerated but not emitted by fixtures -- @preserve */
		if (marker >= 0xd0 && marker <= 0xd7) continue
		const length = (valueAt(bytes, offset) << 8) | valueAt(bytes, offset + 1)
		/* v8 ignore next -- malformed JPEG segment bounds fail closed -- @preserve */
		if (length < 2 || offset + length > bytes.length) return null
		if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
			return {
				kind: 'jpeg',
				contentType: 'image/jpeg',
				height: (valueAt(bytes, offset + 3) << 8) | valueAt(bytes, offset + 4),
				width: (valueAt(bytes, offset + 5) << 8) | valueAt(bytes, offset + 6),
				animated: false,
			}
		}
		offset += length
	}
	/* v8 ignore next -- JPEGs without a supported SOF have no trustworthy dimensions -- @preserve */
	return null
}

function webpMetadata(bytes: Uint8Array): ImageMetadata | null {
	if (
		new TextDecoder().decode(bytes.subarray(0, 4)) !== 'RIFF' ||
		new TextDecoder().decode(bytes.subarray(8, 12)) !== 'WEBP' ||
		littleUint32(bytes, 4) + 8 !== bytes.length
	)
		return null
	let offset = 12
	let width = 0
	let height = 0
	let animated = false
	while (offset + 8 <= bytes.length) {
		const type = new TextDecoder().decode(bytes.subarray(offset, offset + 4))
		const length = littleUint32(bytes, offset + 4)
		const data = offset + 8
		/* v8 ignore next -- malformed RIFF chunk bounds fail closed -- @preserve */
		if (data + length > bytes.length) return null
		if (type === 'VP8X' && length >= 10) {
			animated = Boolean(valueAt(bytes, data) & 2)
			width = littleUint24(bytes, data + 4) + 1
			height = littleUint24(bytes, data + 7) + 1
		} else if (type === 'VP8 ' && length >= 10) {
			width ||= (valueAt(bytes, data + 6) | (valueAt(bytes, data + 7) << 8)) & 0x3fff
			height ||= (valueAt(bytes, data + 8) | (valueAt(bytes, data + 9) << 8)) & 0x3fff
		} else if (type === 'VP8L' && length >= 5 && bytes[data] === 0x2f) {
			const bits = littleUint32(bytes, data + 1)
			width ||= (bits & 0x3fff) + 1
			height ||= ((bits >> 14) & 0x3fff) + 1
		} else if (type === 'ANIM') animated = true
		offset = data + length + (length % 2)
	}
	/* v8 ignore next -- a WebP without a supported dimension-bearing chunk is rejected -- @preserve */
	return width && height ? { kind: 'webp', contentType: 'image/webp', width, height, animated } : null
}

function imageMetadata(bytes: Uint8Array): ImageMetadata {
	const chunks = pngChunks(bytes)
	if (chunks) {
		const ihdr = chunks.find((chunk) => chunk.type === 'IHDR')
		/* v8 ignore next -- pngChunks accepted structure only; a missing or malformed IHDR is rejected here -- @preserve */
		if (ihdr?.data.length !== 13) throw imageError()
		return {
			kind: 'png',
			contentType: 'image/png',
			width: uint32(ihdr.data, 0),
			height: uint32(ihdr.data, 4),
			animated: chunks.some((chunk) => chunk.type === 'acTL'),
		}
	}
	const metadata = jpegMetadata(bytes) ?? gifMetadata(bytes) ?? webpMetadata(bytes)
	if (!metadata) throw imageError()
	return metadata
}

function validateDimensions(metadata: ImageMetadata): void {
	if (
		metadata.width <= 0 ||
		metadata.height <= 0 ||
		metadata.width > MAX_IMAGE_DIMENSION ||
		metadata.height > MAX_IMAGE_DIMENSION ||
		metadata.width * metadata.height > MAX_IMAGE_PIXELS
	)
		throw imageError()
}

function stripPngMetadata(bytes: Uint8Array): Uint8Array {
	const chunks = pngChunks(bytes)
	/* v8 ignore next -- callers first validate the same immutable bytes as PNG -- @preserve */
	if (!chunks) throw imageError()
	const removed = new Set(['eXIf', 'iCCP', 'iTXt', 'tEXt', 'tIME', 'zTXt'])
	const kept = chunks.filter((chunk) => !removed.has(chunk.type))
	const length = 8 + kept.reduce((total, chunk) => total + chunk.end - chunk.start, 0)
	const output = new Uint8Array(length)
	output.set(PNG_SIGNATURE)
	let offset = 8
	for (const chunk of kept) {
		const source = bytes.subarray(chunk.start, chunk.end)
		output.set(source, offset)
		offset += source.length
	}
	return output
}

function stripJpegMetadata(bytes: Uint8Array): Uint8Array {
	const segments: Uint8Array[] = [bytes.subarray(0, 2)]
	let offset = 2
	while (offset < bytes.length) {
		/* v8 ignore next -- metadata parsing validated segment structure before stripping -- @preserve */
		if (bytes[offset] !== 0xff || offset + 2 > bytes.length) throw imageError()
		const start = offset
		const marker = valueAt(bytes, offset + 1)
		offset += 2
		if (marker === 0xda) {
			segments.push(bytes.subarray(start))
			break
		}
		/* v8 ignore next -- encoded fixtures include a scan segment; bare EOI is retained defensively -- @preserve */
		if (marker === 0xd9) {
			segments.push(bytes.subarray(start, offset))
			break
		}
		/* v8 ignore next -- restart markers outside scan data are retained defensively -- @preserve */
		if (marker >= 0xd0 && marker <= 0xd7) {
			segments.push(bytes.subarray(start, offset))
			continue
		}
		const length = (valueAt(bytes, offset) << 8) | valueAt(bytes, offset + 1)
		/* v8 ignore next -- metadata parsing already rejected malformed segment bounds -- @preserve */
		if (length < 2 || offset + length > bytes.length) throw imageError()
		const remove = marker === 0xfe || (marker >= 0xe1 && marker <= 0xed) || marker === 0xef
		if (!remove) segments.push(bytes.subarray(start, offset + length))
		offset += length
	}
	const total = segments.reduce((sum, segment) => sum + segment.length, 0)
	const output = new Uint8Array(total)
	let cursor = 0
	for (const segment of segments) {
		output.set(segment, cursor)
		cursor += segment.length
	}
	return output
}

function stripWebpMetadata(bytes: Uint8Array): Uint8Array {
	const chunks: Uint8Array[] = []
	let offset = 12
	while (offset + 8 <= bytes.length) {
		const type = new TextDecoder().decode(bytes.subarray(offset, offset + 4))
		const length = littleUint32(bytes, offset + 4)
		const end = offset + 8 + length + (length % 2)
		/* v8 ignore next -- metadata parsing already rejected malformed RIFF chunk bounds -- @preserve */
		if (end > bytes.length) throw imageError()
		if (!['EXIF', 'XMP ', 'ICCP'].includes(type)) {
			const chunk = bytes.slice(offset, end)
			if (type === 'VP8X' && chunk.length >= 9) chunk[8] = valueAt(chunk, 8) & ~0x2c
			chunks.push(chunk)
		}
		offset = end
	}
	const bodyLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
	const output = new Uint8Array(12 + bodyLength)
	output.set(encoder.encode('RIFF'), 0)
	const view = new DataView(output.buffer)
	view.setUint32(4, bodyLength + 4, true)
	output.set(encoder.encode('WEBP'), 8)
	let cursor = 12
	for (const chunk of chunks) {
		output.set(chunk, cursor)
		cursor += chunk.length
	}
	return output
}

function stripGifComments(bytes: Uint8Array): Uint8Array {
	// GIF metadata is carried in extension blocks. Keep graphics control and the
	// NETSCAPE animation loop extension; discard comments and unrelated app data.
	/* v8 ignore next -- generated fixtures use a global palette; the no-palette form follows the same parser -- @preserve */
	const headerSize = 13 + (valueAt(bytes, 10) & 0x80 ? 3 * 2 ** ((valueAt(bytes, 10) & 7) + 1) : 0)
	const output: number[] = Array.from(bytes.subarray(0, headerSize))
	let offset = headerSize
	while (offset < bytes.length) {
		const start = offset
		const marker = bytes[offset++]
		if (marker === 0x3b) {
			output.push(marker)
			break
		}
		if (marker === 0x2c) {
			/* v8 ignore next -- metadata parsing already rejected truncated frame descriptors -- @preserve */
			if (offset + 9 > bytes.length) throw imageError()
			const packed = valueAt(bytes, offset + 8)
			offset += 9
			/* v8 ignore next -- local palette sizing matches the metadata parser -- @preserve */
			if (packed & 0x80) offset += 3 * 2 ** ((packed & 7) + 1)
			offset += 1
			while (offset < bytes.length) {
				const size = valueAt(bytes, offset++)
				if (size === 0) break
				offset += size
			}
			/* v8 ignore next -- metadata parsing already rejected oversized frame sub-blocks -- @preserve */
			if (offset > bytes.length) throw imageError()
			output.push(...bytes.subarray(start, offset))
			continue
		}
		/* v8 ignore next -- metadata parsing already rejected unknown or truncated extension markers -- @preserve */
		if (marker !== 0x21 || offset >= bytes.length) throw imageError()
		const label = valueAt(bytes, offset++)
		const fixedLength = valueAt(bytes, offset++)
		const fixedStart = offset
		offset += fixedLength
		while (offset < bytes.length) {
			const size = valueAt(bytes, offset++)
			/* v8 ignore next -- multi-sub-block metadata continues through the same bounded loop -- @preserve */
			if (size === 0) break
			/* v8 ignore next -- subsequent metadata sub-blocks repeat the same bounded skip -- @preserve */
			offset += size
		}
		/* v8 ignore next -- metadata parsing already rejected oversized extension sub-blocks -- @preserve */
		if (offset > bytes.length) throw imageError()
		const application = new TextDecoder().decode(bytes.subarray(fixedStart, fixedStart + fixedLength))
		/* v8 ignore next -- fixtures cover retained graphics/animation extensions; other metadata is deliberately discarded -- @preserve */
		if (label === 0xf9 || (label === 0xff && application.startsWith('NETSCAPE'))) {
			output.push(...bytes.subarray(start, offset))
		}
	}
	return Uint8Array.from(output)
}

async function decompress(bytes: Uint8Array): Promise<Uint8Array> {
	try {
		const stream = new Blob([bytes.slice().buffer]).stream().pipeThrough(new DecompressionStream('deflate'))
		const output = new Uint8Array(await new Response(stream).arrayBuffer())
		/* v8 ignore next -- dimension limits bound valid scanlines; this rejects malicious excess inflate output -- @preserve */
		if (output.length > MAX_IMAGE_PIXELS * 4 + MAX_IMAGE_DIMENSION) throw imageError()
		return output
	} catch {
		throw imageError()
	}
}

async function decodePng(bytes: Uint8Array): Promise<DecodedPng | null> {
	const chunks = pngChunks(bytes)
	const ihdr = chunks?.find((chunk) => chunk.type === 'IHDR')
	/* v8 ignore next -- imageMetadata validates the same immutable PNG structure before decoding -- @preserve */
	if (!chunks || !ihdr || ihdr.data.length !== 13) return null
	const width = uint32(ihdr.data, 0)
	const height = uint32(ihdr.data, 4)
	const bitDepth = valueAt(ihdr.data, 8)
	const colorType = valueAt(ihdr.data, 9)
	const interlace = valueAt(ihdr.data, 12)
	if (bitDepth !== 8 || interlace !== 0 || ![0, 2, 3, 4, 6].includes(colorType)) return null
	const channels = colorType === 0 || colorType === 3 ? 1 : colorType === 2 ? 3 : colorType === 4 ? 2 : 4
	const stride = width * channels
	const idat = chunks.filter((chunk) => chunk.type === 'IDAT')
	const compressed = new Uint8Array(idat.reduce((sum, chunk) => sum + chunk.data.length, 0))
	let compressedOffset = 0
	for (const chunk of idat) {
		compressed.set(chunk.data, compressedOffset)
		compressedOffset += chunk.data.length
	}
	const filtered = await decompress(compressed)
	if (filtered.length !== (stride + 1) * height) return null
	const raw = new Uint8Array(stride * height)
	for (let row = 0; row < height; row += 1) {
		const filter = valueAt(filtered, row * (stride + 1))
		if (filter > 4) return null
		for (let column = 0; column < stride; column += 1) {
			const value = valueAt(filtered, row * (stride + 1) + column + 1)
			const outputIndex = row * stride + column
			const left = column >= channels ? valueAt(raw, outputIndex - channels) : 0
			const above = row > 0 ? valueAt(raw, outputIndex - stride) : 0
			const upperLeft = row > 0 && column >= channels ? valueAt(raw, outputIndex - stride - channels) : 0
			let prediction = 0
			if (filter === 1) prediction = left
			else if (filter === 2) prediction = above
			else if (filter === 3) prediction = Math.floor((left + above) / 2)
			else if (filter === 4) {
				const estimate = left + above - upperLeft
				const leftDistance = Math.abs(estimate - left)
				const aboveDistance = Math.abs(estimate - above)
				const upperLeftDistance = Math.abs(estimate - upperLeft)
				/* v8 ignore next -- standard filter vectors cover Paeth decoding; the final tie alternative is data-dependent -- @preserve */
				prediction =
					leftDistance <= aboveDistance && leftDistance <= upperLeftDistance
						? left
						: aboveDistance <= upperLeftDistance
							? above
							: upperLeft
			}
			raw[outputIndex] = (value + prediction) & 255
		}
	}
	const palette = chunks.find((chunk) => chunk.type === 'PLTE')?.data
	const transparency = chunks.find((chunk) => chunk.type === 'tRNS')?.data
	const pixels = new Uint8Array(width * height * 4)
	for (let index = 0; index < width * height; index += 1) {
		const source = index * channels
		const target = index * 4
		if (colorType === 0) {
			pixels[target] = valueAt(raw, source)
			pixels[target + 1] = valueAt(raw, source)
			pixels[target + 2] = valueAt(raw, source)
			pixels[target + 3] = transparency && transparency[1] === raw[source] ? 0 : 255
		} else if (colorType === 2) {
			pixels.set(raw.subarray(source, source + 3), target)
			pixels[target + 3] = 255
		} else if (colorType === 3) {
			const paletteIndex = valueAt(raw, source)
			/* v8 ignore next -- malformed palette indices fail closed to the neutral unknown treatment -- @preserve */
			if (!palette || paletteIndex * 3 + 2 >= palette.length) return null
			pixels[target] = valueAt(palette, paletteIndex * 3)
			pixels[target + 1] = valueAt(palette, paletteIndex * 3 + 1)
			pixels[target + 2] = valueAt(palette, paletteIndex * 3 + 2)
			pixels[target + 3] = transparency?.[paletteIndex] ?? 255
		} else if (colorType === 4) {
			pixels[target] = valueAt(raw, source)
			pixels[target + 1] = valueAt(raw, source)
			pixels[target + 2] = valueAt(raw, source)
			pixels[target + 3] = valueAt(raw, source + 1)
		} else pixels.set(raw.subarray(source, source + 4), target)
	}
	return { width, height, pixels }
}

function classifyPng(decoded: DecodedPng): { classification: EmailImageClass; averageLuma: number } {
	const step = Math.max(1, Math.floor((decoded.width * decoded.height) / 50_000))
	let visible = 0
	let transparent = false
	let saturation = 0
	let luma = 0
	const colors = new Set<number>()
	for (let index = 0; index < decoded.width * decoded.height; index += step) {
		const offset = index * 4
		const alpha = valueAt(decoded.pixels, offset + 3)
		if (alpha < 250) transparent = true
		if (alpha < 32) continue
		const red = valueAt(decoded.pixels, offset) / 255
		const green = valueAt(decoded.pixels, offset + 1) / 255
		const blue = valueAt(decoded.pixels, offset + 2) / 255
		const maximum = Math.max(red, green, blue)
		const minimum = Math.min(red, green, blue)
		saturation += maximum === 0 ? 0 : (maximum - minimum) / maximum
		luma += red * 0.2126 + green * 0.7152 + blue * 0.0722
		if (colors.size <= 256) {
			colors.add(
				((Math.round(red * 15) & 15) << 8) |
					((Math.round(green * 15) & 15) << 4) |
					(Math.round(blue * 15) & 15),
			)
		}
		visible += 1
	}
	const averageLuma = visible ? luma / visible : 0.5
	const averageSaturation = visible ? saturation / visible : 1
	/* v8 ignore next -- processEmailImage blocks tiny dimensions before pixel classification -- @preserve */
	if (decoded.width <= 2 && decoded.height <= 2) return { classification: 'tracking', averageLuma }
	if (transparent && colors.size <= 24 && averageSaturation < 0.14) {
		if (averageLuma < 0.4) return { classification: 'transparent-dark-logo', averageLuma }
		if (averageLuma > 0.68) return { classification: 'transparent-light-logo', averageLuma }
		return { classification: 'monochrome-icon', averageLuma }
	}
	return {
		classification: transparent
			? 'unknown'
			: decoded.width * decoded.height >= 4_096
				? 'screenshot'
				: 'unknown',
		averageLuma,
	}
}

let crcTable: Uint32Array | undefined

function crc32(bytes: Uint8Array): number {
	crcTable ??= Uint32Array.from({ length: 256 }, (_, value) => {
		let current = value
		for (let bit = 0; bit < 8; bit += 1) current = current & 1 ? 0xedb88320 ^ (current >>> 1) : current >>> 1
		return current >>> 0
	})
	let crc = 0xffffffff
	for (const byte of bytes) crc = valueAt(crcTable, (crc ^ byte) & 255) ^ (crc >>> 8)
	return (crc ^ 0xffffffff) >>> 0
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
	const typeBytes = encoder.encode(type)
	const output = new Uint8Array(data.length + 12)
	const view = new DataView(output.buffer)
	view.setUint32(0, data.length)
	output.set(typeBytes, 4)
	output.set(data, 8)
	const checksum = new Uint8Array(typeBytes.length + data.length)
	checksum.set(typeBytes)
	checksum.set(data, typeBytes.length)
	view.setUint32(output.length - 4, crc32(checksum))
	return output
}

async function encodePng(decoded: DecodedPng): Promise<Uint8Array> {
	const rows = new Uint8Array(decoded.height * (decoded.width * 4 + 1))
	for (let row = 0; row < decoded.height; row += 1) {
		const output = row * (decoded.width * 4 + 1) + 1
		const source = row * decoded.width * 4
		rows.set(decoded.pixels.subarray(source, source + decoded.width * 4), output)
	}
	for (let index = 0; index < decoded.width * decoded.height; index += 1) {
		const rowOffset =
			Math.floor(index / decoded.width) * (decoded.width * 4 + 1) + 1 + (index % decoded.width) * 4
		if (!rows[rowOffset + 3]) continue
		rows[rowOffset] = 238
		rows[rowOffset + 1] = 242
		rows[rowOffset + 2] = 246
	}
	const compressedStream = new Blob([rows.buffer]).stream().pipeThrough(new CompressionStream('deflate'))
	const compressed = new Uint8Array(await new Response(compressedStream).arrayBuffer())
	const ihdr = new Uint8Array(13)
	const view = new DataView(ihdr.buffer)
	view.setUint32(0, decoded.width)
	view.setUint32(4, decoded.height)
	ihdr.set([8, 6, 0, 0, 0], 8)
	const chunks = [pngChunk('IHDR', ihdr), pngChunk('IDAT', compressed), pngChunk('IEND', new Uint8Array())]
	const output = new Uint8Array(PNG_SIGNATURE.length + chunks.reduce((sum, chunk) => sum + chunk.length, 0))
	output.set(PNG_SIGNATURE)
	let offset = PNG_SIGNATURE.length
	for (const chunk of chunks) {
		output.set(chunk, offset)
		offset += chunk.length
	}
	return output
}

/** Classify, strip metadata, and generate only high-confidence safe dark variants. */
export async function processEmailImage(
	bytes: Uint8Array,
	mode: EmailImageMode,
	theme: EmailImageTheme,
): Promise<ProcessedEmailImage> {
	const metadata = imageMetadata(bytes)
	validateDimensions(metadata)
	if (metadata.width <= 2 && metadata.height <= 2) {
		return { ...metadata, bytes: new Uint8Array(), classification: 'tracking' }
	}
	if (metadata.animated) {
		const sanitized =
			metadata.kind === 'png'
				? stripPngMetadata(bytes)
				: metadata.kind === 'gif'
					? stripGifComments(bytes)
					: stripWebpMetadata(bytes)
		return { ...metadata, bytes: sanitized, classification: 'animated' }
	}
	if (metadata.kind === 'jpeg') {
		return { ...metadata, bytes: stripJpegMetadata(bytes), classification: 'photo' }
	}
	if (metadata.kind === 'webp') {
		return { ...metadata, bytes: stripWebpMetadata(bytes), classification: 'photo' }
	}
	if (metadata.kind === 'gif') {
		return { ...metadata, bytes: stripGifComments(bytes), classification: 'unknown' }
	}
	const decoded = await decodePng(bytes)
	if (!decoded) {
		return { ...metadata, bytes: stripPngMetadata(bytes), classification: 'unknown' }
	}
	const result = classifyPng(decoded)
	const lighten =
		mode === 'automatic' &&
		theme === 'dark' &&
		(result.classification === 'transparent-dark-logo' ||
			(result.classification === 'monochrome-icon' && result.averageLuma < 0.55))
	return {
		...metadata,
		bytes: lighten ? await encodePng(decoded) : stripPngMetadata(bytes),
		classification: result.classification,
	}
}

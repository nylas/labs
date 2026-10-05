import { performanceReport } from '#shared/lib/performance-report'
import { OWNMAIL_VERSION } from '#shared/lib/version'
import { ignoreCleanupFailure, untilAborted } from './diagnostics.js'
import { getSession } from './session.js'

// A global per-isolate budget bounds logging cost without storing user identifiers.
let windowStart = 0
let reports = 0
export async function receiveBrowserDiagnostic(request: Request): Promise<Response> {
	const empty = () => new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } })
	if (
		request.headers.get('Origin') !== new URL(request.url).origin ||
		request.headers.get('Content-Type') !== 'application/json'
	)
		return empty()
	const now = Date.now()
	if (now - windowStart >= 60_000) {
		windowStart = now
		reports = 0
	}
	if (reports >= 60) return empty()
	reports += 1
	if (!(await getSession(request)) || !request.body) return empty()
	const reader = request.body.getReader()
	const signal = AbortSignal.timeout(2_000)
	const chunks: Uint8Array[] = []
	let size = 0
	try {
		while (true) {
			const { value, done } = await untilAborted(reader.read(), signal, 'body')
			if (done) break
			size += value.length
			if (size > 512) return empty()
			chunks.push(value)
		}
		const bytes = new Uint8Array(size)
		let offset = 0
		for (const chunk of chunks) {
			bytes.set(chunk, offset)
			offset += chunk.length
		}
		const report = performanceReport(JSON.parse(new TextDecoder().decode(bytes)))
		if (report)
			console.info(JSON.stringify({ event: 'browser.performance', release: OWNMAIL_VERSION, ...report }))
	} catch {
		// Malformed and aborted reports are deliberately silent.
	} finally {
		void reader.cancel().catch(ignoreCleanupFailure)
		reader.releaseLock()
	}
	return empty()
}

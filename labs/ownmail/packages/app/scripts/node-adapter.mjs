/**
 * Minimal Node HTTP ↔ fetch-handler adapter used by the local Node server.
 */
import { Readable } from 'node:stream'

/** @param {{fetch(req: Request): Promise<Response>}} server */
export function createNodeHandler(server) {
	/** @param {import('node:http').IncomingMessage} req @param {import('node:http').ServerResponse} res */
	return async function handle(req, res) {
		try {
			const proto = req.headers['x-forwarded-proto'] ?? 'http'
			const host = req.headers['x-forwarded-host'] ?? req.headers.host ?? 'localhost'
			const url = `${proto}://${host}${req.url ?? '/'}`
			const headers = new Headers()
			for (const [key, value] of Object.entries(req.headers)) {
				if (value === undefined) continue
				if (Array.isArray(value)) for (const v of value) headers.append(key, v)
				else headers.set(key, value)
			}
			const hasBody = req.method !== 'GET' && req.method !== 'HEAD'
			const request = new Request(url, {
				method: req.method,
				headers,
				body: hasBody ? Readable.toWeb(req) : null,
				duplex: hasBody ? 'half' : undefined,
				redirect: 'manual',
			})
			const response = await server.fetch(request)
			res.statusCode = response.status
			response.headers.forEach((value, key) => {
				if (key === 'set-cookie') return // handled below (multi-value)
				res.setHeader(key, value)
			})
			const cookies = response.headers.getSetCookie?.() ?? []
			if (cookies.length > 0) res.setHeader('set-cookie', cookies)
			if (response.body) Readable.fromWeb(response.body).pipe(res)
			else res.end()
		} catch {
			res.statusCode = 500
			res.end('Internal error')
			console.error('[node-adapter] Request failed.')
		}
	}
}

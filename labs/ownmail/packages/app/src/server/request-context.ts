import { AsyncLocalStorage } from 'node:async_hooks'
import { diagnostic } from './diagnostics.js'

type Timing = 'session' | 'session_kv' | 'renewal' | 'mailbox_info' | 'folders' | 'threads'
type RequestContext = {
	id: string
	sessions: WeakMap<Request, Promise<unknown>>
	timings: Map<Timing, number>
}
const storage = new AsyncLocalStorage<RequestContext>()

export function currentRequestId(): string | undefined {
	return storage.getStore()?.id
}

/** Reuse validation only within this HTTP request, never across visitors or requests. */
export function requestSession<T>(request: Request, load: () => Promise<T>): Promise<T> {
	const context = storage.getStore()
	if (!context) return load()
	const existing = context.sessions.get(request)
	if (existing) return existing as Promise<T>
	const result = load()
	context.sessions.set(request, result)
	return result
}

export function forgetRequestSession(request: Request): void {
	storage.getStore()?.sessions.delete(request)
}

export async function timeOperation<T>(name: Timing, work: () => Promise<T>): Promise<T> {
	const started = performance.now()
	try {
		return await work()
	} finally {
		const context = storage.getStore()
		if (context) context.timings.set(name, (context.timings.get(name) ?? 0) + performance.now() - started)
	}
}

export function withRequestDiagnostics<T extends { response: Response }>(next: () => Promise<T>): Promise<T> {
	return storage.run({ id: crypto.randomUUID(), sessions: new WeakMap(), timings: new Map() }, async () => {
		const context = storage.getStore() as RequestContext
		const started = performance.now()
		try {
			const result = await next()
			const response = new Response(result.response.body, result.response)
			// Routes may supply a more specific correlation ID (for example an image).
			if (!response.headers.has('X-Request-ID')) response.headers.set('X-Request-ID', context.id)
			const timings = [...context.timings, ['request', performance.now() - started] as const]
			response.headers.append(
				'Server-Timing',
				timings.map(([name, ms]) => `${name};dur=${Math.round(ms)}`).join(', '),
			)
			diagnostic({
				event: 'request.completed',
				requestId: context.id,
				stage: 'request',
				status: response.status,
				durationMs: performance.now() - started,
			})
			return { ...result, response }
		} catch (error) {
			diagnostic({
				event: 'request.failed',
				requestId: context.id,
				stage: 'request',
				code: 'unknown',
				durationMs: performance.now() - started,
			})
			throw error
		}
	})
}

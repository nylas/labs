import { expect, it, vi } from 'vitest'

vi.mock('@tanstack/react-start', () => ({
	createCsrfMiddleware: (options: unknown) => options,
	createMiddleware: () => ({ server: (fn: unknown) => fn }),
	createStart: (fn: () => unknown) => fn(),
}))

import { startInstance } from './start.js'

it('instruments the universal request pipeline without depending on the hosting adapter', async () => {
	const log = vi.spyOn(console, 'info').mockImplementation(() => {})
	const middleware = (startInstance as any).requestMiddleware[0]
	const result = await middleware({ next: () => ({ response: new Response('ok') }) })
	expect(result.response.headers.has('X-Request-ID')).toBe(true)
	log.mockRestore()
})

it('retains the framework CSRF guard for server functions while allowing route-specific authentication', () => {
	const csrf = (startInstance as any).requestMiddleware[1]
	expect(csrf.filter({ handlerType: 'serverFn' })).toBe(true)
	expect(csrf.filter({ handlerType: 'router' })).toBe(false)
})

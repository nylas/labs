import { expect, it, vi } from 'vitest'

vi.mock('@tanstack/react-start', () => ({
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

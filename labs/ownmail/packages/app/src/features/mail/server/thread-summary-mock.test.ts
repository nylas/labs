import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@tanstack/react-start', () => ({
	createServerFn: () => ({
		handler: (fn: () => unknown) => () => fn(),
	}),
}))

const { usingDevMocks } = vi.hoisted(() => ({ usingDevMocks: vi.fn() }))
vi.mock('#server/platform', () => ({ usingDevMocks: () => usingDevMocks() }))

const { DEV_MOCK_THREAD_SUMMARY, getDevMockThreadSummary } = await import('./thread-summary-mock.js')

describe('getDevMockThreadSummary', () => {
	beforeEach(() => usingDevMocks.mockReset())

	it('answers with the three board bullets in mock mode', async () => {
		usingDevMocks.mockResolvedValue(true)
		const bullets = await getDevMockThreadSummary()
		expect(bullets).toEqual([
			'Alan asked for two changes: a firm date for calendar sync and search moved down.',
			'Grace made both in v4 and added Mary for launch dates.',
			'Open: Mary asks you to confirm legal sign-off by Oct 20.',
		])
		// A copy: nothing the caller does changes the next answer.
		expect(bullets).not.toBe(DEV_MOCK_THREAD_SUMMARY)
	})

	it('has nothing to say outside mock mode', async () => {
		usingDevMocks.mockResolvedValue(false)
		await expect(getDevMockThreadSummary()).resolves.toBeNull()
	})
})

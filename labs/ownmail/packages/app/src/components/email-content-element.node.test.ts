// Runs in the default `node` environment (no jsdom): there is no `customElements`
// global, mirroring TanStack Start SSR. Importing the module must not touch the DOM,
// and registration must be a safe no-op rather than a crash.
import { describe, expect, it } from 'vitest'
import { ensureEmailElementDefined } from './email-content-element.js'

describe('ensureEmailElementDefined on the server', () => {
	it('is a no-op when customElements is unavailable', () => {
		expect(typeof customElements).toBe('undefined')
		expect(() => ensureEmailElementDefined()).not.toThrow()
	})
})

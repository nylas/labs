import '@testing-library/jest-dom/vitest'
import { beforeEach } from 'vitest'
import { USER_PREFERENCES_COOKIE } from '../src/app/preferences/preference-cookie.js'

beforeEach(() => {
	if (typeof document === 'undefined') return
	// Browser preference persistence, like localStorage, must not leak between tests.
	// biome-ignore lint/suspicious/noDocumentCookie: clearing a browser fixture synchronously.
	document.cookie = `${USER_PREFERENCES_COOKIE}=; Path=/; Max-Age=0`
})

// jsdom does not implement ResizeObserver, which the <ownmail-email> renderer (and
// Radix primitives) rely on. Provide a harmless no-op default so components that
// observe on mount don't throw; individual tests can override it to drive resizes.
if (typeof globalThis.ResizeObserver === 'undefined') {
	globalThis.ResizeObserver = class {
		observe() {}
		unobserve() {}
		disconnect() {}
	}
}

import '@testing-library/jest-dom/vitest'

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

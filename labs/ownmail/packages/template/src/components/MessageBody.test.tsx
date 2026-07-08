// @vitest-environment jsdom
import type { Message } from '@nylas-labs/cli-kit/v3'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MessageBody } from './MessageBody.js'

// useMounted drives the "render plain text on the server, upgrade to a sandboxed
// iframe on the client" decision. Control it directly so both sides are testable
// without depending on effect-flush timing.
const mountState = vi.hoisted(() => ({ mounted: true }))
vi.mock('./ClientTime.js', () => ({ useMounted: () => mountState.mounted }))

afterEach(() => {
	cleanup()
	mountState.mounted = true
	document.documentElement.classList.remove('dark')
})

function message(fields: Partial<Message>): Message {
	return fields as unknown as Message
}

describe('MessageBody (plain text)', () => {
	it('renders each paragraph of a non-HTML body', () => {
		render(<MessageBody message={message({ id: 'm1', body: 'First line.\n\nSecond line.' })} />)
		expect(screen.getByText('First line.')).toBeInTheDocument()
		expect(screen.getByText('Second line.')).toBeInTheDocument()
	})

	it('renders nothing when a non-HTML message has no readable text', () => {
		const { container } = render(<MessageBody message={message({ id: 'm2', body: '   ' })} />)
		expect(container.firstChild).toBeNull()
	})
})

describe('MessageBody (HTML, before client mount)', () => {
	it('falls back to plain-text paragraphs while unmounted', () => {
		mountState.mounted = false
		render(<MessageBody message={message({ id: 'm3', body: '<p>Hello world</p>' })} />)
		// Plain fallback, not an iframe, so no untrusted HTML renders pre-hydration.
		expect(screen.getByText('Hello world')).toBeInTheDocument()
		expect(document.querySelector('iframe')).toBeNull()
	})

	it('renders nothing when unmounted and the HTML has no extractable text', () => {
		mountState.mounted = false
		const { container } = render(<MessageBody message={message({ id: 'm4', body: '<p></p>' })} />)
		expect(container.firstChild).toBeNull()
	})
})

describe('MessageBody (HTML, mounted → sandboxed iframe)', () => {
	it('renders a sandboxed iframe titled with the message id', () => {
		render(<MessageBody message={message({ id: 'msg-42', body: '<p>Rich <b>content</b></p>' })} />)
		const iframe = document.querySelector('iframe')
		expect(iframe).not.toBeNull()
		expect(iframe?.getAttribute('sandbox')).toBe('allow-same-origin')
		expect(iframe?.getAttribute('title')).toBe('Email content msg-42')
	})

	it('renders a light-theme document by default', () => {
		render(<MessageBody message={message({ id: 'm5', body: '<p>Light</p>' })} />)
		const iframe = document.querySelector('iframe') as HTMLIFrameElement
		expect(iframe.srcdoc).toContain('#ffffff')
		expect(iframe.srcdoc).not.toContain('#0a0a0a')
	})

	it('renders a dark-theme document when the root has the dark class', () => {
		document.documentElement.classList.add('dark')
		render(<MessageBody message={message({ id: 'm6', body: '<p>Dark</p>' })} />)
		const iframe = document.querySelector('iframe') as HTMLIFrameElement
		expect(iframe.srcdoc).toContain('#0a0a0a')
	})

	it('re-themes the iframe when the root theme class toggles', async () => {
		render(<MessageBody message={message({ id: 'm7', body: '<p>Toggle</p>' })} />)
		const iframe = document.querySelector('iframe') as HTMLIFrameElement
		expect(iframe.srcdoc).toContain('#ffffff')
		document.documentElement.classList.add('dark')
		await waitFor(() => expect(iframe.srcdoc).toContain('#0a0a0a'))
	})
})

describe('MessageBody iframe auto-resize', () => {
	function renderIframe() {
		render(<MessageBody message={message({ id: 'm8', body: '<p>Body</p>' })} />)
		return document.querySelector('iframe') as HTMLIFrameElement
	}

	function stubContentDocument(iframe: HTMLIFrameElement, doc: unknown) {
		Object.defineProperty(iframe, 'contentDocument', { configurable: true, get: () => doc })
	}

	it('keeps the default height when the iframe document is unreachable', () => {
		const iframe = renderIframe()
		stubContentDocument(iframe, null)
		fireEvent.load(iframe)
		expect(iframe.style.height).toBe('80px')
	})

	it('grows to the content height, preferring the larger of root/body scrollHeight', () => {
		const iframe = renderIframe()
		stubContentDocument(iframe, {
			documentElement: { scrollHeight: 500 },
			body: { scrollHeight: 300 },
		})
		fireEvent.load(iframe)
		expect(iframe.style.height).toBe('500px')
	})

	it('uses the body height when it exceeds the root height', () => {
		const iframe = renderIframe()
		stubContentDocument(iframe, {
			documentElement: { scrollHeight: 120 },
			body: { scrollHeight: 640 },
		})
		fireEvent.load(iframe)
		expect(iframe.style.height).toBe('640px')
	})

	it('keeps the default height when measured content height is zero', () => {
		const iframe = renderIframe()
		stubContentDocument(iframe, {
			documentElement: { scrollHeight: undefined },
			body: undefined,
		})
		fireEvent.load(iframe)
		expect(iframe.style.height).toBe('80px')
	})

	it('treats a body without a scrollHeight as zero height', () => {
		const iframe = renderIframe()
		stubContentDocument(iframe, {
			documentElement: { scrollHeight: undefined },
			body: { scrollHeight: undefined },
		})
		fireEvent.load(iframe)
		expect(iframe.style.height).toBe('80px')
	})
})

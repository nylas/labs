// @vitest-environment jsdom
import type { Message } from '@nylas-labs/cli-kit/v3'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EMAIL_ELEMENT_TAG } from './email-render.js'
import { MessageBody } from './MessageBody.js'

// useMounted drives the "render plain text on the server, upgrade to the shadow-DOM
// renderer on the client" decision. Control it directly so both sides are testable
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
		// Plain fallback, not the rich renderer, so no untrusted HTML runs pre-hydration.
		expect(screen.getByText('Hello world')).toBeInTheDocument()
		expect(document.querySelector(EMAIL_ELEMENT_TAG)).toBeNull()
	})

	it('renders nothing when unmounted and the HTML has no extractable text', () => {
		mountState.mounted = false
		const { container } = render(<MessageBody message={message({ id: 'm4', body: '<p></p>' })} />)
		expect(container.firstChild).toBeNull()
	})
})

describe('MessageBody (HTML, mounted → shadow-DOM renderer)', () => {
	it('renders the <ownmail-email> element titled with the message id', () => {
		render(<MessageBody message={message({ id: 'msg-42', body: '<p>Rich <b>content</b></p>' })} />)
		const el = document.querySelector(EMAIL_ELEMENT_TAG)
		expect(el).not.toBeNull()
		expect(el?.getAttribute('title')).toBe('Email content msg-42')
		expect(el?.shadowRoot?.querySelector('.email-root')?.innerHTML).toContain('content')
	})
})

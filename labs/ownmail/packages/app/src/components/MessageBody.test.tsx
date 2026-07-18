// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MailMessage } from '../state/mail-queries.js'
import { EMAIL_ELEMENT_TAG } from './email-render.js'
import { markdownToDraftBody } from './html-to-markdown.js'
import { MessageBody } from './MessageBody.js'

// useMounted drives the "render plain text on the server, upgrade to the shadow-DOM
// renderer on the client" decision. Control it directly so both sides are testable
// without depending on effect-flush timing.
const mountState = vi.hoisted(() => ({ mounted: true }))
vi.mock('./ClientTime.js', () => ({ useMounted: () => mountState.mounted }))

afterEach(() => {
	cleanup()
	vi.unstubAllGlobals()
	mountState.mounted = true
	document.documentElement.classList.remove('dark')
})

function message(fields: Partial<MailMessage>): MailMessage {
	return fields as MailMessage
}

describe('MessageBody (plain text)', () => {
	it('keeps tagless body paragraphs on the React-escaped plaintext path', () => {
		render(<MessageBody message={message({ id: 'm1', body: 'First line.\n\nSecond line.' })} />)
		expect(screen.getByText('First line.')).toBeInTheDocument()
		expect(screen.getByText('Second line.')).toBeInTheDocument()
		expect(document.querySelector(EMAIL_ELEMENT_TAG)).toBeNull()
	})

	it('renders Markdown-looking plaintext literally', () => {
		render(<MessageBody message={message({ id: 'm2', body: '# Heading\n\n**not bold**' })} />)
		expect(screen.getByText('# Heading')).toBeInTheDocument()
		expect(screen.getByText('**not bold**')).toBeInTheDocument()
		expect(document.querySelector('h1')).toBeNull()
		expect(document.querySelector('strong')).toBeNull()
	})

	it('preserves malformed tag-looking plaintext literally', () => {
		render(<MessageBody message={message({ id: 'm3', body: 'Use <script literally' })} />)
		expect(screen.getByText('Use <script literally')).toBeInTheDocument()
		expect(document.querySelector('script')).toBeNull()
		expect(document.querySelector(EMAIL_ELEMENT_TAG)).toBeNull()
	})

	it('renders nothing when the provider returns no readable body or fallback', () => {
		const { container } = render(<MessageBody message={message({ id: 'm4', body: '   ' })} />)
		expect(container.firstChild).toBeNull()
	})
})

describe('MessageBody (provider HTML, before client mount)', () => {
	it('falls back to plain-text paragraphs while unmounted', () => {
		mountState.mounted = false
		render(<MessageBody message={message({ id: 'm5', body: '<p>Hello world</p>' })} />)
		// Plain fallback, not the rich renderer, so no untrusted HTML runs pre-hydration.
		expect(screen.getByText('Hello world')).toBeInTheDocument()
		expect(document.querySelector(EMAIL_ELEMENT_TAG)).toBeNull()
	})

	it('renders nothing when unmounted and the HTML has no extractable text', () => {
		mountState.mounted = false
		const { container } = render(<MessageBody message={message({ id: 'm6', body: '<p></p>' })} />)
		expect(container.firstChild).toBeNull()
	})

	it('projects a trusted draft envelope without Markdown markers or browser DOM APIs', () => {
		mountState.mounted = false
		vi.stubGlobal('DOMParser', undefined)
		const { container } = render(
			<MessageBody
				message={message({
					id: 'draft-ssr',
					folders: ['custom'],
					ownmailDraft: true,
					body: markdownToDraftBody('# Heading\n\n**ready** to send'),
				})}
			/>,
		)

		expect(screen.getByText('Heading')).toBeInTheDocument()
		expect(screen.getByText('ready to send')).toBeInTheDocument()
		expect(container.textContent).not.toContain('# Heading')
		expect(container.textContent).not.toContain('**ready**')
		expect(document.querySelector(EMAIL_ELEMENT_TAG)).toBeNull()
	})

	it('renders no SSR placeholder for an empty trusted draft envelope', () => {
		mountState.mounted = false
		const { container } = render(
			<MessageBody
				message={message({
					id: 'draft-empty',
					ownmailDraft: true,
					body: markdownToDraftBody(''),
				})}
			/>,
		)

		expect(container.firstChild).toBeNull()
	})
})

describe('MessageBody (provider HTML, mounted → shadow-DOM renderer)', () => {
	it('renders the <ownmail-email> element titled with the message id', () => {
		render(<MessageBody message={message({ id: 'msg-42', body: '<p>Rich <b>content</b></p>' })} />)
		const el = document.querySelector(EMAIL_ELEMENT_TAG)
		expect(el).not.toBeNull()
		expect(el?.getAttribute('title')).toBe('Email content msg-42')
		expect(el?.shadowRoot?.querySelector('.email-root')?.innerHTML).toContain('content')
	})

	it('does not interpret an OwnMail-looking envelope from a provider message in Drafts', () => {
		render(
			<MessageBody
				message={message({
					id: 'msg-untrusted-envelope',
					folders: ['drafts'],
					body: markdownToDraftBody('# Heading\n\n**not bold**'),
				})}
			/>,
		)
		const root = document.querySelector(EMAIL_ELEMENT_TAG)?.shadowRoot?.querySelector('.email-root')

		expect(root).not.toBeNull()
		expect(root?.textContent).toContain('# Heading')
		expect(root?.textContent).toContain('**not bold**')
		expect(root?.querySelector('h1')).toBeNull()
		expect(root?.querySelector('strong')).toBeNull()
	})

	it('preserves original HTML structure through the sanitized renderer', () => {
		render(
			<MessageBody
				message={message({
					id: 'msg-formatted',
					body: '<h2>Release notes</h2><p><strong>Ready</strong> to ship.</p>',
				})}
			/>,
		)
		const root = document.querySelector(EMAIL_ELEMENT_TAG)?.shadowRoot?.querySelector('.email-root')

		expect(root?.querySelector('h2')?.textContent).toBe('Release notes')
		expect(root?.querySelector('strong')?.textContent).toBe('Ready')
	})

	it('retains sanitization and safe-link rewriting on the read path', () => {
		render(
			<MessageBody
				message={message({
					id: 'msg-hostile',
					body: '<p>Safe</p><script>alert(1)</script><a href="javascript:alert(2)">bad</a><a href="https://example.com">good</a>',
				})}
			/>,
		)
		const root = document.querySelector(EMAIL_ELEMENT_TAG)?.shadowRoot?.querySelector('.email-root')
		const safeLink = root?.querySelector('a[href="https://example.com"]')

		expect(root?.querySelector('script')).toBeNull()
		expect(root?.innerHTML).not.toContain('javascript:')
		expect(safeLink?.getAttribute('target')).toBe('_blank')
		expect(safeLink?.getAttribute('rel')).toBe('noopener noreferrer nofollow')
	})

	it('renders an explicit OwnMail draft envelope as its final email HTML preview', () => {
		render(
			<MessageBody
				message={message({
					id: 'draft-preview',
					folders: ['custom'],
					ownmailDraft: true,
					body: markdownToDraftBody('# Heading\n\n**ready** to send'),
				})}
			/>,
		)
		const root = document.querySelector(EMAIL_ELEMENT_TAG)?.shadowRoot?.querySelector('.email-root')

		expect(root?.querySelector('h1')?.textContent).toBe('Heading')
		expect(root?.querySelector('strong')?.textContent).toBe('ready')
		expect(root?.textContent).not.toContain('# Heading')
		expect(root?.textContent).not.toContain('**ready**')
	})
})

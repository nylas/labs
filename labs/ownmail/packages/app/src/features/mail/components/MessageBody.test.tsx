// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EMAIL_CANVAS_EVENT, EMAIL_ELEMENT_TAG } from '../lib/email-render.js'
import { markdownToDraftBody } from '../lib/html-to-markdown.js'
import type { MailMessage } from '../state/mail-queries.js'
import { MessageBody } from './MessageBody.js'

// useMounted drives the "render plain text on the server, upgrade to the shadow-DOM
// renderer on the client" decision. Control it directly so both sides are testable
// without depending on effect-flush timing.
const mountState = vi.hoisted(() => ({ mounted: true }))
vi.mock('#shared/components/ClientTime', () => ({ useMounted: () => mountState.mounted }))

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

	it('renders literal content in a full-width region with a bounded, safely wrapping prose measure', () => {
		const longToken = 'x'.repeat(200)
		const text = `First line\r\n  indented ${longToken}`
		render(<MessageBody message={message({ id: 'm-contained', body: text })} />)
		const container = document.querySelector('[data-slot="plain-email-content"]')
		const prose = document.querySelector('[data-slot="plain-email-prose"]')
		const content = container?.querySelector('p')

		expect(container).toHaveClass('w-full', 'min-w-0')
		expect(container).not.toHaveClass('max-w-[72ch]', 'rounded-xl', 'border', 'bg-card', 'p-5')
		expect(prose).toHaveClass('max-w-[72ch]', 'space-y-3')
		expect(content).toHaveClass('whitespace-pre-wrap', 'break-words', '[overflow-wrap:anywhere]')
		expect(content).toHaveTextContent(`First line\n  indented ${longToken}`, { normalizeWhitespace: false })
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

	it('collapses recognized plaintext reply history behind an accessible disclosure', async () => {
		render(
			<MessageBody
				message={message({
					id: 'm-quoted-text',
					body: 'Current answer\n\nOn Friday, Sam wrote:\n> Earlier line\n> Another line',
				})}
			/>,
		)

		const pill = screen.getByRole('button', { name: 'Quoted: 1 earlier message' })
		expect(screen.getByText('Current answer')).toBeInTheDocument()
		expect(pill).toHaveAttribute('aria-expanded', 'false')
		expect(screen.queryByText(/Earlier line/)).toBeNull()
		await userEvent.click(pill)
		expect(screen.getByText('Sam, Friday')).toBeInTheDocument()
		expect(screen.getByText('Earlier line Another line')).toBeInTheDocument()
	})

	it('does not hide an arbitrary plaintext quote', () => {
		render(
			<MessageBody message={message({ id: 'm-visible-quote', body: 'A thought:\n> Keep this visible' })} />,
		)

		expect(screen.queryByRole('button', { name: /Quoted/ })).toBeNull()
		expect(screen.getByText(/Keep this visible/)).toBeInTheDocument()
	})

	it('shows a disclosure when a plaintext message contains only recognized history', () => {
		render(
			<MessageBody
				message={message({ id: 'm-history-only', body: 'On Friday, Sam wrote:\n> Earlier line' })}
			/>,
		)

		expect(screen.getByRole('button', { name: 'Quoted: 1 earlier message' })).toBeInTheDocument()
		expect(document.querySelector('[data-slot="plain-email-prose"] > p')).toBeNull()
	})
})

describe('MessageBody (provider HTML, before client mount)', () => {
	it('shows a neutral placeholder instead of presenting the HTML message as plaintext', () => {
		mountState.mounted = false
		render(
			<MessageBody
				message={message({
					id: 'm5',
					body: '<p><strong>HTML version</strong></p>',
					snippet: 'Plaintext version',
				})}
			/>,
		)

		expect(screen.getByRole('status', { name: 'Loading email content' })).toBeInTheDocument()
		expect(screen.queryByText('HTML version')).toBeNull()
		expect(screen.queryByText('Plaintext version')).toBeNull()
		expect(document.querySelector('[data-slot="plain-email-content"]')).toBeNull()
		expect(document.querySelector(EMAIL_ELEMENT_TAG)).toBeNull()
	})

	it('does not inspect or execute textless HTML while unmounted', () => {
		mountState.mounted = false
		render(<MessageBody message={message({ id: 'm6', body: '<p></p>' })} />)
		expect(screen.getByRole('status', { name: 'Loading email content' })).toBeInTheDocument()
		expect(document.querySelector(EMAIL_ELEMENT_TAG)).toBeNull()
	})

	it('keeps a trusted draft envelope behind the same client rendering boundary', () => {
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

		expect(screen.getByRole('status', { name: 'Loading email content' })).toBeInTheDocument()
		expect(container.textContent).not.toContain('# Heading')
		expect(container.textContent).not.toContain('**ready**')
		expect(document.querySelector('[data-slot="plain-email-content"]')).toBeNull()
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
	it('prefers the full HTML body over a conflicting plaintext snippet', () => {
		render(
			<MessageBody
				message={message({
					id: 'msg-alternative',
					body: '<section><strong>Rich HTML version</strong></section>',
					snippet: 'Plaintext version',
				})}
			/>,
		)
		const root = document.querySelector(EMAIL_ELEMENT_TAG)?.shadowRoot?.querySelector('.email-root')

		expect(root?.querySelector('strong')?.textContent).toBe('Rich HTML version')
		expect(root?.textContent).not.toContain('Plaintext version')
		expect(document.querySelector('[data-slot="plain-email-content"]')).toBeNull()
	})

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

	it('bounds prose HTML without constraining a designed fixed-width email', () => {
		const prose = render(
			<MessageBody message={message({ id: 'msg-prose', body: '<p>A readable status update.</p>' })} />,
		)
		expect(prose.container.querySelector('[data-slot="html-email-content"]')).toHaveClass('max-w-[72ch]')

		prose.rerender(
			<MessageBody
				message={message({
					id: 'msg-designed',
					body: '<table width="640"><tr><td>Designed newsletter</td></tr></table>',
				})}
			/>,
		)
		expect(prose.container.querySelector('[data-slot="html-email-content"]')).not.toHaveClass('max-w-[72ch]')
	})

	it('collapses provider-marked HTML history but preserves an ordinary blockquote', () => {
		render(
			<MessageBody
				message={message({
					id: 'msg-quoted-html',
					body: '<p>Current reply</p><div class="gmail_quote">Old reply</div><blockquote>Visible callout</blockquote>',
				})}
			/>,
		)
		const root = document.querySelector(EMAIL_ELEMENT_TAG)?.shadowRoot?.querySelector('.email-root')

		expect(root?.querySelector('details:not([open]) summary')).toHaveTextContent('Show quoted text')
		expect(root?.querySelector('details')).toHaveTextContent('Old reply')
		expect(root?.querySelector('body > blockquote')).toHaveTextContent('Visible callout')
	})

	it('resolves matched CID images and renders unmatched references as inert text', async () => {
		const view = render(
			<MessageBody
				message={message({
					id: 'msg/cid',
					body: '<img src="cid:logo@example.com" alt="Logo"><img src="cid:missing" alt="Missing signature">',
					attachments: [{ id: 'inline/logo', is_inline: true, content_id: '<logo@example.com>' }],
					ownmailImageTokens: { 'inline/logo': 'signed.payload' },
				})}
			/>,
		)
		const root = document.querySelector(EMAIL_ELEMENT_TAG)?.shadowRoot?.querySelector('.email-root')

		expect(root?.querySelector('img')).not.toHaveAttribute('src')
		expect(root?.querySelector('[role="img"]')).toHaveTextContent('Missing signature')
		expect(root?.innerHTML).not.toContain('cid:')

		view.rerender(
			<MessageBody
				message={message({
					id: 'msg/cid',
					body: '<img src="cid:logo@example.com" alt="Logo"><img src="cid:missing" alt="Missing signature">',
					attachments: [{ id: 'inline/logo', is_inline: true, content_id: '<logo@example.com>' }],
					ownmailImageTokens: { 'inline/logo': 'signed.payload' },
				})}
				loadRemoteImagesForThread
			/>,
		)
		await waitFor(() =>
			expect(root?.querySelector('img')).toHaveAttribute(
				'src',
				'/email-images/signed.payload?mode=automatic&theme=light',
			),
		)
	})

	it('preserves a safe fallback link from an Outlook VML-only CTA', () => {
		render(
			<MessageBody
				message={message({
					id: 'msg-vml',
					body: '<v:roundrect href="https://example.com/confirm"><center>Confirm</center></v:roundrect>',
				})}
			/>,
		)
		const root = document.querySelector(EMAIL_ELEMENT_TAG)?.shadowRoot?.querySelector('.email-root')
		const link = root?.querySelector('a')

		expect(link).toHaveTextContent('Confirm')
		expect(link).toHaveAttribute('href', 'https://example.com/confirm')
		expect(link).toHaveAttribute('target', '_blank')
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

describe('MessageBody (canvas band)', () => {
	it('extends a reported sender canvas across the pane and keeps designed mail on the column', () => {
		render(
			<MessageBody
				message={message({ id: 'm-band', body: '<table width="600"><tr><td>Report</td></tr></table>' })}
			/>,
		)
		const band = document.querySelector('[data-slot="email-canvas-band"]') as HTMLElement
		expect(band.style.backgroundColor).toBe('')
		expect(band.firstElementChild).toHaveClass('px-0')
		act(() => {
			document.querySelector(EMAIL_ELEMENT_TAG)?.dispatchEvent(
				new CustomEvent(EMAIL_CANVAS_EVENT, {
					detail: { strategy: 'paper', canvas: 'rgb(238, 240, 243)', height: 300 },
				}),
			)
		})
		expect(band.style.backgroundColor).toBe('rgb(238, 240, 243)')
		expect(band).toHaveClass('py-3')
		expect(band).not.toHaveClass('py-6')
		expect(band).toHaveAttribute('data-email-strategy', 'paper')
	})
})

describe('MessageBody (edge states)', () => {
	it('reflows hard-wrapped plain text, sets each paragraph’s direction and keeps code as written', () => {
		render(
			<MessageBody
				message={message({
					id: 'm-release',
					body: [
						'The release went out at 6 and the rollback plan is in the doc. Ping me',
						'if staging looks off tonight.',
						'',
						'شكراً، سأراجع المستند صباح الغد.',
						'',
						'    git checkout release/3.2',
					].join('\n'),
				})}
				bodyFontSize={17}
			/>,
		)
		const paragraph = screen.getByText(
			'The release went out at 6 and the rollback plan is in the doc. Ping me if staging looks off tonight.',
		)
		expect(paragraph).toHaveAttribute('dir', 'auto')
		expect(paragraph).toHaveClass('text-[17px]', 'leading-[1.55]')
		expect(screen.getByText('شكراً، سأراجع المستند صباح الغد.')).toHaveAttribute('dir', 'auto')
		const code = screen.getByText('git checkout release/3.2')
		expect(code.tagName).toBe('PRE')
		expect(code).toHaveClass('font-mono', 'bg-muted', 'whitespace-pre')
	})

	it('keys repeated plain-text paragraphs apart', () => {
		const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
		render(<MessageBody message={message({ id: 'm-repeat', body: 'Same words.\n\nSame words.' })} />)
		expect(screen.getAllByText('Same words.')).toHaveLength(2)
		expect(errors).not.toHaveBeenCalled()
		errors.mockRestore()
	})

	it('folds a plain-text signature behind its pill', async () => {
		render(<MessageBody message={message({ id: 'm-sig', body: 'See you then.\n-- \nGrace Hopper' })} />)
		expect(screen.queryByText('Grace Hopper')).toBeNull()
		await userEvent.click(screen.getByRole('button', { name: 'Signature' }))
		expect(screen.getByText('Grace Hopper')).toBeInTheDocument()
	})

	it('takes HTML history and signature off the rendered email and shows them behind one pill', async () => {
		const onGoToQuoted = vi.fn()
		render(
			<MessageBody
				message={message({
					id: 'msg-12',
					subject: 'Re: Q3 roadmap',
					from: [{ name: 'Alan Turing', email: 'alan@x.com' }],
					body: '<div><p>Otherwise this is ready.</p><div class="gmail_signature">Alan Turing<br>Principal Engineer</div></div><div class="gmail_quote"><div class="gmail_attr">On Tue, Oct 13, 2026 at 6:02 PM Grace Hopper &lt;grace@x.com&gt; wrote:<br></div><blockquote class="gmail_quote"><p>Here is v3.</p></blockquote></div>',
				})}
				onGoToQuoted={onGoToQuoted}
			/>,
		)
		const root = document.querySelector(EMAIL_ELEMENT_TAG)?.shadowRoot?.querySelector('.email-root')
		expect(root?.textContent).toContain('Otherwise this is ready.')
		expect(root?.querySelector('details')).toBeNull()
		expect(root?.textContent).not.toContain('Principal Engineer')
		await userEvent.click(screen.getByRole('button', { name: 'Quoted text and signature' }))
		expect(screen.getByText('Here is v3.')).toBeInTheDocument()
		await userEvent.click(screen.getByRole('button', { name: 'Go to Grace’s message' }))
		expect(onGoToQuoted).toHaveBeenCalledWith(
			expect.objectContaining({ name: 'Grace Hopper', email: 'grace@x.com' }),
		)
	})

	it('keeps the pills of designed mail on the phone gutter', () => {
		render(
			<MessageBody
				message={message({
					id: 'm-designed-sig',
					body: '<table width="640"><tr><td>Designed</td></tr></table><div class="gmail_signature">Figma</div>',
				})}
			/>,
		)
		expect(screen.getByRole('button', { name: 'Signature' }).closest('.px-4')).not.toBeNull()
	})

	it('passes disabled links and the phone body size to the HTML renderer', () => {
		render(
			<MessageBody
				message={message({ id: 'm-links', body: '<p><a href="https://example.com">Confirm</a></p>' })}
				linksDisabled
				bodyFontSize={17}
			/>,
		)
		const element = document.querySelector(EMAIL_ELEMENT_TAG) as HTMLElement
		expect(element.style.fontSize).toBe('17px')
		expect(element.shadowRoot?.querySelector('style[data-ownmail-edge-style]')?.textContent).toContain(
			'a[href]{cursor:default!important;}',
		)
	})
})

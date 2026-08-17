// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { defaultUserPreferences, writeUserPreferences } from '#app/preferences/user-preferences'
import { EMAIL_ELEMENT_TAG, EMAIL_LAYOUT_STATUS_EVENT, LINK_PREVIEW_EVENT } from '../lib/email-render.js'
import { EmailHtml } from './EmailHtml.js'

afterEach(() => {
	cleanup()
	document.documentElement.classList.remove('dark')
	localStorage.clear()
})

function emailElement(): HTMLElement & { emailHtml: string } {
	return document.querySelector(EMAIL_ELEMENT_TAG) as HTMLElement & { emailHtml: string }
}

describe('EmailHtml', () => {
	it('mounts the shadow-DOM element and feeds it sanitized html', () => {
		render(<EmailHtml html="<p>Newsletter body</p>" messageId="m1" />)
		const el = emailElement()
		expect(el).not.toBeNull()
		expect(document.querySelector('[data-slot="html-email-placeholder"]')).toBeNull()
		expect(el.getAttribute('title')).toBe('Email content m1')
		expect(el.shadowRoot?.querySelector('.email-root')?.innerHTML).toContain('Newsletter body')
	})

	it('shows a URL preview anchored near the cursor while a link is hovered, and hides it on leave', () => {
		render(<EmailHtml html="<p>x</p>" messageId="m2" />)
		const el = emailElement()

		act(() => {
			el.dispatchEvent(
				new CustomEvent(LINK_PREVIEW_EVENT, {
					detail: { href: 'https://preview.example.com/path', x: 50, y: 60 },
				}),
			)
		})
		const box = screen.getByText('https://preview.example.com/path')
		expect(box).toBeInTheDocument()
		// Positioned relative to the pointer (top-left quadrant → offset down-right),
		// not pinned to a fixed corner.
		expect(box.style.left).toBe('66px')
		expect(box.style.top).toBe('76px')

		act(() => {
			el.dispatchEvent(new CustomEvent(LINK_PREVIEW_EVENT, { detail: { href: null, x: 0, y: 0 } }))
		})
		expect(screen.queryByText('https://preview.example.com/path')).toBeNull()
	})

	it('does not invert email in light mode', () => {
		render(<EmailHtml html="<p>x</p>" messageId="m3" />)
		expect(emailElement()).not.toHaveAttribute('data-dark-invert')
		expect(emailElement()).toHaveAttribute('data-email-theme', 'light')
	})

	it('leaves an adaptive dark stylesheet in control', () => {
		document.documentElement.classList.add('dark')
		render(
			<EmailHtml
				html="<style>@media (prefers-color-scheme:dark){p{color:white}}</style><p>x</p>"
				messageId="m4"
			/>,
		)
		expect(emailElement()).not.toHaveAttribute('data-dark-invert')
		expect(emailElement()).toHaveAttribute('data-email-theme', 'dark')
	})

	it('does not trust dark-mode text that the sanitizer removes', () => {
		document.documentElement.classList.add('dark')
		render(
			<EmailHtml
				html={'<script>"@media (prefers-color-scheme:dark)"</script><p>plain</p>'}
				messageId="m4-hostile"
			/>,
		)
		expect(emailElement()).toHaveAttribute('data-dark-invert')
	})

	it('auto-darkens by default in dark mode, including email with only a color-scheme declaration', () => {
		document.documentElement.classList.add('dark')
		render(<EmailHtml html='<meta name="color-scheme" content="light dark"><p>plain</p>' messageId="m5" />)
		expect(emailElement()).toHaveAttribute('data-dark-invert')
	})

	it('preserves original colors when account-level automatic darkening is off', () => {
		document.documentElement.classList.add('dark')
		render(<EmailHtml html="<p>plain</p>" messageId="m5-original" darken={false} />)
		expect(emailElement()).not.toHaveAttribute('data-dark-invert')
	})

	it('reacts to the app switching into dark mode after mount', async () => {
		render(<EmailHtml html="<p>x</p>" messageId="m6" />)
		expect(emailElement()).not.toHaveAttribute('data-dark-invert')

		act(() => {
			document.documentElement.classList.add('dark')
		})
		await waitFor(() => expect(emailElement()).toHaveAttribute('data-dark-invert'))
		expect(emailElement()).toHaveAttribute('data-email-theme', 'dark')
	})

	it('keeps blocked-image privacy and display controls in one compact popover', async () => {
		render(
			<EmailHtml
				html='<img class="remote" src="https://images.example/tracker.png" width="600" height="200">'
				messageId="m-remote"
			/>,
		)
		const image = () => emailElement().shadowRoot?.querySelector<HTMLImageElement>('.remote')
		expect(image()?.hasAttribute('src')).toBe(false)
		expect(image()?.getAttribute('width')).toBe('600')
		const display = await screen.findByRole('button', { name: 'Images blocked' })
		expect(screen.queryByText('Remote images are blocked to protect your privacy.')).toBeNull()
		fireEvent.click(display)
		expect(screen.getByRole('dialog', { name: 'Message display' })).toBeInTheDocument()
		fireEvent.click(screen.getByRole('button', { name: 'Show once' }))
		await waitFor(() => expect(image()?.getAttribute('src')).toBe('https://images.example/tracker.png'))
		expect(screen.queryByRole('dialog', { name: 'Message display' })).toBeNull()
		fireEvent.click(screen.getByRole('button', { name: 'Display' }))
		expect(screen.getByRole('button', { name: 'Automatic' })).toHaveAttribute('aria-pressed', 'true')
		fireEvent.click(screen.getByRole('button', { name: 'Original' }))
		expect(emailElement()).toHaveAttribute('data-image-mode', 'original')
	})

	it('dismisses display controls outside the menu and returns focus after Escape', async () => {
		render(<EmailHtml html='<img src="https://images.example/tracker.png">' messageId="m-display-dismiss" />)
		const display = await screen.findByRole('button', { name: 'Images blocked' })
		fireEvent.click(display)
		fireEvent.keyDown(document, { key: 'Tab' })
		expect(screen.getByRole('dialog', { name: 'Message display' })).toBeInTheDocument()

		fireEvent.keyDown(document, { key: 'Escape' })
		expect(screen.queryByRole('dialog', { name: 'Message display' })).toBeNull()
		expect(display).toHaveFocus()

		fireEvent.click(display)
		fireEvent.pointerDown(display)
		expect(screen.getByRole('dialog', { name: 'Message display' })).toBeInTheDocument()
		fireEvent.pointerDown(document.body)
		expect(screen.queryByRole('dialog', { name: 'Message display' })).toBeNull()

		fireEvent.click(display)
		fireEvent.focusIn(document.body)
		expect(screen.queryByRole('dialog', { name: 'Message display' })).toBeNull()
	})

	it('can remember proxy consent for a normalized sender without storing their address', async () => {
		const props = {
			html: '<img class="remote" src="https://images.example/logo.png">',
			messageId: 'm-trusted',
			senderAddress: 'News@Example.com',
		}
		const first = render(<EmailHtml {...props} />)
		fireEvent.click(await screen.findByRole('button', { name: 'Images blocked' }))
		fireEvent.click(screen.getByRole('button', { name: 'Always from sender' }))
		await waitFor(() => expect(screen.queryByRole('button', { name: 'Images blocked' })).toBeNull())
		expect(localStorage.getItem('ownmail:trusted-image-senders:v2') ?? '').not.toContain('example.com')

		first.unmount()
		render(<EmailHtml {...props} messageId="m-trusted-next" />)
		await waitFor(() =>
			expect(emailElement().shadowRoot?.querySelector('.remote')).toHaveAttribute(
				'src',
				'https://images.example/logo.png',
			),
		)
	})

	it('keeps images blocked when an invalid sender cannot be trusted', async () => {
		render(
			<EmailHtml
				html='<img class="remote" src="https://images.example/logo.png">'
				messageId="m-invalid-sender"
				senderAddress="not-an-email"
			/>,
		)
		fireEvent.click(await screen.findByRole('button', { name: 'Images blocked' }))
		fireEvent.click(screen.getByRole('button', { name: 'Always from sender' }))
		expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t save that image choice. Try again.')
		expect(screen.getByRole('button', { name: 'Always from sender' })).toBeInTheDocument()
	})

	it('persists an always-show choice and applies it to later messages', async () => {
		const html = '<img class="remote" src="https://images.example/logo.png">'
		const first = render(<EmailHtml html={html} messageId="m-always-first" />)
		fireEvent.click(await screen.findByRole('button', { name: 'Images blocked' }))
		fireEvent.click(screen.getByRole('button', { name: 'Always show all' }))
		await waitFor(() =>
			expect(JSON.parse(localStorage.getItem('ownmail:user-preferences:v1') ?? '{}')).toMatchObject({
				remoteImagePolicy: 'always',
			}),
		)

		first.unmount()
		writeUserPreferences({ ...defaultUserPreferences(), remoteImagePolicy: 'always' })
		render(<EmailHtml html={html} messageId="m-always-next" />)
		await waitFor(() =>
			expect(emailElement().shadowRoot?.querySelector('.remote')).toHaveAttribute(
				'src',
				'https://images.example/logo.png',
			),
		)
	})

	it('offers readable and original layouts when legacy content needs compatibility reflow', () => {
		render(<EmailHtml html='<table width="800"><tr><td>Legacy</td></tr></table>' messageId="m7" />)
		const el = emailElement()

		act(() => {
			el.dispatchEvent(
				new CustomEvent(EMAIL_LAYOUT_STATUS_EVENT, {
					detail: {
						mode: 'readable',
						naturalWidth: 320,
						containerWidth: 320,
						scale: 1,
						reflowed: true,
						needsFit: false,
					},
				}),
			)
		})

		fireEvent.click(screen.getByRole('button', { name: 'Display' }))
		const readable = screen.getByRole('button', { name: 'Readable' })
		const original = screen.getByRole('button', { name: 'Original' })
		expect(readable).toHaveAttribute('aria-pressed', 'true')
		expect(el).toHaveAttribute('data-layout-mode', 'readable')

		fireEvent.click(original)

		expect(original).toHaveAttribute('aria-pressed', 'true')
		expect(el).toHaveAttribute('data-layout-mode', 'original')
	})
})

// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { EMAIL_ELEMENT_TAG, LINK_PREVIEW_EVENT } from '../lib/email-render.js'
import { EmailHtml } from './EmailHtml.js'

afterEach(() => {
	cleanup()
	document.documentElement.classList.remove('dark')
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
	})

	it('leaves an adaptive dark stylesheet in control', () => {
		document.documentElement.classList.add('dark')
		render(<EmailHtml html="<style>@media (prefers-color-scheme:dark){}</style><p>x</p>" messageId="m4" />)
		expect(emailElement()).not.toHaveAttribute('data-dark-invert')
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
	})
})

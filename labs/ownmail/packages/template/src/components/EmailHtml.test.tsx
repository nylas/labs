// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { EmailHtml } from './EmailHtml.js'
import { EMAIL_ELEMENT_TAG, LINK_PREVIEW_EVENT } from './email-render.js'

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

	it('hides the auto-dark toggle in light mode', () => {
		render(<EmailHtml html="<p>x</p>" messageId="m3" />)
		expect(screen.queryByLabelText('Toggle automatic dark mode for this email')).toBeNull()
	})

	it('hides the auto-dark toggle when the email brings its own dark styles', () => {
		document.documentElement.classList.add('dark')
		render(<EmailHtml html="<style>@media (prefers-color-scheme:dark){}</style><p>x</p>" messageId="m4" />)
		expect(screen.queryByLabelText('Toggle automatic dark mode for this email')).toBeNull()
	})

	it('auto-darkens by default in dark mode and toggles back to the original colors', () => {
		document.documentElement.classList.add('dark')
		render(<EmailHtml html="<p>plain</p>" messageId="m5" />)
		const el = emailElement()
		const toggle = screen.getByLabelText('Toggle automatic dark mode for this email')

		// Default: auto-dark on → element inverted, label reads "Dark".
		expect(toggle).toHaveAttribute('aria-pressed', 'true')
		expect(toggle).toHaveTextContent('Dark')
		expect(el.hasAttribute('data-dark-invert')).toBe(true)

		fireEvent.click(toggle)

		// Toggled off → original colors, inversion attribute removed.
		expect(toggle).toHaveAttribute('aria-pressed', 'false')
		expect(toggle).toHaveTextContent('Original')
		expect(el.hasAttribute('data-dark-invert')).toBe(false)
	})

	it('reacts to the app switching into dark mode after mount', async () => {
		render(<EmailHtml html="<p>x</p>" messageId="m6" />)
		expect(screen.queryByLabelText('Toggle automatic dark mode for this email')).toBeNull()

		act(() => {
			document.documentElement.classList.add('dark')
		})
		await waitFor(() =>
			expect(screen.getByLabelText('Toggle automatic dark mode for this email')).toBeInTheDocument(),
		)
	})
})

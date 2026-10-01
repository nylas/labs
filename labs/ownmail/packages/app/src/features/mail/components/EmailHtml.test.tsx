// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultUserPreferences, writeUserPreferences } from '#app/preferences/user-preferences'
import {
	EMAIL_CANVAS_EVENT,
	EMAIL_ELEMENT_TAG,
	EMAIL_LAYOUT_STATUS_EVENT,
	EMAIL_REMOTE_IMAGES_EVENT,
	LINK_PREVIEW_EVENT,
} from '../lib/email-render.js'
import { forgetRememberedEmails, rememberEmail, renderedEmailKey } from '../lib/email-render-memory.js'
import { EmailHtml } from './EmailHtml.js'

const { senderImagesTrustedMock } = vi.hoisted(() => ({ senderImagesTrustedMock: vi.fn() }))
vi.mock('../lib/image-sender-trust.js', () => ({ senderImagesTrusted: senderImagesTrustedMock }))

afterEach(() => {
	cleanup()
	document.documentElement.classList.remove('dark')
	localStorage.clear()
	forgetRememberedEmails()
})

beforeEach(() => {
	senderImagesTrustedMock.mockReset()
	senderImagesTrustedMock.mockResolvedValue(false)
})

function emailElement(): HTMLElement & { emailHtml: string } {
	return document.querySelector(EMAIL_ELEMENT_TAG) as HTMLElement & { emailHtml: string }
}

const CONTROLLED_IMAGE = `/email-images/${'a'.repeat(20)}.${'b'.repeat(20)}?mode=automatic&theme=light`

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

	it('renders light mode with the original presentation', () => {
		render(<EmailHtml html="<p>x</p>" messageId="m3" />)
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
		expect(emailElement()).toHaveAttribute('data-email-theme', 'dark')
	})

	it('auto-darkens by default in dark mode, including email with only a color-scheme declaration', () => {
		document.documentElement.classList.add('dark')
		render(<EmailHtml html='<meta name="color-scheme" content="light dark"><p>plain</p>' messageId="m5" />)
		expect(emailElement()).toHaveAttribute('data-email-theme', 'dark')
		expect(emailElement()).toHaveAttribute('data-color-mode', 'automatic')
	})

	it('preserves original colors when account-level automatic darkening is off', () => {
		document.documentElement.classList.add('dark')
		render(<EmailHtml html="<p>plain</p>" messageId="m5-original" darken={false} />)
		expect(emailElement()).toHaveAttribute('data-email-theme', 'light')
	})

	it('reacts to the app switching into dark mode after mount', async () => {
		render(<EmailHtml html="<p>x</p>" messageId="m6" />)
		expect(emailElement()).toHaveAttribute('data-email-theme', 'light')

		act(() => {
			document.documentElement.classList.add('dark')
		})
		await waitFor(() => expect(emailElement()).toHaveAttribute('data-email-theme', 'dark'))
	})

	it('keeps remote images blocked until the thread controller opts in', async () => {
		document.documentElement.classList.add('dark')
		const view = render(
			<EmailHtml
				html={`<img class="remote" src="${CONTROLLED_IMAGE}" width="600" height="200">`}
				messageId="m-remote"
			/>,
		)
		const image = () => emailElement().shadowRoot?.querySelector<HTMLImageElement>('.remote')
		expect(image()?.hasAttribute('src')).toBe(false)
		expect(image()?.getAttribute('width')).toBe('600')

		view.rerender(
			<EmailHtml
				html={`<img class="remote" src="${CONTROLLED_IMAGE}" width="600" height="200">`}
				messageId="m-remote"
				loadRemoteImagesForThread
			/>,
		)
		await waitFor(() =>
			expect(image()?.getAttribute('src')).toBe(
				`${CONTROLLED_IMAGE.split('?')[0]}?mode=automatic&theme=dark`,
			),
		)
	})

	it('applies controlled layout and color modes without rendering message-level chrome', () => {
		render(
			<EmailHtml
				html="<p>Newsletter</p>"
				messageId="m-controlled-display"
				layoutMode="original"
				colorMode="original"
			/>,
		)

		expect(screen.queryByRole('button')).toBeNull()
		expect(emailElement()).toHaveAttribute('data-layout-mode', 'original')
		expect(emailElement()).toHaveAttribute('data-image-mode', 'original')
		expect(emailElement()).toHaveAttribute('data-email-theme', 'light')
		expect(emailElement()).toHaveAttribute('data-color-mode', 'original')
	})

	it('reports the chosen canvas and remembers the measured height for the next open', () => {
		const onCanvas = vi.fn()
		const view = render(<EmailHtml html="<p>Report</p>" messageId="m-canvas" onCanvas={onCanvas} />)
		const detail = { strategy: 'original', canvas: 'rgb(238, 240, 243)', height: 640 }
		act(() => {
			emailElement().dispatchEvent(new CustomEvent(EMAIL_CANVAS_EVENT, { detail }))
		})
		expect(onCanvas).toHaveBeenCalledWith(detail)
		act(() => {
			emailElement().dispatchEvent(new CustomEvent(EMAIL_CANVAS_EVENT, { detail: { ...detail, height: 0 } }))
		})
		view.unmount()

		const replayed = vi.fn()
		render(<EmailHtml html="<p>Report</p>" messageId="m-canvas" onCanvas={replayed} />)
		expect(replayed).toHaveBeenCalledWith(detail)
		const wrapper = emailElement().parentElement as HTMLElement
		expect(wrapper.style.minHeight).toBe('640px')
		act(() => {
			emailElement().dispatchEvent(new CustomEvent(EMAIL_CANVAS_EVENT, { detail }))
		})
		expect(wrapper.style.minHeight).toBe('')
	})

	it('reserves a remembered height without a placeholder box before the element is ready', () => {
		rememberEmail(renderedEmailKey('m-reserved', 'light', 'automatic'), {
			strategy: 'original',
			canvas: null,
			height: 300,
		})
		render(<EmailHtml html="<p>Reserved</p>" messageId="m-reserved" />)
		expect((emailElement().parentElement as HTMLElement).style.minHeight).toBe('300px')
	})

	it('reports renderer status and retries failures when the thread revision advances', async () => {
		const onDisplayStatus = vi.fn()
		const view = render(
			<EmailHtml
				html={`<img class="remote" alt="Newsletter chart" src="${CONTROLLED_IMAGE}">`}
				messageId="m-failed-image"
				loadRemoteImagesForThread
				onDisplayStatus={onDisplayStatus}
			/>,
		)
		const image = emailElement().shadowRoot?.querySelector<HTMLImageElement>('.remote') as HTMLImageElement
		await waitFor(() => expect(image).toHaveAttribute('src', CONTROLLED_IMAGE))

		fireEvent.error(image)
		expect(onDisplayStatus).toHaveBeenLastCalledWith(
			'm-failed-image',
			expect.objectContaining({
				remoteImages: expect.objectContaining({ failedImages: 1 }),
			}),
		)
		expect(emailElement().shadowRoot?.querySelector('[role="img"]')).toHaveAccessibleName('Newsletter chart')

		view.rerender(
			<EmailHtml
				html={`<img class="remote" alt="Newsletter chart" src="${CONTROLLED_IMAGE}">`}
				messageId="m-failed-image"
				loadRemoteImagesForThread
				retryRevision={1}
				onDisplayStatus={onDisplayStatus}
			/>,
		)
		expect(image.src).toContain('retry=1')
	})

	it('reports layout capability and clears it when the message changes', () => {
		const onDisplayStatus = vi.fn()
		const view = render(
			<EmailHtml
				html="<table width=800><tr><td>Digest</td></tr></table>"
				messageId="m-layout"
				onDisplayStatus={onDisplayStatus}
			/>,
		)
		act(() => {
			emailElement().dispatchEvent(
				new CustomEvent(EMAIL_LAYOUT_STATUS_EVENT, {
					detail: {
						mode: 'readable',
						naturalWidth: 800,
						containerWidth: 320,
						scale: 1,
						reflowed: true,
						needsFit: false,
					},
				}),
			)
		})
		expect(onDisplayStatus).toHaveBeenLastCalledWith(
			'm-layout',
			expect.objectContaining({ layoutAvailable: true }),
		)

		view.rerender(<EmailHtml html="<p>Ordinary</p>" messageId="m-layout" onDisplayStatus={onDisplayStatus} />)
		expect(onDisplayStatus).toHaveBeenLastCalledWith(
			'm-layout',
			expect.objectContaining({ layoutAvailable: false }),
		)
	})

	it('reports fit-only layouts while leaving ordinary layouts unavailable', () => {
		const onDisplayStatus = vi.fn()
		render(<EmailHtml html="<p>Layout</p>" messageId="m-fit-layout" onDisplayStatus={onDisplayStatus} />)
		const detail = {
			mode: 'readable',
			naturalWidth: 320,
			containerWidth: 320,
			scale: 1,
			reflowed: false,
			needsFit: false,
		}

		act(() => {
			emailElement().dispatchEvent(new CustomEvent(EMAIL_LAYOUT_STATUS_EVENT, { detail }))
		})
		expect(onDisplayStatus).toHaveBeenLastCalledWith(
			'm-fit-layout',
			expect.objectContaining({ layoutAvailable: false }),
		)

		act(() => {
			emailElement().dispatchEvent(
				new CustomEvent(EMAIL_LAYOUT_STATUS_EVENT, { detail: { ...detail, needsFit: true } }),
			)
		})
		expect(onDisplayStatus).toHaveBeenLastCalledWith(
			'm-fit-layout',
			expect.objectContaining({ layoutAvailable: true }),
		)
	})

	it('does not carry thread consent when its controller resets the opt-in', async () => {
		const html = `<img class="remote" src="${CONTROLLED_IMAGE}">`
		const { rerender } = render(
			<EmailHtml html={html} messageId="m-consent-first" loadRemoteImagesForThread />,
		)
		await waitFor(() =>
			expect(emailElement().shadowRoot?.querySelector('.remote')).toHaveAttribute('src', CONTROLLED_IMAGE),
		)

		rerender(<EmailHtml html={html} messageId="m-consent-second" />)
		await waitFor(() =>
			expect(emailElement().shadowRoot?.querySelector('.remote')).not.toHaveAttribute('src'),
		)
	})

	it('loads images after a matching sender is trusted by the thread controller', async () => {
		render(
			<EmailHtml
				html={`<img class="remote" src="${CONTROLLED_IMAGE}">`}
				messageId="m-trusted-sender"
				senderAddress="news@example.com"
				loadRemoteImagesForSender
			/>,
		)
		await waitFor(() =>
			expect(emailElement().shadowRoot?.querySelector('.remote')).toHaveAttribute('src', CONTROLLED_IMAGE),
		)
	})

	it('loads images for a sender remembered from a previous thread', async () => {
		senderImagesTrustedMock.mockResolvedValue(true)
		render(
			<EmailHtml
				html={`<img class="remote" src="${CONTROLLED_IMAGE}">`}
				messageId="m-remembered-sender"
				senderAddress="remembered@example.com"
			/>,
		)

		await waitFor(() => expect(senderImagesTrustedMock).toHaveBeenCalledWith('remembered@example.com'))
		await waitFor(() =>
			expect(emailElement().shadowRoot?.querySelector('.remote')).toHaveAttribute('src', CONTROLLED_IMAGE),
		)
	})

	it('ignores a remembered-sender result after its rendered document is replaced', async () => {
		let resolveTrust: ((trusted: boolean) => void) | undefined
		senderImagesTrustedMock.mockImplementation(
			() =>
				new Promise<boolean>((resolve) => {
					resolveTrust = resolve
				}),
		)
		const view = render(
			<EmailHtml
				html={`<img class="old" src="${CONTROLLED_IMAGE}">`}
				messageId="m-old-sender"
				senderAddress="remembered@example.com"
			/>,
		)
		view.rerender(<EmailHtml html="<p>Replacement</p>" messageId="m-replacement" />)
		await act(async () => resolveTrust?.(true))

		expect(emailElement().shadowRoot?.querySelector('.old')).toBeNull()
		expect(emailElement()).not.toHaveAttribute('data-load-remote-images')
	})

	it('does not retry when the revision advances without failed images', () => {
		const view = render(<EmailHtml html="<p>No failures</p>" messageId="m-no-failures" />)
		act(() => {
			emailElement().dispatchEvent(
				new CustomEvent(EMAIL_REMOTE_IMAGES_EVENT, {
					detail: { hasRemoteImages: true, loaded: true, failedImages: 0, pendingImages: 0 },
				}),
			)
		})
		view.rerender(<EmailHtml html="<p>No failures</p>" messageId="m-no-failures" retryRevision={1} />)
		act(() => {
			emailElement().dispatchEvent(
				new CustomEvent(EMAIL_REMOTE_IMAGES_EVENT, {
					detail: { hasRemoteImages: true, loaded: true },
				}),
			)
		})
		view.rerender(<EmailHtml html="<p>No failures</p>" messageId="m-no-failures" retryRevision={2} />)
		expect(emailElement()).not.toHaveAttribute('data-retry-revision')
	})

	it('removes its thread status when unmounted', () => {
		const onDisplayStatus = vi.fn()
		const view = render(
			<EmailHtml html="<p>Status</p>" messageId="m-status" onDisplayStatus={onDisplayStatus} />,
		)

		view.unmount()
		expect(onDisplayStatus).toHaveBeenLastCalledWith('m-status', null)
	})

	it('reapplies saved image consent when the rendered HTML changes in place', async () => {
		writeUserPreferences({ ...defaultUserPreferences(), remoteImagePolicy: 'always' })
		const { rerender } = render(
			<EmailHtml html={`<img class="first" src="${CONTROLLED_IMAGE}">`} messageId="m-always-update" />,
		)
		await waitFor(() =>
			expect(emailElement().shadowRoot?.querySelector('.first')).toHaveAttribute('src', CONTROLLED_IMAGE),
		)

		rerender(
			<EmailHtml html={`<img class="replacement" src="${CONTROLLED_IMAGE}">`} messageId="m-always-update" />,
		)
		await waitFor(() =>
			expect(emailElement().shadowRoot?.querySelector('.replacement')).toHaveAttribute(
				'src',
				CONTROLLED_IMAGE,
			),
		)
	})
})

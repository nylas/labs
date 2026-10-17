// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetAccountScope, setAccountScope } from '#app/lib/account-scope'
import { defaultUserPreferences, writeUserPreferences } from '#app/preferences/user-preferences'
import {
	EMAIL_CANVAS_EVENT,
	EMAIL_ELEMENT_TAG,
	EMAIL_LAYOUT_STATUS_EVENT,
	EMAIL_REMOTE_IMAGES_EVENT,
	LINK_PREVIEW_EVENT,
} from '../lib/email-render.js'
import { forgetRememberedEmails, rememberEmail, renderedEmailKey } from '../lib/email-render-memory.js'
import { blockedImageCount, EDGE_STYLE_ATTRIBUTE, EmailHtml, edgeShadowStyle } from './EmailHtml.js'

const { senderImagesTrustedMock, trustSenderImagesMock, openMessageWindowMock } = vi.hoisted(() => ({
	senderImagesTrustedMock: vi.fn(),
	trustSenderImagesMock: vi.fn(),
	openMessageWindowMock: vi.fn(),
}))
vi.mock('../lib/image-sender-trust.js', () => ({
	senderImagesTrusted: senderImagesTrustedMock,
	trustSenderImages: trustSenderImagesMock,
}))
vi.mock('../lib/open-message-window.js', () => ({ openMessageWindow: openMessageWindowMock }))

afterEach(() => {
	cleanup()
	document.documentElement.classList.remove('dark')
	localStorage.clear()
	forgetRememberedEmails()
	resetAccountScope()
})

beforeEach(() => {
	setAccountScope('ada@ownmail.com')
	senderImagesTrustedMock.mockReset()
	senderImagesTrustedMock.mockResolvedValue(false)
	trustSenderImagesMock.mockReset()
	trustSenderImagesMock.mockResolvedValue(true)
	openMessageWindowMock.mockReset()
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

	it('reopens a message on the paper it was last shown on, and only that message', () => {
		document.documentElement.classList.add('dark')
		rememberEmail(renderedEmailKey('m-paper', 'dark', 'automatic'), {
			strategy: 'paper',
			canvas: 'rgb(255, 255, 255)',
			height: 300,
		})
		const view = render(<EmailHtml html="<p>Logo mail</p>" messageId="m-paper" />)
		expect(emailElement()).toHaveAttribute('data-email-paper')

		// Original colors is a different presentation; nothing was remembered for it.
		view.rerender(<EmailHtml html="<p>Logo mail</p>" messageId="m-paper" colorMode="original" />)
		expect(emailElement()).not.toHaveAttribute('data-email-paper')
		view.rerender(<EmailHtml html="<p>Other mail</p>" messageId="m-other" />)
		expect(emailElement()).not.toHaveAttribute('data-email-paper')
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

		// The question is whether this inbox trusts the sender, not any inbox on the device.
		await waitFor(() =>
			expect(senderImagesTrustedMock).toHaveBeenCalledWith('remembered@example.com', 'ada@ownmail.com'),
		)
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

describe('EmailHtml edge states', () => {
	const blocked = `<img alt="Lisbon skyline" src="${CONTROLLED_IMAGE}" width="600" height="200"><img alt="QR" src="${CONTROLLED_IMAGE}"><img src="${CONTROLLED_IMAGE}" width="1" height="1">`
	const fitStatus = (scale: number) =>
		new CustomEvent(EMAIL_LAYOUT_STATUS_EVENT, {
			detail: {
				mode: 'original',
				naturalWidth: 640,
				containerWidth: 524,
				scale,
				reflowed: false,
				needsFit: scale < 1,
			},
		})

	it('says how many images are hidden and from where, and shows them for this message', async () => {
		render(
			<EmailHtml html={blocked} messageId="m-voyage" senderAddress="trips@voyage.com" senderName="Voyage" />,
		)
		expect(await screen.findByText('2 images from voyage.com are hidden')).toBeInTheDocument()
		const style = emailElement().shadowRoot?.querySelector(`style[${EDGE_STYLE_ATTRIBUTE}]`)
		expect(style?.textContent).toContain('content:attr(alt)')
		expect(style?.textContent).not.toContain('a[href]{cursor:default')

		fireEvent.click(screen.getByRole('button', { name: 'Show' }))
		await waitFor(() => expect(emailElement()).toHaveAttribute('data-load-remote-images'))
		await waitFor(() => expect(screen.queryByText(/are hidden/)).toBeNull())
	})

	it('remembers the sender with Always, and says so when that fails', async () => {
		const view = render(
			<EmailHtml html={blocked} messageId="m-always" senderAddress="trips@voyage.com" senderName="Voyage" />,
		)
		fireEvent.click(await screen.findByRole('button', { name: 'Always for Voyage' }))
		expect(trustSenderImagesMock).toHaveBeenCalledWith('trips@voyage.com', 'ada@ownmail.com')
		await waitFor(() => expect(emailElement()).toHaveAttribute('data-load-remote-images'))
		expect(screen.queryByRole('alert')).toBeNull()
		view.unmount()

		trustSenderImagesMock.mockResolvedValue(false)
		render(<EmailHtml html={blocked} messageId="m-always-fails" senderAddress="trips@voyage.com" />)
		fireEvent.click(await screen.findByRole('button', { name: 'Always for voyage.com' }))
		expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t remember this sender.')
	})

	it('offers only Show without a sender, and nothing when images are always allowed', async () => {
		const view = render(<EmailHtml html={blocked} messageId="m-anon" />)
		expect(await screen.findByText('2 images are hidden')).toBeInTheDocument()
		expect(screen.queryByRole('button', { name: /Always/ })).toBeNull()
		view.unmount()

		writeUserPreferences({ ...defaultUserPreferences(), remoteImagePolicy: 'always' })
		render(<EmailHtml html={blocked} messageId="m-allowed" />)
		await waitFor(() => expect(emailElement()).toHaveAttribute('data-load-remote-images'))
		expect(screen.queryByText(/are hidden/)).toBeNull()
	})

	it('says a wide layout was fitted, shows it at actual size, and opens it in a window', () => {
		render(
			<EmailHtml
				html="<table width='640'><tr><td>Config</td></tr></table>"
				messageId="m-fit"
				windowTitle="Config"
			/>,
		)
		act(() => {
			emailElement().dispatchEvent(fitStatus(0.82))
		})
		expect(screen.getByText(/Fitted to width/)).toHaveTextContent('Fitted to width (82%)')

		fireEvent.click(screen.getByRole('button', { name: 'Actual size' }))
		expect(emailElement().style.width).toBe('640px')
		expect(emailElement().style.maxWidth).toBe('none')
		expect(emailElement().parentElement).toHaveClass('overflow-x-auto')
		// At actual size the element reports no scale; the bar keeps its measurement.
		act(() => {
			emailElement().dispatchEvent(fitStatus(1))
		})
		expect(screen.getByRole('button', { name: 'Fit to width' })).toBeInTheDocument()

		fireEvent.click(screen.getByRole('button', { name: 'Open in window' }))
		expect(openMessageWindowMock).toHaveBeenCalledWith(
			"<table width='640'><tr><td>Config</td></tr></table>",
			{
				title: 'Config',
				allowRemoteImages: false,
			},
		)

		fireEvent.click(screen.getByRole('button', { name: 'Fit to width' }))
		act(() => {
			emailElement().dispatchEvent(fitStatus(1))
		})
		expect(screen.queryByText(/Fitted to width/)).toBeNull()
		expect(emailElement().style.width).toBe('')
	})

	it('keeps the bars on the prose gutter for designed mail', () => {
		render(<EmailHtml html="<p>Wide</p>" messageId="m-inset" chromeInset />)
		act(() => {
			emailElement().dispatchEvent(fitStatus(0.8))
		})
		expect(document.querySelector('[data-slot="email-edge-bars"]')).toHaveClass('px-4', 'sm:px-0')
	})

	it('sets the phone body size on the element', () => {
		render(<EmailHtml html="<p>Phone</p>" messageId="m-17" fontSize={17} />)
		expect(emailElement().style.fontSize).toBe('17px')
		expect(emailElement().style.lineHeight).toBe('1.55')
	})

	it('makes links inert when the sender is not to be trusted', () => {
		const view = render(
			<EmailHtml
				html='<p><a class="go" href="https://meridian-secure.co/verify">Confirm</a> <span class="plain">text</span></p>'
				messageId="m-lookalike"
				linksDisabled
			/>,
		)
		const root = emailElement().shadowRoot as ShadowRoot
		expect(root.querySelector(`style[${EDGE_STYLE_ATTRIBUTE}]`)?.textContent).toContain(
			'a[href]{cursor:default!important;}',
		)
		const link = root.querySelector('.go') as HTMLElement
		const click = new MouseEvent('click', { bubbles: true, composed: true, cancelable: true })
		link.dispatchEvent(click)
		expect(click.defaultPrevented).toBe(true)
		const middle = new MouseEvent('auxclick', { bubbles: true, composed: true, cancelable: true })
		link.dispatchEvent(middle)
		expect(middle.defaultPrevented).toBe(true)
		const plain = new MouseEvent('click', { bubbles: true, composed: true, cancelable: true })
		;(root.querySelector('.plain') as HTMLElement).dispatchEvent(plain)
		expect(plain.defaultPrevented).toBe(false)

		view.rerender(
			<EmailHtml
				html='<p><a class="go" href="https://meridian-secure.co/verify">Confirm</a> <span class="plain">text</span></p>'
				messageId="m-lookalike"
			/>,
		)
		expect(root.querySelector(`style[${EDGE_STYLE_ATTRIBUTE}]`)?.textContent).not.toContain('cursor:default')
		const allowed = new MouseEvent('click', { bubbles: true, composed: true, cancelable: true })
		link.addEventListener('click', (event) => event.preventDefault(), { once: true })
		;(root.querySelector('.go') as HTMLElement).dispatchEvent(allowed)
		expect(root.querySelectorAll(`style[${EDGE_STYLE_ATTRIBUTE}]`)).toHaveLength(1)
	})
})

describe('edge helpers', () => {
	it('counts blocked images a reader would have seen, never tracking pixels', () => {
		const root = document.createElement('div')
		root.innerHTML =
			'<div class="email-root"><img alt="a"><img width="600" height="200"><img width="1" height="1"><img width="1"><img src="/email-images/x.y"></div>'
		expect(blockedImageCount(root)).toBe(3)
		expect(blockedImageCount(null)).toBe(0)
	})

	it('holds blocked images at their declared size, and adds the inert-link rule only when asked', () => {
		expect(edgeShadowStyle(false)).toContain('repeating-linear-gradient(135deg')
		expect(edgeShadowStyle(false)).not.toContain('cursor:default')
		expect(edgeShadowStyle(true)).toContain(':host .email-root a[href]{cursor:default!important;}')
	})
})

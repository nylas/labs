// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { EmailRemoteImagesDetail } from '../lib/email-render.js'
import type { MailMessage } from '../state/mail-queries.js'
import type { EmailDisplayStatus } from './EmailHtml.js'
import { ThreadDisplayMenu } from './ThreadDisplayMenu.js'

afterEach(cleanup)

function remoteImages(overrides: Partial<EmailRemoteImagesDetail> = {}): EmailRemoteImagesDetail {
	return { hasRemoteImages: true, loaded: false, failedImages: 0, pendingImages: 0, ...overrides }
}

function status(remote: EmailRemoteImagesDetail | null, layoutAvailable = false): EmailDisplayStatus {
	return { layoutAvailable, remoteImages: remote }
}

function message(id: string, email?: string): MailMessage {
	return { id, from: email === undefined ? undefined : [{ email }], body: '<p>Message</p>' }
}

function renderMenu({
	messages = [],
	statuses = new Map<string, EmailDisplayStatus>(),
	layoutMode = 'readable' as const,
	colorMode = 'automatic' as const,
	showColorControl = false,
	senderTrustStatus = { state: 'idle' as const },
} = {}) {
	const callbacks = {
		onLayoutModeChange: vi.fn(),
		onColorModeChange: vi.fn(),
		onShowThreadImages: vi.fn(),
		onAlwaysShowImages: vi.fn(),
		onTrustSender: vi.fn(),
		onRetryImages: vi.fn(),
	}
	const view = render(
		<ThreadDisplayMenu
			messages={messages}
			statuses={statuses}
			layoutMode={layoutMode}
			colorMode={colorMode}
			showColorControl={showColorControl}
			senderTrustStatus={senderTrustStatus}
			{...callbacks}
		/>,
	)
	return { ...view, callbacks }
}

describe('ThreadDisplayMenu', () => {
	it('focuses the dialog itself if it has no available action', () => {
		renderMenu()
		const panelQuery = vi.spyOn(HTMLElement.prototype, 'querySelector').mockReturnValueOnce(null)
		fireEvent.click(screen.getByRole('button', { name: 'Thread display' }))
		expect(screen.getByRole('dialog')).toHaveFocus()
		panelQuery.mockRestore()
	})

	it('dismisses outside and on Escape while ignoring inside and unrelated keys', () => {
		renderMenu()
		const trigger = screen.getByRole('button', { name: 'Thread display' })
		fireEvent.click(trigger)
		expect(screen.getByRole('link', { name: 'Manage image choices' })).toHaveFocus()

		fireEvent.pointerDown(trigger)
		fireEvent.keyDown(document, { key: 'ArrowDown' })
		expect(screen.getByRole('dialog')).toBeInTheDocument()

		fireEvent.pointerDown(document.body)
		expect(screen.queryByRole('dialog')).toBeNull()

		fireEvent.click(trigger)
		fireEvent.keyDown(document, { key: 'Escape' })
		expect(screen.queryByRole('dialog')).toBeNull()
		expect(trigger).toHaveFocus()
	})

	it('offers thread, sender, global, retry, layout, and color actions from aggregate status', () => {
		const statuses = new Map([['m1', status(remoteImages({ failedImages: 1, pendingImages: 1 }), true)]])
		const { callbacks } = renderMenu({
			messages: [message('m1', 'News@Example.com')],
			statuses,
			showColorControl: true,
		})

		const trigger = screen.getByRole('button', { name: 'Thread display' })
		fireEvent.click(trigger)
		expect(screen.getByRole('button', { name: 'Show images in this thread' })).toHaveFocus()
		expect(screen.getByText('One image could not be loaded.')).toBeInTheDocument()
		expect(screen.getByText('Loading one image…')).toBeInTheDocument()
		fireEvent.click(screen.getByRole('button', { name: 'Retry images' }))
		fireEvent.click(screen.getByRole('button', { name: 'Always show from news@example.com' }))
		fireEvent.click(screen.getByRole('button', { name: 'Original' }))
		fireEvent.click(screen.getByRole('button', { name: 'Original message colors' }))
		expect(callbacks.onRetryImages).toHaveBeenCalledOnce()
		expect(callbacks.onTrustSender).toHaveBeenCalledWith('news@example.com')
		expect(callbacks.onLayoutModeChange).toHaveBeenCalledWith('original')
		expect(callbacks.onColorModeChange).toHaveBeenCalledWith('original')

		fireEvent.click(screen.getByRole('button', { name: 'Always show all' }))
		expect(callbacks.onAlwaysShowImages).toHaveBeenCalledOnce()
		expect(screen.queryByRole('dialog')).toBeNull()
		expect(trigger).toHaveFocus()

		fireEvent.click(trigger)
		fireEvent.click(screen.getByRole('button', { name: 'Show images in this thread' }))
		expect(callbacks.onShowThreadImages).toHaveBeenCalledOnce()
		expect(screen.queryByRole('dialog')).toBeNull()
		expect(trigger).toHaveFocus()
	})

	it('shows loading and error sender states and plural image progress', () => {
		const statuses = new Map([['m1', status(remoteImages({ failedImages: 2, pendingImages: 2 }))]])
		const props = {
			messages: [message('m1', 'sender@example.com')],
			statuses,
			senderTrustStatus: { address: 'sender@example.com', state: 'loading' as const },
		}
		const view = renderMenu(props)
		fireEvent.click(screen.getByRole('button', { name: 'Thread display' }))
		expect(screen.getByText('2 images could not be loaded.')).toBeInTheDocument()
		expect(screen.getByText('Loading 2 images…')).toBeInTheDocument()
		expect(screen.getByRole('button', { name: 'Always show from sender@example.com' })).toHaveAttribute(
			'aria-busy',
			'true',
		)

		view.rerender(
			<ThreadDisplayMenu
				messages={props.messages}
				statuses={statuses}
				layoutMode="original"
				colorMode="original"
				showColorControl
				senderTrustStatus={{ address: 'other@example.com', state: 'loading' }}
				onLayoutModeChange={vi.fn()}
				onColorModeChange={vi.fn()}
				onShowThreadImages={vi.fn()}
				onAlwaysShowImages={vi.fn()}
				onTrustSender={vi.fn()}
				onRetryImages={vi.fn()}
			/>,
		)
		expect(screen.getByRole('button', { name: 'Always show from sender@example.com' })).not.toHaveAttribute(
			'aria-busy',
		)

		view.rerender(
			<ThreadDisplayMenu
				messages={props.messages}
				statuses={statuses}
				layoutMode="original"
				colorMode="original"
				showColorControl
				senderTrustStatus={{ address: 'sender@example.com', state: 'error' }}
				onLayoutModeChange={vi.fn()}
				onColorModeChange={vi.fn()}
				onShowThreadImages={vi.fn()}
				onAlwaysShowImages={vi.fn()}
				onTrustSender={vi.fn()}
				onRetryImages={vi.fn()}
			/>,
		)
		expect(screen.getByRole('alert')).toHaveTextContent('Couldn’t save that image choice. Try again.')
	})

	it('filters non-blocked and invalid senders before offering persistent trust', () => {
		const messages = [
			message('none', 'none@example.com'),
			message('loaded', 'loaded@example.com'),
			message('missing'),
			message('blank', '   '),
			message('valid', 'valid@example.com'),
			message('duplicate', 'VALID@example.com'),
		]
		const statuses = new Map([
			['none', status(null)],
			['loaded', status(remoteImages({ loaded: true }))],
			['missing', status(remoteImages())],
			['blank', status(remoteImages())],
			['valid', status(remoteImages())],
			['duplicate', status(remoteImages())],
		])
		renderMenu({ messages, statuses })
		fireEvent.click(screen.getByRole('button', { name: 'Thread display' }))
		expect(screen.getByRole('button', { name: 'Always show from valid@example.com' })).toBeInTheDocument()
	})

	it('offers a remembered original-color choice for each HTML sender while colors are automatic', () => {
		const onSenderOriginalColorsChange = vi.fn()
		const messages = [
			message('m1', 'Brand@Example.com'),
			message('m2', 'brand@example.com'),
			{ id: 'm3', from: [{ email: 'plain@example.com' }], body: 'Plain text only' },
			message('m4'),
			message('m5', 'news@example.com'),
		]
		const view = render(
			<ThreadDisplayMenu
				messages={messages}
				statuses={new Map()}
				layoutMode="readable"
				colorMode="automatic"
				showColorControl
				senderTrustStatus={{ state: 'idle' }}
				originalColorSenders={new Set(['news@example.com'])}
				originalColorStatus="error"
				onLayoutModeChange={vi.fn()}
				onColorModeChange={vi.fn()}
				onSenderOriginalColorsChange={onSenderOriginalColorsChange}
				onShowThreadImages={vi.fn()}
				onAlwaysShowImages={vi.fn()}
				onTrustSender={vi.fn()}
				onRetryImages={vi.fn()}
			/>,
		)
		fireEvent.click(screen.getByRole('button', { name: 'Thread display' }))
		const brand = screen.getByRole('button', { name: 'Always use original colors from brand@example.com' })
		const news = screen.getByRole('button', { name: 'Always use original colors from news@example.com' })
		expect(screen.queryByRole('button', { name: /plain@example.com/ })).toBeNull()
		expect(brand).toHaveAttribute('aria-pressed', 'false')
		expect(news).toHaveAttribute('aria-pressed', 'true')
		expect(screen.getByRole('alert')).toHaveTextContent('Couldn’t save that color choice. Try again.')
		fireEvent.click(brand)
		fireEvent.click(news)
		expect(onSenderOriginalColorsChange).toHaveBeenNthCalledWith(1, 'brand@example.com', true)
		expect(onSenderOriginalColorsChange).toHaveBeenNthCalledWith(2, 'news@example.com', false)

		view.rerender(
			<ThreadDisplayMenu
				messages={messages}
				statuses={new Map()}
				layoutMode="readable"
				colorMode="original"
				showColorControl
				senderTrustStatus={{ state: 'idle' }}
				onLayoutModeChange={vi.fn()}
				onColorModeChange={vi.fn()}
				onSenderOriginalColorsChange={onSenderOriginalColorsChange}
				onShowThreadImages={vi.fn()}
				onAlwaysShowImages={vi.fn()}
				onTrustSender={vi.fn()}
				onRetryImages={vi.fn()}
			/>,
		)
		expect(screen.queryByRole('button', { name: /Always use original colors/ })).toBeNull()
	})

	it('lists sender color choices with no remembered senders by default', () => {
		render(
			<ThreadDisplayMenu
				messages={[message('m1', 'brand@example.com')]}
				statuses={new Map()}
				layoutMode="readable"
				colorMode="automatic"
				showColorControl
				senderTrustStatus={{ state: 'idle' }}
				onLayoutModeChange={vi.fn()}
				onColorModeChange={vi.fn()}
				onSenderOriginalColorsChange={vi.fn()}
				onShowThreadImages={vi.fn()}
				onAlwaysShowImages={vi.fn()}
				onTrustSender={vi.fn()}
				onRetryImages={vi.fn()}
			/>,
		)
		fireEvent.click(screen.getByRole('button', { name: 'Thread display' }))
		expect(
			screen.getByRole('button', { name: 'Always use original colors from brand@example.com' }),
		).toHaveAttribute('aria-pressed', 'false')
	})
})

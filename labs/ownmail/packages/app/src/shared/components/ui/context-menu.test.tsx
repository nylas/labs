// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuSeparator,
	ContextMenuShortcut,
	ContextMenuTrigger,
} from './context-menu.js'

// Radix measures the menu and scrolls the focused item into view; jsdom has neither.
beforeAll(() => {
	Element.prototype.scrollIntoView = vi.fn()
})

afterEach(() => {
	window.getSelection()?.removeAllRanges()
	cleanup()
})

function Harness({
	onOpen = () => {},
	onDelete = () => {},
	onRowContextMenu,
	onRowPointerDown,
	onAncestorTouchStart,
	onAncestorClick,
	onAncestorKeyDown,
}: {
	onOpen?: () => void
	onDelete?: () => void
	onRowContextMenu?: () => void
	onRowPointerDown?: () => void
	onAncestorTouchStart?: () => void
	onAncestorClick?: () => void
	onAncestorKeyDown?: () => void
}) {
	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: stands in for a day cell or a gesture area around the row
		<div
			role="presentation"
			onTouchStart={onAncestorTouchStart}
			onTouchMove={onAncestorTouchStart}
			onTouchEnd={onAncestorTouchStart}
			onClick={onAncestorClick}
			onKeyDown={onAncestorKeyDown}
		>
			<ContextMenu>
				<ContextMenuTrigger
					asChild
					onContextMenuCapture={onRowContextMenu}
					onPointerDownCapture={onRowPointerDown}
				>
					<div tabIndex={-1} data-testid="row">
						<span data-testid="row-text">Quarterly report</span>
						<input aria-label="Rename" />
						<span contentEditable suppressContentEditableWarning data-testid="editable">
							draft
						</span>
					</div>
				</ContextMenuTrigger>
				<ContextMenuContent aria-label="Row actions" className="w-60">
					<ContextMenuItem aria-keyshortcuts="Enter" onSelect={onOpen}>
						Open <ContextMenuShortcut>Enter</ContextMenuShortcut>
					</ContextMenuItem>
					<ContextMenuItem disabled>Archive</ContextMenuItem>
					<ContextMenuItem asChild>
						<a href="/messages/m1/download" download>
							Download
						</a>
					</ContextMenuItem>
					<ContextMenuSeparator />
					<ContextMenuItem variant="destructive" className="font-medium" onSelect={onDelete}>
						Delete
					</ContextMenuItem>
				</ContextMenuContent>
			</ContextMenu>
		</div>
	)
}

function rightClick(element: Element) {
	// `fireEvent` returns false when a handler cancelled the browser's menu.
	return fireEvent.contextMenu(element, { clientX: 20, clientY: 20 })
}

describe('ContextMenu', () => {
	it('opens on right-click with real menu items and replaces the browser menu', async () => {
		const onOpen = vi.fn()
		render(<Harness onOpen={onOpen} />)

		expect(rightClick(screen.getByTestId('row-text'))).toBe(false)
		const menu = await screen.findByRole('menu', { name: 'Row actions' })
		expect(menu).toHaveAttribute('data-slot', 'context-menu-content')
		// A context menu floats over the plane: panel glass, the one recipe for menus.
		expect(menu).toHaveClass('glass-panel', 'w-60')
		expect(menu).not.toHaveAttribute('data-glass')
		expect(menu.className).not.toMatch(/bg-popover|shadow-|rounded-/)

		const open = screen.getByRole('menuitem', { name: 'Open' })
		// 44px floor wherever the menu can be touched.
		expect(open).toHaveClass('max-md:min-h-11', '[@media(any-pointer:coarse)]:min-h-11')
		expect(open.querySelector('kbd')).toHaveTextContent('Enter')
		expect(open.querySelector('kbd')).toHaveClass('kbd')
		// The hint is visual; the item itself announces the shortcut.
		expect(open.querySelector('[data-slot="context-menu-shortcut"]')).toHaveAttribute('aria-hidden', 'true')
		expect(open).toHaveAttribute('aria-keyshortcuts', 'Enter')
		expect(screen.getByRole('menuitem', { name: 'Download' })).toHaveAttribute(
			'href',
			'/messages/m1/download',
		)
		expect(screen.getByRole('separator')).toHaveAttribute('data-slot', 'context-menu-separator')

		fireEvent.click(open)
		expect(onOpen).toHaveBeenCalledTimes(1)
		await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
	})

	it('exposes an unavailable action as disabled instead of hiding it', async () => {
		render(<Harness />)
		rightClick(screen.getByTestId('row'))
		expect(await screen.findByRole('menuitem', { name: 'Archive' })).toHaveAttribute('aria-disabled', 'true')
	})

	it('marks a destructive item for styling without changing what it does', async () => {
		const onDelete = vi.fn()
		render(<Harness onDelete={onDelete} />)
		rightClick(screen.getByTestId('row'))
		const item = await screen.findByRole('menuitem', { name: 'Delete' })
		expect(item).toHaveAttribute('data-variant', 'destructive')
		expect(item).toHaveClass('data-[variant=destructive]:text-destructive', 'font-medium')
		fireEvent.click(item)
		expect(onDelete).toHaveBeenCalledTimes(1)
	})

	it('moves through items with the arrow keys and returns focus to the row on Escape', async () => {
		const user = userEvent.setup()
		render(<Harness />)
		const row = screen.getByTestId('row')
		row.focus()
		rightClick(row)
		await screen.findByRole('menu')

		await user.keyboard('{ArrowDown}')
		await waitFor(() => expect(screen.getByRole('menuitem', { name: 'Open' })).toHaveFocus())
		await user.keyboard('{Escape}')
		await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
		await waitFor(() => expect(row).toHaveFocus())
	})

	it('keeps the browser menu inside text fields and editable content', () => {
		const onRowContextMenu = vi.fn()
		render(<Harness onRowContextMenu={onRowContextMenu} />)

		expect(rightClick(screen.getByRole('textbox', { name: 'Rename' }))).toBe(true)
		expect(rightClick(screen.getByTestId('editable'))).toBe(true)
		expect(onRowContextMenu).toHaveBeenCalledTimes(2)
		expect(screen.queryByRole('menu')).not.toBeInTheDocument()
	})

	it('keeps the browser menu inside rendered email content', () => {
		render(
			<ContextMenu>
				<ContextMenuTrigger data-testid="reader">
					{/* @ts-expect-error -- the custom element is registered by the mail feature */}
					<ownmail-email data-testid="email">A message</ownmail-email>
				</ContextMenuTrigger>
				<ContextMenuContent>
					<ContextMenuItem>Open</ContextMenuItem>
				</ContextMenuContent>
			</ContextMenu>,
		)
		expect(rightClick(screen.getByTestId('email'))).toBe(true)
		expect(screen.queryByRole('menu')).not.toBeInTheDocument()
	})

	it('keeps the browser menu on the extra targets a trigger names, such as links and images in message text', async () => {
		render(
			<ContextMenu>
				<ContextMenuTrigger keepNativeMenuOn="a[href], img">
					<p data-testid="text">
						See <a href="https://example.com">the agenda</a> <img alt="chart" src="data:," />
					</p>
				</ContextMenuTrigger>
				<ContextMenuContent>
					<ContextMenuItem>Open</ContextMenuItem>
				</ContextMenuContent>
			</ContextMenu>,
		)
		expect(rightClick(screen.getByRole('link', { name: 'the agenda' }))).toBe(true)
		expect(rightClick(screen.getByRole('img', { name: 'chart' }))).toBe(true)
		expect(screen.queryByRole('menu')).not.toBeInTheDocument()
		// The text around them still opens the app's menu.
		expect(rightClick(screen.getByTestId('text'))).toBe(false)
		expect(await screen.findByRole('menu')).toBeInTheDocument()
	})

	it('keeps the browser menu while text in the row is selected', async () => {
		render(<Harness />)
		const text = screen.getByTestId('row-text')
		window.getSelection()?.selectAllChildren(text)

		expect(rightClick(text)).toBe(true)
		expect(screen.queryByRole('menu')).not.toBeInTheDocument()

		// A selection somewhere else on the page does not disable the row's menu.
		const elsewhere = document.body.appendChild(document.createElement('p'))
		elsewhere.textContent = 'Selected in the reader'
		window.getSelection()?.selectAllChildren(elsewhere)
		expect(window.getSelection()?.isCollapsed).toBe(false)
		expect(rightClick(text)).toBe(false)
		expect(await screen.findByRole('menu')).toBeInTheDocument()
	})

	it('lets a touch reach the gestures around the row, such as pull-to-refresh', () => {
		const onAncestorTouchStart = vi.fn()
		render(<Harness onAncestorTouchStart={onAncestorTouchStart} />)
		fireEvent.touchStart(screen.getByTestId('row'), { touches: [{ clientX: 5, clientY: 5 }] })
		expect(onAncestorTouchStart).toHaveBeenCalledTimes(1)
	})

	it('keeps what happens inside the menu away from the handlers around the row', async () => {
		const onAncestorClick = vi.fn()
		const onAncestorKeyDown = vi.fn()
		const onAncestorTouchStart = vi.fn()
		const onOpen = vi.fn()
		render(
			<Harness
				onOpen={onOpen}
				onAncestorClick={onAncestorClick}
				onAncestorKeyDown={onAncestorKeyDown}
				onAncestorTouchStart={onAncestorTouchStart}
			/>,
		)
		rightClick(screen.getByTestId('row-text'))
		const open = await screen.findByRole('menuitem', { name: 'Open' })
		const point = { clientX: 5, clientY: 5 }

		fireEvent.keyDown(open, { key: 'j' })
		fireEvent.touchStart(open, { touches: [point], changedTouches: [point] })
		fireEvent.touchMove(open, { touches: [point], changedTouches: [point] })
		fireEvent.touchEnd(open, { touches: [], changedTouches: [point] })
		fireEvent.click(open)

		// The item ran; a day cell, grid or pull-to-refresh around the row saw nothing.
		expect(onOpen).toHaveBeenCalledTimes(1)
		expect(onAncestorClick).not.toHaveBeenCalled()
		expect(onAncestorKeyDown).not.toHaveBeenCalled()
		expect(onAncestorTouchStart).not.toHaveBeenCalled()
	})

	it('opens on a touch long press of the row, but never from a text field inside it', async () => {
		vi.useFakeTimers()
		try {
			const onRowPointerDown = vi.fn()
			render(<Harness onRowPointerDown={onRowPointerDown} />)

			fireEvent.pointerDown(screen.getByRole('textbox', { name: 'Rename' }), { pointerType: 'touch' })
			act(() => void vi.advanceTimersByTime(800))
			expect(onRowPointerDown).toHaveBeenCalledTimes(1)
			expect(screen.queryByRole('menu')).not.toBeInTheDocument()

			fireEvent.pointerDown(screen.getByTestId('row-text'), { pointerType: 'touch' })
			act(() => void vi.advanceTimersByTime(800))
			expect(screen.getByRole('menu')).toBeInTheDocument()
		} finally {
			vi.useRealTimers()
		}
	})
})

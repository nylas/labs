// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import {
	GLASS_BAR_BOTTOM_EDGE,
	GLASS_BAR_CLASS,
	GLASS_PANEL_CLASS,
	GLASS_PANEL_FROM_SM_CLASS,
	GlassPanelScope,
	UNDER_MOBILE_BAR_CLASS,
	UNDER_PINNED_BAR_CLASS,
	useGlassPanelProps,
} from './glass.js'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './select.js'
import { Toolbar } from './toolbar.js'

// Radix Select relies on pointer-capture, ResizeObserver, and scrollIntoView,
// none of which jsdom implements; stub them so the listbox can open.
beforeAll(() => {
	vi.stubGlobal(
		'ResizeObserver',
		class {
			observe() {}
			unobserve() {}
			disconnect() {}
		},
	)
	Element.prototype.scrollIntoView = vi.fn()
	Element.prototype.hasPointerCapture = vi.fn(() => false)
	Element.prototype.setPointerCapture = vi.fn()
	Element.prototype.releasePointerCapture = vi.fn()
})

afterEach(cleanup)

function Panel({ label }: { label: string }) {
	return <div role="menu" aria-label={label} {...useGlassPanelProps()} />
}

function OpenSelect() {
	return (
		<Select defaultValue="8" open>
			<SelectTrigger aria-label="Start time">
				<SelectValue />
			</SelectTrigger>
			<SelectContent>
				<SelectItem value="8">8 AM</SelectItem>
			</SelectContent>
		</Select>
	)
}

describe('glass layer', () => {
	it('names the two recipes and the classes for content that runs beneath a bar', () => {
		// These are the class names `styles.css` defines and `pnpm lint` allows to blur.
		expect(GLASS_BAR_CLASS).toBe('glass-bar')
		expect(GLASS_PANEL_CLASS).toBe('glass-panel')
		expect(GLASS_PANEL_FROM_SM_CLASS.split(' ')).toEqual(['glass-panel', 'glass-panel-from-sm'])
		expect(GLASS_BAR_BOTTOM_EDGE).toEqual({ 'data-glass-edge': 'top' })
		expect(UNDER_PINNED_BAR_CLASS).toBe('under-pinned-bar')
		expect(UNDER_MOBILE_BAR_CLASS).toBe('under-mobile-bar')
	})

	it('pins a toolbar over its pane as bar glass without changing its height', () => {
		render(
			<>
				<Toolbar>Flat</Toolbar>
				<Toolbar pinned className="px-3">
					Pinned
				</Toolbar>
			</>,
		)
		const flat = screen.getByText('Flat')
		const pinned = screen.getByText('Pinned')
		// Content scrolls beneath a pinned toolbar, so it floats over the pane instead of taking a row.
		expect(pinned).toHaveClass('glass-bar', 'absolute', 'inset-x-0', 'top-0', 'px-3')
		expect(flat).not.toHaveClass('glass-bar')
		expect(flat).not.toHaveClass('absolute')
		// One toolbar height either way: the first line beneath it does not move.
		for (const toolbar of [flat, pinned]) expect(toolbar).toHaveClass('h-(--toolbar-height)')
	})

	it('makes a panel over the plane glass and a panel opened from a glass panel solid', () => {
		render(
			<>
				<Panel label="Over the plane" />
				<GlassPanelScope>
					<Panel label="Over glass" />
				</GlassPanelScope>
			</>,
		)
		const overPlane = screen.getByRole('menu', { name: 'Over the plane' })
		const overGlass = screen.getByRole('menu', { name: 'Over glass' })
		expect(overPlane).toHaveClass('glass-panel')
		expect(overPlane).not.toHaveAttribute('data-glass')
		// One layer deep: the same shape, but opaque, so glass never sits on glass.
		expect(overGlass).toHaveClass('glass-panel')
		expect(overGlass).toHaveAttribute('data-glass', 'solid')
	})

	it('keeps a select list solid when it opens from a glass panel, even through its portal', () => {
		const { unmount } = render(<OpenSelect />)
		expect(document.querySelector('[data-slot="select-content"]')).toHaveClass('glass-panel')
		expect(document.querySelector('[data-slot="select-content"]')).not.toHaveAttribute('data-glass')
		unmount()

		render(
			<GlassPanelScope>
				<OpenSelect />
			</GlassPanelScope>,
		)
		const list = document.querySelector('[data-slot="select-content"]')
		// The list is portalled out of the panel, so the DOM cannot tell; the scope does.
		expect(list?.closest('.glass-panel:not([data-slot="select-content"])')).toBeNull()
		expect(list).toHaveAttribute('data-glass', 'solid')
	})
})

describe('context menu on glass', () => {
	it('is panel glass over the plane and solid when it opens over a glass surface', async () => {
		const { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } = await import(
			'./context-menu.js'
		)
		const menu = (label: string) => (
			<ContextMenu>
				<ContextMenuTrigger asChild>
					<div>{label}</div>
				</ContextMenuTrigger>
				<ContextMenuContent aria-label={`${label} actions`}>
					<ContextMenuItem>Open</ContextMenuItem>
				</ContextMenuContent>
			</ContextMenu>
		)
		render(
			<>
				{menu('Row')}
				<GlassPanelScope>{menu('Composer field')}</GlassPanelScope>
			</>,
		)
		fireEvent.contextMenu(screen.getByText('Row'), { clientX: 10, clientY: 10 })
		const overPlane = await screen.findByRole('menu', { name: 'Row actions' })
		expect(overPlane).toHaveClass('glass-panel')
		expect(overPlane).not.toHaveAttribute('data-glass')
		fireEvent.keyDown(overPlane, { key: 'Escape' })

		fireEvent.contextMenu(screen.getByText('Composer field'), { clientX: 10, clientY: 10 })
		const overGlass = await screen.findByRole('menu', { name: 'Composer field actions' })
		// The menu is portalled out of the glass it was opened on; the scope carries the rule.
		expect(overGlass).toHaveAttribute('data-glass', 'solid')
	})
})

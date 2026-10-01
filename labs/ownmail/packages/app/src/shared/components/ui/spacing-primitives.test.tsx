// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CHROME_ROW_CLASS, TOOLBAR_HEIGHT_CLASS } from '#app/config/layout'
import { Chip, PillRow } from './chip.js'
import { IconButton } from './icon-button.js'
import { Section } from './section.js'
import { Toolbar } from './toolbar.js'

afterEach(cleanup)

describe('Toolbar', () => {
	it('uses the one desktop toolbar height, which is the 44px chrome row', () => {
		render(<Toolbar className="px-3">Inbox</Toolbar>)
		const toolbar = screen.getByText('Inbox')
		expect(toolbar).toHaveAttribute('data-slot', 'toolbar')
		// One source: the height is the `--toolbar-height` token (44px on desktop, the
		// chrome row's height; 56px on a phone), which pinned-bar padding reads too.
		expect(TOOLBAR_HEIGHT_CLASS).toBe('h-(--toolbar-height)')
		expect(CHROME_ROW_CLASS).toBe('h-11')
		expect(toolbar).toHaveClass('h-(--toolbar-height)', 'border-b', 'px-3')
		// Flat unless pinned: a toolbar with nothing scrolling beneath it is not glass.
		expect(toolbar).not.toHaveClass('glass-bar')
	})
})

describe('Section', () => {
	it('puts the same section space on both sides of its separator', () => {
		render(<Section className="flex">Actions</Section>)
		expect(screen.getByText('Actions')).toHaveClass('mt-section', 'border-t', 'pt-section', 'flex')
	})
})

describe('PillRow and Chip', () => {
	it('spaces chips with the cluster gap and keeps each chip at the touch floor without vertical padding', () => {
		render(
			<PillRow aria-label="Files" role="list">
				<Chip>agenda.pdf</Chip>
			</PillRow>,
		)
		expect(screen.getByRole('list', { name: 'Files' })).toHaveClass('flex-wrap', 'gap-cluster')
		const chip = screen.getByText('agenda.pdf')
		expect(chip).toHaveClass('min-h-11', 'px-hairline')
		expect(chip.className).not.toMatch(/\bp[ytb]-/)
		expect(chip.children).toHaveLength(0)
	})

	it('seats a trailing action inside the chip', () => {
		render(<Chip action={<IconButton label="Remove agenda.pdf">x</IconButton>}>agenda.pdf</Chip>)
		const button = screen.getByRole('button', { name: 'Remove agenda.pdf' })
		expect(button.closest('[data-slot="chip"]')).toHaveTextContent('agenda.pdf')
	})
})

describe('IconButton', () => {
	it('always carries an accessible name, a matching tooltip, and the shared icon target', () => {
		const onClick = vi.fn()
		render(
			<IconButton label="Remove" onClick={onClick}>
				x
			</IconButton>,
		)
		const button = screen.getByRole('button', { name: 'Remove' })
		expect(button).toHaveAttribute('title', 'Remove')
		expect(button).toHaveAttribute('type', 'button')
		// 36px with a fine pointer, 44px on mobile and touch.
		expect(button).toHaveClass('size-9', 'max-md:size-11')
		fireEvent.click(button)
		expect(onClick).toHaveBeenCalledOnce()
	})
})

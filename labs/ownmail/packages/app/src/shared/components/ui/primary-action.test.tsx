// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Pencil } from 'lucide-react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
	PRIMARY_ACTION_CLASS,
	PRIMARY_ACTION_ICON_CLASS,
	PrimaryAction,
	PrimaryActionContent,
} from './primary-action.js'
import { ToolbarSeparator } from './toolbar.js'

afterEach(cleanup)

describe('PrimaryAction', () => {
	it('is a quiet outline whose accent lives on the icon only, so it never outweighs the content', () => {
		const onClick = vi.fn()
		render(<PrimaryAction icon={Pencil} label="New event" shortcut="N" onClick={onClick} />)
		const button = screen.getByRole('button', { name: 'New event' })
		expect(button).toHaveClass('border-cta-line', 'rounded-md', 'text-foreground', 'press')
		// A filled background would make the create action louder than the folders it sits above.
		expect(button.className).not.toMatch(/\bbg-(primary|cta)\b/)
		expect(button.querySelector('svg')).toHaveClass('text-cta-icon')
		expect(button).toHaveAttribute('aria-keyshortcuts', 'N')
		fireEvent.click(button)
		expect(onClick).toHaveBeenCalledTimes(1)
	})

	it('shows its shortcut as hidden-from-touch text that is not read twice', () => {
		render(<PrimaryAction icon={Pencil} label="Compose" shortcut="C" />)
		const hint = screen.getByText('C')
		expect(hint).toHaveClass('primary-action-shortcut')
		expect(hint).toHaveAttribute('aria-hidden', 'true')
	})

	it('renders no hint when the action has no shortcut', () => {
		render(<PrimaryActionContent icon={Pencil} label="New contact" />)
		expect(document.querySelector('.primary-action-shortcut')).toBeNull()
	})

	it('shares one recipe between the full action and its icon-only top bar form', () => {
		for (const recipe of [PRIMARY_ACTION_CLASS, PRIMARY_ACTION_ICON_CLASS]) {
			expect(recipe).toContain('border-cta-line')
			expect(recipe).toContain('press')
			expect(recipe).toContain('focus-visible:ring-ring')
		}
	})
})

describe('ToolbarSeparator', () => {
	it('is a 1px vertical separator, not an accent bar', () => {
		render(<ToolbarSeparator className="hidden md:block" />)
		const separator = screen.getByRole('separator')
		expect(separator).toHaveAttribute('aria-orientation', 'vertical')
		expect(separator).toHaveClass('w-px', 'bg-border', 'hidden', 'md:block')
	})
})

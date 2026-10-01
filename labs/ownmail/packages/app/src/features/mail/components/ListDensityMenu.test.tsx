// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ListDensityMenu } from './ListDensityMenu.js'

afterEach(cleanup)

function renderMenu(value: 'default' | 'compact' | 'condensed' = 'default') {
	const onChange = vi.fn()
	render(
		<div>
			<ListDensityMenu value={value} onChange={onChange} />
			<button type="button">Outside</button>
		</div>,
	)
	return { onChange, trigger: screen.getByRole('button', { name: /^List density:/ }) }
}

describe('ListDensityMenu', () => {
	it('names the current density and exposes it as a checked menu item', async () => {
		const { trigger } = renderMenu('condensed')
		expect(trigger).toHaveAccessibleName('List density: Condensed')
		expect(trigger).toHaveAttribute('aria-expanded', 'false')

		await userEvent.click(trigger)

		expect(trigger).toHaveAttribute('aria-expanded', 'true')
		expect(screen.getByRole('menu', { name: 'List density' })).toBeInTheDocument()
		expect(screen.getAllByRole('menuitemradio').map((item) => item.textContent)).toEqual([
			'Default',
			'Compact',
			'Condensed',
		])
		expect(screen.getByRole('menuitemradio', { name: 'Condensed' })).toHaveAttribute('aria-checked', 'true')
		expect(screen.getByRole('menuitemradio', { name: 'Default' })).toHaveAttribute('aria-checked', 'false')
		// Opening focuses the current choice so Enter keeps it.
		expect(screen.getByRole('menuitemradio', { name: 'Condensed' })).toHaveFocus()
	})

	it('carries the hook that hides it where compact rows never apply, with a visible focus ring', () => {
		const { trigger } = renderMenu()
		// `.list-density-menu` is shown only for a fine pointer on desktop layouts (styles.css).
		expect(trigger.parentElement).toHaveClass('list-density-menu')
		// The trigger is the shared toolbar IconButton.
		expect(trigger).toHaveAttribute('data-slot', 'button')
		expect(trigger).toHaveClass('focus-visible:ring-[3px]', 'focus-visible:ring-ring')
	})

	it('applies a choice, closes, and returns focus to the trigger', async () => {
		const { onChange, trigger } = renderMenu()
		await userEvent.click(trigger)
		await userEvent.click(screen.getByRole('menuitemradio', { name: 'Compact' }))

		expect(onChange).toHaveBeenCalledWith('compact')
		expect(screen.queryByRole('menu')).toBeNull()
		expect(trigger).toHaveFocus()
	})

	it('moves between choices with arrows, Home, and End, wrapping at the ends', async () => {
		renderMenu('default')
		await userEvent.click(screen.getByRole('button', { name: /^List density:/ }))
		const menu = screen.getByRole('menu')
		const item = (name: string) => screen.getByRole('menuitemradio', { name })

		fireEvent.keyDown(menu, { key: 'ArrowUp' })
		expect(item('Condensed')).toHaveFocus()
		fireEvent.keyDown(menu, { key: 'ArrowDown' })
		expect(item('Default')).toHaveFocus()
		fireEvent.keyDown(menu, { key: 'ArrowDown' })
		expect(item('Compact')).toHaveFocus()
		fireEvent.keyDown(menu, { key: 'ArrowUp' })
		expect(item('Default')).toHaveFocus()
		fireEvent.keyDown(menu, { key: 'End' })
		expect(item('Condensed')).toHaveFocus()
		fireEvent.keyDown(menu, { key: 'ArrowDown' })
		expect(item('Default')).toHaveFocus()
		fireEvent.keyDown(menu, { key: 'Home' })
		expect(item('Default')).toHaveFocus()
		// Unrelated keys leave focus alone.
		fireEvent.keyDown(menu, { key: 'x' })
		expect(item('Default')).toHaveFocus()
	})

	it('lets Tab and Shift+Tab leave the open menu without trapping focus on the trigger', async () => {
		const { onChange, trigger } = renderMenu()
		for (const shiftKey of [false, true]) {
			await userEvent.click(trigger)
			// fireEvent returns false when the handler cancelled the event. Cancelling Tab, or
			// refocusing the trigger, would cost keyboard users an extra keystroke to move on.
			const notCancelled = fireEvent.keyDown(screen.getByRole('menu'), { key: 'Tab', shiftKey })
			expect(notCancelled).toBe(true)
			expect(screen.queryByRole('menu')).toBeNull()
			expect(trigger).not.toHaveFocus()
			expect(trigger).toHaveAttribute('aria-expanded', 'false')
		}
		expect(onChange).not.toHaveBeenCalled()
	})

	it('moves focus on to the next toolbar control with a real Tab press', async () => {
		const { trigger } = renderMenu()
		await userEvent.click(trigger)
		await userEvent.tab()
		expect(screen.queryByRole('menu')).toBeNull()
		expect(trigger).not.toHaveFocus()
	})

	it('closes on Escape without changing the density, and when clicking elsewhere', async () => {
		const { onChange, trigger } = renderMenu()
		await userEvent.click(trigger)
		// Escape is a dismissal, so it is cancelled and focus returns to the trigger.
		expect(fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })).toBe(false)
		expect(screen.queryByRole('menu')).toBeNull()
		expect(trigger).toHaveFocus()

		await userEvent.click(trigger)
		fireEvent.pointerDown(screen.getByRole('menuitemradio', { name: 'Compact' }))
		expect(screen.getByRole('menu')).toBeInTheDocument()
		fireEvent.pointerDown(screen.getByRole('button', { name: 'Outside' }))
		expect(screen.queryByRole('menu')).toBeNull()
		expect(onChange).not.toHaveBeenCalled()

		await userEvent.click(trigger)
		await userEvent.click(trigger)
		expect(screen.queryByRole('menu')).toBeNull()
	})
})

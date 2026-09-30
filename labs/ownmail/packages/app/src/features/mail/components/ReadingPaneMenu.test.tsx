// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ReadingPaneMenu } from './ReadingPaneMenu.js'

afterEach(cleanup)

function renderMenu(value: 'none' | 'vertical' | 'horizontal' = 'vertical') {
	const onChange = vi.fn()
	render(
		<div>
			<ReadingPaneMenu value={value} onChange={onChange} />
			<button type="button">Outside</button>
		</div>,
	)
	return { onChange, trigger: screen.getByRole('button', { name: /^Reading pane:/ }) }
}

describe('ReadingPaneMenu', () => {
	it('names the current layout and exposes it as a checked menu item', async () => {
		const { trigger } = renderMenu('horizontal')
		expect(trigger).toHaveAccessibleName('Reading pane: Horizontal split')
		expect(trigger).toHaveAttribute('aria-expanded', 'false')

		await userEvent.click(trigger)

		expect(trigger).toHaveAttribute('aria-expanded', 'true')
		expect(screen.getByRole('menu', { name: 'Reading pane' })).toBeInTheDocument()
		expect(screen.getByRole('menuitemradio', { name: 'Horizontal split' })).toHaveAttribute(
			'aria-checked',
			'true',
		)
		expect(screen.getByRole('menuitemradio', { name: 'No split' })).toHaveAttribute('aria-checked', 'false')
		// Opening focuses the current choice so Enter keeps it.
		expect(screen.getByRole('menuitemradio', { name: 'Horizontal split' })).toHaveFocus()
	})

	it('applies a choice, closes, and returns focus to the trigger', async () => {
		const { onChange, trigger } = renderMenu()
		await userEvent.click(trigger)
		await userEvent.click(screen.getByRole('menuitemradio', { name: 'No split' }))

		expect(onChange).toHaveBeenCalledWith('none')
		expect(screen.queryByRole('menu')).toBeNull()
		expect(trigger).toHaveFocus()
	})

	it('moves between choices with arrows, Home, and End, wrapping at the ends', async () => {
		renderMenu('none')
		await userEvent.click(screen.getByRole('button', { name: /^Reading pane:/ }))
		const menu = screen.getByRole('menu')
		const item = (name: string) => screen.getByRole('menuitemradio', { name })

		fireEvent.keyDown(menu, { key: 'ArrowUp' })
		expect(item('Horizontal split')).toHaveFocus()
		fireEvent.keyDown(menu, { key: 'ArrowDown' })
		expect(item('No split')).toHaveFocus()
		fireEvent.keyDown(menu, { key: 'ArrowDown' })
		expect(item('Vertical split')).toHaveFocus()
		fireEvent.keyDown(menu, { key: 'ArrowUp' })
		expect(item('No split')).toHaveFocus()
		fireEvent.keyDown(menu, { key: 'End' })
		expect(item('Horizontal split')).toHaveFocus()
		fireEvent.keyDown(menu, { key: 'ArrowDown' })
		expect(item('No split')).toHaveFocus()
		fireEvent.keyDown(menu, { key: 'Home' })
		expect(item('No split')).toHaveFocus()
		// Unrelated keys leave focus alone.
		fireEvent.keyDown(menu, { key: 'x' })
		expect(item('No split')).toHaveFocus()
	})

	it('closes on Escape or Tab without changing the layout, and when clicking elsewhere', async () => {
		const { onChange, trigger } = renderMenu()
		for (const key of ['Escape', 'Tab']) {
			await userEvent.click(trigger)
			fireEvent.keyDown(screen.getByRole('menu'), { key })
			expect(screen.queryByRole('menu')).toBeNull()
			expect(trigger).toHaveFocus()
		}

		await userEvent.click(trigger)
		fireEvent.pointerDown(screen.getByRole('menuitemradio', { name: 'No split' }))
		expect(screen.getByRole('menu')).toBeInTheDocument()
		fireEvent.pointerDown(screen.getByRole('button', { name: 'Outside' }))
		expect(screen.queryByRole('menu')).toBeNull()
		expect(onChange).not.toHaveBeenCalled()

		await userEvent.click(trigger)
		await userEvent.click(trigger)
		expect(screen.queryByRole('menu')).toBeNull()
	})
})

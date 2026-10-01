// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CalendarHourHeight } from '#app/preferences/user-preferences'
import { GridZoomControl, SecondaryTimezoneControl } from './CalendarGridControls.js'

afterEach(cleanup)

function Zoom({ initial, onChange }: { initial: CalendarHourHeight; onChange?: (next: number) => void }) {
	const [hourHeight, setHourHeight] = useState(initial)
	return (
		<>
			<GridZoomControl
				hourHeight={hourHeight}
				onChange={(next) => {
					onChange?.(next)
					setHourHeight(next)
				}}
			/>
			<button type="button">elsewhere</button>
		</>
	)
}

describe('grid zoom control', () => {
	it('steps the hour height one size per press and names the level in text', () => {
		const onChange = vi.fn()
		render(<Zoom initial={52} onChange={onChange} />)
		const trigger = screen.getByRole('button', { name: 'Grid zoom' })
		expect(trigger).toHaveAttribute('aria-expanded', 'false')
		fireEvent.click(trigger)
		expect(trigger).toHaveAttribute('aria-expanded', 'true')
		const popover = within(screen.getByRole('dialog', { name: 'Grid zoom' }))
		expect(popover.getByRole('status')).toHaveTextContent('Default')

		fireEvent.click(popover.getByRole('button', { name: 'Zoom in' }))
		expect(onChange).toHaveBeenLastCalledWith(64)
		expect(popover.getByRole('status')).toHaveTextContent('Roomy')

		fireEvent.click(popover.getByRole('button', { name: 'Zoom out' }))
		fireEvent.click(popover.getByRole('button', { name: 'Zoom out' }))
		expect(onChange).toHaveBeenLastCalledWith(40)
		expect(popover.getByRole('status')).toHaveTextContent('Compact')
	})

	it('stops at the ends of the scale without taking keyboard focus away', () => {
		const onChange = vi.fn()
		render(<Zoom initial={40} onChange={onChange} />)
		fireEvent.click(screen.getByRole('button', { name: 'Grid zoom' }))
		const zoomOut = screen.getByRole('button', { name: 'Zoom out' })
		// A natively disabled button would drop focus mid-interaction; aria-disabled keeps it.
		expect(zoomOut).toHaveAttribute('aria-disabled', 'true')
		expect(zoomOut).not.toBeDisabled()
		fireEvent.click(zoomOut)
		expect(onChange).not.toHaveBeenCalled()

		cleanup()
		render(<Zoom initial={80} onChange={onChange} />)
		fireEvent.click(screen.getByRole('button', { name: 'Grid zoom' }))
		const zoomIn = screen.getByRole('button', { name: 'Zoom in' })
		expect(zoomIn).toHaveAttribute('aria-disabled', 'true')
		fireEvent.click(zoomIn)
		expect(onChange).not.toHaveBeenCalled()
	})

	it('moves focus into the popover and returns it to the trigger on Escape', () => {
		render(<Zoom initial={52} />)
		const trigger = screen.getByRole('button', { name: 'Grid zoom' })
		fireEvent.click(trigger)
		const popover = screen.getByRole('dialog', { name: 'Grid zoom' })
		expect(popover).toHaveFocus()
		// Other keys are left alone so the buttons keep their native behaviour.
		fireEvent.keyDown(popover, { key: 'Enter' })
		expect(screen.getByRole('dialog', { name: 'Grid zoom' })).toBeInTheDocument()
		fireEvent.keyDown(popover, { key: 'Escape' })
		expect(screen.queryByRole('dialog')).toBeNull()
		expect(trigger).toHaveFocus()
	})

	it('closes when the trigger is pressed again or a click lands elsewhere', () => {
		render(<Zoom initial={52} />)
		const trigger = screen.getByRole('button', { name: 'Grid zoom' })
		fireEvent.click(trigger)
		fireEvent.click(screen.getByRole('status'))
		// A click inside the popover is not a dismissal.
		expect(screen.getByRole('dialog', { name: 'Grid zoom' })).toBeInTheDocument()
		fireEvent.click(trigger)
		expect(screen.queryByRole('dialog')).toBeNull()

		fireEvent.click(trigger)
		fireEvent.click(screen.getByRole('button', { name: 'elsewhere' }))
		expect(screen.queryByRole('dialog')).toBeNull()
	})

	it('closes when keyboard focus moves away, but not when focus stays inside or goes nowhere', () => {
		render(<Zoom initial={52} />)
		fireEvent.click(screen.getByRole('button', { name: 'Grid zoom' }))
		const popover = screen.getByRole('dialog', { name: 'Grid zoom' })
		fireEvent.blur(popover, { relatedTarget: screen.getByRole('button', { name: 'Zoom in' }) })
		expect(screen.getByRole('dialog', { name: 'Grid zoom' })).toBeInTheDocument()
		// Clicking the popover's padding blurs to nothing, which must not dismiss it.
		fireEvent.blur(popover, { relatedTarget: null })
		expect(screen.getByRole('dialog', { name: 'Grid zoom' })).toBeInTheDocument()
		fireEvent.blur(popover, { relatedTarget: screen.getByRole('button', { name: 'elsewhere' }) })
		expect(screen.queryByRole('dialog')).toBeNull()
	})
})

const NOW = new Date('2024-06-15T12:00:00Z')

function Zones({ initial, onChange }: { initial: string; onChange?: (next: string) => void }) {
	const [secondary, setSecondary] = useState(initial)
	return (
		<SecondaryTimezoneControl
			primaryTimezone="America/Toronto"
			secondaryTimezone={secondary}
			now={NOW}
			onChange={(next) => {
				onChange?.(next)
				setSecondary(next)
			}}
		/>
	)
}

describe('second time zone control', () => {
	it('offers to add a second zone from the gutter head when none is shown', () => {
		const onChange = vi.fn()
		render(<Zones initial="" onChange={onChange} />)
		const trigger = screen.getByRole('button', { name: 'Time zone: EDT. Add a second time zone' })
		fireEvent.click(trigger)
		const popover = within(screen.getByRole('dialog', { name: 'Second time zone' }))
		// Nothing to remove yet.
		expect(popover.queryByRole('button', { name: 'Remove second time zone' })).toBeNull()
		fireEvent.change(popover.getByRole('combobox', { name: 'Second time zone' }), {
			target: { value: 'Europe/London' },
		})
		expect(onChange).toHaveBeenCalledWith('Europe/London')
		// The short name depends on the runtime's locale data (BST or GMT+1).
		expect(
			screen.getByRole('button', { name: /^Time zones: EDT and (BST|GMT\+1)\. Change second time zone$/ }),
		).toBeInTheDocument()
	})

	it('never offers the primary zone, since a second ruler equal to the first shows nothing new', () => {
		render(<Zones initial="" />)
		fireEvent.click(screen.getByRole('button', { name: /Add a second time zone/ }))
		const options = within(screen.getByRole('combobox', { name: 'Second time zone' })).getAllByRole('option')
		expect(options.map((option) => option.getAttribute('value'))).not.toContain('America/Toronto')
		expect(options[0]).toHaveValue('')
	})

	it('rejects a zone the runtime does not support, or the primary zone, even if the page offers it', () => {
		const onChange = vi.fn()
		render(<Zones initial="" onChange={onChange} />)
		fireEvent.click(screen.getByRole('button', { name: /Add a second time zone/ }))
		const select = screen.getByRole('combobox', { name: 'Second time zone' })
		select.append(new Option('Tampered', 'not/a-timezone'), new Option('Primary', 'America/Toronto'))
		fireEvent.change(select, { target: { value: 'not/a-timezone' } })
		fireEvent.change(select, { target: { value: 'America/Toronto' } })
		expect(onChange).not.toHaveBeenCalled()
	})

	it('removes the second zone, by button or by choosing None, and returns focus to the gutter head', () => {
		const onChange = vi.fn()
		render(<Zones initial="Europe/London" onChange={onChange} />)
		fireEvent.click(screen.getByRole('button', { name: /Change second time zone/ }))
		fireEvent.click(screen.getByRole('button', { name: 'Remove second time zone' }))
		expect(onChange).toHaveBeenLastCalledWith('')
		expect(screen.queryByRole('dialog')).toBeNull()
		const trigger = screen.getByRole('button', { name: /Add a second time zone/ })
		expect(trigger).toHaveFocus()

		fireEvent.click(trigger)
		fireEvent.change(screen.getByRole('combobox', { name: 'Second time zone' }), {
			target: { value: 'Asia/Tokyo' },
		})
		fireEvent.change(screen.getByRole('combobox', { name: 'Second time zone' }), { target: { value: '' } })
		expect(onChange).toHaveBeenLastCalledWith('')
	})
})

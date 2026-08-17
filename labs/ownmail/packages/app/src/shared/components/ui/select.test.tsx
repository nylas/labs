// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './select.js'

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

function Harness({ onValueChange }: { onValueChange: (value: string) => void }) {
	return (
		<Select defaultValue="8" onValueChange={onValueChange}>
			<SelectTrigger aria-label="Start time" className="w-40">
				<SelectValue />
			</SelectTrigger>
			<SelectContent>
				<SelectItem value="8">8 AM</SelectItem>
				<SelectItem value="9">9 AM</SelectItem>
			</SelectContent>
		</Select>
	)
}

describe('Select', () => {
	it('renders the trigger with the selected value and opens to pick another option', async () => {
		const user = userEvent.setup()
		const onValueChange = vi.fn()
		render(<Harness onValueChange={onValueChange} />)

		const trigger = screen.getByRole('combobox', { name: 'Start time' })
		expect(trigger).toHaveAttribute('data-slot', 'select-trigger')
		expect(trigger).toHaveTextContent('8 AM')
		expect(trigger.className).toContain('text-base')
		expect(trigger.className).toContain('sm:text-sm')
		expect(trigger.className).toContain('touch-target')

		await user.click(trigger)
		// Opening renders the portalled content + items (with the checked indicator).
		const option = await screen.findByRole('option', { name: '9 AM' })
		expect(option.className).toContain('touch-target')
		await user.click(option)

		expect(onValueChange).toHaveBeenCalledWith('9')
	})
})

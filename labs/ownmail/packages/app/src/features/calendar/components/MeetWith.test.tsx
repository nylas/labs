// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FreeBusyPerson, MeetWithPerson } from '../lib/free-busy.js'
import { MeetWith } from './MeetWith.js'

// The people search is the existing contacts lookup, a server function.
vi.mock('#server/fns', () => ({ searchContacts: vi.fn() }))

import { searchContacts } from '#server/fns'

const search = vi.mocked(searchContacts)

beforeEach(() => {
	vi.useFakeTimers()
	search.mockReset().mockResolvedValue([])
})
afterEach(() => {
	cleanup()
	vi.runOnlyPendingTimers()
	vi.useRealTimers()
})

type HarnessProps = {
	initial?: MeetWithPerson[]
	results?: FreeBusyPerson[]
	loading?: boolean
	error?: string | null
	shownOnGrid?: boolean
	onChange?: (people: MeetWithPerson[]) => void
	onRetry?: () => void
}

function Harness({
	initial = [],
	results = [],
	loading = false,
	error = null,
	shownOnGrid = true,
	onChange,
	onRetry = () => {},
}: HarnessProps) {
	const [people, setPeople] = useState(initial)
	return (
		<MeetWith
			people={people}
			results={results}
			loading={loading}
			error={error}
			shownOnGrid={shownOnGrid}
			timeZone="America/Toronto"
			onChange={(next) => {
				onChange?.(next)
				setPeople(next)
			}}
			onRetry={onRetry}
		/>
	)
}

const field = () => screen.getByRole('combobox', { name: 'Search people to meet with' })
const type = (value: string) => fireEvent.change(field(), { target: { value } })
/** Lets the typing pause pass and the lookup it starts be delivered. */
const pause = async (ms = 250) => {
	await act(() => vi.advanceTimersByTimeAsync(ms))
}
const legend = () => screen.getByRole('list', { name: 'People shown on the grid' })

describe('searching for people', () => {
	it('waits for a pause in typing, so contacts are not looked up on every keystroke', async () => {
		render(<Harness />)
		for (const value of ['m', 'mi', 'min', 'mina']) {
			type(value)
			await pause(100)
		}
		expect(search).not.toHaveBeenCalled()
		await pause()
		expect(search).toHaveBeenCalledExactlyOnceWith({ data: { q: 'mina' } })
	})

	it('does not search for a single character, and closes the list when the text is cleared', async () => {
		search.mockResolvedValue([{ email: 'mina@example.com', name: 'Mina Park' }])
		render(<Harness />)
		type('m')
		await pause()
		expect(search).not.toHaveBeenCalled()
		type('mi')
		await pause()
		expect(screen.getByRole('listbox', { name: 'People suggestions' })).toBeInTheDocument()
		type('')
		expect(screen.queryByRole('listbox')).toBeNull()
		expect(field()).toHaveAttribute('aria-expanded', 'false')
	})

	it('offers contacts by name and adds the picked person to the legend with a swatch', async () => {
		search.mockResolvedValue([{ email: 'Mina@Example.com', name: 'Mina Park' }, { email: 'sam@example.com' }])
		const onChange = vi.fn()
		render(<Harness onChange={onChange} />)
		type('mi')
		await pause()
		const options = screen.getAllByRole('option')
		expect(options[0]).toHaveTextContent('Mina Park')
		expect(options[0]).toHaveTextContent('mina@example.com')
		// A contact with no name is listed once, by address.
		expect(options[1]?.textContent).toBe('sam@example.com')

		fireEvent.click(options[0] as HTMLElement)
		expect(onChange).toHaveBeenCalledExactlyOnceWith([{ email: 'mina@example.com', name: 'Mina Park' }])
		const row = within(legend()).getByRole('listitem')
		expect(row).toHaveTextContent('Mina Park')
		expect(row.querySelector('.busy-block')).toHaveAttribute('aria-hidden', 'true')
		// The field is ready for the next person.
		expect(field()).toHaveValue('')
		expect(screen.queryByRole('listbox')).toBeNull()
	})

	it('picks with the keyboard: arrows move the highlight, Enter adds, Escape only closes the list', async () => {
		search.mockResolvedValue([
			{ email: 'mina@example.com', name: 'Mina Park' },
			{ email: 'sam@example.com', name: 'Sam Lee' },
		])
		const onChange = vi.fn()
		render(<Harness onChange={onChange} />)
		type('ex')
		await pause()
		expect(field()).toHaveAttribute('aria-activedescendant', screen.getAllByRole('option')[0]?.id)
		fireEvent.keyDown(field(), { key: 'ArrowDown' })
		expect(screen.getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true')
		fireEvent.keyDown(field(), { key: 'ArrowUp' })
		fireEvent.keyDown(field(), { key: 'ArrowUp' })
		expect(screen.getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true')
		// Hovering is supplementary: it moves the same highlight.
		fireEvent.mouseEnter(screen.getAllByRole('option')[0] as HTMLElement)
		expect(screen.getAllByRole('option')[0]).toHaveAttribute('aria-selected', 'true')
		fireEvent.keyDown(field(), { key: 'ArrowDown' })

		const escapeKey = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
		act(() => {
			field().dispatchEvent(escapeKey)
		})
		expect(escapeKey.defaultPrevented).toBe(true)
		expect(screen.queryByRole('listbox')).toBeNull()
		expect(field()).toHaveValue('ex')
		expect(onChange).not.toHaveBeenCalled()

		type('exa')
		await pause()
		fireEvent.keyDown(field(), { key: 'ArrowDown' })
		fireEvent.keyDown(field(), { key: 'Enter' })
		expect(onChange).toHaveBeenCalledExactlyOnceWith([{ email: 'sam@example.com', name: 'Sam Lee' }])
	})

	it('keeps focus in the field when a suggestion is pressed, so the pick lands before the list closes', async () => {
		search.mockResolvedValue([{ email: 'mina@example.com', name: 'Mina Park' }])
		render(<Harness />)
		type('mi')
		await pause()
		const pointerDown = new MouseEvent('pointerdown', { bubbles: true, cancelable: true })
		act(() => {
			screen.getByRole('option').dispatchEvent(pointerDown)
		})
		expect(pointerDown.defaultPrevented).toBe(true)
		fireEvent.blur(field())
		expect(screen.queryByRole('listbox')).toBeNull()
	})

	it('adds someone who is not a contact by their full address', async () => {
		const onChange = vi.fn()
		render(<Harness onChange={onChange} />)
		type('  New.Person@Example.com ')
		fireEvent.keyDown(field(), { key: 'Enter' })
		expect(onChange).toHaveBeenCalledExactlyOnceWith([{ email: 'new.person@example.com' }])
	})

	it('refuses text that is not a full address, and says what to do instead', () => {
		const onChange = vi.fn()
		render(<Harness onChange={onChange} />)
		// Enter in an empty field does nothing at all.
		fireEvent.keyDown(field(), { key: 'Enter' })
		expect(screen.queryByRole('alert')).toBeNull()
		// Keys with no meaning here are left to the browser.
		fireEvent.keyDown(field(), { key: 'Escape' })
		fireEvent.keyDown(field(), { key: 'a' })

		type('mina')
		fireEvent.keyDown(field(), { key: 'Enter' })
		expect(onChange).not.toHaveBeenCalled()
		expect(field()).toHaveAttribute('aria-invalid', 'true')
		expect(screen.getByRole('alert')).toHaveTextContent(
			'Pick a person from the list or type a full email address.',
		)
		expect(field()).toHaveAccessibleDescription('Pick a person from the list or type a full email address.')
		// Typing again clears the complaint.
		type('mina@')
		expect(field()).not.toHaveAttribute('aria-invalid')
		expect(screen.queryByRole('alert')).toBeNull()
	})

	it('never offers someone already listed or an address that cannot be looked up', async () => {
		search.mockResolvedValue([
			{ email: 'mina@example.com', name: 'Mina Park' },
			{ email: 'not an address', name: 'Broken' },
			{ email: 'sam@example.com', name: 'Sam Lee' },
		])
		const onChange = vi.fn()
		render(<Harness initial={[{ email: 'mina@example.com', name: 'Mina Park' }]} onChange={onChange} />)
		type('ex')
		await pause()
		expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
			'Sam Leesam@example.com',
		])

		// Typing the address of someone already listed adds nobody twice.
		type('MINA@example.com')
		fireEvent.keyDown(field(), { key: 'Enter' })
		expect(onChange).not.toHaveBeenCalled()
		expect(within(legend()).getAllByRole('listitem')).toHaveLength(1)
	})

	it('shows no list when nothing usable is found or the lookup fails', async () => {
		render(<Harness />)
		type('zz')
		await pause()
		expect(screen.queryByRole('listbox')).toBeNull()
		search.mockRejectedValueOnce(new Error('offline'))
		type('zzz')
		await pause()
		expect(screen.queryByRole('listbox')).toBeNull()
		expect(screen.queryByRole('alert')).toBeNull()
	})

	it('ignores a slow lookup that finishes after a newer one was started', async () => {
		let finishSlow: (value: { email: string; name?: string }[]) => void = () => {}
		search.mockReturnValueOnce(
			new Promise((resolve) => {
				finishSlow = resolve
			}),
		)
		search.mockResolvedValueOnce([{ email: 'sam@example.com', name: 'Sam Lee' }])
		render(<Harness />)
		type('mi')
		await pause()
		type('sa')
		await pause()
		expect(screen.getByRole('option')).toHaveTextContent('Sam Lee')
		await act(async () => finishSlow([{ email: 'mina@example.com', name: 'Mina Park' }]))
		expect(screen.getByRole('option')).toHaveTextContent('Sam Lee')
	})

	it('stops at five people and says so', () => {
		const five = Array.from({ length: 5 }, (_, index) => ({ email: `person${index}@example.com` }))
		render(<Harness initial={five} />)
		expect(field()).toBeDisabled()
		expect(field()).toHaveAccessibleDescription('Up to 5 people at a time.')
	})
})

describe('the legend', () => {
	const mina = { email: 'mina@example.com', name: 'Mina Park' }
	const sam = { email: 'sam@example.com' }
	// 9 AM to 10 AM in Toronto on Wednesday 7 October 2026.
	const slot = { start: Date.UTC(2026, 9, 7, 13) / 1000, end: Date.UTC(2026, 9, 7, 14) / 1000 }

	it('says up front that only busy times are shown, never event details', () => {
		render(<Harness />)
		expect(screen.getByRole('region', { name: 'Meet with…' })).toBeInTheDocument()
		expect(field()).toHaveAccessibleDescription(
			'Their busy times appear on the grid. Event details are never shown.',
		)
		expect(screen.queryByRole('list', { name: 'People shown on the grid' })).toBeNull()
	})

	it('states each person in words beside their swatch, so nothing depends on colour', () => {
		render(
			<Harness
				initial={[mina, sam, { email: 'new@example.com' }]}
				results={[
					{ email: 'mina@example.com', busy: [slot], unavailable: false },
					{ email: 'sam@example.com', busy: [], unavailable: true },
				]}
				loading
			/>,
		)
		const rows = within(legend()).getAllByRole('listitem', { name: '' })
		expect(rows[0]).toHaveTextContent('Mina Park')
		expect(rows[0]).toHaveTextContent('1 busy time')
		// The grid blocks are decorative, so the same times are listed in text.
		expect(
			within(screen.getByRole('list', { name: 'Busy times for Mina Park' })).getByRole('listitem'),
		).toHaveTextContent('9 AM – 10 AM')
		expect(screen.getByText('sam@example.com').closest('li')).toHaveTextContent('Availability not shared')
		expect(screen.getByText('new@example.com').closest('li')).toHaveTextContent('Checking availability…')
	})

	it('removes a person from the grid with a named, touch-sized button', () => {
		const onChange = vi.fn()
		render(<Harness initial={[mina, sam]} onChange={onChange} />)
		const remove = screen.getByRole('button', { name: 'Remove Mina Park' })
		expect(remove).toHaveClass('[@media(any-pointer:coarse)]:size-11')
		fireEvent.click(remove)
		expect(onChange).toHaveBeenCalledExactlyOnceWith([sam])
		expect(screen.queryByText('Mina Park')).toBeNull()
	})

	it('shows a failure as a visible, generic message with a way to try again', () => {
		const onRetry = vi.fn()
		render(
			<Harness
				initial={[mina]}
				error="Availability is temporarily rate limited. Try again shortly."
				onRetry={onRetry}
			/>,
		)
		expect(screen.getByRole('alert')).toHaveTextContent(
			'Availability is temporarily rate limited. Try again shortly.',
		)
		fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
		expect(onRetry).toHaveBeenCalledOnce()
	})

	it('shows no failure when nobody is listed', () => {
		render(<Harness error="Could not load availability. Try again shortly." />)
		expect(screen.queryByRole('alert')).toBeNull()
	})

	it('explains that the month view has no grid to draw on, instead of showing stale states', () => {
		render(
			<Harness
				initial={[mina]}
				results={[{ email: 'mina@example.com', busy: [slot], unavailable: false }]}
				error="Could not load availability. Try again shortly."
				shownOnGrid={false}
			/>,
		)
		expect(screen.getByText('Shown in the day and week views')).toBeInTheDocument()
		expect(screen.queryByText('1 busy time')).toBeNull()
		expect(screen.queryByRole('list', { name: 'Busy times for Mina Park' })).toBeNull()
		expect(screen.queryByRole('alert')).toBeNull()
	})
})

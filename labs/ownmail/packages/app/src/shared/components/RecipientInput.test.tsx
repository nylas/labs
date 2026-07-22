// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RecipientInput } from './RecipientInput.js'

// Contact lookup is a server function; stub it so the debounce/UI behaviour is
// what's under test, not the network.
vi.mock('#server/fns', () => ({ searchContacts: vi.fn() }))

import { searchContacts } from '#server/fns'

const mockSearch = vi.mocked(searchContacts)

beforeEach(() => {
	vi.useFakeTimers()
	mockSearch.mockReset()
})

afterEach(() => {
	cleanup()
	vi.runOnlyPendingTimers()
	vi.useRealTimers()
})

function Harness({
	initial = '',
	onChangeSpy,
	placeholder,
	className,
	label,
	id,
}: {
	initial?: string
	onChangeSpy?: (next: string) => void
	placeholder?: string
	className?: string
	label?: string
	id?: string
}) {
	const [value, setValue] = useState(initial)
	return (
		<RecipientInput
			value={value}
			onChange={(next) => {
				setValue(next)
				onChangeSpy?.(next)
			}}
			placeholder={placeholder}
			className={className}
			{...(label ? { label } : {})}
			{...(id ? { id } : {})}
		/>
	)
}

function field() {
	return screen.getByLabelText('Recipients') as HTMLInputElement
}

async function flushDebounce(ms = 250) {
	await act(async () => {
		await vi.advanceTimersByTimeAsync(ms)
	})
}

describe('RecipientInput', () => {
	it('uses the default placeholder and keeps typed text in the draft input', () => {
		const onChangeSpy = vi.fn()
		render(<Harness onChangeSpy={onChangeSpy} />)
		const input = field()
		expect(input.placeholder).toBe('To (comma-separated)')
		fireEvent.change(input, { target: { value: 'a' } })
		// Typing a partial fragment does not commit a recipient yet.
		expect(onChangeSpy).not.toHaveBeenCalled()
		expect(input.value).toBe('a')
	})

	it('honours a custom placeholder, className, id, and label', () => {
		render(<Harness placeholder="Send to" className="wide" label="Guests" id="guest-field" />)
		const input = screen.getByLabelText('Guests') as HTMLInputElement
		expect(input.placeholder).toBe('Send to')
		expect(input.id).toBe('guest-field')
		// className styles the chip container, not the inner input.
		expect(input.closest('.wide')).not.toBeNull()
	})

	it('renders existing recipients as chips and hides the placeholder', () => {
		render(<Harness initial="mina@example.com, alex@acme.com" placeholder="add" />)
		expect(screen.getByText('mina@example.com')).toBeInTheDocument()
		expect(screen.getByText('alex@acme.com')).toBeInTheDocument()
		expect(field().placeholder).toBe('')
	})

	it('removes a chip when its remove button is pressed', () => {
		const onChangeSpy = vi.fn()
		render(<Harness initial="mina@example.com, alex@acme.com" onChangeSpy={onChangeSpy} />)
		fireEvent.mouseDown(screen.getByRole('button', { name: 'Remove mina@example.com' }))
		expect(onChangeSpy).toHaveBeenCalledWith('alex@acme.com')
	})

	it('removes the last chip on Backspace when the draft is empty', () => {
		const onChangeSpy = vi.fn()
		render(<Harness initial="mina@example.com, alex@acme.com" onChangeSpy={onChangeSpy} />)
		fireEvent.keyDown(field(), { key: 'Backspace' })
		expect(onChangeSpy).toHaveBeenCalledWith('mina@example.com')
	})

	it('does not remove a chip on Backspace while the draft has text', () => {
		const onChangeSpy = vi.fn()
		render(<Harness initial="mina@example.com" onChangeSpy={onChangeSpy} />)
		fireEvent.change(field(), { target: { value: 'a' } })
		fireEvent.keyDown(field(), { key: 'Backspace' })
		expect(onChangeSpy).not.toHaveBeenCalled()
	})

	it('commits the draft as a chip when a comma is typed', () => {
		const onChangeSpy = vi.fn()
		render(<Harness onChangeSpy={onChangeSpy} />)
		fireEvent.change(field(), { target: { value: 'bob@x.com,' } })
		expect(onChangeSpy).toHaveBeenCalledWith('bob@x.com')
		expect(field().value).toBe('')
	})

	it('commits multiple pasted comma-separated addresses at once', () => {
		const onChangeSpy = vi.fn()
		render(<Harness onChangeSpy={onChangeSpy} />)
		fireEvent.change(field(), { target: { value: 'a@x.com, b@x.com, c' } })
		expect(onChangeSpy).toHaveBeenCalledWith('a@x.com, b@x.com')
		expect(field().value).toBe('c')
	})

	it('does not query for fragments shorter than two characters', async () => {
		render(<Harness />)
		fireEvent.change(field(), { target: { value: 'a' } })
		await flushDebounce()
		expect(mockSearch).not.toHaveBeenCalled()
		expect(screen.queryByRole('list')).toBeNull()
	})

	it('shows autocomplete results after the debounce, with and without names', async () => {
		mockSearch.mockResolvedValue([
			{ email: 'jordan@acme.com', name: 'Jordan Lee' },
			{ email: 'noname@acme.com' },
		])
		render(<Harness />)
		fireEvent.change(field(), { target: { value: 'jo' } })
		await flushDebounce()

		expect(screen.getByRole('list')).toBeInTheDocument()
		expect(mockSearch).toHaveBeenCalledWith({ data: { q: 'jo' } })
		expect(screen.getByText('Jordan Lee')).toBeInTheDocument()
		// Name and email render on their own truncating lines (no angle brackets).
		expect(screen.getByText('jordan@acme.com')).toBeInTheDocument()
		expect(screen.getByText('noname@acme.com')).toBeInTheDocument()
	})

	it('stays closed when the lookup returns no matches', async () => {
		mockSearch.mockResolvedValue([])
		render(<Harness />)
		fireEvent.change(field(), { target: { value: 'zz' } })
		await flushDebounce()
		expect(mockSearch).toHaveBeenCalled()
		expect(screen.queryByRole('list')).toBeNull()
	})

	it('swallows lookup failures without surfacing suggestions', async () => {
		mockSearch.mockRejectedValue(new Error('offline'))
		render(<Harness />)
		fireEvent.change(field(), { target: { value: 'fa' } })
		await flushDebounce()
		expect(screen.queryByRole('list')).toBeNull()
	})

	it('picks a suggestion with the mouse, committing it as a chip', async () => {
		const onChangeSpy = vi.fn()
		mockSearch.mockResolvedValue([{ email: 'jordan@acme.com', name: 'Jordan Lee' }])
		render(<Harness onChangeSpy={onChangeSpy} />)
		fireEvent.change(field(), { target: { value: 'jo' } })
		await flushDebounce()

		fireEvent.mouseDown(screen.getByRole('button', { name: /Jordan Lee/ }))
		expect(onChangeSpy).toHaveBeenCalledWith('jordan@acme.com')
		expect(screen.queryByRole('list')).toBeNull()
	})

	it('appends a picked suggestion to existing chips', async () => {
		const onChangeSpy = vi.fn()
		mockSearch.mockResolvedValue([{ email: 'jordan@acme.com', name: 'Jordan Lee' }])
		render(<Harness initial="taylor@acme.com" onChangeSpy={onChangeSpy} />)
		fireEvent.change(field(), { target: { value: 'jo' } })
		await flushDebounce()

		fireEvent.mouseDown(screen.getByRole('button', { name: /Jordan Lee/ }))
		expect(onChangeSpy).toHaveBeenCalledWith('taylor@acme.com, jordan@acme.com')
	})

	it('navigates suggestions with arrow keys and commits the highlight on Enter', async () => {
		const onChangeSpy = vi.fn()
		mockSearch.mockResolvedValue([
			{ email: 'a@acme.com', name: 'Ann' },
			{ email: 'b@acme.com', name: 'Bo' },
		])
		render(<Harness onChangeSpy={onChangeSpy} />)
		const input = field()
		fireEvent.change(input, { target: { value: 'a' } })
		fireEvent.change(input, { target: { value: 'an' } })
		await flushDebounce()

		fireEvent.keyDown(input, { key: 'ArrowDown' }) // 0 -> 1
		fireEvent.keyDown(input, { key: 'ArrowUp' }) // 1 -> 0
		fireEvent.keyDown(input, { key: 'ArrowDown' }) // 0 -> 1
		fireEvent.keyDown(input, { key: 'Enter' })
		expect(onChangeSpy).toHaveBeenLastCalledWith('b@acme.com')
	})

	it('Enter commits the typed draft when nothing is highlighted / list closed', () => {
		const onChangeSpy = vi.fn()
		render(<Harness onChangeSpy={onChangeSpy} />)
		const input = field()
		fireEvent.change(input, { target: { value: 'solo@acme.com' } })
		fireEvent.keyDown(input, { key: 'Enter' })
		expect(onChangeSpy).toHaveBeenCalledWith('solo@acme.com')
	})

	it('Enter with an empty draft and no list does nothing', () => {
		const onChangeSpy = vi.fn()
		render(<Harness onChangeSpy={onChangeSpy} />)
		fireEvent.keyDown(field(), { key: 'Enter' })
		expect(onChangeSpy).not.toHaveBeenCalled()
	})

	it('Escape closes the suggestion list', async () => {
		mockSearch.mockResolvedValue([{ email: 'jordan@acme.com', name: 'Jordan Lee' }])
		render(<Harness />)
		const input = field()
		fireEvent.change(input, { target: { value: 'jo' } })
		await flushDebounce()
		expect(screen.getByRole('list')).toBeInTheDocument()
		fireEvent.keyDown(input, { key: 'Escape' })
		expect(screen.queryByRole('list')).toBeNull()
	})

	it('hovering a suggestion moves the highlight so Enter picks it', async () => {
		const onChangeSpy = vi.fn()
		mockSearch.mockResolvedValue([
			{ email: 'a@acme.com', name: 'Ann' },
			{ email: 'b@acme.com', name: 'Bo' },
		])
		render(<Harness onChangeSpy={onChangeSpy} />)
		const input = field()
		fireEvent.change(input, { target: { value: 'an' } })
		await flushDebounce()
		fireEvent.mouseEnter(screen.getByRole('button', { name: /Bo/ }))
		fireEvent.keyDown(input, { key: 'Enter' })
		expect(onChangeSpy).toHaveBeenLastCalledWith('b@acme.com')
	})

	it('commits a valid draft on blur but leaves an empty draft alone', async () => {
		const onChangeSpy = vi.fn()
		render(<Harness onChangeSpy={onChangeSpy} />)
		const input = field()

		// Empty draft: blur only closes, never commits.
		fireEvent.blur(input)
		await act(async () => {
			await vi.advanceTimersByTimeAsync(150)
		})
		expect(onChangeSpy).not.toHaveBeenCalled()

		// Non-empty draft: blur commits it as a chip.
		fireEvent.change(input, { target: { value: 'late@acme.com' } })
		fireEvent.blur(input)
		await act(async () => {
			await vi.advanceTimersByTimeAsync(150)
		})
		expect(onChangeSpy).toHaveBeenCalledWith('late@acme.com')
	})

	it('reschedules the lookup as the draft changes', async () => {
		mockSearch.mockResolvedValue([])
		render(<Harness />)
		const input = field()
		fireEvent.change(input, { target: { value: 'jo' } })
		fireEvent.change(input, { target: { value: 'jor' } })
		await flushDebounce()
		expect(mockSearch).toHaveBeenLastCalledWith({ data: { q: 'jor' } })
	})

	it('keeps newer suggestions when an earlier lookup resolves late', async () => {
		let resolveFirst: (value: { email: string; name?: string }[]) => void = () => {}
		let resolveSecond: (value: { email: string; name?: string }[]) => void = () => {}
		mockSearch
			.mockImplementationOnce(
				() =>
					new Promise((resolve) => {
						resolveFirst = resolve
					}),
			)
			.mockImplementationOnce(
				() =>
					new Promise((resolve) => {
						resolveSecond = resolve
					}),
			)

		render(<Harness />)
		const input = field()
		fireEvent.change(input, { target: { value: 'jo' } })
		await flushDebounce()
		fireEvent.change(input, { target: { value: 'jordan' } })
		await flushDebounce()

		await act(async () => resolveSecond([{ email: 'jordan@acme.com', name: 'Jordan' }]))
		expect(screen.getByText('jordan@acme.com')).toBeInTheDocument()

		await act(async () => resolveFirst([{ email: 'jo@old-example.com', name: 'Old result' }]))
		expect(screen.getByText('jordan@acme.com')).toBeInTheDocument()
		expect(screen.queryByText('jo@old-example.com')).toBeNull()
	})

	it('ignores a late lookup failure after the draft has changed', async () => {
		let rejectFirst: (reason?: unknown) => void = () => {}
		let resolveSecond: (value: { email: string; name?: string }[]) => void = () => {}
		mockSearch
			.mockImplementationOnce(
				() =>
					new Promise((_, reject) => {
						rejectFirst = reject
					}),
			)
			.mockImplementationOnce(
				() =>
					new Promise((resolve) => {
						resolveSecond = resolve
					}),
			)

		render(<Harness />)
		const input = field()
		fireEvent.change(input, { target: { value: 'jo' } })
		await flushDebounce()
		fireEvent.change(input, { target: { value: 'jordan' } })
		await flushDebounce()

		await act(async () => resolveSecond([{ email: 'jordan@acme.com', name: 'Jordan' }]))
		await act(async () => rejectFirst(new Error('offline')))

		expect(screen.getByText('jordan@acme.com')).toBeInTheDocument()
	})
})

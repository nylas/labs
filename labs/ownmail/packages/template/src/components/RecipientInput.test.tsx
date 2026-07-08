// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RecipientInput } from './RecipientInput.js'

// Contact lookup is a server function; stub it so the debounce/UI behaviour is
// what's under test, not the network.
vi.mock('../server/fns.js', () => ({ searchContacts: vi.fn() }))

import { searchContacts } from '../server/fns.js'

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
}: {
	initial?: string
	onChangeSpy?: (next: string) => void
	placeholder?: string
	className?: string
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
		/>
	)
}

async function flushDebounce(ms = 250) {
	await act(async () => {
		await vi.advanceTimersByTimeAsync(ms)
	})
}

describe('RecipientInput', () => {
	it('uses the default placeholder and forwards typed input to onChange', () => {
		const onChangeSpy = vi.fn()
		render(<Harness onChangeSpy={onChangeSpy} />)
		const input = screen.getByLabelText('Recipients') as HTMLInputElement
		expect(input.placeholder).toBe('To (comma-separated)')
		fireEvent.change(input, { target: { value: 'a' } })
		expect(onChangeSpy).toHaveBeenCalledWith('a')
	})

	it('honours a custom placeholder and className', () => {
		render(<Harness placeholder="Send to" className="wide" />)
		const input = screen.getByLabelText('Recipients') as HTMLInputElement
		expect(input.placeholder).toBe('Send to')
		expect(input.className).toContain('wide')
	})

	it('does not query for fragments shorter than two characters', async () => {
		render(<Harness initial="a" />)
		await flushDebounce()
		expect(mockSearch).not.toHaveBeenCalled()
		expect(screen.queryByRole('list')).toBeNull()
	})

	it('shows autocomplete results after the debounce, with and without names', async () => {
		mockSearch.mockResolvedValue([
			{ email: 'jordan@acme.com', name: 'Jordan Lee' },
			{ email: 'noname@acme.com' },
		])
		render(<Harness initial="jo" />)
		await flushDebounce()

		expect(screen.getByRole('list')).toBeInTheDocument()
		expect(mockSearch).toHaveBeenCalledWith({ data: { q: 'jo' } })
		expect(screen.getByText('Jordan Lee')).toBeInTheDocument()
		expect(screen.getByText('<jordan@acme.com>')).toBeInTheDocument()
		expect(screen.getByText('noname@acme.com')).toBeInTheDocument()
	})

	it('stays closed when the lookup returns no matches', async () => {
		mockSearch.mockResolvedValue([])
		render(<Harness initial="zz" />)
		await flushDebounce()
		expect(mockSearch).toHaveBeenCalled()
		expect(screen.queryByRole('list')).toBeNull()
	})

	it('swallows lookup failures without surfacing suggestions', async () => {
		mockSearch.mockRejectedValue(new Error('offline'))
		render(<Harness initial="fa" />)
		await flushDebounce()
		expect(screen.queryByRole('list')).toBeNull()
	})

	it('picking a suggestion for a fresh field replaces the fragment and closes', async () => {
		const onChangeSpy = vi.fn()
		mockSearch.mockResolvedValue([{ email: 'jordan@acme.com', name: 'Jordan Lee' }])
		render(<Harness initial="jo" onChangeSpy={onChangeSpy} />)
		await flushDebounce()

		const option = screen.getByRole('button', { name: /Jordan Lee/ })
		fireEvent.mouseDown(option)
		// Leading space from the join is trimmed for the first recipient.
		expect(onChangeSpy).toHaveBeenCalledWith('jordan@acme.com')
		expect(screen.queryByRole('list')).toBeNull()
	})

	it('picking a suggestion appends to an existing comma-separated list', async () => {
		const onChangeSpy = vi.fn()
		mockSearch.mockResolvedValue([{ email: 'jordan@acme.com', name: 'Jordan Lee' }])
		render(<Harness initial="taylor@acme.com, jo" onChangeSpy={onChangeSpy} />)
		await flushDebounce()

		const option = screen.getByRole('button', { name: /Jordan Lee/ })
		fireEvent.mouseDown(option)
		expect(onChangeSpy).toHaveBeenCalledWith('taylor@acme.com, jordan@acme.com')
	})

	it('closes the suggestion list shortly after blur', async () => {
		mockSearch.mockResolvedValue([{ email: 'jordan@acme.com', name: 'Jordan Lee' }])
		render(<Harness initial="jo" />)
		await flushDebounce()
		expect(screen.getByRole('list')).toBeInTheDocument()

		fireEvent.blur(screen.getByLabelText('Recipients'))
		await act(async () => {
			await vi.advanceTimersByTimeAsync(150)
		})
		expect(screen.queryByRole('list')).toBeNull()
	})

	it('reschedules the lookup as the active fragment changes', async () => {
		mockSearch.mockResolvedValue([])
		render(<Harness initial="jo" />)
		const input = screen.getByLabelText('Recipients')
		fireEvent.change(input, { target: { value: 'jor' } })
		await flushDebounce()
		// The pending timer for "jo" is cleared; only the latest fragment queries.
		expect(mockSearch).toHaveBeenLastCalledWith({ data: { q: 'jor' } })
	})
})

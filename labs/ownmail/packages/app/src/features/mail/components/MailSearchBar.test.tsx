// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MailSearchBar } from './MailSearchBar.js'

function ControlledSearch({
	onSubmit,
	activeQuery,
}: {
	onSubmit: (value: string) => void | Promise<void>
	activeQuery?: string
}) {
	const [value, setValue] = useState('')
	return <MailSearchBar value={value} activeQuery={activeQuery} onChange={setValue} onSubmit={onSubmit} />
}

function input() {
	return screen.getByRole('combobox', { name: 'Search mail' }) as HTMLInputElement
}

function deferred() {
	let resolve!: () => void
	let reject!: (error: Error) => void
	const promise = new Promise<void>((promiseResolve, promiseReject) => {
		resolve = promiseResolve
		reject = promiseReject
	})
	return { promise, resolve, reject }
}

afterEach(cleanup)

describe('MailSearchBar', () => {
	it('keeps typing local until Enter or the explicit Search button', async () => {
		const onSubmit = vi.fn()
		render(<ControlledSearch onSubmit={onSubmit} />)

		fireEvent.change(input(), { target: { value: 'invoice overdue' } })
		expect(onSubmit).not.toHaveBeenCalled()

		fireEvent.keyDown(input(), { key: 'Enter' })
		expect(onSubmit).toHaveBeenCalledWith('invoice overdue')
		await waitFor(() => expect(screen.getByRole('button', { name: 'Submit mail search' })).toBeEnabled())

		fireEvent.change(input(), { target: { value: 'receipt' } })
		fireEvent.click(screen.getByRole('button', { name: 'Submit mail search' }))
		expect(onSubmit).toHaveBeenLastCalledWith('receipt')
	})

	it('opens discoverable templates without adding another input', () => {
		render(<ControlledSearch onSubmit={vi.fn()} />)
		expect(screen.queryByRole('listbox')).toBeNull()

		fireEvent.click(screen.getByRole('button', { name: 'Show advanced search help' }))
		expect(screen.getByRole('listbox', { name: 'Advanced search suggestions' })).toBeInTheDocument()
		expect(screen.getByText('Exact phrase')).toBeInTheDocument()
		fireEvent.click(screen.getByRole('option', { name: /Exact phrase/ }))
		expect(input().value).toBe('""')
	})

	it('uses arrows and Enter to apply a prediction, then Enter again to search', () => {
		const onSubmit = vi.fn()
		render(<ControlledSearch onSubmit={onSubmit} />)
		fireEvent.change(input(), { target: { value: 'invoice o' } })

		fireEvent.keyDown(input(), { key: 'ArrowDown' })
		expect(input()).toHaveAttribute('aria-activedescendant')
		fireEvent.keyDown(input(), { key: 'Enter' })
		expect(input().value).toBe('invoice OR ')
		expect(onSubmit).not.toHaveBeenCalled()

		fireEvent.change(input(), { target: { value: 'invoice OR receipt' } })
		fireEvent.keyDown(input(), { key: 'Enter' })
		expect(onSubmit).toHaveBeenCalledWith('invoice OR receipt')
	})

	it('supports reverse keyboard navigation, dismissal, and pointer selection', () => {
		render(<ControlledSearch onSubmit={vi.fn()} />)
		fireEvent.change(input(), { target: { value: 'invoice' } })
		fireEvent.focus(input())

		fireEvent.keyDown(input(), { key: 'ArrowUp' })
		const options = screen.getAllByRole('option')
		expect(options.at(-1)).toHaveAttribute('aria-selected', 'true')
		fireEvent.keyDown(input(), { key: 'ArrowUp' })
		expect(options.at(-2)).toHaveAttribute('aria-selected', 'true')

		fireEvent.click(input())
		expect(input()).not.toHaveAttribute('aria-activedescendant')
		fireEvent.mouseDown(options[0] as HTMLElement)
		fireEvent.mouseEnter(options[1] as HTMLElement)
		expect(options[1]).toHaveAttribute('aria-selected', 'true')
		fireEvent.keyDown(options[1] as HTMLElement, { key: 'Tab' })
		fireEvent.keyDown(options[1] as HTMLElement, { key: 'Enter' })
		expect(input().value).toBe('invoice -')

		fireEvent.change(input(), { target: { value: 'invoice' } })
		fireEvent.focus(input())
		fireEvent.keyDown(input(), { key: 'Escape' })
		expect(screen.queryByRole('listbox')).toBeNull()
		fireEvent.keyDown(input(), { key: 'Escape' })
	})

	it('keeps the panel for internal focus changes and validates on leaving the form', () => {
		render(<ControlledSearch onSubmit={vi.fn()} />)
		fireEvent.change(input(), { target: { value: 'invoice :' } })
		const form = input().closest('form')
		if (!form) throw new Error('Expected the search form')

		fireEvent.blur(form, { relatedTarget: input() })
		expect(input()).not.toHaveAttribute('aria-invalid')
		fireEvent.blur(form, { relatedTarget: null })
		expect(input()).toHaveAttribute('aria-invalid', 'true')

		fireEvent.change(input(), { target: { value: '' } })
		fireEvent.blur(form, { relatedTarget: null })
	})

	it('toggles advanced help and applies a suggestion with Space', async () => {
		render(<ControlledSearch onSubmit={vi.fn()} />)
		const help = screen.getByRole('button', { name: 'Show advanced search help' })
		fireEvent.click(help)
		const phrase = screen.getByRole('option', { name: /Exact phrase/ })
		fireEvent.keyDown(phrase, { key: ' ' })
		expect(input().value).toBe('""')

		fireEvent.click(screen.getByRole('button', { name: 'Clear search' }))
		await waitFor(() => expect(screen.getByRole('button', { name: 'Submit mail search' })).toBeEnabled())
		fireEvent.click(help)
		expect(screen.getByRole('listbox')).toBeInTheDocument()
		fireEvent.click(help)
		expect(screen.queryByRole('listbox')).toBeNull()
	})

	it('blocks unsupported syntax with static, recoverable feedback', () => {
		const onSubmit = vi.fn()
		render(<ControlledSearch onSubmit={onSubmit} />)
		fireEvent.change(input(), { target: { value: 'from:billing@example.com' } })
		fireEvent.click(screen.getByRole('button', { name: 'Submit mail search' }))

		expect(onSubmit).not.toHaveBeenCalled()
		expect(input()).toHaveAttribute('aria-invalid', 'true')
		expect(screen.getByRole('alert')).toHaveTextContent("“:” isn't supported")
	})

	it('treats Clear as an explicit action and restores the blank value', () => {
		const onSubmit = vi.fn()
		render(<ControlledSearch onSubmit={onSubmit} />)
		fireEvent.change(input(), { target: { value: 'invoice' } })
		fireEvent.click(screen.getByRole('button', { name: 'Clear search' }))

		expect(input().value).toBe('')
		expect(onSubmit).toHaveBeenCalledWith('')
	})

	it('exposes loading, disabled, error, and success states without locking the input', async () => {
		const pending = deferred()
		const onSubmit = vi.fn(() => pending.promise)
		const view = render(<ControlledSearch onSubmit={onSubmit} />)
		fireEvent.change(input(), { target: { value: 'invoice' } })
		fireEvent.click(screen.getByRole('button', { name: 'Submit mail search' }))

		expect(screen.getByRole('button', { name: 'Searching mail' })).toBeDisabled()
		expect(input()).not.toBeDisabled()
		await act(async () => pending.resolve())

		view.rerender(
			<MailSearchBar value="invoice" activeQuery="invoice" onChange={vi.fn()} onSubmit={vi.fn()} />,
		)
		expect(screen.getByRole('button', { name: 'Submit mail search' })).toHaveAttribute(
			'data-state',
			'success',
		)

		const failed = deferred()
		view.rerender(
			<MailSearchBar value="receipt" onChange={vi.fn()} onSubmit={() => failed.promise as Promise<void>} />,
		)
		fireEvent.click(screen.getByRole('button', { name: 'Submit mail search' }))
		await act(async () => failed.reject(new Error('private provider detail')))
		expect(screen.getByRole('alert')).toHaveTextContent("Search couldn't start. Please try again.")
		expect(screen.queryByText('private provider detail')).toBeNull()
	})
})

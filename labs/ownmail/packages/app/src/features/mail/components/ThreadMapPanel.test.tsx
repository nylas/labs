// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { renderToString } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MapEntry, Person } from '../lib/thread-reading-model.js'
import type { MailMessage } from '../state/mail-queries.js'
import {
	mapDateLabel,
	mapEntryMatches,
	type ThreadMapFilter,
	ThreadMapPanel,
	threadMapNamesYou,
} from './ThreadMapPanel.js'

afterEach(() => {
	cleanup()
	vi.unstubAllGlobals()
	Reflect.deleteProperty(window, 'matchMedia')
})

const DAY = 86_400
/** Thursday 15 October 2026, 12:00 UTC. */
const NOW = 1_792_065_600
const OWNER = 'ada@ownmail.com'
const GRACE: Person = { name: 'Grace Hopper', email: 'grace@vercel.com', isOwner: false }
const ALAN: Person = { name: 'Alan Turing', email: 'alan@bletchley.dev', isOwner: false }
const MARY: Person = { name: 'Mary Jackson', email: 'mjackson@vercel.com', isOwner: false }
const ADA: Person = { name: 'Ada Lovelace', email: OWNER, isOwner: true }

const now = () => Math.floor(Date.now() / 1000)
const entry = (id: string, from: Person, daysAgo: number, extra: Partial<MapEntry> = {}): MapEntry => ({
	messageId: id,
	from,
	date: now() - daysAgo * DAY,
	chips: [],
	unread: false,
	...extra,
})

/** Board 04's map in miniature: history with files, a subject change, then three new messages. */
const ENTRIES: MapEntry[] = [
	entry('m1', GRACE, 20, { chips: ['v1'] }),
	entry('m2', ADA, 19, { chips: ['docx'] }),
	entry('m3', ALAN, 17, { event: 'Subject changed: “Q3 roadmap” → “… final review before Friday”' }),
	entry('m4', GRACE, 10, { chips: ['v2'] }),
	entry('m5', ALAN, 1, { unread: true }),
	entry('m6', GRACE, 0, { chips: ['v4', '+ Mary'], unread: true }),
	entry('m7', MARY, 0, { chips: ['asks you'], unread: true }),
]

/** Pretends the window is at least `xl` wide (or narrower), with a way to change it. */
function stubWidth(docked: boolean) {
	const listeners = new Set<() => void>()
	const media = {
		matches: docked,
		addEventListener: (_: string, listener: () => void) => listeners.add(listener),
		removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
	}
	Object.defineProperty(window, 'matchMedia', { configurable: true, value: vi.fn(() => media) })
	return {
		resize(next: boolean) {
			media.matches = next
			for (const listener of listeners) listener()
		},
	}
}

function Harness({
	initialFilter = 'all' as ThreadMapFilter,
	onSelect = vi.fn(),
	onClose = vi.fn(),
	open = true,
	entries = ENTRIES,
	namesYouIds,
	stoppedBeforeIndex = 4 as number | null,
}: {
	initialFilter?: ThreadMapFilter
	onSelect?: (id: string) => void
	onClose?: () => void
	open?: boolean
	entries?: MapEntry[]
	namesYouIds?: string[]
	stoppedBeforeIndex?: number | null
}) {
	const [filter, setFilter] = useState<ThreadMapFilter>(initialFilter)
	return (
		<div>
			<ThreadMapPanel
				entries={entries}
				stoppedBeforeIndex={stoppedBeforeIndex}
				filter={filter}
				onFilter={setFilter}
				selectedId="m5"
				onSelect={onSelect}
				onClose={onClose}
				open={open}
				namesYouIds={namesYouIds}
			/>
			<button type="button">Outside</button>
		</div>
	)
}

const rowNames = () =>
	screen
		.getAllByRole('button')
		.filter((button) => button.hasAttribute('data-map-row'))
		.map((row) => row.dataset.messageId)

describe('mapDateLabel', () => {
	it('sets today as a time, this week as a weekday and older days as a date', () => {
		expect(mapDateLabel(NOW - 2.5 * 3600, NOW, 'UTC')).toBe('9:30')
		expect(mapDateLabel(NOW + 4 * 3600, NOW, 'UTC')).toBe('4:00')
		expect(mapDateLabel(NOW - DAY, NOW, 'UTC')).toBe('Wed')
		expect(mapDateLabel(NOW - 3 * DAY, NOW, 'UTC')).toBe('Mon')
		expect(mapDateLabel(NOW - 17 * DAY, NOW, 'UTC')).toBe('Sep 28')
		expect(mapDateLabel(0, NOW, 'UTC')).toBe('')
	})

	it('falls back to UTC for a zone it does not know', () => {
		expect(mapDateLabel(NOW - 2.5 * 3600, NOW, 'Not/AZone')).toBe('9:30')
		expect(mapDateLabel(NOW - DAY, NOW, 'Not/AZone')).toBe('Wed')
		// Formatters are kept per zone.
		expect(mapDateLabel(NOW - 2.5 * 3600, NOW, 'Not/AZone')).toBe('9:30')
	})
})

describe('mapEntryMatches', () => {
	const [m1, m2, m3, , , m6, m7] = ENTRIES as [
		MapEntry,
		MapEntry,
		MapEntry,
		MapEntry,
		MapEntry,
		MapEntry,
		MapEntry,
	]
	it('keeps every row, the rows with files, the rows naming you, or one sender', () => {
		expect(mapEntryMatches(m3, 'all')).toBe(true)
		expect(mapEntryMatches(m1, 'files')).toBe(true)
		expect(mapEntryMatches(m3, 'files')).toBe(false)
		expect(mapEntryMatches(entry('x', GRACE, 0, { chips: ['+ Mary', '− Alan', 'asks you'] }), 'files')).toBe(
			false,
		)
		expect(mapEntryMatches(m6, 'files')).toBe(true)
		expect(mapEntryMatches(m7, 'you')).toBe(true)
		expect(mapEntryMatches(m1, 'you')).toBe(false)
		expect(mapEntryMatches(m1, 'you', new Set(['m1']))).toBe(true)
		expect(mapEntryMatches(m2, { from: ' ADA@ownmail.com ' })).toBe(true)
		expect(mapEntryMatches(m1, { from: OWNER })).toBe(false)
	})
})

describe('threadMapNamesYou', () => {
	const message = (id: string, from: { name: string; email: string }, body: string): MailMessage => ({
		id,
		from: [from],
		to: [ADA],
		body,
	})
	it('keeps other people’s messages that name the reader or ask the reader something', () => {
		const messages = [
			message('names', GRACE, 'Thanks Ada, that settles it.'),
			message('address', ALAN, 'I copied ada@ownmail.com on the doc.'),
			message('asks', MARY, 'Billing can make Q3. Can you confirm the date with legal?'),
			message('none', GRACE, 'Adam will send the numbers.'),
			message('own', ADA, 'Ada here, signing off.'),
		]
		expect(threadMapNamesYou(messages, OWNER, 'Ada')).toEqual(['names', 'address', 'asks'])
		expect(threadMapNamesYou([message('x', GRACE, 'Plain note.')], '', '')).toEqual([])
	})
})

describe('ThreadMapPanel as a sheet below xl', () => {
	it('lays out board 04: count, filters, rows, the subject change, the stopped rule and the footnote', async () => {
		render(<Harness />)
		const dialog = await screen.findByRole('dialog', { name: 'Thread map' })
		expect(within(dialog).getByText('7 messages')).toHaveClass('font-data')
		const filters = within(dialog).getByRole('group', { name: 'Filter' })
		expect(
			within(filters)
				.getAllByRole('button')
				.map((button) => button.textContent),
		).toEqual(['All', 'With files', 'Names you', 'From…'])
		expect(within(filters).getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true')
		expect(rowNames()).toEqual(['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7'])

		const rows = Array.from(dialog.querySelectorAll('[data-map-row], [data-slot="thread-map-stopped"], p'))
		const texts = rows.map((row) => row.textContent)
		expect(texts.indexOf('Subject changed: “Q3 roadmap” → “… final review before Friday”')).toBe(
			texts.findIndex((text) => text?.startsWith('Alan Turing')) - 1,
		)
		expect(texts[texts.indexOf('You stopped here') + 1]).toMatch(/^Alan Turing, new/)

		const selected = within(dialog).getByRole('button', { current: true })
		expect(selected).toHaveAttribute('data-message-id', 'm5')
		expect(selected).toHaveClass('bg-row-selected', 'font-semibold')
		// The current row is where focus starts.
		expect(selected).toHaveFocus()
		expect(selected.querySelector('time')).toHaveClass('text-cta-icon')
		expect(selected.querySelector('span[aria-hidden]')).toHaveClass('bg-person-dot-250', 'ring-3')

		const youRow = dialog.querySelector('[data-message-id="m2"]') as HTMLElement
		expect(youRow.textContent).toMatch(/^Youdocx/)
		expect(youRow.querySelector('span[aria-hidden]')).toHaveClass('bg-person-dot-158')
		expect(youRow.querySelector('time')).toHaveClass('text-muted-foreground')
		expect(
			within(dialog.querySelector('[data-message-id="m7"]') as HTMLElement).getByText('asks you'),
		).toHaveClass('bg-amber-soft')
		expect(
			within(dialog.querySelector('[data-message-id="m6"]') as HTMLElement).getByText('+ Mary'),
		).toHaveClass('bg-muted')
		expect(dialog).toHaveTextContent(
			'Opens from the dots beside the reader, or with g m. Clicking a row scrolls to it and opens it.',
		)
		expect(within(dialog).getByText('g m').tagName).toBe('KBD')
	})

	it('opens a row, closes from the button, and closes when the sheet is dismissed', async () => {
		const onSelect = vi.fn()
		const onClose = vi.fn()
		render(<Harness onSelect={onSelect} onClose={onClose} />)
		await userEvent.click(screen.getByRole('button', { name: /^Mary Jackson/ }))
		expect(onSelect).toHaveBeenCalledWith('m7')
		await userEvent.click(screen.getByRole('button', { name: 'Close thread map' }))
		expect(onClose).toHaveBeenCalledTimes(1)
		fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
		expect(onClose).toHaveBeenCalledTimes(2)
	})

	it('filters to files, to the rows naming you, and back to all', async () => {
		render(<Harness namesYouIds={['m4']} />)
		await userEvent.click(screen.getByRole('button', { name: 'With files' }))
		expect(screen.getByRole('button', { name: 'With files' })).toHaveAttribute('aria-pressed', 'true')
		expect(rowNames()).toEqual(['m1', 'm2', 'm4', 'm6'])
		// Subject changes belong to the full map only.
		expect(screen.queryByText(/^Subject changed/)).toBeNull()
		expect(screen.getByText('You stopped here')).toBeInTheDocument()

		await userEvent.click(screen.getByRole('button', { name: 'Names you' }))
		expect(rowNames()).toEqual(['m4', 'm7'])

		await userEvent.click(screen.getByRole('button', { name: 'All' }))
		expect(rowNames()).toHaveLength(7)
	})

	it('drops the stopped rule when the filtered rows are all on one side of it', async () => {
		render(<Harness />)
		await userEvent.click(screen.getByRole('button', { name: 'Names you' }))
		expect(rowNames()).toEqual(['m7'])
		expect(screen.queryByText('You stopped here')).toBeNull()
	})

	it('has no stopped rule when nothing was new, and says when no row matches', async () => {
		render(<Harness stoppedBeforeIndex={null} entries={[{ ...(ENTRIES[0] as MapEntry), date: 0 }]} />)
		expect(screen.queryByText('You stopped here')).toBeNull()
		expect(screen.getByText('1 message')).toBeInTheDocument()
		// A message with no date has an empty date column, not 1970.
		const time = document.querySelector('time') as HTMLElement
		expect(time).toBeEmptyDOMElement()
		expect(time).not.toHaveAttribute('datetime')
		await userEvent.click(screen.getByRole('button', { name: 'Names you' }))
		expect(screen.getByText('No messages match.')).toBeInTheDocument()
	})

	it('picks one sender from the From… menu', async () => {
		render(<Harness />)
		const from = screen.getByRole('button', { name: 'From…' })
		expect(from).toHaveAttribute('aria-pressed', 'false')
		await userEvent.click(from)
		const menu = screen.getByRole('menu', { name: 'Messages from' })
		// The sheet is solid, so the menu over it is panel glass.
		expect(menu).toHaveClass('glass-panel')
		expect(menu).not.toHaveAttribute('data-glass')
		expect(from).toHaveAttribute('aria-controls', menu.id)
		const items = within(menu).getAllByRole('menuitemradio')
		expect(items.map((item) => item.textContent)).toEqual([
			'Grace Hopper',
			'You',
			'Alan Turing',
			'Mary Jackson',
		])
		expect(items[0]).toHaveFocus()

		await userEvent.click(items[0] as HTMLElement)
		expect(screen.queryByRole('menu')).toBeNull()
		const active = screen.getByRole('button', { name: 'From Grace' })
		expect(active).toHaveAttribute('aria-pressed', 'true')
		expect(active).toHaveFocus()
		expect(rowNames()).toEqual(['m1', 'm4', 'm6'])

		// Reopened, the current sender is checked and focused.
		await userEvent.click(active)
		const checked = screen.getByRole('menuitemradio', { name: 'Grace Hopper' })
		expect(checked).toHaveAttribute('aria-checked', 'true')
		expect(checked).toHaveFocus()
		await userEvent.click(screen.getByRole('menuitemradio', { name: 'You' }))
		expect(screen.getByRole('button', { name: 'From you' })).toBeInTheDocument()
		expect(rowNames()).toEqual(['m2'])
	})

	it('moves through the From… menu with the keyboard and closes it with Escape or by leaving', async () => {
		render(<Harness initialFilter={{ from: 'nobody@else.dev' }} />)
		// A sender who is not on the map leaves the menu label as it was.
		const from = screen.getByRole('button', { name: 'From…' })
		expect(from).toHaveAttribute('aria-pressed', 'true')
		await userEvent.click(from)
		const menu = screen.getByRole('menu')
		const item = (name: string) => screen.getByRole('menuitemradio', { name })
		expect(item('Grace Hopper')).toHaveFocus()
		fireEvent.keyDown(menu, { key: 'ArrowDown' })
		expect(item('You')).toHaveFocus()
		fireEvent.keyDown(menu, { key: 'End' })
		expect(item('Mary Jackson')).toHaveFocus()
		fireEvent.keyDown(menu, { key: 'ArrowDown' })
		expect(item('Mary Jackson')).toHaveFocus()
		fireEvent.keyDown(menu, { key: 'ArrowUp' })
		expect(item('Alan Turing')).toHaveFocus()
		fireEvent.keyDown(menu, { key: 'Home' })
		expect(item('Grace Hopper')).toHaveFocus()
		fireEvent.keyDown(menu, { key: 'ArrowUp' })
		expect(item('Grace Hopper')).toHaveFocus()
		fireEvent.keyDown(menu, { key: 'x' })
		fireEvent.keyDown(menu, { key: 'Escape' })
		expect(screen.queryByRole('menu')).toBeNull()
		expect(from).toHaveFocus()

		await userEvent.click(from)
		fireEvent.pointerDown(item('You'))
		expect(screen.getByRole('menu')).toBeInTheDocument()
		fireEvent.pointerDown(screen.getByRole('button', { name: 'With files' }))
		expect(screen.queryByRole('menu')).toBeNull()
	})

	it('moves between rows with the arrow keys', () => {
		render(<Harness />)
		const list = screen.getByRole('button', { current: true }).parentElement as HTMLElement
		const row = (id: string) => list.querySelector(`[data-message-id="${id}"]`) as HTMLElement
		fireEvent.keyDown(list, { key: 'ArrowDown' })
		expect(row('m6')).toHaveFocus()
		fireEvent.keyDown(list, { key: 'Home' })
		expect(row('m1')).toHaveFocus()
		fireEvent.keyDown(list, { key: 'End' })
		expect(row('m7')).toHaveFocus()
		fireEvent.keyDown(list, { key: 'ArrowUp' })
		expect(row('m6')).toHaveFocus()
	})

	it('ignores arrow keys where there are no rows', async () => {
		render(<Harness stoppedBeforeIndex={null} entries={ENTRIES.slice(0, 1)} />)
		await userEvent.click(screen.getByRole('button', { name: 'Names you' }))
		const empty = screen.getByText('No messages match.').parentElement as HTMLElement
		const event = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })
		empty.dispatchEvent(event)
		expect(event.defaultPrevented).toBe(false)
	})

	it('focuses the first row when no row is current', async () => {
		function NoSelection() {
			return (
				<ThreadMapPanel
					entries={ENTRIES}
					stoppedBeforeIndex={4}
					filter="all"
					onFilter={vi.fn()}
					onSelect={vi.fn()}
					onClose={vi.fn()}
					open
				/>
			)
		}
		render(<NoSelection />)
		expect(await screen.findByRole('dialog')).toBeInTheDocument()
		expect(screen.getAllByRole('button').find((button) => button.dataset.messageId === 'm1')).toHaveFocus()
	})

	it('renders nothing while closed', () => {
		render(<Harness open={false} />)
		expect(screen.queryByRole('dialog')).toBeNull()
	})
})

describe('ThreadMapPanel docked from xl', () => {
	it('is panel glass beside the reader, with the current row focused', () => {
		stubWidth(true)
		render(<Harness />)
		const panel = screen.getByRole('complementary', { name: 'Thread map' })
		expect(panel).toHaveClass('glass-panel', 'absolute', 'w-[380px]')
		expect(screen.queryByRole('dialog')).toBeNull()
		expect(screen.getByRole('button', { current: true })).toHaveFocus()
		expect(within(panel).getByRole('heading', { level: 2, name: 'Thread map' })).toBeInTheDocument()
	})

	it('closes with Escape unless something inside handled it first', async () => {
		stubWidth(true)
		const onClose = vi.fn()
		render(<Harness onClose={onClose} />)
		await userEvent.click(screen.getByRole('button', { name: 'From…' }))
		// Glass never sits on glass: the menu over the docked panel is solid.
		expect(screen.getByRole('menu')).toHaveAttribute('data-glass', 'solid')
		fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
		expect(onClose).not.toHaveBeenCalled()
		fireEvent.keyDown(screen.getByRole('complementary'), { key: 'Enter' })
		expect(onClose).not.toHaveBeenCalled()
		fireEvent.keyDown(screen.getByRole('complementary'), { key: 'Escape' })
		expect(onClose).toHaveBeenCalledOnce()
	})

	it('renders nothing while closed and follows the window across the breakpoint', async () => {
		const width = stubWidth(true)
		const { rerender } = render(<Harness open={false} />)
		expect(screen.queryByRole('complementary')).toBeNull()
		rerender(<Harness open />)
		expect(screen.getByRole('complementary')).toBeInTheDocument()
		act(() => width.resize(false))
		expect(screen.queryByRole('complementary')).toBeNull()
		expect(await screen.findByRole('dialog', { name: 'Thread map' })).toBeInTheDocument()
	})

	it('renders as the sheet on the server, where the width is unknown', () => {
		const html = renderToString(<Harness open={false} />)
		expect(html).not.toContain('Thread map')
	})
})

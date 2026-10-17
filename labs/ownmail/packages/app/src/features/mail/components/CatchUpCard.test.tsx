// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CatchUpFacts, Person } from '../lib/thread-reading-model.js'
import type { MailMessage } from '../state/mail-queries.js'
import { CatchUpCard } from './CatchUpCard.js'
import { ThreadSummaryProvider, type ThreadSummarySource } from './thread-summary.js'

afterEach(cleanup)

const MARY: Person = { name: 'Mary Jackson', email: 'mjackson@vercel.com', isOwner: false }
const NEW: MailMessage[] = [{ id: 'msg-12' }, { id: 'msg-13' }, { id: 'msg-14' }]
const BULLETS = [
	'Alan asked for two changes: a firm date for calendar sync and search moved down.',
	'Grace made both in v4 and added Mary for launch dates.',
	'Open: Mary asks you to confirm legal sign-off by Oct 20.',
]

const boardFacts: CatchUpFacts = {
	newCount: 3,
	joined: [MARY],
	replacedFiles: [{ file: 'Q3-roadmap-v4.pdf', replaces: 'v3' }],
	questionsToYou: [{ messageId: 'msg-14', from: MARY }],
}

function renderCard({
	facts = boardFacts,
	sinceLabel = 'Tuesday',
	summaryMessages = NEW,
	provider = { summarize: async () => BULLETS },
}: {
	facts?: CatchUpFacts
	sinceLabel?: string
	summaryMessages?: MailMessage[]
	provider?: ThreadSummarySource | null
} = {}) {
	const handlers = { onJumpToFirstNew: vi.fn(), onAnswer: vi.fn(), onShowSources: vi.fn() }
	render(
		<ThreadSummaryProvider provider={provider}>
			<CatchUpCard facts={facts} sinceLabel={sinceLabel} summaryMessages={summaryMessages} {...handlers} />
		</ThreadSummaryProvider>,
	)
	return handlers
}

const factTexts = () =>
	within(screen.getByRole('list', { name: 'What changed' }))
		.getAllByRole('listitem')
		.map((item) => item.textContent)

describe('CatchUpCard', () => {
	it('states the board 04 facts in order, the question on the amber ground', async () => {
		renderCard()
		expect(
			screen.getByRole('heading', { level: 2, name: 'Since you last read, Tuesday' }),
		).toBeInTheDocument()
		expect(factTexts()).toEqual([
			'3 new messages',
			'Mary Jackson joined',
			'Q3-roadmap-v4.pdf replaces v3',
			'1 question to you',
		])
		const items = within(screen.getByRole('list', { name: 'What changed' })).getAllByRole('listitem')
		expect(items[0]).toHaveClass('font-data', 'tabular-nums', 'bg-muted')
		expect(items[3]).toHaveClass('bg-amber-soft', 'text-amber-soft-foreground')
		expect(await screen.findByText(BULLETS[0] as string)).toBeInTheDocument()
	})

	it('jumps to the first new message', async () => {
		const { onJumpToFirstNew } = renderCard()
		await userEvent.click(screen.getByRole('button', { name: 'Jump to first new' }))
		expect(onJumpToFirstNew).toHaveBeenCalledOnce()
	})

	it('shows the summary from the provider with Answer and Show sources', async () => {
		const { onAnswer, onShowSources } = renderCard()
		const list = await screen.findByText(BULLETS[2] as string)
		expect(list.closest('ul')?.querySelectorAll('li')).toHaveLength(3)
		expect(screen.getByText('Summary')).toBeInTheDocument()
		expect(screen.getByText('· from the 3 new messages')).toBeInTheDocument()

		await userEvent.click(screen.getByRole('button', { name: 'Answer Mary' }))
		expect(onAnswer).toHaveBeenCalledWith('msg-14')

		const sources = screen.getByRole('button', { name: 'Show sources' })
		expect(sources).toHaveAttribute('aria-pressed', 'false')
		await userEvent.click(sources)
		expect(sources).toHaveAttribute('aria-pressed', 'true')
		expect(onShowSources).toHaveBeenLastCalledWith(['msg-12', 'msg-13', 'msg-14'])
		await userEvent.click(sources)
		expect(sources).toHaveAttribute('aria-pressed', 'false')
		expect(onShowSources).toHaveBeenLastCalledWith([])
	})

	it('leaves the summary block out when no provider answers', async () => {
		renderCard({ provider: null })
		await Promise.resolve()
		expect(screen.queryByText('Summary')).toBeNull()
		expect(screen.queryByRole('separator')).toBeNull()
		expect(screen.queryByRole('button', { name: /^Answer/ })).toBeNull()
		expect(screen.queryByRole('button', { name: 'Show sources' })).toBeNull()
		// The facts never depend on it.
		expect(factTexts()).toHaveLength(4)
	})

	it('counts in the singular, names many joiners briefly and drops facts that did not happen', async () => {
		const person = (name: string): Person => ({ name, email: `${name.toLowerCase()}@x.dev`, isOwner: false })
		renderCard({
			facts: {
				newCount: 1,
				joined: [person('Ana'), person('Ben'), person('Cy'), person('Dee')],
				replacedFiles: [],
				questionsToYou: [],
			},
			sinceLabel: '  ',
			summaryMessages: [{ id: 'only' }],
		})
		expect(screen.getByRole('heading', { level: 2, name: 'Since you last read' })).toBeInTheDocument()
		expect(factTexts()).toEqual([
			'1 new message',
			'Ana joined',
			'Ben joined',
			'Cy joined',
			'1 more person joined',
		])
		expect(await screen.findByText('· from the new message')).toBeInTheDocument()
		// Nothing asks the reader anything, so there is no one to answer.
		expect(screen.queryByRole('button', { name: /^Answer/ })).toBeNull()
		expect(screen.getByRole('button', { name: 'Show sources' })).toBeInTheDocument()
	})

	it('counts several questions and several more joiners in the plural', () => {
		const person = (name: string): Person => ({ name, email: `${name.toLowerCase()}@x.dev`, isOwner: false })
		renderCard({
			facts: {
				newCount: 5,
				// A joiner the provider gave no address still gets a fact of their own.
				joined: [{ name: 'Nameless', email: '', isOwner: false }, ...['Ben', 'Cy', 'Dee', 'Eve'].map(person)],
				replacedFiles: [],
				questionsToYou: [
					{ messageId: 'a', from: person('Ana') },
					{ messageId: 'b', from: person('Ben') },
				],
			},
			provider: null,
		})
		expect(factTexts()).toContain('Nameless joined')
		expect(factTexts()).toContain('2 more people joined')
		expect(factTexts()).toContain('2 questions to you')
	})
})

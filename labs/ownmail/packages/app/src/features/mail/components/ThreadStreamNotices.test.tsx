// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetAccountScope, setAccountScope } from '#app/lib/account-scope'
import { type MailMessage, type MailThread, mailKeys } from '../state/mail-queries.js'

const { getThreads } = vi.hoisted(() => ({ getThreads: vi.fn() }))
vi.mock('#server/fns', () => ({ getThreads: (...args: unknown[]) => getThreads(...args) }))
vi.mock('@tanstack/react-router', () => ({
	Link: ({
		to,
		params,
		children,
		className,
	}: {
		to: string
		params: Record<string, string>
		children: ReactNode
		className?: string
	}) => (
		<a
			href={to
				.replace('$folderId', params.folderId as string)
				.replace('$threadId', params.threadId as string)}
			className={className}
		>
			{children}
		</a>
	),
}))

const { ThreadStreamNotices, findSideThread, sideThreadKey, sideThreadText, subjectSearch } = await import(
	'./ThreadStreamNotices.js'
)

const OWNER = 'ada@ownmail.com'
const ADA = { name: 'Ada Lovelace', email: OWNER }
const ALAN = { name: 'Alan Turing', email: 'alan@x.com' }
const GRACE = { name: 'Grace Hopper', email: 'grace@x.com' }
const KATHERINE = { name: 'Katherine Johnson', email: 'katherine@x.com' }
const MARY = { name: 'Mary Jackson', email: 'mary@x.com' }

const thread = {
	id: 't1',
	subject: 'Offsite venue shortlist',
	earliest_message_date: 100,
	folders: ['inbox'],
} as MailThread
const messages = [
	{ id: 'm1', subject: 'Offsite venue shortlist', from: [KATHERINE], to: [ADA, ALAN, GRACE], date: 100 },
] as MailMessage[]
const side = {
	id: 't2',
	subject: 'Re: Offsite venue shortlist',
	earliest_message_date: 200,
	participants: [ALAN, GRACE, ADA],
	folders: ['inbox'],
} as MailThread

function renderNotices(
	props: Partial<Parameters<typeof ThreadStreamNotices>[0]> = {},
	queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } }),
) {
	return render(
		<QueryClientProvider client={queryClient}>
			<ThreadStreamNotices
				trashed={[]}
				showTrashed={false}
				onToggleTrashed={() => {}}
				thread={thread}
				messages={messages}
				owner={OWNER}
				{...props}
			/>
		</QueryClientProvider>,
	)
}

beforeEach(() => {
	setAccountScope(OWNER)
	getThreads.mockReset().mockResolvedValue({ threads: [] })
})

afterEach(() => {
	cleanup()
	resetAccountScope()
})

describe('ThreadStreamNotices', () => {
	it('renders nothing when nothing is elsewhere', async () => {
		const { container } = renderNotices()
		await waitFor(() => expect(getThreads).toHaveBeenCalledWith({ data: { q: 'Offsite venue shortlist' } }))
		expect(container).toBeEmptyDOMElement()
	})

	it('says how many messages are in Trash and toggles them', async () => {
		const onToggleTrashed = vi.fn()
		const view = renderNotices({ trashed: [messages[0] as MailMessage], onToggleTrashed })
		expect(screen.getByRole('note')).toHaveTextContent('1 message is in TrashShow')
		await userEvent.click(screen.getByRole('button', { name: 'Show' }))
		expect(onToggleTrashed).toHaveBeenCalledOnce()
		view.unmount()
		renderNotices({ trashed: messages.concat(messages), showTrashed: true })
		expect(screen.getByRole('note')).toHaveTextContent('2 messages are in Trash')
		expect(screen.getByRole('button', { name: 'Hide' })).toHaveAttribute('aria-expanded', 'true')
	})

	it('finds a side thread and links to it', async () => {
		getThreads.mockResolvedValue({ threads: [side] })
		renderNotices()
		const link = await screen.findByRole('link', { name: 'Open' })
		expect(link).toHaveAttribute('href', '/mail/f/inbox/t/t2')
		expect(screen.getByText('Alan started a side thread with Grace')).toBeInTheDocument()
	})

	it('keeps looking while mail writes cancel and refetch everything under the mail root', async () => {
		let answer: (value: { threads: MailThread[] }) => void = () => {}
		getThreads.mockImplementation(() => new Promise((resolve) => (answer = resolve)))
		const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
		renderNotices({}, queryClient)
		await waitFor(() => expect(getThreads).toHaveBeenCalledOnce())
		// What mail-cache does when the thread is marked read as it opens.
		await queryClient.cancelQueries({ queryKey: mailKeys.all })
		await queryClient.invalidateQueries({ queryKey: mailKeys.all, refetchType: 'active' })
		answer({ threads: [side] })
		expect(await screen.findByRole('link', { name: 'Open' })).toBeInTheDocument()
		expect(getThreads).toHaveBeenCalledOnce()
		expect(sideThreadKey('t1', 'Offsite venue shortlist')).toEqual([
			'mail-side-thread',
			OWNER,
			't1',
			'Offsite venue shortlist',
		])
	})

	it('does not look up a thread with no subject or no messages', () => {
		renderNotices({ thread: { ...thread, subject: '' }, messages: [] })
		renderNotices({ thread: { ...thread, subject: undefined }, messages: [] })
		renderNotices({ thread: { ...thread, subject: undefined }, messages: [{ id: 'x' } as MailMessage] })
		renderNotices({ messages: [] })
		expect(getThreads).not.toHaveBeenCalled()
	})
})

describe('findSideThread', () => {
	it('takes a later thread with the same subject and a strict subset of the people', () => {
		expect(findSideThread(thread, messages, [thread, side])).toBe(side)
		// A message without recipients adds nobody.
		expect(findSideThread(thread, [...messages, { id: 'bare', date: 150 } as MailMessage], [side])).toBe(side)
	})

	it('rejects other subjects, earlier threads, the same people, unknown people and empty lists', () => {
		const candidates = [
			{ ...side, subject: 'Other' },
			{ ...side, earliest_message_date: 50 },
			{ ...side, earliest_message_date: undefined },
			{ ...side, participants: [KATHERINE, ADA, ALAN, GRACE] },
			{ ...side, participants: [ALAN, MARY] },
			{ ...side, participants: undefined },
			{ ...side, participants: [{ email: '' }] },
		] as MailThread[]
		expect(findSideThread(thread, messages, candidates)).toBeNull()
	})

	it('uses the first message’s subject and date when the thread has none, and needs a subject', () => {
		const bare = { id: 't1' } as MailThread
		expect(findSideThread(bare, messages, [side])).toBe(side)
		expect(
			findSideThread(
				bare,
				[{ ...(messages[0] as MailMessage), subject: undefined, date: undefined }],
				[side],
			),
		).toBeNull()
		const undated = {
			id: 'm',
			subject: 'Re: Offsite venue shortlist',
			from: [ALAN],
			to: [{ email: '' }],
			cc: [],
		}
		expect(findSideThread(bare, [...messages, undated] as MailMessage[], [side])).toBe(side)
		expect(findSideThread(bare, [undated] as MailMessage[], [side])).toBeNull()
	})
})

describe('sideThreadText', () => {
	it('names the starter and everyone else but you', () => {
		expect(sideThreadText(side, OWNER)).toBe('Alan started a side thread with Grace')
		expect(sideThreadText({ ...side, participants: [ADA, GRACE, MARY, ALAN] } as MailThread, OWNER)).toBe(
			'You started a side thread with Grace, Mary and Alan',
		)
		expect(sideThreadText({ ...side, participants: [ALAN, ADA] } as MailThread, OWNER)).toBe(
			'Alan started a side thread',
		)
		expect(sideThreadText({ ...side, participants: undefined } as MailThread, OWNER)).toBe(
			'Someone started a side thread',
		)
	})
})

describe('subjectSearch', () => {
	it('keeps only the words of a subject, without reply prefixes', () => {
		expect(subjectSearch('Re: Q3 "roadmap": final (review)!')).toBe('Q3 roadmap final review')
		expect(subjectSearch('Re: ???')).toBeNull()
		expect(subjectSearch(`${'word '.repeat(400)}`)).toBeNull()
	})
})

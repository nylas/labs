import { describe, expect, it } from 'vitest'
import type { MailMessage } from '../state/mail-queries.js'
import type { CleanBlock, MessageContent } from './clean-view.js'
import {
	buildConversation,
	type ConversationItem,
	GROUP_WINDOW_SECONDS,
	localDayKey,
	newContent,
	senderLabel,
} from './conversation-model.js'

const text = (value: string): CleanBlock => ({ type: 'paragraph', spans: [{ text: value }] })
const quote = (value: string): CleanBlock => ({ type: 'quote', blocks: [text(value)] })
const history = (...blocks: CleanBlock[]): CleanBlock => ({ type: 'history', blocks })

const INES = { name: 'Ines Carvalho', email: 'ines@example.com' }
const TOMAS = { name: 'Tomas Reyes', email: 'tomas@example.com' }
const SAM = { email: 'Sam@Example.com' }
const NOON = 1_790_596_800 // 2026-09-28T12:00:00Z, the same local day in every time zone a few minutes either side

function message(id: string, from: { name?: string; email: string } | undefined, date?: number): MailMessage {
	return { id, ...(from ? { from: [from] } : {}), to: [SAM], ...(date ? { date } : {}) }
}

function build(
	messages: MailMessage[],
	contents: Record<string, MessageContent> = {},
	originalIds: string[] = [],
	mailboxEmail: string | null = 'sam@example.com',
) {
	return buildConversation(messages, {
		mailboxEmail: mailboxEmail ?? undefined,
		contentFor: (item) =>
			contents[item.id] ?? { kind: 'blocks', blocks: [text(`body ${item.id}`)], hasRemoteImages: false },
		originalIds: new Set(originalIds),
	})
}

const kinds = (items: ConversationItem[]) =>
	items.map((item) =>
		item.kind === 'run' ? `run:${item.bubbles.map((bubble) => bubble.message.id)}` : item.kind,
	)

describe('newContent', () => {
	it('shows a message with no quoted history as written', () => {
		const blocks = [text('Hello'), quote('a pull quote the author chose')]
		expect(newContent(blocks)).toEqual({ blocks, unsure: false })
	})

	it('drops quoted history that trails the new text, because earlier bubbles already show it', () => {
		const blocks = [text('Sounds good.'), history(text('On Mon, Ines wrote:'), quote('Draft'))]
		expect(newContent(blocks)).toEqual({ blocks: [text('Sounds good.')], unsure: false })
	})

	it('keeps the whole message when hiding the history could hide something that mattered', () => {
		const cases: CleanBlock[][] = [
			// Nothing but a quote: there would be no bubble content left.
			[history(text('On Mon, Ines wrote:'), quote('Draft'))],
			// Text below the quote (bottom posting).
			[history(quote('Draft')), text('Room 4B is booked.')],
			// A forwarded message is the content itself.
			[
				text('FYI'),
				history(text('---------- Forwarded message ---------\nFrom: Desk'), text('Door code 482913')),
			],
			[text('FYI'), history(text('Begin forwarded message:'), quote('Door code 482913'))],
			// Answers typed between quoted lines.
			[text('Inline:'), history(text('On Mon, Tomas wrote:'), quote('Thursday?'), text('Yes.'))],
		]
		for (const blocks of cases) expect(newContent(blocks)).toEqual({ blocks, unsure: true })
	})
})

describe('buildConversation', () => {
	it('puts the signed-in address on the right and everyone else on the left', () => {
		const { items, group, participants } = build([
			message('a', INES, NOON),
			message('b', { email: 'SAM@example.com ' }, NOON + 3600),
		])
		expect(items.map((item) => (item.kind === 'run' ? [item.label, item.mine] : item.kind))).toEqual([
			'day',
			['Ines Carvalho', false],
			['SAM@example.com ', true],
		])
		// Two participants read as a direct chat: no names needed.
		expect(group).toBe(false)
		expect(participants).toBe('Ines and you')
	})

	it('treats three or more participants as a group, named in order of appearance', () => {
		const third: MailMessage = {
			...message('c', TOMAS, NOON + 7200),
			cc: [{ email: 'mara.lindqvist@example.com' }],
		}
		const conversation = build([message('a', INES, NOON), third])
		expect(conversation.group).toBe(true)
		expect(conversation.participants).toBe('Ines, Tomas, mara.lindqvist and you')
	})

	it('has no side for "me" when the signed-in address is unknown', () => {
		const conversation = build([message('a', SAM, NOON)], {}, [], null)
		expect(conversation.items.at(-1)).toMatchObject({ kind: 'run', mine: false })
		expect(conversation.participants).toBe('Sam')
	})

	it('names nobody when the thread carries no usable address', () => {
		const conversation = build([{ id: 'a', from: [{ email: ' ' }] }, { id: 'b' }])
		expect(conversation.participants).toBe('')
		expect(conversation.group).toBe(false)
	})

	it('merges consecutive emails from one sender within the window into one run', () => {
		const messages = [
			message('a', TOMAS, NOON),
			message('b', TOMAS, NOON + GROUP_WINDOW_SECONDS),
			message('c', TOMAS, NOON + 2 * GROUP_WINDOW_SECONDS + 1),
			message('d', INES, NOON + 2 * GROUP_WINDOW_SECONDS + 2),
			message('e', TOMAS, NOON + 2 * GROUP_WINDOW_SECONDS + 3),
		]
		expect(kinds(build(messages).items)).toEqual(['day', 'run:a,b', 'run:c', 'run:d', 'run:e'])
	})

	it('never merges messages it cannot place in time, or senders it cannot tell apart by address', () => {
		const undated = [message('a', TOMAS), message('b', TOMAS)]
		expect(kinds(build(undated).items)).toEqual(['run:a', 'run:b'])

		const half = [message('a', TOMAS, NOON), message('b', TOMAS)]
		expect(kinds(build(half).items)).toEqual(['day', 'run:a', 'run:b'])

		const unknown = [message('a', undefined, NOON), message('b', undefined, NOON + 1)]
		const conversation = build(unknown)
		expect(kinds(conversation.items)).toEqual(['day', 'run:a,b'])
		expect(conversation.items[1]).toMatchObject({ label: '(unknown sender)', mine: false })
	})

	it('breaks the transcript with a day separator, which also ends a run', () => {
		const dayOf = (epochSeconds: number) => (epochSeconds < NOON + 100 ? 'monday' : 'tuesday')
		const conversation = buildConversation(
			[message('a', TOMAS, NOON), message('b', TOMAS, NOON + 60), message('c', TOMAS, NOON + 120)],
			{
				contentFor: () => ({ kind: 'blocks', blocks: [text('x')], hasRemoteImages: false }),
				originalIds: new Set(),
				dayKey: dayOf,
			},
		)
		expect(kinds(conversation.items)).toEqual(['day', 'run:a,b', 'day', 'run:c'])
		expect(conversation.items[2]).toEqual({ kind: 'day', key: 'day:c', epochSeconds: NOON + 120 })
	})

	it('shows mail that keeps the standard reader as a card in the stream', () => {
		const conversation = build(
			[message('a', TOMAS, NOON), message('news', INES, NOON + 60), message('b', TOMAS, NOON + 120)],
			{ news: { kind: 'original' } },
		)
		expect(kinds(conversation.items)).toEqual(['day', 'run:a', 'card', 'run:b'])
		// Designed mail has no bubble form to go back to.
		expect(conversation.items[2]).toMatchObject({ kind: 'card', label: 'Ines Carvalho', restorable: false })
	})

	it('shows the original for a message the reader asked for, and can restore its bubble', () => {
		const conversation = build([message('a', TOMAS, NOON), message('b', TOMAS, NOON + 60)], {}, ['b'])
		expect(kinds(conversation.items)).toEqual(['day', 'run:a', 'card'])
		expect(conversation.items[2]).toMatchObject({ kind: 'card', key: 'b', restorable: true })
	})

	it('fills each bubble with only the newly written text', () => {
		const conversation = build([message('a', TOMAS, NOON)], {
			a: { kind: 'blocks', blocks: [text('New'), history(quote('Old'))], hasRemoteImages: false },
		})
		expect(conversation.items[1]).toMatchObject({ bubbles: [{ blocks: [text('New')], unsure: false }] })
	})
})

describe('helpers', () => {
	it('labels a sender by name, then address', () => {
		expect(senderLabel(message('a', INES))).toBe('Ines Carvalho')
		expect(senderLabel(message('a', { email: 'ines@example.com' }))).toBe('ines@example.com')
		expect(senderLabel(message('a', undefined))).toBe('(unknown sender)')
	})

	it('keys a day by the local calendar date', () => {
		const date = new Date(2026, 8, 28, 9, 12)
		expect(localDayKey(date.getTime() / 1000)).toBe('2026-9-28')
	})
})

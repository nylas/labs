import { describe, expect, it } from 'vitest'
import type { MailMessage } from '../state/mail-queries.js'
import type { CleanBlock, MessageContent } from './clean-view.js'
import {
	bubbleContent,
	buildConversation,
	type ConversationItem,
	GROUP_WINDOW_SECONDS,
	localDayKey,
	rememberBlocks,
	type ShownBlock,
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

describe('bubbleContent', () => {
	const EARLIER = 'Here is the first draft of the offsite agenda. Thursday afternoon is still open.'
	const shown = (): ShownBlock[] => {
		const memory: ShownBlock[] = []
		rememberBlocks(memory, [text(EARLIER), text('Also, the retro probably fits better on Friday.')], 'Ines')
		return memory
	}
	const attribution = text('On Mon, Sep 28, 2026 at 9:12 AM Ines Carvalho <ines@example.com> wrote:')
	const signature = (...blocks: CleanBlock[]): CleanBlock => ({ type: 'signature', blocks })

	it('shows a message with no quoted history as written', () => {
		const blocks = [text('Hello'), quote('a pull quote the author chose')]
		expect(bubbleContent(blocks)).toEqual({ blocks, unsure: false })
	})

	it('folds a trailing quote only when it repeats an earlier message', () => {
		const blocks = [text('Sounds good.'), history(attribution, quote(EARLIER))]
		expect(bubbleContent(blocks, shown())).toEqual({ blocks: [text('Sounds good.')], unsure: false })
		// The same quote with nothing earlier to match stays reachable in the bubble.
		expect(bubbleContent(blocks)).toEqual({ blocks, unsure: false })
		// So does a quote the sender edited beyond recognition.
		const edited = [
			text('Sounds good.'),
			history(attribution, quote('Here is a completely different sentence now.')),
		]
		expect(bubbleContent(edited, shown())).toEqual({ blocks: edited, unsure: false })
	})

	it('matches hard-wrapped plaintext quotes, ignoring quote marks and attribution lines', () => {
		const wrapped = text(
			'On Mon, Ines wrote:\n> Here is the first draft of the offsite\n> agenda. Thursday afternoon is still open.\n> OK',
		)
		expect(bubbleContent([text('Works for me.'), history(wrapped)], shown())).toEqual({
			blocks: [text('Works for me.')],
			unsure: false,
		})
		// Outlook's header block is attribution too; with nothing else it is no reason to keep the fold.
		const headers = text('From: Ines\nSent: Monday\nTo: Sam\nSubject: Re: Offsite')
		expect(bubbleContent([text('Thanks.'), history(headers)], shown()).blocks).toEqual([text('Thanks.')])
	})

	it('folds trailing content that repeats the thread even when the client did not mark it as a quote', () => {
		const blocks = [text('Agreed, see below.'), text(EARLIER)]
		expect(bubbleContent(blocks, shown()).blocks).toEqual([text('Agreed, see below.')])
		// A short repeat ("Thanks") is ordinary conversation, never a fold.
		const memory = shown()
		rememberBlocks(memory, [text('Thanks, all.')], 'Tomas')
		expect(bubbleContent([text('One more thing.'), text('Thanks, all.')], memory).blocks).toHaveLength(2)
	})

	it('removes a signature the mail client marked, and one it did not', () => {
		const marked = [text('See you Thursday.'), signature(text('Tomas Reyes\nOperations'))]
		expect(bubbleContent(marked).blocks).toEqual([text('See you Thursday.')])

		const dashes = [
			text('See you Thursday.'),
			text('--\nTomas Reyes'),
			text('Example Co'),
			history(quote(EARLIER)),
		]
		expect(bubbleContent(dashes, shown()).blocks).toEqual([text('See you Thursday.')])
		expect(bubbleContent([text('Hi'), text('--')]).blocks).toEqual([text('Hi')])

		const contact = [text('See you Thursday.'), text('Tomas Reyes\n+1 555 010 0199\ntomas@example.com')]
		expect(bubbleContent(contact).blocks).toEqual([text('See you Thursday.')])
	})

	it('does not mistake ordinary closing lines for a signature', () => {
		for (const closing of [
			text('Thanks,\nTomas'),
			text(
				'Call me on +1 555 010 0199 tomorrow, or write to tomas@example.com, and we will sort the whole thing out.\nOK?',
			),
			text(
				'a@example.com\nb@example.com\nc@example.com\nd@example.com\ne@example.com\nf@example.com\ng@example.com',
			),
			quote('+1 555 010 0199\ntomas@example.com'),
		]) {
			const blocks = [text('See you Thursday.'), closing]
			expect(bubbleContent(blocks).blocks).toEqual(blocks)
		}
		// A message that is only contact details is the message.
		const only = [text('+1 555 010 0199\ntomas@example.com')]
		expect(bubbleContent(only)).toEqual({ blocks: only, unsure: false })
	})

	it('keeps a signature in place when there is text below it', () => {
		const blocks = [text('Main point.'), signature(text('Tomas')), text('PS: bring the projector.')]
		expect(bubbleContent(blocks)).toEqual({ blocks, unsure: false })
	})

	it('turns answers between quoted lines into reply references above each answer', () => {
		const inline = [
			text('Answers inline.'),
			history(
				text('On 28/09/2026 09:40, Ines\nCarvalho wrote:'),
				quote(EARLIER),
				text('Yes, Thursday from one works.'),
				quote('Also, the retro probably fits better on Friday.'),
				text('Friday at nine, before people leave.'),
			),
		]
		expect(bubbleContent(inline, shown())).toEqual({
			unsure: false,
			blocks: [
				text('Answers inline.'),
				{ type: 'reference', text: EARLIER, author: 'Ines' },
				text('Yes, Thursday from one works.'),
				{ type: 'reference', text: 'Also, the retro probably fits better on Friday.', author: 'Ines' },
				text('Friday at nine, before people leave.'),
			],
		})
	})

	it('references the quote above text written below it, shortened, without an author it cannot know', () => {
		const long = `${EARLIER} ${'And a long tail that goes on. '.repeat(6)}`.trim()
		const memory: ShownBlock[] = []
		rememberBlocks(memory, [history(quote(long))], 'Tomas')
		const result = bubbleContent([history(attribution, quote(long)), text('Room 4B is booked.')], memory)
		expect(result.unsure).toBe(false)
		expect(result.blocks[1]).toEqual(text('Room 4B is booked.'))
		const pointer = result.blocks[0] as { type: string; text: string; author?: string }
		expect(pointer.type).toBe('reference')
		expect(pointer.text).toHaveLength(140)
		expect(pointer.text.endsWith('…')).toBe(true)
		// The thread only saw this text as someone else's quote, so nobody is credited.
		expect(pointer.author).toBeUndefined()
	})

	it('keeps a quote in full when the thread has not shown it, and anything that is not an attribution line', () => {
		const unseen = quote('Something from a message that is not in this thread.')
		const short = quote('OK')
		const preface = text('For context, from the venue:')
		const result = bubbleContent(
			[history(preface, unseen, short), text('Can we still make this work?')],
			shown(),
		)
		expect(result).toEqual({
			unsure: false,
			blocks: [preface, unseen, short, text('Can we still make this work?')],
		})
	})

	it('keeps an answer that merely begins like a mail header', () => {
		// "Date: Thursday works for me" is a sentence somebody wrote, not the Date
		// header of a quoted message. Dropping it because of its first word would
		// silently delete an answer.
		const answer = text('Date: Thursday works for me')
		const inline = bubbleContent(
			[
				text('Replying inline.'),
				history(
					attribution,
					quote(EARLIER),
					answer,
					quote('Also, the retro probably fits better on Friday.'),
					text('Subject: fine by me too'),
				),
			],
			shown(),
		)
		expect(inline.unsure).toBe(false)
		expect(inline.blocks).toContainEqual(answer)
		expect(inline.blocks).toContainEqual(text('Subject: fine by me too'))

		const below = bubbleContent([history(attribution, quote(EARLIER)), answer], shown())
		expect(below.blocks.at(-1)).toEqual(answer)

		// A real header still goes: a lead-in directly above a quote, and Outlook's
		// group of header lines, wherever they sit in the history.
		const nested = bubbleContent(
			[
				text('See both below.'),
				history(
					attribution,
					quote(EARLIER),
					text('Agreed.'),
					text('On Tue, Tomas Reyes wrote:'),
					quote('Also, the retro probably fits better on Friday.'),
					text('From: Ines\nSent: Monday'),
					text('Fine.'),
				),
			],
			shown(),
		)
		expect(
			nested.blocks.map((block) => (block.type === 'paragraph' ? block.spans[0]?.text : block.type)),
		).toEqual(['See both below.', 'reference', 'Agreed.', 'reference', 'Fine.'])
		// A lead-in that is not above a quote is just a sentence ending in "wrote:".
		const sentence = text('This is what the venue wrote:')
		expect(
			bubbleContent([text('Hi'), history(attribution, quote(EARLIER), sentence)], shown()).blocks,
		).toContainEqual(sentence)
	})

	it('does not fold quoted history whose unquoted lines the thread has never shown', () => {
		// Outlook-style history has no quote marks. A body line that starts like a
		// header is still body: if the thread has not shown it, the history stays.
		const headers = text('From: Ines\nSent: Monday\nSubject: Re: Offsite')
		const unseen = [
			text('Thanks.'),
			history(headers, text(EARLIER), text('Subject: budget is approved, by the way')),
		]
		expect(bubbleContent(unseen, shown())).toEqual({ blocks: unseen, unsure: false })
		const seen = [text('Thanks.'), history(headers, text(EARLIER))]
		expect(bubbleContent(seen, shown()).blocks).toEqual([text('Thanks.')])
	})

	it('leaves history without quote marks behind its disclosure, even with text below it', () => {
		const outlook = history(text('From: Ines\nSent: Monday'), text('An unseen earlier message body.'))
		const blocks = [outlook, text('Replying below.')]
		expect(bubbleContent(blocks, shown())).toEqual({ blocks, unsure: false })
	})

	it('shows the whole message when nothing new would be left, or when it is a forward', () => {
		const cases: CleanBlock[][] = [
			// Nothing but a quote.
			[history(attribution, quote('Unseen text from somewhere else entirely.'))],
			// Nothing but a repeat and a signature.
			[signature(text('Tomas')), history(attribution, quote(EARLIER))],
			[text(EARLIER)],
			// A forwarded message is the content itself, even if the thread has seen it.
			[text('FYI'), history(text('---------- Forwarded message ---------\nFrom: Desk'), text(EARLIER))],
			[text('FYI'), history(text('Begin forwarded message:'), quote(EARLIER))],
		]
		for (const blocks of cases) expect(bubbleContent(blocks, shown())).toEqual({ blocks, unsure: true })
	})
})

describe('a plaintext reply with text after the quote', () => {
	it('shows the additional answer in the bubble instead of folding it away with the quote', () => {
		const original = message('a', TOMAS, NOON)
		const reply = message('b', INES, NOON + 3600)
		const conversation = build([original, reply], {
			a: { kind: 'blocks', blocks: [text('The old text of the first message.')], hasRemoteImages: false },
			// What `messageContent` produces for:
			//   New\nOn Monday, Tomas wrote:\n> The old text of the first message.\nAdditional answer
			b: {
				kind: 'blocks',
				hasRemoteImages: false,
				blocks: [
					text('New'),
					history(
						text('On Monday, Tomas wrote:'),
						quote('The old text of the first message.'),
						text('Additional answer'),
					),
				],
			},
		})
		expect(conversation.items.at(-1)).toMatchObject({
			kind: 'run',
			bubbles: [
				{
					unsure: false,
					blocks: [
						text('New'),
						{ type: 'reference', text: 'The old text of the first message.', author: 'Tomas' },
						text('Additional answer'),
					],
				},
			],
		})
	})
})

describe('rememberBlocks', () => {
	it('credits a message with its own words only, and skips lines too short to identify it', () => {
		const memory: ShownBlock[] = []
		rememberBlocks(
			memory,
			[
				text('The retro fits better on Friday.'),
				text('OK'),
				quote('Quoted from elsewhere, long enough.'),
				{ type: 'rule' },
			],
			'Tomas',
		)
		rememberBlocks(memory, [text('No author on this one.')])
		expect(memory).toEqual([
			{ text: 'theretrofitsbetteronfriday', author: 'Tomas' },
			{ text: 'quotedfromelsewherelongenough' },
			{ text: 'noauthoronthisone' },
		])
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

	it('places designed mail in the stream as an article, which can show its original and come back', () => {
		const article: MessageContent = {
			kind: 'article',
			blocks: [text('Issue 112')],
			hasRemoteImages: false,
			mailClass: 'newsletter',
		}
		const messages = [message('a', TOMAS, NOON), message('news', INES, NOON + 60)]
		const conversation = build(messages, { news: article })
		expect(kinds(conversation.items)).toEqual(['day', 'run:a', 'article'])
		expect(conversation.items[2]).toMatchObject({ label: 'Ines Carvalho', blocks: [text('Issue 112')] })
		// One person-to-person message keeps the thread a chat.
		expect(conversation.layout).toBe('chat')

		const original = build(messages, { news: article }, ['news'])
		expect(original.items[2]).toMatchObject({ kind: 'card', restorable: true })
	})

	it('opens a thread of only designed mail as an article, not a chat', () => {
		const article: MessageContent = {
			kind: 'article',
			blocks: [text('Receipt')],
			hasRemoteImages: false,
			mailClass: 'transactional',
		}
		const messages = [message('a', INES, NOON), message('b', INES, NOON + 86_400 * 2), message('c', INES)]
		const contents = { a: article, b: { kind: 'original' } as MessageContent, c: article }
		const conversation = build(messages, contents)
		expect(conversation.layout).toBe('article')
		// An article has no day separators.
		expect(kinds(conversation.items)).toEqual(['article', 'card', 'article'])
		// Showing an article's original does not turn the thread into a chat.
		expect(build(messages, contents, ['a']).layout).toBe('article')
		// A reply the reader switched to its original still makes it a chat.
		expect(build([...messages, message('d', TOMAS, NOON)], contents, ['d']).layout).toBe('chat')
		// An empty thread is nothing in particular.
		expect(build([]).layout).toBe('chat')
	})

	it('folds a quote of an earlier message and credits reply references to who wrote the line', () => {
		const first = 'Could we use Thursday afternoon for the planning session?'
		const conversation = build(
			[message('a', TOMAS, NOON), message('b', SAM, NOON + 3600), message('c', INES, NOON + 7200)],
			{
				a: { kind: 'blocks', blocks: [text(first)], hasRemoteImages: false },
				b: { kind: 'blocks', blocks: [text('Yes.'), history(quote(first))], hasRemoteImages: false },
				c: {
					kind: 'blocks',
					blocks: [history(quote(first), text('Not for me.'), quote('Yes.'))],
					hasRemoteImages: false,
				},
			},
		)
		const bubbles = conversation.items.flatMap((item) => (item.kind === 'run' ? item.bubbles : []))
		expect(bubbles.map((bubble) => bubble.blocks)).toEqual([
			[text(first)],
			[text('Yes.')],
			[{ type: 'reference', text: first, author: 'Tomas' }, text('Not for me.'), quote('Yes.')],
		])
	})

	it('remembers what articles and original cards showed, so later quotes of them fold', () => {
		const issue = 'Three small utilities we kept using all month, and one we stopped.'
		const conversation = build(
			[message('news', INES, NOON), message('shown', TOMAS, NOON + 60), message('reply', SAM, NOON + 3600)],
			{
				news: { kind: 'article', blocks: [text(issue)], hasRemoteImages: false, mailClass: 'newsletter' },
				shown: {
					kind: 'blocks',
					blocks: [text('The second utility is the one I use daily.')],
					hasRemoteImages: false,
				},
				reply: {
					kind: 'blocks',
					blocks: [text('Same.'), history(quote(issue), quote('The second utility is the one I use daily.'))],
					hasRemoteImages: false,
				},
			},
			['shown'],
		)
		expect(conversation.items.at(-1)).toMatchObject({ kind: 'run', bubbles: [{ blocks: [text('Same.')] }] })
	})

	describe('system lines', () => {
		const MARA = { name: 'Mara Lindqvist', email: 'mara@example.com' }
		const events = (messages: MailMessage[], mailboxEmail: string | null = 'sam@example.com') =>
			build(messages, {}, [], mailboxEmail).items.flatMap((item) =>
				item.kind === 'event' ? [item.text] : [],
			)

		it('says who was added and who was moved to Cc, from To and Cc alone', () => {
			const messages: MailMessage[] = [
				{ id: 'a', from: [INES], to: [TOMAS, SAM], date: NOON },
				{ id: 'b', from: [TOMAS], to: [INES], cc: [SAM], date: NOON + 60 },
				{ id: 'c', from: [SAM], to: [TOMAS], cc: [INES], date: NOON + 120 },
				{ id: 'd', from: [INES], to: [MARA, SAM, MARA], cc: [TOMAS, { email: ' ' }], date: NOON + 180 },
			]
			// Plain reply-alls put everyone else in Cc on their own: that is not an event.
			expect(events(messages)).toEqual(['Ines added Mara Lindqvist · Tomas Reyes moved to Cc'])
			const conversation = build(messages)
			// The line sits before the message that made the change, and ends the run.
			expect(kinds(conversation.items)).toEqual(['day', 'run:a', 'run:b', 'run:c', 'event', 'run:d'])
			expect(conversation.items[4]).toMatchObject({ key: 'event:d' })
		})

		it('speaks to the reader in the second person', () => {
			expect(
				events([
					{ id: 'a', from: [INES], to: [TOMAS] },
					{ id: 'b', from: [SAM], to: [INES, { email: 'new@example.com' }], cc: [TOMAS] },
					{ id: 'c', from: [INES], to: [TOMAS], cc: [SAM] },
				]),
			).toEqual(['You added new@example.com · Tomas Reyes moved to Cc', 'you moved to Cc'])
		})

		it('names nobody as "you" when the signed-in address is unknown, and copes with a missing sender', () => {
			expect(
				events(
					[
						{ id: 'a', from: [INES], to: [TOMAS] },
						{ id: 'b', to: [SAM] },
						{ id: 'c', from: [TOMAS] },
					],
					null,
				),
			).toEqual(['Someone added Sam@Example.com'])
		})

		it('says when the subject changed, ignoring reply and forward prefixes', () => {
			const subjects = (first: string | undefined, second: string | undefined) =>
				events([
					{ id: 'a', from: [INES], to: [SAM], ...(first === undefined ? {} : { subject: first }) },
					{ id: 'b', from: [TOMAS], to: [INES], ...(second === undefined ? {} : { subject: second }) },
				])
			expect(subjects('Offsite agenda draft', 'RE: Fwd:  offsite  Agenda draft')).toEqual([])
			expect(subjects('Offsite agenda draft', 'Re: Offsite agenda, final')).toEqual([
				'Tomas changed the subject to “Offsite agenda, final”',
			])
			// A missing subject on either side is not a change anyone made.
			expect(subjects(undefined, 'Offsite')).toEqual([])
			expect(subjects('Offsite', 'Re:')).toEqual([])
		})

		it('has no system lines in an article', () => {
			const article: MessageContent = {
				kind: 'article',
				blocks: [text('Issue')],
				hasRemoteImages: false,
				mailClass: 'newsletter',
			}
			const conversation = build(
				[
					{ id: 'a', from: [INES], to: [SAM], subject: 'Issue 111' },
					{ id: 'b', from: [INES], to: [SAM, TOMAS], subject: 'Issue 112' },
				],
				{ a: article, b: article },
			)
			expect(kinds(conversation.items)).toEqual(['article', 'article'])
		})
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

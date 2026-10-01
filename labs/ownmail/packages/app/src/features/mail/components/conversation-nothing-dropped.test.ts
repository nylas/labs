// @vitest-environment jsdom

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { blocksText, type CleanBlock, messageContent } from '../lib/clean-view.js'
import { buildConversation } from '../lib/conversation-model.js'
import type { MailMessage } from '../state/mail-queries.js'

/**
 * The property the Conversation view must hold for every message of every
 * thread: nothing a person newly wrote is silently dropped.
 *
 * Every word of a message that no earlier message of the thread contains is
 * either rendered in the transcript, or the message is shown in full (the pass
 * was unsure) or handed to the standard reader. Only two things may go, both by
 * design and both still behind "Show original":
 *
 * - a signature the sender's mail client marked, or the signature lines under a
 *   plaintext `-- ` delimiter. Only those lines: a postscript or any other
 *   message text below them is content, and is checked like any other;
 * - the header that opens quoted history ("On Mon, Ines wrote:", Outlook's
 *   From/Sent/To/Subject group). Only the block in that position: a line that
 *   merely begins like a header is content, and is checked like any other.
 */

const directory = dirname(fileURLToPath(import.meta.url))
const fixture = (name: string) => readFileSync(join(directory, 'reader-fixtures', `${name}.html`), 'utf8')

const INES = { name: 'Ines Carvalho', email: 'ines@example.com' }
const TOMAS = { name: 'Tomas Reyes', email: 'tomas@example.com' }
const SAM = { name: 'Sam Reader', email: 'sam@example.com' }
const START = 1_790_596_800

function thread(...bodies: Array<[from: { name: string; email: string }, body: string]>): MailMessage[] {
	return bodies.map(([from, body], index) => ({
		id: `m${index}`,
		from: [from],
		to: [INES, TOMAS, SAM].filter((person) => person !== from),
		date: START + index * 3600,
		body,
	}))
}

const words = (text: string): string[] => text.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []

/** The text of the blocks the view is allowed to leave out. */
function droppable(blocks: CleanBlock[]): string {
	return blocks
		.flatMap((block) => {
			if (block.type === 'signature') return [blocksText([block])]
			if (block.type === 'history') return [blocksText(block.blocks.slice(0, 1))]
			return []
		})
		.join('\n')
}

/** Every new word of every message is on screen, or the message is shown whole. */
function expectNothingDropped(messages: MailMessage[]): void {
	const contents = new Map(messages.map((message) => [message.id, messageContent(message, false)]))
	const conversation = buildConversation(messages, {
		mailboxEmail: SAM.email,
		contentFor: (message) => contents.get(message.id) as ReturnType<typeof messageContent>,
		originalIds: new Set(),
	})
	const rendered = new Map<string, { text: string; whole: boolean }>()
	for (const item of conversation.items) {
		if (item.kind === 'run') {
			for (const bubble of item.bubbles) {
				rendered.set(bubble.message.id, { text: blocksText(bubble.blocks), whole: bubble.unsure })
			}
		} else if (item.kind === 'article') {
			rendered.set(item.message.id, { text: blocksText(item.blocks), whole: false })
		} else if (item.kind === 'card') {
			rendered.set(item.message.id, { text: '', whole: true })
		}
	}

	const earlier = new Set<string>()
	for (const message of messages) {
		const content = contents.get(message.id) as ReturnType<typeof messageContent>
		const shown = rendered.get(message.id)
		// Every message has a place in the transcript.
		expect(shown, message.id).toBeDefined()
		if (content.kind === 'original' || !shown) continue
		const full = blocksText(content.blocks)
		if (!shown.whole) {
			const onScreen = new Set(words(shown.text))
			const allowed = new Set(words(droppable(content.blocks)))
			const lost = words(full).filter(
				(word) => !earlier.has(word) && !onScreen.has(word) && !allowed.has(word),
			)
			expect(lost, `${message.id} lost: ${lost.join(' ')}`).toEqual([])
		}
		for (const word of words(full)) earlier.add(word)
	}
}

const FIRST = 'Here is the first draft of the offsite agenda. Thursday afternoon is still open.'
const SECOND =
	'Could we use Thursday afternoon for the planning session?\n\nAlso, the retro probably fits better on Friday.'
const THIRD = 'Updated and sent the invite. Retro is Friday at 9.'

describe('nothing a person wrote is silently dropped', () => {
	it('holds for the reply fixtures, each arriving in a thread that already showed what it quotes', () => {
		for (const name of [
			'conversation-gmail-reply',
			'conversation-outlook-reply',
			'conversation-forwarded-message',
			'conversation-inline-replies',
			'conversation-text-below-quote',
			'conversation-text-below-signature',
		]) {
			expectNothingDropped(thread([INES, FIRST], [TOMAS, SECOND], [INES, THIRD], [SAM, fixture(name)]))
		}
	})

	it('holds when every fixture arrives in one long thread, designed mail included', () => {
		expectNothingDropped(
			thread(
				[INES, FIRST],
				[TOMAS, SECOND],
				[INES, THIRD],
				[TOMAS, fixture('conversation-gmail-reply')],
				[SAM, fixture('conversation-inline-replies')],
				[INES, fixture('clean-newsletter-layout-tables')],
				[SAM, fixture('conversation-text-below-quote')],
				[INES, fixture('clean-receipt-data-table')],
				[INES, fixture('clean-zero-font-columns')],
				[TOMAS, fixture('conversation-outlook-reply')],
				[INES, fixture('clean-image-only-newsletter')],
				[INES, fixture('conversation-text-below-signature')],
				[SAM, fixture('conversation-forwarded-message')],
			),
		)
	})

	it('holds for a plaintext reply that continues below the quote', () => {
		const original = 'The old text of the first message, long enough to be recognised.'
		const messages = thread(
			[TOMAS, original],
			[INES, `New\nOn Monday, Tomas wrote:\n> ${original}\nAdditional answer`],
			[
				SAM,
				`On Tuesday, Ines wrote:\n> New\n> Additional answer\n\nBottom posted reply, nothing above the quote.`,
			],
		)
		expectNothingDropped(messages)
	})

	it('holds for answers that begin like a mail header', () => {
		const original = 'Could we use Thursday afternoon for the planning session?'
		expectNothingDropped(
			thread(
				[TOMAS, original],
				[
					INES,
					`Inline.\nOn Monday, Tomas wrote:\n> ${original}\nDate: Thursday works for me\nSubject: fine too`,
				],
				[
					SAM,
					`<div>Mine below.</div><div class="gmail_quote"><div class="gmail_attr">On Mon, Tomas wrote:</div><blockquote>${original}</blockquote><div>From: my side that is fine</div></div>`,
				],
			),
		)
	})

	it('holds for a closing list of links, which is not a signature', () => {
		expectNothingDropped(
			thread(
				[TOMAS, 'Can you send the links?'],
				[INES, 'Here you go.\n\nResources:\nhttps://example.com/agenda\nhttps://example.com/venue'],
				[
					SAM,
					'<p>And two more.</p><p>Further Reading<br>https://example.com/rooms<br>www.example.com/catering</p>',
				],
			),
		)
	})

	it('holds for repeats, short messages and quotes of mail the thread never showed', () => {
		expectNothingDropped(
			thread(
				[INES, FIRST],
				[TOMAS, `Agreed.\n\nOn Monday, Ines wrote:\n> ${FIRST}`],
				[SAM, 'OK'],
				[
					INES,
					'Thanks.\n\nOn Sunday, Someone Else wrote:\n> A message from another thread entirely, never shown here.',
				],
				[TOMAS, FIRST],
				[SAM, 'See you Thursday.\n\n-- \nSam Reader\n+1 555 010 0199'],
			),
		)
	})

	it('holds for a postscript written below a plaintext signature', () => {
		const messages = thread(
			[TOMAS, 'Which room, and how do we get in?'],
			[INES, 'Main point: room 4B.\n\n-- \nInes Carvalho\nExample Co\n\nPS: door code 482913'],
			[SAM, 'Thanks.\n\n--\nSam Reader\n\nOne more thing, catering arrives at noon.'],
		)
		expectNothingDropped(messages)
		// The exemption covers the signature lines only, so the postscript is really checked.
		const content = messageContent(messages[1] as MailMessage, false)
		if (content.kind !== 'blocks') throw new Error('expected a bubble')
		expect(words(droppable(content.blocks))).toEqual(['ines', 'carvalho', 'example'])
	})

	describe('an answer written below quoted mail that has no quote marks', () => {
		// Outlook and some other clients mark where the quoted mail starts, not what
		// is quoted: everything after the separator is "history", including an
		// answer typed below the original. Nothing in the markup tells the two apart.
		const original =
			'Could we move the planning session to Thursday afternoon, and would the retro then fit better on Friday morning before people fly out?'
		const answer = 'Yes, agreed.'
		const cases: Array<[client: string, html: string]> = [
			[
				'Outlook #divRplyFwdMsg',
				`<p>See below.</p><div id="divRplyFwdMsg"><b>From:</b> Tomas Reyes<br><b>Sent:</b> Monday</div><p>${original}</p><p>${answer}</p>`,
			],
			[
				'Outlook .OutlookMessageHeader',
				`<p>See below.</p><div class="OutlookMessageHeader"><b>From:</b> Tomas Reyes<br><b>Sent:</b> Monday</div><p>${original}</p><p>${answer}</p>`,
			],
			[
				'Outlook hr#stopSpelling',
				`<p>See below.</p><hr id="stopSpelling"><p>From: Tomas Reyes<br>Sent: Monday</p><p>${original}</p><p>${answer}</p>`,
			],
			[
				'Thunderbird moz-cite-prefix without a blockquote',
				`<p>See below.</p><div class="moz-cite-prefix">On 28/09/2026, Tomas Reyes wrote:</div><p>${original}</p><p>${answer}</p>`,
			],
			[
				'Yahoo yahoo_quoted',
				`<p>See below.</p><div class="yahoo_quoted"><div>On Monday, Tomas Reyes wrote:</div><div>${original}</div><div>${answer}</div></div>`,
			],
			[
				'Apple AppleOriginalContents',
				`<p>See below.</p><div class="AppleOriginalContents"><div>On Monday, Tomas Reyes wrote:</div><div>${original}</div><div>${answer}</div></div>`,
			],
			[
				'Gmail gmail_quote without a blockquote',
				`<p>See below.</p><div class="gmail_quote"><div>On Monday, Tomas Reyes wrote:</div><div>${original}</div><div>${answer}</div></div>`,
			],
		]

		it.each(cases)('%s: the answer is shown, with the message in full', (_client, html) => {
			const messages = thread([TOMAS, original], [INES, html])
			expectNothingDropped(messages)
			const conversation = buildConversation(messages, {
				mailboxEmail: SAM.email,
				contentFor: (message) => messageContent(message, false),
				originalIds: new Set(),
			})
			const bubble = conversation.items.flatMap((item) => (item.kind === 'run' ? item.bubbles : [])).at(-1)
			// The answer is three words; any share-of-text rule would call the history a repeat.
			expect(blocksText(bubble?.blocks ?? [])).toContain(answer)
			expect(bubble?.unsure).toBe(true)
		})

		it('still folds such history when every part of it was shown before', () => {
			const messages = thread(
				[TOMAS, original],
				[
					INES,
					`<p>Works for me.</p><div id="divRplyFwdMsg"><b>From:</b> Tomas Reyes<br><b>Sent:</b> Monday</div><p>${original}</p>`,
				],
			)
			expectNothingDropped(messages)
			const conversation = buildConversation(messages, {
				mailboxEmail: SAM.email,
				contentFor: (message) => messageContent(message, false),
				originalIds: new Set(),
			})
			const bubble = conversation.items.flatMap((item) => (item.kind === 'run' ? item.bubbles : [])).at(-1)
			expect(bubble).toMatchObject({ unsure: false })
			expect(blocksText(bubble?.blocks ?? [])).toBe('Works for me.')
		})
	})

	it('holds for a closing contact list under a title, which is not the sender signing off', () => {
		const messages = thread(
			[TOMAS, 'Who do I talk to about the venue?'],
			[INES, 'Here they are.\n\nProject Contacts\nalice@example.com\nbob@example.com'],
			[SAM, '<p>And for catering.</p><p>Catering Team<br>+1 555 010 0142<br>catering@example.com</p>'],
		)
		expectNothingDropped(messages)
	})

	it('would catch a dropped answer: the check itself is not vacuous', () => {
		// The same check, run against a transcript that leaves a new line out.
		const messages = thread([TOMAS, 'A question.'], [INES, 'An answer nobody has seen before.'])
		const contents = new Map(messages.map((message) => [message.id, messageContent(message, false)]))
		const answer = contents.get('m1')
		if (answer?.kind !== 'blocks') throw new Error('expected a bubble')
		const full = words(blocksText(answer.blocks))
		const onScreen = new Set(words('An answer.'))
		expect(full.filter((word) => !onScreen.has(word))).toEqual(['nobody', 'has', 'seen', 'before'])
	})
})

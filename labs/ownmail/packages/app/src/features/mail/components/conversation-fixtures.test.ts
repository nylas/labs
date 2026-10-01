// @vitest-environment jsdom

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
	blockLinks,
	blocksText,
	type CleanBlock,
	type MessageContent,
	messageContent,
	stripHiddenContent,
} from '../lib/clean-view.js'
import { bubbleContent, rememberBlocks, type ShownBlock } from '../lib/conversation-model.js'
import { prepareEmailMessageContent } from '../lib/email-message-content.js'
import { sanitizeEmailDocument } from '../lib/sanitize-email.js'

/**
 * The Conversation view rewrites what a message looks like, so its corpus pins
 * what must survive. The block model of every synthetic fixture is snapshotted,
 * and every fixture the clean view accepts has to keep its visible text and its
 * links, keep unsubscribe reachable, never come out empty, and convert the same
 * way twice. Fixtures the clean view must refuse are pinned as fallbacks.
 *
 * `reader-fixtures` are synthetic. `real-email-fixtures` are scrubbed real
 * layouts (see real-email-fixtures.test.ts); they are checked for the
 * invariants only and are never copied into a snapshot.
 */

const directory = dirname(fileURLToPath(import.meta.url))

type Expected = MessageContent['kind']

const SYNTHETIC: ReadonlyArray<readonly [name: string, expected: Expected]> = [
	['conversation-gmail-reply', 'blocks'],
	['conversation-outlook-reply', 'blocks'],
	['conversation-forwarded-message', 'blocks'],
	['conversation-inline-replies', 'blocks'],
	['conversation-text-below-quote', 'blocks'],
	['conversation-text-below-signature', 'blocks'],
	['conversation-table-signature', 'blocks'],
	['clean-newsletter-layout-tables', 'article'],
	['clean-transactional-notice', 'article'],
	['clean-one-time-code', 'article'],
	['clean-zero-font-columns', 'article'],
	['light-matte-logo', 'article'],
	['report-canvas-dark-band', 'article'],
	['clean-receipt-data-table', 'article'],
	['ci-notification-card', 'article'],
	// Golden fallbacks: the clean view must leave these to the standard reader.
	['clean-image-only-newsletter', 'original'],
	['clean-itinerary-nested-table', 'original'],
]

const SCRUBBED_REAL = [
	'bare-legacy-tables',
	'long-form-fixed-width',
	'nested-background-cards',
	'responsive-image-gallery',
	'responsive-table-stack',
] as const

function fixtureHtml(folder: string, name: string): string {
	return readFileSync(join(directory, folder, `${name}.html`), 'utf8')
}

function convert(html: string, name: string): MessageContent {
	return messageContent({ id: name, body: html }, false)
}

/** The sanitized, stripped body the clean view worked from, built independently of it. */
function strippedBody(html: string, designed: boolean): HTMLElement {
	const prepared = prepareEmailMessageContent(html, 'fixture')
	const sanitized = sanitizeEmailDocument(prepared.html) as HTMLElement
	if (designed) stripHiddenContent(sanitized)
	const body = sanitized.querySelector('body') as HTMLElement
	for (const skipped of body.querySelectorAll('style, summary')) skipped.remove()
	return body
}

const squash = (value: string) => value.replace(/\s+/g, '')

/** What the thread had already shown before each reply fixture arrived. */
const EARLIER: ShownBlock[] = []
rememberBlocks(
	EARLIER,
	[
		'Here is the first draft of the offsite agenda. Thursday afternoon is still open.',
		'Updated and sent the invite. Retro is Friday at 9.',
	].map((text) => ({ type: 'paragraph', spans: [{ text }] })),
	'Ines',
)
rememberBlocks(
	EARLIER,
	[
		'Could we use Thursday afternoon for the planning session?',
		'Also, the retro probably fits better on Friday.',
	].map((text) => ({ type: 'paragraph', spans: [{ text }] })),
	'Tomas',
)

function textNodes(root: Node): string[] {
	const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
	const texts: string[] = []
	while (walker.nextNode()) {
		const text = squash(walker.currentNode.textContent ?? '')
		if (text) texts.push(text)
	}
	return texts
}

function assertInvariants(
	html: string,
	name: string,
	content: Exclude<MessageContent, { kind: 'original' }>,
) {
	const blocks: CleanBlock[] = content.blocks
	// Output is never empty, and the pipeline is idempotent.
	expect(blocks.length).toBeGreaterThan(0)
	expect(convert(html, name)).toEqual(content)

	const body = strippedBody(html, content.kind === 'article')
	// Every piece of visible text is retained.
	const kept = squash(blocksText(blocks))
	for (const text of textNodes(body)) expect(kept).toContain(text)

	// Every link a reader could follow is retained.
	const links = blockLinks(blocks)
	const anchors = [...body.querySelectorAll('a[href]')].filter(
		(anchor) =>
			/^(?:https?:|mailto:)/i.test(anchor.getAttribute('href') ?? '') &&
			(squash(anchor.textContent) !== '' || anchor.querySelector('img') !== null),
	)
	for (const anchor of anchors) expect(links).toContain(anchor.getAttribute('href'))

	// Unsubscribe stays reachable.
	const unsubscribe = anchors.filter((anchor) => /unsubscribe/i.test(anchor.textContent))
	for (const anchor of unsubscribe) expect(links).toContain(anchor.getAttribute('href'))
}

describe.each(SYNTHETIC)('synthetic fixture %s', (name, expected) => {
	const html = fixtureHtml('reader-fixtures', name)

	it(`converts to "${expected}" and matches its recorded block model`, async () => {
		const content = convert(html, name)
		expect(content.kind).toBe(expected)
		const recorded =
			content.kind === 'blocks' ? { ...content, bubble: bubbleContent(content.blocks, EARLIER) } : content
		await expect(`${JSON.stringify(recorded, null, '\t')}\n`).toMatchFileSnapshot(
			`./__tests__/clean-fixtures/${name}.json`,
		)
	})

	it('keeps its text and links, never comes out empty, and converts the same way twice', () => {
		const content = convert(html, name)
		if (content.kind !== 'original') assertInvariants(html, name, content)
		// A fallback is stable too: asking again never flips it to a clean render.
		else expect(convert(html, name)).toEqual({ kind: 'original' })
	})
})

describe.each(SCRUBBED_REAL)('scrubbed real layout %s', (name) => {
	it('either falls back or keeps every invariant', () => {
		const html = fixtureHtml('real-email-fixtures', name)
		const content = convert(html, name)
		if (content.kind !== 'original') assertInvariants(html, name, content)
		else expect(convert(html, name)).toEqual({ kind: 'original' })
	})
})

describe('what a bubble may hide', () => {
	const bubble = (name: string) => {
		const content = convert(fixtureHtml('reader-fixtures', name), name)
		if (content.kind !== 'blocks') throw new Error(`${name} is not a bubble`)
		return bubbleContent(content.blocks, EARLIER)
	}
	const bubbleText = (name: string) => blocksText(bubble(name).blocks)

	it('drops the signature and the trailing quote of an ordinary reply', () => {
		expect(bubble('conversation-gmail-reply').unsure).toBe(false)
		expect(bubbleText('conversation-gmail-reply')).toContain('Could we use Thursday afternoon')
		expect(bubbleText('conversation-gmail-reply')).not.toContain('Here is the first draft')
		expect(bubbleText('conversation-gmail-reply')).not.toContain('Operations, Example Co')

		expect(bubble('conversation-outlook-reply').unsure).toBe(false)
		expect(bubbleText('conversation-outlook-reply')).not.toContain('retro probably fits better')
	})

	it('never hides a forwarded message, including the code inside it', () => {
		expect(bubble('conversation-forwarded-message').unsure).toBe(true)
		expect(bubbleText('conversation-forwarded-message')).toContain('Door code 482913')
	})

	it('shows answers written between quoted lines, each under a reference to its question', () => {
		const { blocks, unsure } = bubble('conversation-inline-replies')
		expect(unsure).toBe(false)
		expect(blocks.map((block) => block.type)).toEqual([
			'paragraph',
			'reference',
			'paragraph',
			'reference',
			'paragraph',
		])
		expect(blocks[1]).toEqual({
			type: 'reference',
			author: 'Tomas',
			text: 'Could we use Thursday afternoon for the planning session?',
		})
		expect(bubbleText('conversation-inline-replies')).toContain('Yes, Thursday from one works.')
		expect(bubbleText('conversation-inline-replies')).toContain('Friday at nine, before people leave.')
	})

	it('never hides text written below the quote', () => {
		const { blocks, unsure } = bubble('conversation-text-below-quote')
		expect(unsure).toBe(false)
		expect(blocks[0]).toMatchObject({ type: 'reference', author: 'Ines' })
		expect(bubbleText('conversation-text-below-quote')).toContain('Room 4B is booked for both days.')
		expect(bubbleText('conversation-text-below-quote')).toContain('Catering arrives at noon')
	})

	it('never hides text written below a signature', () => {
		const { blocks, unsure } = bubble('conversation-text-below-signature')
		expect(unsure).toBe(false)
		expect(blocks.map((block) => block.type)).toEqual(['paragraph', 'signature', 'paragraph'])
		expect(bubbleText('conversation-text-below-signature')).toContain('the door code for Room 4B is 482913')
	})
})

describe('what an article may drop', () => {
	const article = (name: string) => {
		const content = convert(fixtureHtml('reader-fixtures', name), name)
		if (content.kind !== 'article') throw new Error(`${name} is not an article`)
		return content
	}

	it('drops the preheader, tracking pixel, spacer and duplicated mobile copy of a newsletter', () => {
		const { blocks, mailClass } = article('clean-newsletter-layout-tables')
		const text = blocksText(blocks)
		expect(mailClass).toBe('newsletter')
		// The preheader repeats the intro; only the visible copy remains.
		expect(text.match(/Three small utilities we kept using all month/g)).toHaveLength(1)
		expect(text.match(/Reply to this email to tell us what you use\./g)).toHaveLength(1)
		expect(JSON.stringify(blocks)).not.toContain('track.example')
		// Layout tables are read in row order: headline, intro, the two cards, the button.
		expect(text.indexOf('Issue 112')).toBeLessThan(text.indexOf('A calmer clipboard.'))
		expect(text.indexOf('A calmer clipboard.')).toBeLessThan(text.indexOf('Plain-text timers.'))
		expect(text.indexOf('Plain-text timers.')).toBeLessThan(text.indexOf('Read the issue'))
		expect(blocks).toContainEqual({
			type: 'heading',
			level: 1,
			spans: [{ text: 'Issue 112: the quiet tools issue' }],
		})
		expect(blocks).toContainEqual({
			type: 'paragraph',
			spans: [{ text: 'Read the issue', href: 'https://fieldnotes.example/issues/112', cta: true }],
		})
		expect(blockLinks(blocks)).toContain('https://fieldnotes.example/unsubscribe?u=1')
		// An icon with no description is still a link, named by where it goes.
		expect(text).toContain('photos.example')
	})

	it('never folds a one-time code that sits in the small print', () => {
		const { blocks, mailClass } = article('clean-one-time-code')
		expect(mailClass).toBe('transactional')
		// The block looks like a footer (legal links, last in the message) but holds the code.
		expect(blocks.some((block) => block.type === 'footer')).toBe(false)
		expect(blocks.at(-1)).toMatchObject({ type: 'paragraph' })
		expect(blocksText(blocks.slice(-1))).toContain('Your code is 482913')
	})

	it('folds navigation, the social row and the footer of a newsletter into one disclosure', () => {
		const { blocks } = article('clean-newsletter-layout-tables')
		const footer = blocks.at(-1)
		if (footer?.type !== 'footer') throw new Error('the newsletter footer was not folded')
		expect(blocks.filter((block) => block.type === 'footer')).toHaveLength(1)
		expect(footer.unsubscribe).toBe(true)
		expect(blocksText(footer.blocks)).toContain('Home · Archive · Shop · View in browser')
		expect(blocksText(footer.blocks)).toContain('© Harbor & Pine')
		// The message itself stays outside the fold.
		const body = blocksText(blocks.slice(0, -1))
		expect(body).toContain('Issue 112: the quiet tools issue')
		expect(body).toContain('Read the issue')
		expect(body).not.toContain('Unsubscribe')
	})

	it('keeps columns whose wrapper sets a zero font size only to close the gap between them', () => {
		// The wrapper is "zero-sized", the columns inside it are not: they set their
		// own font size. Treating the wrapper as hidden dropped both columns, and
		// because the gate measured what was left, the article still scored full.
		const text = blocksText(article('clean-zero-font-columns').blocks)
		expect(text).toContain('Planning moved to Thursday afternoon, from one until five, in Room 4B.')
		expect(text).toContain('The retro is now Friday at nine, before half the team flies out at two.')
	})

	it('keeps the line items of a receipt, and the rows of a report, as tables', () => {
		const receipt = article('clean-receipt-data-table').blocks.find((block) => block.type === 'table')
		expect(receipt).toMatchObject({ type: 'table', header: true })
		expect(blocksText(receipt ? [receipt] : [])).toBe(
			[
				'Item | Qty | Price',
				'Field notebook, dotted | 2 | $18.00',
				'Brass pencil cap | 1 | $7.50',
				'Shipping | | $4.00',
				'Total | | $29.50',
			].join('\n'),
		)
		// No header was marked here: the regular grid of short cells is what makes it data.
		const report = article('report-canvas-dark-band').blocks.find((block) => block.type === 'table')
		expect(report).toMatchObject({ type: 'table', header: false })
		expect(blocksText(report ? [report] : [])).toContain(
			'ERROR sync-worker | TimeoutError: upstream IMAP read timed out | 412',
		)
	})

	it('keeps the button a transactional notice exists for, rescued from Outlook markup too', () => {
		const { blocks } = article('clean-transactional-notice')
		expect(blocks).toContainEqual({
			type: 'paragraph',
			spans: [
				{ text: 'Track parcel', href: 'https://parcelway.example/track/PW-4471-0092' },
				{ text: ' ' },
				{ text: 'Track your parcel', href: 'https://parcelway.example/track/PW-4471-0092', cta: true },
			],
		})
		expect(blocksText(blocks)).toContain('PW-4471-0092')
	})
})

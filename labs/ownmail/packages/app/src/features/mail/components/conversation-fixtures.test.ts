// @vitest-environment jsdom

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { blocksText, type CleanBlock, type CleanSpan, messageContent } from '../lib/clean-view.js'
import { type BubbleContent, newContent } from '../lib/conversation-model.js'
import { sanitizeEmailDocument } from '../lib/sanitize-email.js'

/**
 * The Conversation view rewrites what a message looks like, so its corpus pins
 * what must survive: the block model of every fixture is snapshotted, and each
 * fixture has to keep its text and links, never come out empty, and convert the
 * same way twice. All fixtures are synthetic.
 */

const directory = dirname(fileURLToPath(import.meta.url))

const FIXTURES = [
	'conversation-gmail-reply',
	'conversation-outlook-reply',
	'conversation-forwarded-message',
	'conversation-inline-replies',
	'conversation-text-below-quote',
] as const

function fixtureHtml(name: string): string {
	return readFileSync(join(directory, 'reader-fixtures', `${name}.html`), 'utf8')
}

function convert(name: string): { blocks: CleanBlock[]; bubble: BubbleContent } {
	const content = messageContent({ id: name, body: fixtureHtml(name) }, false)
	if (content.kind !== 'blocks') throw new Error(`${name} did not convert to blocks`)
	return { blocks: content.blocks, bubble: newContent(content.blocks) }
}

function spansOf(blocks: CleanBlock[]): CleanSpan[] {
	return blocks.flatMap((block) => {
		if (block.type === 'heading' || block.type === 'paragraph') return block.spans
		if (block.type === 'list') return block.items.flat()
		if (block.type === 'quote' || block.type === 'history') return spansOf(block.blocks)
		return []
	})
}

const squash = (value: string) => value.replace(/\s+/g, '')

describe.each(FIXTURES)('conversation fixture %s', (name) => {
	it('matches its recorded block model', async () => {
		await expect(`${JSON.stringify(convert(name), null, '\t')}\n`).toMatchFileSnapshot(
			`./__tests__/clean-fixtures/${name}.json`,
		)
	})

	it('never comes out empty and converts the same way twice', () => {
		const first = convert(name)
		expect(first.blocks.length).toBeGreaterThan(0)
		expect(first.bubble.blocks.length).toBeGreaterThan(0)
		expect(convert(name)).toEqual(first)
	})

	it('keeps every word and every link of the sanitized message', () => {
		const sanitized = sanitizeEmailDocument(fixtureHtml(name)) as HTMLElement
		const body = sanitized.querySelector('body') as HTMLElement
		for (const style of body.querySelectorAll('style')) style.remove()
		const { blocks } = convert(name)

		expect(squash(blocksText(blocks))).toBe(squash(body.textContent))
		const kept = new Set(spansOf(blocks).map((span) => span.href))
		for (const anchor of body.querySelectorAll('a[href]')) expect(kept).toContain(anchor.getAttribute('href'))
	})
})

describe('what a bubble may hide', () => {
	const bubbleText = (name: string) => blocksText(convert(name).bubble.blocks)

	it('drops the trailing quote of an ordinary reply', () => {
		const { bubble } = convert('conversation-gmail-reply')
		expect(bubble.unsure).toBe(false)
		expect(blocksText(bubble.blocks)).toContain('Could we use Thursday afternoon')
		expect(blocksText(bubble.blocks)).not.toContain('Here is the first draft')

		expect(convert('conversation-outlook-reply').bubble.unsure).toBe(false)
		expect(bubbleText('conversation-outlook-reply')).not.toContain('retro probably fits better')
	})

	it('never hides a forwarded message, including the code inside it', () => {
		expect(convert('conversation-forwarded-message').bubble.unsure).toBe(true)
		expect(bubbleText('conversation-forwarded-message')).toContain('Door code 482913')
	})

	it('never hides answers written between quoted lines', () => {
		expect(convert('conversation-inline-replies').bubble.unsure).toBe(true)
		expect(bubbleText('conversation-inline-replies')).toContain('Yes, Thursday from one works.')
		expect(bubbleText('conversation-inline-replies')).toContain('Friday at nine, before people leave.')
	})

	it('never hides text written below the quote', () => {
		expect(convert('conversation-text-below-quote').bubble.unsure).toBe(true)
		expect(bubbleText('conversation-text-below-quote')).toContain('Room 4B is booked for both days.')
	})
})

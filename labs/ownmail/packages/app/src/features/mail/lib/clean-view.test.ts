// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import type { MailMessage } from '../state/mail-queries.js'
import { blocksText, type CleanBlock, messageContent, normaliseBlocks } from './clean-view.js'

const CONTROLLED_IMAGE = `/email-images/${'a'.repeat(20)}.${'b'.repeat(20)}?mode=automatic&theme=light`

function blocksOf(html: string): CleanBlock[] {
	return normaliseBlocks(new DOMParser().parseFromString(html, 'text/html').body)
}

function message(body: string | undefined, extra: Partial<MailMessage> = {}): MailMessage {
	return {
		id: 'm1',
		from: [{ email: 'ines@example.com' }],
		...(body === undefined ? {} : { body }),
		...extra,
	}
}

describe('normaliseBlocks', () => {
	it('keeps the structure a reader relies on: headings, paragraphs, lists, quotes, code and rules', () => {
		expect(
			blocksOf(
				'<h1>Agenda</h1><h5>Deep heading</h5><p>First <b>bold</b> and <em>soft</em> and <code>x = 1</code>.</p>' +
					'<ul><li>One</li><li>Two<ol><li>Nested</li></ol></li><li> </li></ul><ol><li>Step</li></ol><ul></ul>' +
					'<blockquote><p>Quoted line</p></blockquote><blockquote> </blockquote>' +
					'<pre>line 1\n  line 2\n</pre><pre>  </pre><hr>',
			),
		).toEqual([
			{ type: 'heading', level: 1, spans: [{ text: 'Agenda' }] },
			{ type: 'heading', level: 3, spans: [{ text: 'Deep heading' }] },
			{
				type: 'paragraph',
				spans: [
					{ text: 'First ' },
					{ text: 'bold', bold: true },
					{ text: ' and ' },
					{ text: 'soft', italic: true },
					{ text: ' and ' },
					{ text: 'x = 1', code: true },
					{ text: '.' },
				],
			},
			{ type: 'list', ordered: false, items: [[{ text: 'One' }], [{ text: 'Two' }], [{ text: 'Nested' }]] },
			{ type: 'list', ordered: true, items: [[{ text: 'Step' }]] },
			{ type: 'quote', blocks: [{ type: 'paragraph', spans: [{ text: 'Quoted line' }] }] },
			{ type: 'code', text: 'line 1\n  line 2' },
			{ type: 'rule' },
		])
	})

	it('never drops stray text between blocks, and keeps line breaks the author typed', () => {
		expect(
			blocksOf(
				'before<div>one<br>two<br><br><br><br>three  spaced</div>after<!-- note --><span> tail</span>',
			),
		).toEqual([
			{ type: 'paragraph', spans: [{ text: 'before' }] },
			{ type: 'paragraph', spans: [{ text: 'one\ntwo\n\nthree spaced' }] },
			{ type: 'paragraph', spans: [{ text: 'after tail' }] },
		])
	})

	it('keeps only web and mail links, so a script or data target can never be followed', () => {
		const blocks = blocksOf(
			'<p><a href="https://example.com/a">web</a> <a href="mailto:ines@example.com">mail</a> ' +
				'<a href="javascript:alert(1)">script</a> <a href="data:text/html,x">data</a> <a>bare</a></p>',
		)
		expect(blocks).toEqual([
			{
				type: 'paragraph',
				spans: [
					{ text: 'web', href: 'https://example.com/a' },
					{ text: ' ' },
					{ text: 'mail', href: 'mailto:ines@example.com' },
					{ text: ' script data bare' },
				],
			},
		])
	})

	it('keeps a link that wraps block content instead of losing it', () => {
		expect(blocksOf('<a href="https://example.com/issue"><div>Read the issue</div></a>')).toEqual([
			{ type: 'paragraph', spans: [{ text: 'Read the issue', href: 'https://example.com/issue' }] },
		])
	})

	it('gives every image its own block and only keeps sources the sanitizer controls', () => {
		expect(
			blocksOf(
				`<p>Chart: <img src="${CONTROLLED_IMAGE}" alt="Q3 chart" width="600" height="300"> done</p>` +
					'<p><img src="data:image/png;base64,AAAA" alt="Inline"></p>' +
					'<a href="https://example.com/x"><img src="https://tracker.example/banner.png" alt="Banner"></a>' +
					'<p><img alt=""></p><p>Trailing<b> </b></p><p><img src="data:image/gif;base64,BB"></p>',
			),
		).toEqual([
			{ type: 'paragraph', spans: [{ text: 'Chart:' }] },
			{ type: 'image', alt: 'Q3 chart', src: CONTROLLED_IMAGE },
			{ type: 'paragraph', spans: [{ text: 'done' }] },
			{ type: 'image', alt: 'Inline', src: 'data:image/png;base64,AAAA' },
			{ type: 'image', alt: 'Banner', href: 'https://example.com/x' },
			{ type: 'image', alt: '' },
			{ type: 'paragraph', spans: [{ text: 'Trailing' }] },
			{ type: 'image', alt: '', src: 'data:image/gif;base64,BB' },
		])
	})

	it('reads emoji and icon images as their alt text, inline', () => {
		expect(
			blocksOf(
				'<p>Thanks <img src="data:image/png;base64,AA" alt=":)" width="16" height="16"> all ' +
					'<a href="https://example.com"><img alt="" width="1" height="1"></a>done</p>' +
					'<ul><li><img alt="Logo" src="x.png"> item <a href="https://example.com/i"><img alt="Icon" src="y.png" width="200" height="200"></a></li></ul>',
			),
		).toEqual([
			{ type: 'paragraph', spans: [{ text: 'Thanks :) all done' }] },
			{
				type: 'list',
				ordered: false,
				items: [[{ text: 'Logo item ' }, { text: 'Icon', href: 'https://example.com/i' }]],
			},
		])
	})

	it('separates paragraphs inside a list item or heading with a line break', () => {
		expect(blocksOf('<ul><li><p>First</p><p>Second</p></li></ul><h2><div>Split</div>title</h2>')).toEqual([
			{ type: 'list', ordered: false, items: [[{ text: 'First\n\nSecond' }]] },
			{ type: 'heading', level: 2, spans: [{ text: 'Split\ntitle' }] },
		])
	})

	it('marks detected quoted history and skips its disclosure label, styles and empty blocks', () => {
		expect(
			blocksOf(
				'<style>p{color:red}</style><p>New text</p><p> </p><p><b> </b></p>' +
					'<details class="ownmail-quoted-history"><summary>Show quoted text</summary><div>On Mon, Ines wrote:</div><blockquote>Earlier</blockquote></details>' +
					'<details><summary>Sender disclosure</summary><p>Kept</p></details>',
			),
		).toEqual([
			{ type: 'paragraph', spans: [{ text: 'New text' }] },
			{
				type: 'history',
				blocks: [
					{ type: 'paragraph', spans: [{ text: 'On Mon, Ines wrote:' }] },
					{ type: 'quote', blocks: [{ type: 'paragraph', spans: [{ text: 'Earlier' }] }] },
				],
			},
			{ type: 'paragraph', spans: [{ text: 'Kept' }] },
		])
	})
})

describe('blocksText', () => {
	it('returns what a reader sees, one block per line', () => {
		expect(
			blocksText(
				blocksOf(
					'<h2>Title</h2><p>Body   text</p><ul><li>a</li><li>b</li></ul><blockquote>q</blockquote><hr><pre>code</pre><p><img alt="Chart" src="x"></p>',
				),
			),
		).toBe('Title\nBody text\na\nb\nq\ncode\nChart')
	})
})

describe('messageContent', () => {
	it('splits plaintext into paragraphs and keeps recognised history apart', () => {
		expect(
			messageContent(
				message('Both work for me.\r\n\r\nI will check the room.\n\nOn Mon, Tomas wrote:\n> Thursday?'),
				false,
			),
		).toEqual({
			kind: 'blocks',
			hasRemoteImages: false,
			blocks: [
				{ type: 'paragraph', spans: [{ text: 'Both work for me.' }] },
				{ type: 'paragraph', spans: [{ text: 'I will check the room.' }] },
				{
					type: 'history',
					blocks: [{ type: 'paragraph', spans: [{ text: 'On Mon, Tomas wrote:\n> Thursday?' }] }],
				},
			],
		})
	})

	it('falls back to the snippet, and to no blocks when a message has no text at all', () => {
		expect(messageContent(message('   ', { snippet: 'Preview only' }), false)).toEqual({
			kind: 'blocks',
			hasRemoteImages: false,
			blocks: [{ type: 'paragraph', spans: [{ text: 'Preview only' }] }],
		})
		expect(messageContent(message(undefined), false)).toEqual({
			kind: 'blocks',
			hasRemoteImages: false,
			blocks: [],
		})
	})

	it('converts an HTML reply into blocks with its quoted history marked', () => {
		const content = messageContent(
			message(
				'<div>Sounds good.</div><div class="gmail_quote">On Mon, Ines wrote:<blockquote>Draft</blockquote></div>',
			),
			false,
		)
		expect(content).toEqual({
			kind: 'blocks',
			hasRemoteImages: false,
			blocks: [
				{ type: 'paragraph', spans: [{ text: 'Sounds good.' }] },
				{
					type: 'history',
					blocks: [
						{ type: 'paragraph', spans: [{ text: 'On Mon, Ines wrote:' }] },
						{ type: 'quote', blocks: [{ type: 'paragraph', spans: [{ text: 'Draft' }] }] },
					],
				},
			],
		})
	})

	it('keeps remote images blocked until the reader has consented', () => {
		const html = `<p>See the chart</p><img src="${CONTROLLED_IMAGE}" alt="Chart">`
		expect(messageContent(message(html), false)).toEqual({
			kind: 'blocks',
			hasRemoteImages: true,
			blocks: [
				{ type: 'paragraph', spans: [{ text: 'See the chart' }] },
				{ type: 'image', alt: 'Chart' },
			],
		})
		expect(messageContent(message(html, { attachments: [] }), true)).toEqual({
			kind: 'blocks',
			hasRemoteImages: true,
			blocks: [
				{ type: 'paragraph', spans: [{ text: 'See the chart' }] },
				{ type: 'image', alt: 'Chart', src: CONTROLLED_IMAGE },
			],
		})
	})

	it('never loads an image from outside the signed proxy, even with consent', () => {
		const content = messageContent(
			message('<p>Hi</p><img src="https://tracker.example/p.png" alt="Pixel">'),
			true,
		)
		expect(content).toMatchObject({ blocks: [{ type: 'paragraph' }, { type: 'image', alt: 'Pixel' }] })
		expect(JSON.stringify(content)).not.toContain('tracker.example')
	})

	it('leaves drafts, designed mail and messages with nothing to show to the standard reader', () => {
		expect(
			messageContent(message('<pre data-ownmail-markdown="1">draft</pre>', { ownmailDraft: true }), false),
		).toEqual({
			kind: 'original',
		})
		expect(messageContent(message('<table><tr><td>Receipt</td></tr></table>'), false)).toEqual({
			kind: 'original',
		})
		expect(messageContent(message('<div><style>p{color:red}</style></div>'), false)).toEqual({
			kind: 'original',
		})
	})
})

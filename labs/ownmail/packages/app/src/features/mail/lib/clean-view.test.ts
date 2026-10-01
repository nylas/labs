// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import type { MailMessage } from '../state/mail-queries.js'
import {
	blockLinks,
	blocksText,
	bodySignals,
	type CleanBlock,
	CONFIDENCE_THRESHOLD,
	classifyMail,
	cleanConfidence,
	messageContent,
	normaliseBlocks,
	stripHiddenContent,
} from './clean-view.js'
import { sanitizeEmailDocument } from './sanitize-email.js'

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
					'<p><img alt=""></p><p>Trailing<b> </b></p><p><img src="data:image/gif;base64,BB"></p>' +
					'<a href="https://www.example.org/sale?x=1"><img width="300" height="100"></a>',
			),
		).toEqual([
			{ type: 'paragraph', spans: [{ text: 'Chart:' }] },
			{ type: 'image', alt: 'Q3 chart', src: CONTROLLED_IMAGE },
			{ type: 'paragraph', spans: [{ text: 'done' }] },
			{ type: 'image', alt: 'Inline', src: 'data:image/png;base64,AAAA' },
			{ type: 'image', alt: 'Banner', href: 'https://example.com/x' },
			// An unloaded image with no description and no link says nothing, so it is left out.
			{ type: 'paragraph', spans: [{ text: 'Trailing' }] },
			{ type: 'image', alt: '', src: 'data:image/gif;base64,BB' },
			// A linked one is named by its destination, so the link survives.
			{ type: 'image', alt: '', href: 'https://www.example.org/sale?x=1' },
		])
	})

	it('reads emoji and icon images as their alt text, inline', () => {
		expect(
			blocksOf(
				'<p>Thanks <img src="data:image/png;base64,AA" alt=":)" width="16" height="16"> all ' +
					'<a href="https://example.com"><img alt="" width="1" height="1"></a>done ' +
					'<a href="mailto:Help@Example.com"><img width="20" height="20"></a><img width="20" height="20"></p>' +
					'<ul><li><img alt="Logo" src="x.png"> item <a href="https://example.com/i"><img alt="Icon" src="y.png" width="200" height="200"></a></li></ul>',
			),
		).toEqual([
			{
				type: 'paragraph',
				spans: [
					{ text: 'Thanks :) all done ' },
					{ text: 'Help@Example.com', href: 'mailto:Help@Example.com' },
				],
			},
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

	it('leaves drafts and messages with nothing to show to the standard reader', () => {
		expect(
			messageContent(message('<pre data-ownmail-markdown="1">draft</pre>', { ownmailDraft: true }), false),
		).toEqual({ kind: 'original' })
		expect(messageContent(message('<div><style>p{color:red}</style></div>'), false)).toEqual({
			kind: 'original',
		})
	})
})

function sanitized(html: string): HTMLElement {
	return sanitizeEmailDocument(html) as HTMLElement
}

function bodyOf(html: string): HTMLElement {
	return sanitized(html).querySelector('body') as HTMLElement
}

const PROSE_FILLER = 'This paragraph is ordinary body copy that a person would actually read. '.repeat(3)

describe('classifyMail', () => {
	it('measures the body signals it classifies on', () => {
		const body = bodyOf(
			'<table role="presentation"><tr><td><table><tr><td><table><tr><td>Deep <a href="https://example.com/a">link</a></td></tr></table></td></tr></table></td></tr></table>' +
				'<table><tr><td><img alt="x"><a href="https://example.com/unsubscribe">Leave</a><a>no target</a></td></tr></table>',
		)
		expect(bodySignals(body)).toEqual({
			tableDepth: 3,
			presentationTables: 1,
			images: 1,
			textLength: 'DeeplinkLeavenotarget'.length,
			links: 2,
			linkDensity: 'linkLeave'.length / 'DeeplinkLeavenotarget'.length,
			unsubscribeLinks: 1,
		})
		expect(bodySignals(bodyOf('<p></p>')).linkDensity).toBe(0)
	})

	it('tells prose and reply chains from designed mail', () => {
		expect(classifyMail(bodyOf('<p>Hello there</p>'), true)).toBe('prose')
		expect(
			classifyMail(
				bodyOf('<p>Yes</p><details class="ownmail-quoted-history"><p>Earlier</p></details>'),
				true,
			),
		).toBe('reply')
		expect(classifyMail(bodyOf('<table><tr><td>Your receipt</td></tr></table>'), false)).toBe('transactional')
	})

	it('needs two bulk signals, so one stray signal never makes a newsletter', () => {
		// An unsubscribe link alone is decisive: it counts double.
		expect(
			classifyMail(bodyOf(`<p>${PROSE_FILLER}</p><a href="https://example.com/x">Unsubscribe</a>`), true),
		).toBe('newsletter')
		expect(
			classifyMail(
				bodyOf(`<p>${PROSE_FILLER}</p><a href="https://example.com/opt-out?u=1">Stop these</a>`),
				true,
			),
		).toBe('newsletter')
		// Link-dense alone, image-heavy alone, or nested tables alone: not bulk.
		const links =
			'<a href="https://example.com/a">one</a> <a href="https://example.com/b">two</a> <a href="https://example.com/c">three</a> <a href="https://example.com/d">four</a>'
		expect(classifyMail(bodyOf(links), true)).toBe('prose')
		expect(classifyMail(bodyOf('<p>Photos</p><img alt="a"><img alt="b"><img alt="c">'), true)).toBe('prose')
		const nested =
			'<table><tr><td><table><tr><td><table><tr><td>Deep</td></tr></table></td></tr></table></td></tr></table>'
		expect(classifyMail(bodyOf(nested), false)).toBe('transactional')
		// Any two together are.
		expect(classifyMail(bodyOf(`${links}<img alt="a"><img alt="b"><img alt="c">`), true)).toBe('newsletter')
		expect(
			classifyMail(
				bodyOf(
					`<table role="presentation"><tr><td><table role="presentation"><tr><td>${links}</td></tr></table></td></tr></table>`,
				),
				false,
			),
		).toBe('newsletter')
	})
})

describe('stripHiddenContent', () => {
	function stripped(html: string): string {
		const document = sanitized(html)
		stripHiddenContent(document)
		return (document.querySelector('body') as HTMLElement).textContent.replace(/\s+/g, ' ').trim()
	}

	it('removes what no reader would see', () => {
		expect(
			stripped(
				'<div style="display: none">preheader</div><div style="visibility:hidden">ghost</div>' +
					'<span style="mso-hide: all">outlook</span><span style="font-size:0px">zero</span>' +
					'<span style="FONT-SIZE:0;line-height:0">zero too</span><div style="max-height:0;overflow:hidden">squashed</div>' +
					'<span style="opacity:0">clear</span><span style="color:transparent">invisible ink</span>' +
					'<div hidden>attr</div><div class="email-preheader">named</div><div id="preview-text">named too</div>' +
					'<div style="display:none"><span style="display:none">nested</span></div>' +
					'<p style="font-size:0.9em;opacity:0.8;line-height:0.5">Seen</p>',
			),
		).toBe('Seen')
	})

	it('removes tracking pixels and spacers but keeps real images', () => {
		const document = sanitized(
			'<img width="1" height="1" alt=""><img style="width:1px;height:20px" alt=""><img width="600" height="1" alt="">' +
				'<img width="600" height="200" alt="Hero"><img alt="No size">',
		)
		stripHiddenContent(document)
		expect([...document.querySelectorAll('img')].map((image) => image.getAttribute('alt'))).toEqual([
			'Hero',
			'No size',
		])
	})

	it('drops a stylesheet-hidden block only when its text is duplicated elsewhere', () => {
		const html = (extra: string) =>
			`<html><head><style>.mobile{display:none}@media (max-width:480px){.mobile{display:block}.other{display:none}} a[{display:none} .empty{ display : none }</style></head><body><p class="desktop">Read me once</p><p class="mobile">${extra}</p><p class="other">Other</p><p class="empty"></p></body></html>`
		// The mobile copy repeats the desktop copy: one is enough.
		expect(stripped(html('Read me once'))).toBe('Read me onceOther')
		// A hidden block with text found nowhere else stays: removing it could lose content.
		expect(stripped(html('Only on phones'))).toBe('Read me onceOnly on phonesOther')
	})
})

describe('cleanConfidence', () => {
	const score = (html: string) => {
		const body = bodyOf(html)
		return cleanConfidence(body, normaliseBlocks(body))
	}

	it('is full when every visible character is retained', () => {
		expect(score(`<table><tr><td>${PROSE_FILLER}</td></tr></table>`)).toBe(1)
		expect(score('<pre>code only</pre><ul><li>item</li></ul><blockquote>quoted</blockquote>')).toBe(1)
	})

	it('is zero when there is nothing to show', () => {
		expect(score('<p> </p>')).toBe(0)
		// An image description alone is not message text.
		expect(score('<img alt="Poster" width="600" height="800">')).toBe(0)
	})

	it('drops below the threshold for a data table the unwrap would flatten', () => {
		for (const table of [
			`<table><tr><th>Item</th></tr><tr><td>${PROSE_FILLER}</td></tr></table>`,
			`<table><thead><tr><td>Item</td></tr></thead><tr><td>${PROSE_FILLER}</td></tr></table>`,
			`<table><caption>Order</caption><tr><td>${PROSE_FILLER}</td></tr></table>`,
		]) {
			expect(score(table)).toBeLessThan(CONFIDENCE_THRESHOLD)
		}
	})

	it('drops below the threshold when the content is mostly images', () => {
		const links =
			'<a href="https://example.com/unsubscribe">Unsubscribe from these emails at any time by following this long link text</a>'
		expect(score(`<img alt="Sale" width="600" height="400"><p>© Shop</p>${links}`)).toBeLessThan(
			CONFIDENCE_THRESHOLD,
		)
		expect(score(`<img alt="Logo" width="600" height="80"><p>${PROSE_FILLER}</p>`)).toBe(1)
	})

	it('counts text the blocks lost', () => {
		const body = bodyOf(`<p>${PROSE_FILLER}</p><p>${PROSE_FILLER}</p>`)
		const half = normaliseBlocks(body).slice(0, 1)
		expect(cleanConfidence(body, half)).toBeCloseTo(0.5)
	})
})

describe('designed mail', () => {
	const designed = (inner: string) =>
		`<table role="presentation" width="600"><tr><td>${inner}</td></tr><tr><td>${PROSE_FILLER}</td></tr></table>`

	it('becomes an article with its layout tables read in row order', () => {
		const content = messageContent(
			message(
				designed('<table><tr><td>Left cell</td><td>Right cell</td></tr><tr><td>Second row</td></tr></table>'),
			),
			false,
		)
		expect(content).toMatchObject({ kind: 'article', mailClass: 'transactional', hasRemoteImages: false })
		expect(blocksText((content as { blocks: CleanBlock[] }).blocks)).toBe(
			`Left cell\nRight cell\nSecond row\n${PROSE_FILLER.trim()}`,
		)
	})

	it('reads large styled lines as headings and filled links as calls to action', () => {
		const content = messageContent(
			message(
				designed(
					'<div style="font-size:26px">Big title</div><div><span style="font-size:14pt">Section</span></div>' +
						'<div style="font-size:12px">Small print</div><div style="font-size:2em">Relative size</div>' +
						`<div style="font-size:30px">${'Too long to be a heading. '.repeat(6)}</div>` +
						'<div style="font-size:20px"><a href="https://example.com/go" style="background-color:#0b5fff">Go</a></div>' +
						'<table><tr><td bgcolor="#1f5c3d"><a href="https://example.com/read">Read</a></td><td bgcolor="#ffffff"><a href="https://example.com/plain">Plain</a></td>' +
						'<td style="background: transparent"><a href="https://example.com/clear">Clear</a></td><td bgcolor="#222222"><a href="https://example.com/img"><img alt="" width="1" height="1"></a></td>' +
						'<td bgcolor="#222222">Label <a href="https://example.com/part">Part</a></td></tr></table><a href="https://example.com/loose">Loose</a>',
				),
			),
			false,
		) as { blocks: CleanBlock[] }
		expect(content.blocks.slice(0, 5)).toEqual([
			{ type: 'heading', level: 1, spans: [{ text: 'Big title' }] },
			{ type: 'heading', level: 2, spans: [{ text: 'Section' }] },
			{ type: 'paragraph', spans: [{ text: 'Small print' }] },
			{ type: 'paragraph', spans: [{ text: 'Relative size' }] },
			{ type: 'paragraph', spans: [{ text: 'Too long to be a heading. '.repeat(6).trim() }] },
		])
		const spans = content.blocks.flatMap((block) => (block.type === 'paragraph' ? block.spans : []))
		const cta = (href: string) => spans.find((span) => span.href === href)?.cta
		expect(cta('https://example.com/go')).toBe(true)
		expect(cta('https://example.com/read')).toBe(true)
		// A white or transparent cell is not a button, and neither is a link that shares its cell.
		expect(cta('https://example.com/plain')).toBeUndefined()
		expect(cta('https://example.com/clear')).toBeUndefined()
		expect(cta('https://example.com/part')).toBeUndefined()
		expect(cta('https://example.com/loose')).toBeUndefined()
		expect(blockLinks(content.blocks)).toEqual(
			expect.arrayContaining([
				'https://example.com/go',
				'https://example.com/read',
				'https://example.com/loose',
			]),
		)
	})

	it('keeps the standard reader when the gate is unsure, or when original layouts were asked for', () => {
		expect(
			messageContent(message('<table><tr><th>Item</th></tr><tr><td>Notebook</td></tr></table>'), false),
		).toEqual({
			kind: 'original',
		})
		const article = message(designed('Hello'))
		expect(messageContent(article, false).kind).toBe('article')
		expect(messageContent(article, false, false)).toEqual({ kind: 'original' })
	})

	it('still gives a person-to-person reply a bubble when its markup uses tables', () => {
		const reply = message(
			'<p>Friday works.</p><table><tr><td>Mara Lindqvist</td><td>Operations</td></tr></table>' +
				'<div class="gmail_quote">On Mon, Tomas wrote:<blockquote>Thursday?</blockquote></div>',
		)
		expect(messageContent(reply, false)).toMatchObject({ kind: 'blocks' })
		// The reader's layout choice is about designed mail, not about replies.
		expect(messageContent(reply, false, false)).toMatchObject({ kind: 'blocks' })
	})
})

describe('blockLinks', () => {
	it('lists every link target once, wherever it sits', () => {
		const blocks = blocksOf(
			'<h2><a href="https://example.com/h">Title</a></h2><p><a href="https://example.com/p">p</a> <a href="https://example.com/p">again</a> plain</p>' +
				'<ul><li><a href="https://example.com/l">l</a></li><li>none</li></ul><blockquote><a href="https://example.com/q">q</a></blockquote>' +
				'<a href="https://example.com/i"><img alt="i" src="data:image/png;base64,AA"></a><img alt="unlinked" src="data:image/png;base64,AA"><pre>code</pre>',
		)
		expect(blockLinks(blocks)).toEqual([
			'https://example.com/h',
			'https://example.com/p',
			'https://example.com/l',
			'https://example.com/q',
			'https://example.com/i',
		])
	})
})

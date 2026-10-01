// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { CleanBlock } from '../lib/clean-view'
import { CleanBlocks, LinkPreviewRegion } from './CleanBlocks'

afterEach(cleanup)

const CONTROLLED_IMAGE = `/email-images/${'a'.repeat(20)}.${'b'.repeat(20)}?mode=automatic&theme=light`

describe('CleanBlocks', () => {
	it('renders every block kind as an app element, in app typography', () => {
		const blocks: CleanBlock[] = [
			{ type: 'heading', level: 1, spans: [{ text: 'Issue 112' }] },
			{ type: 'heading', level: 3, spans: [{ text: 'Small print' }] },
			{
				type: 'paragraph',
				spans: [
					{ text: 'Plain ' },
					{ text: 'bold', bold: true },
					{ text: 'soft', italic: true },
					{ text: 'x = 1', code: true },
					{ text: 'link', href: 'https://example.com/a', bold: true },
				],
			},
			{ type: 'list', ordered: false, items: [[{ text: 'One' }], [{ text: 'Two' }]] },
			{ type: 'list', ordered: true, items: [[{ text: 'Step' }]] },
			{ type: 'quote', blocks: [{ type: 'paragraph', spans: [{ text: 'Quoted' }] }] },
			{ type: 'code', text: 'const a = 1' },
			{ type: 'rule' },
		]
		const { container } = render(<CleanBlocks blocks={blocks} />)

		expect(screen.getByRole('heading', { level: 2, name: 'Issue 112' })).toHaveClass('text-lg')
		expect(screen.getByRole('heading', { level: 4, name: 'Small print' })).not.toHaveClass('text-lg')
		expect(container.querySelector('strong')).toHaveTextContent('bold')
		expect(container.querySelector('em')).toHaveTextContent('soft')
		expect(container.querySelector('code')).toHaveTextContent('x = 1')
		expect(screen.getByRole('link', { name: 'link' }).querySelector('strong')).not.toBeNull()
		expect(container.querySelector('ul')).toHaveClass('list-disc')
		expect(container.querySelector('ol')).toHaveClass('list-decimal')
		expect(container.querySelectorAll('li')).toHaveLength(3)
		expect(container.querySelector('pre')).toHaveTextContent('const a = 1')
		expect(container.querySelector('hr')).not.toBeNull()
		// Quotation is an indent and muted text: no border on one side.
		const quote = container.querySelector('blockquote') as HTMLElement
		expect(quote).toHaveClass('pl-region', 'text-muted-foreground')
		expect(quote.className).not.toMatch(/border/)
	})

	it('draws a call to action as a button in app colours, with a full-size touch target', () => {
		render(
			<CleanBlocks
				blocks={[
					{
						type: 'paragraph',
						spans: [
							{ text: 'Read the issue', href: 'https://example.com/issue', cta: true },
							{ text: 'plain link', href: 'https://example.com/plain' },
						],
					},
				]}
			/>,
		)
		const button = screen.getByRole('link', { name: 'Read the issue' })
		expect(button).toHaveAttribute('data-cta', 'true')
		expect(button).toHaveClass('min-h-11', 'bg-primary', 'text-primary-foreground')
		expect(button).toHaveAttribute('rel', 'noopener noreferrer nofollow')
		const plain = screen.getByRole('link', { name: 'plain link' })
		expect(plain).not.toHaveAttribute('data-cta')
		expect(plain).toHaveClass('underline')
	})

	it('shows an image only when it has a controlled source, and says so in words otherwise', () => {
		const { container } = render(
			<CleanBlocks
				blocks={[
					{ type: 'image', alt: 'Chart', src: CONTROLLED_IMAGE },
					{ type: 'image', alt: 'Banner', href: 'https://example.com/issue' },
					{ type: 'image', alt: '' },
				]}
			/>,
		)
		const image = screen.getByRole('img', { name: 'Chart' })
		expect(image).toHaveAttribute('src', CONTROLLED_IMAGE)
		expect(image).toHaveAttribute('referrerpolicy', 'no-referrer')
		expect(container.querySelectorAll('img')).toHaveLength(1)
		// A blocked image that was a link keeps its link.
		expect(screen.getByRole('link', { name: 'Image: Banner' })).toHaveAttribute(
			'href',
			'https://example.com/issue',
		)
		expect(screen.getByText('Image not loaded')).toBeInTheDocument()
	})

	it('shows a reply reference as a small filled pointer, and a kept signature as muted text', () => {
		const { container } = render(
			<CleanBlocks
				blocks={[
					{ type: 'reference', author: 'Tomas', text: 'the retro probably fits better on Friday' },
					{ type: 'reference', text: 'no author known' },
					{ type: 'signature', blocks: [{ type: 'paragraph', spans: [{ text: 'Ines Carvalho' }] }] },
				]}
			/>,
		)
		const [named, anonymous] = [...container.querySelectorAll<HTMLElement>('[data-slot="clean-reference"]')]
		expect(named).toHaveTextContent('Tomas: the retro probably fits better on Friday')
		expect(anonymous).toHaveTextContent(/^no author known$/)
		// A fill, not a quote bar down one side.
		expect(named?.className).toMatch(/\bbg-/)
		expect(named?.className).not.toMatch(/border/)
		expect(container.querySelector('[data-slot="clean-signature"]')).toHaveTextContent('Ines Carvalho')
		expect(container.querySelector('[data-slot="clean-signature"]')).toHaveClass('text-muted-foreground')
	})

	it('keeps a data table as a table, with its header row and caption', () => {
		const { container } = render(
			<CleanBlocks
				blocks={[
					{
						type: 'table',
						header: true,
						caption: 'Order 1042',
						rows: [
							[[{ text: 'Item' }], [{ text: 'Price' }]],
							[[{ text: 'Notebook' }], [{ text: '$18.00', href: 'https://shop.example/n' }]],
						],
					},
					{ type: 'table', header: false, rows: [[[{ text: 'Depart' }], [{ text: '8:40 AM' }]]] },
				]}
			/>,
		)
		const [first, second] = [...container.querySelectorAll('table')]
		expect(first?.querySelector('caption')).toHaveTextContent('Order 1042')
		expect([...(first?.querySelectorAll('th') ?? [])].map((cell) => cell.textContent)).toEqual([
			'Item',
			'Price',
		])
		expect(first?.querySelector('th')).toHaveAttribute('scope', 'col')
		expect(first?.querySelectorAll('td')).toHaveLength(2)
		expect(screen.getByRole('link', { name: '$18.00' })).toHaveAttribute('href', 'https://shop.example/n')
		// No header row was marked, so none is invented; and a wide table scrolls instead of squeezing.
		expect(second?.querySelector('th, caption')).toBeNull()
		expect(first?.parentElement).toHaveClass('overflow-x-auto')
		// Row separators are full-width hairlines, and cell text keeps 12px clear of them.
		expect(first?.querySelector('tr')).toHaveClass('border-b', 'border-border')
		expect(first?.querySelector('td')).toHaveClass('py-hairline')
	})

	it('folds the footer into one disclosure that says what is inside, and keeps every link in it', () => {
		const footer = (links: number, unsubscribe: boolean): CleanBlock => ({
			type: 'footer',
			links,
			unsubscribe,
			blocks: [
				{ type: 'paragraph', spans: [{ text: 'Unsubscribe', href: 'https://example.com/unsubscribe' }] },
			],
		})
		const { container } = render(
			<CleanBlocks blocks={[footer(6, true), footer(1, false), footer(2, false), footer(0, false)]} />,
		)
		const summaries = [...container.querySelectorAll('[data-slot="clean-footer"] > summary')]
		expect(summaries.map((summary) => summary.textContent)).toEqual([
			'Footer, 6 links including Unsubscribe',
			'Footer, 1 link',
			'Footer, 2 links',
			'Footer',
		])
		expect(summaries[0]).toHaveClass('min-h-11', 'focus-visible:ring-2')
		// Folded, not deleted: the link is in the document and reachable once opened.
		expect(container.querySelector('[data-slot="clean-footer"] a')).toHaveAttribute(
			'href',
			'https://example.com/unsubscribe',
		)
	})

	it('keeps quoted history behind a disclosure with a full-size touch target', () => {
		render(
			<CleanBlocks
				blocks={[{ type: 'history', blocks: [{ type: 'paragraph', spans: [{ text: 'Earlier message' }] }] }]}
			/>,
		)
		const summary = screen.getByText('Quoted text')
		expect(summary.tagName).toBe('SUMMARY')
		expect(summary).toHaveClass('min-h-11', 'focus-visible:ring-2')
		expect(summary.closest('details')).toHaveTextContent('Earlier message')
		expect(summary.closest('details')).not.toHaveAttribute('open')
	})
})

describe('LinkPreviewRegion', () => {
	it('anchors the preview to the focused link when there is no pointer', () => {
		render(
			<LinkPreviewRegion data-testid="region">
				<a href="https://example.com/very/long">go</a>
				<span>text</span>
			</LinkPreviewRegion>,
		)
		fireEvent.focus(screen.getByRole('link', { name: 'go' }))
		const preview = document.querySelector('[data-slot="link-preview"]') as HTMLElement
		expect(preview).toHaveTextContent('https://example.com/very/long')
		expect(preview.style.left).not.toBe('')

		fireEvent.focus(screen.getByText('text'))
		expect(document.querySelector('[data-slot="link-preview"]')).toBeNull()
	})
})

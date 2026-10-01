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

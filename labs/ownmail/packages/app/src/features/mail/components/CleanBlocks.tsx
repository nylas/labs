import { type ComponentProps, type ReactNode, type SyntheticEvent, useState } from 'react'
import { cn } from '#shared/lib/utils'
import type { CleanBlock, CleanImage, CleanSpan } from '../lib/clean-view.js'
import { linkPreviewText, type PreviewPoint, previewBoxStyle } from '../lib/email-render.js'
import { anchorHref, previewPoint } from './email-content-element.js'

/** Blocks and spans never reorder, so their position is a stable key. */
function keyed<T>(items: readonly T[]): Array<{ key: string; item: T }> {
	return items.map((item, position) => ({ key: String(position), item }))
}

/**
 * A sender-authored link, with the same handling the email renderer applies:
 * a new tab, no opener, no referrer, and a visible underline and focus ring.
 * The block model only carries http(s) and mailto targets.
 */
function SafeLink({ href, children }: { href: string; children: ReactNode }) {
	return (
		<a
			href={href}
			target="_blank"
			rel="noopener noreferrer nofollow"
			className="rounded-sm underline underline-offset-2 [overflow-wrap:anywhere] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
		>
			{children}
		</a>
	)
}

function Span({ span }: { span: CleanSpan }) {
	let node: ReactNode = span.text
	if (span.code)
		node = <code className="rounded-sm bg-background/60 px-control font-mono text-sm">{node}</code>
	if (span.italic) node = <em>{node}</em>
	if (span.bold) node = <strong className="font-semibold">{node}</strong>
	return span.href ? <SafeLink href={span.href}>{node}</SafeLink> : node
}

function Spans({ spans }: { spans: CleanSpan[] }) {
	return keyed(spans).map(({ key, item }) => <Span key={key} span={item} />)
}

const HEADING_TAGS = ['h2', 'h3', 'h4'] as const

function Image({ image }: { image: CleanImage }) {
	// Without a source the image is blocked, or was never safe to load: say so
	// in words instead of painting a broken image.
	const content = image.src ? (
		<img
			src={image.src}
			alt={image.alt}
			loading="lazy"
			decoding="async"
			referrerPolicy="no-referrer"
			className="h-auto max-w-full rounded-md"
		/>
	) : (
		<span data-slot="clean-image-placeholder" className="text-sm text-muted-foreground">
			{image.alt ? `Image: ${image.alt}` : 'Image not loaded'}
		</span>
	)
	return <p>{image.href ? <SafeLink href={image.href}>{content}</SafeLink> : content}</p>
}

function Block({ block }: { block: CleanBlock }) {
	switch (block.type) {
		case 'heading': {
			const Tag = HEADING_TAGS[block.level - 1] as (typeof HEADING_TAGS)[number]
			return (
				<Tag className={cn('font-sans font-semibold tracking-normal', block.level === 1 && 'text-lg')}>
					<Spans spans={block.spans} />
				</Tag>
			)
		}
		case 'paragraph':
			return (
				<p className="whitespace-pre-line">
					<Spans spans={block.spans} />
				</p>
			)
		case 'list': {
			const Tag = block.ordered ? 'ol' : 'ul'
			return (
				<Tag
					className={cn('flex flex-col gap-control pl-section', block.ordered ? 'list-decimal' : 'list-disc')}
				>
					{keyed(block.items).map(({ key, item }) => (
						<li key={key} className="whitespace-pre-line">
							<Spans spans={item} />
						</li>
					))}
				</Tag>
			)
		}
		case 'quote':
			// Quotation is an indent and muted text, never a side rail.
			return (
				<blockquote className="pl-region text-muted-foreground">
					<CleanBlocks blocks={block.blocks} />
				</blockquote>
			)
		case 'image':
			return <Image image={block} />
		case 'code':
			return (
				<pre className="overflow-x-auto rounded-md bg-background/60 p-hairline font-mono text-sm">
					{block.text}
				</pre>
			)
		case 'rule':
			return <hr className="border-border" />
		case 'history':
			return (
				<details data-slot="clean-quoted-history" className="text-muted-foreground">
					<summary className="flex min-h-11 cursor-pointer items-center rounded-sm text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
						Quoted text
					</summary>
					<div className="pl-region">
						<CleanBlocks blocks={block.blocks} />
					</div>
				</details>
			)
	}
}

/** Renders the clean block model in app typography. Every node is a React element. */
export function CleanBlocks({ blocks }: { blocks: CleanBlock[] }) {
	return (
		<div
			data-slot="clean-blocks"
			className="flex min-w-0 flex-col gap-hairline text-base leading-relaxed [overflow-wrap:anywhere]"
		>
			{keyed(blocks).map(({ key, item }) => (
				<Block key={key} block={item} />
			))}
		</div>
	)
}

/**
 * Shows a link's real target beside the pointer or the focused link, as the
 * email renderer does for links inside its shadow root (an anti-phishing aid).
 */
export function LinkPreviewRegion({ children, ...props }: ComponentProps<'div'>) {
	const [preview, setPreview] = useState<({ href: string } & PreviewPoint) | null>(null)
	const show = (event: SyntheticEvent) => {
		const href = anchorHref(event.target)
		setPreview(href ? { href, ...previewPoint(event.nativeEvent, event.target) } : null)
	}
	const hide = () => setPreview(null)
	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: the handlers only observe links inside to preview their target; the region itself is not a control.
		<div {...props} onMouseOver={show} onFocus={show} onMouseOut={hide} onBlur={hide}>
			{children}
			{preview ? (
				<div
					data-slot="link-preview"
					className="pointer-events-none fixed z-50 max-w-[min(90vw,32rem)] truncate rounded-md bg-foreground px-hairline py-cluster text-xs font-medium text-background shadow-lg"
					style={previewBoxStyle(preview, { width: window.innerWidth, height: window.innerHeight })}
				>
					{linkPreviewText(preview.href)}
				</div>
			) : null}
		</div>
	)
}

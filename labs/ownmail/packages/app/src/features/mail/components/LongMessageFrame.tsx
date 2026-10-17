import { type ReactNode, useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { cn } from '#shared/lib/utils'
import { readingStats } from '../lib/thread-reading-model.js'
import { ThreadColumn } from './ThreadColumn.js'

/** Past this many words of new text a message gets reading time, progress and an outline. */
export const LONG_MESSAGE_WORDS = 1500
/** A heading counts as the current section once it is this close to the top of the view. */
const CURRENT_SECTION_SLACK = 96

const positionKey = (messageId: string): string => `ownmail:reading-position:${messageId}`

/** Where a reader stopped in a message: how far past its top the view was, in pixels. */
export function readSavedOffset(messageId: string): number {
	try {
		const saved = Number(sessionStorage.getItem(positionKey(messageId)))
		return Number.isFinite(saved) && saved > 0 ? saved : 0
	} catch {
		return 0
	}
}

function saveOffset(messageId: string, offset: number): void {
	try {
		sessionStorage.setItem(positionKey(messageId), String(Math.max(0, Math.round(offset))))
	} catch {}
}

/** The nearest ancestor that scrolls vertically, or null for the page itself. */
export function scrollParent(element: Element): HTMLElement | null {
	let current = element.parentElement
	while (current) {
		const { overflowY } = getComputedStyle(current)
		if (overflowY === 'auto' || overflowY === 'scroll') return current
		current = current.parentElement
	}
	return null
}

const normalise = (text: string): string => text.replace(/\s+/g, ' ').trim().toLowerCase()

/** The rendered heading elements of a message, in the light DOM and inside rendered email shadow roots. */
export function headingNodes(root: HTMLElement, headings: string[]): Array<Element | null> {
	const scopes: Array<HTMLElement | ShadowRoot> = [root]
	for (const host of root.querySelectorAll('*')) if (host.shadowRoot) scopes.push(host.shadowRoot)
	const found = scopes.flatMap((scope) => [...scope.querySelectorAll('h1, h2, h3')])
	return headings.map(
		(heading) => found.find((node) => normalise(node.textContent as string) === normalise(heading)) ?? null,
	)
}

/**
 * Frames one very long message: reading time, a 4px progress bar and the
 * percent read, and an outline from the message's own headings (a right
 * column on wide screens, a disclosure otherwise). Reopening the message
 * returns to where the reader stopped. Shorter messages pass through as is.
 */
export function LongMessageFrame({
	messageId,
	text,
	headings,
	children,
}: {
	messageId: string
	text: string
	headings: string[]
	children: ReactNode
}) {
	const stats = useMemo(() => readingStats(text), [text])
	if (stats.words <= LONG_MESSAGE_WORDS) return <>{children}</>
	return (
		<LongMessageLayout messageId={messageId} minutes={stats.minutes} headings={headings}>
			{children}
		</LongMessageLayout>
	)
}

function LongMessageLayout({
	messageId,
	minutes,
	headings,
	children,
}: {
	messageId: string
	minutes: number
	headings: string[]
	children: ReactNode
}) {
	const rootRef = useRef<HTMLDivElement>(null)
	const [progress, setProgress] = useState(0)
	const [current, setCurrent] = useState(-1)
	const restored = useRef(false)

	const viewport = useCallback((parent: HTMLElement | null) => {
		if (parent) return parent.getBoundingClientRect()
		return { top: 0, bottom: window.innerHeight }
	}, [])

	const measure = useCallback(() => {
		const root = rootRef.current as HTMLDivElement
		const parent = scrollParent(root)
		const view = viewport(parent)
		const rect = root.getBoundingClientRect()
		if (rect.height <= 0) return
		const read = Math.min(1, Math.max(0, (view.bottom - rect.top) / rect.height))
		setProgress(read)
		if (restored.current) saveOffset(messageId, view.top - rect.top)
		const nodes = headingNodes(root, headings)
		let section = -1
		nodes.forEach((node, index) => {
			if (node && node.getBoundingClientRect().top <= view.top + CURRENT_SECTION_SLACK) section = index
		})
		setCurrent(section)
	}, [headings, messageId, viewport])

	// Return to where the reader stopped once the message has its height, then follow the scroll.
	useLayoutEffect(() => {
		const root = rootRef.current as HTMLDivElement
		const parent = scrollParent(root)
		const target = parent ?? window
		let frame = 0
		const schedule = () => {
			cancelAnimationFrame(frame)
			frame = requestAnimationFrame(measure)
		}
		const restore = () => {
			if (restored.current) return
			const offset = readSavedOffset(messageId)
			const view = viewport(parent)
			const rect = root.getBoundingClientRect()
			if (offset > 0 && rect.height < offset) return
			restored.current = true
			if (offset > 0) {
				const by = rect.top - view.top + offset
				if (parent) parent.scrollTop += by
				else window.scrollBy(0, by)
			}
			schedule()
		}
		restore()
		const observer = new ResizeObserver(() => {
			restore()
			schedule()
		})
		observer.observe(root)
		target.addEventListener('scroll', schedule, { passive: true })
		return () => {
			cancelAnimationFrame(frame)
			observer.disconnect()
			target.removeEventListener('scroll', schedule)
		}
	}, [measure, messageId, viewport])

	/** Brings a section's heading to the top of the view, under the progress bar while it is pinned. */
	const goTo = (index: number) => {
		const root = rootRef.current as HTMLDivElement
		const node = headingNodes(root, headings)[index]
		if (!node) return
		const parent = scrollParent(root)
		const bar = root.querySelector('[data-slot="long-message-progress"]') as HTMLElement
		const pinned = getComputedStyle(bar).position === 'sticky' ? bar.getBoundingClientRect().height : 0
		// The pane's scroll padding is the bar it scrolls under (the toolbar); the progress bar pins below it.
		const padding = parent ? Number.parseFloat(getComputedStyle(parent).scrollPaddingTop) || 0 : 0
		const by = node.getBoundingClientRect().top - viewport(parent).top - padding - pinned
		if (parent) parent.scrollBy({ top: by, behavior: 'smooth' })
		else window.scrollBy({ top: by, behavior: 'smooth' })
	}

	const percent = Math.round(progress * 100)
	const outline =
		headings.length > 0 ? (
			<ol className="m-0 flex list-none flex-col gap-1 p-0 text-xs">
				{headings.map((heading, index) => (
					// A message's headings never reorder, and two can share words; the position tells them apart.
					// biome-ignore lint/suspicious/noArrayIndexKey: headings are positional.
					<li key={index}>
						<button
							type="button"
							onClick={() => goTo(index)}
							aria-current={index === current ? 'location' : undefined}
							className={cn(
								'rounded-sm text-left transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-md:min-h-11 [@media(any-pointer:coarse)]:min-h-11',
								index === current ? 'font-semibold text-foreground' : 'text-muted-foreground',
							)}
						>
							{index + 1} {heading}
						</button>
					</li>
				))}
			</ol>
		) : null

	return (
		<div
			ref={rootRef}
			data-slot="long-message"
			className="xl:grid xl:grid-cols-[minmax(0,1fr)_130px] xl:items-start xl:gap-x-6"
		>
			<div className="min-w-0">
				<div data-slot="long-message-progress" className="z-10 bg-background pb-3 md:sticky md:top-0">
					<ThreadColumn>
						<div className="flex flex-col gap-2">
							<div
								role="progressbar"
								aria-label="Read so far"
								aria-valuemin={0}
								aria-valuemax={100}
								aria-valuenow={percent}
								className="h-1 overflow-hidden rounded-full bg-border"
							>
								<div className="h-1 rounded-full bg-primary" style={{ width: `${percent}%` }} />
							</div>
							<p className="m-0 font-data text-xs text-muted-foreground tabular-nums">
								{minutes} min read · {percent}%
							</p>
							{outline ? (
								<details className="xl:hidden">
									<summary className="cursor-pointer text-xs font-semibold text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
										Outline
									</summary>
									<div className="pt-2">{outline}</div>
								</details>
							) : null}
						</div>
					</ThreadColumn>
				</div>
				{children}
			</div>
			{outline ? (
				<nav aria-label="Outline" className="sticky top-16 hidden pt-8 xl:block">
					{outline}
				</nav>
			) : null}
		</div>
	)
}

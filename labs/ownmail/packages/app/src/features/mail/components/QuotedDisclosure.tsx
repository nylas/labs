import { MoreHorizontal } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import {
	attributionSeconds,
	type BodyDisclosure,
	type QuotedEntry,
	quotedExcerpt,
} from '../lib/body-disclosure.js'
import { clockTime, viewerZone } from '../lib/edge-states.js'
import { firstName, shortDayLabel } from '../lib/thread-reading-model.js'
import { EDGE_LINK_CLASS } from './edge-actions.js'

export type DisclosureKind = 'quoted' | 'signature' | 'both'

/** "Quoted text and signature", "Quoted: 2 earlier messages", "Signature". */
export function disclosureLabel(kind: DisclosureKind, count = 0): string {
	if (kind === 'both') return 'Quoted text and signature'
	if (kind === 'signature') return 'Signature'
	if (count <= 0) return 'Quoted text'
	return `Quoted: ${count} earlier ${count === 1 ? 'message' : 'messages'}`
}

/**
 * The quiet pill that stands in for what trails a message: its quoted history,
 * its signature, or both at once. 24px, 6px radius, a muted fill and muted
 * 12px words; the history pills lead with a "more" glyph.
 */
export function QuotedDisclosure({
	kind,
	count = 0,
	expanded,
	onToggle,
	controls,
	ref,
}: {
	kind: DisclosureKind
	count?: number
	expanded: boolean
	onToggle(): void
	controls?: string
	ref?: React.Ref<HTMLButtonElement>
}) {
	return (
		<button
			ref={ref}
			type="button"
			data-slot="quoted-disclosure"
			data-kind={kind}
			aria-expanded={expanded}
			aria-controls={controls}
			onClick={onToggle}
			className="inline-flex h-6 shrink-0 items-center gap-1 rounded-md bg-muted px-2 text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-expanded:text-foreground max-md:min-h-11 [@media(any-pointer:coarse)]:min-h-11"
		>
			{kind === 'signature' ? null : <MoreHorizontal aria-hidden="true" className="size-3.5 shrink-0" />}
			{disclosureLabel(kind, count)}
		</button>
	)
}

/** "Grace, Tue 6:02 PM": who wrote a quoted message and when, as the reader names days. */
export function quotedHeader(entry: QuotedEntry, now: number, tz: string): string {
	const name = entry.name || entry.email ? firstName({ name: entry.name, email: entry.email ?? '' }) : ''
	const seconds = attributionSeconds(entry.dateText)
	let when = entry.dateText ?? ''
	if (seconds !== null) {
		const day = shortDayLabel(seconds, now, tz)
		const time = clockTime(seconds, tz)
		// "Tue 6:02 PM", "yesterday 6:02 PM", "Oct 3, 6:02 PM".
		when = day === 'today' ? time : /\d/.test(day) ? `${day}, ${time}` : `${day} ${time}`
	}
	return [name, when].filter(Boolean).join(', ')
}

export type GoToQuoted = (quote: { name: string; email?: string; date?: number }) => void

/**
 * The pills under a message's own words and what they open. A message with
 * both history and a signature shows one pill; opening it splits into the
 * history (open) and the signature (closed), each its own toggle.
 */
export function BodyDisclosures({
	disclosure,
	onGoToQuoted,
	now = Date.now(),
	tz = viewerZone(),
}: {
	disclosure: BodyDisclosure
	onGoToQuoted?: GoToQuoted
	now?: number
	tz?: string
}) {
	const id = useId()
	const [split, setSplit] = useState(false)
	const [quotedOpen, setQuotedOpen] = useState(false)
	const [signatureOpen, setSignatureOpen] = useState(false)
	const quotedPill = useRef<HTMLButtonElement>(null)
	const { quoted, signature } = disclosure
	const both = quoted.length > 0 && signature.length > 0

	useEffect(() => {
		if (split) quotedPill.current?.focus()
	}, [split])

	if (quoted.length === 0 && signature.length === 0) return null
	const quotedId = `${id}-quoted`
	const signatureId = `${id}-signature`
	return (
		<div data-slot="body-disclosures" className="mt-3">
			<div className="flex flex-wrap gap-2">
				{both && !split ? (
					<QuotedDisclosure
						kind="both"
						expanded={false}
						onToggle={() => {
							setSplit(true)
							setQuotedOpen(true)
						}}
					/>
				) : (
					<>
						{quoted.length > 0 ? (
							<QuotedDisclosure
								ref={quotedPill}
								kind="quoted"
								count={quoted.length}
								expanded={quotedOpen}
								controls={quotedId}
								onToggle={() => setQuotedOpen((open) => !open)}
							/>
						) : null}
						{signature.length > 0 ? (
							<QuotedDisclosure
								kind="signature"
								expanded={signatureOpen}
								controls={signatureId}
								onToggle={() => setSignatureOpen((open) => !open)}
							/>
						) : null}
					</>
				)}
			</div>
			{signatureOpen ? (
				<div
					id={signatureId}
					data-slot="body-signature"
					className="mt-3 whitespace-pre-line text-sm leading-normal text-muted-foreground"
				>
					{signature.join('\n')}
				</div>
			) : null}
			{quotedOpen ? (
				<div id={quotedId} data-slot="body-quoted" className="mt-4 flex flex-col gap-2">
					{quoted.map((entry, index) => {
						// Only a quote with an address can be found in the thread.
						const email = onGoToQuoted ? entry.email : undefined
						const linked = Boolean(email)
						const header = quotedHeader(entry, now, tz)
						const date = attributionSeconds(entry.dateText)
						return (
							<div
								// Quoted entries never reorder; the index keeps repeated words distinct.
								// biome-ignore lint/suspicious/noArrayIndexKey: entries are positional.
								key={index}
								className="rounded-md bg-secondary p-3 text-sm leading-normal text-muted-foreground"
							>
								{header ? <div className="mb-1 text-xs font-semibold">{header}</div> : null}
								{entry.text ? (
									<p className="m-0 [overflow-wrap:anywhere]">{quotedExcerpt(entry, linked)}</p>
								) : null}
								{linked ? (
									<button
										type="button"
										className={`${EDGE_LINK_CLASS} mt-1`}
										onClick={() =>
											(onGoToQuoted as GoToQuoted)({
												name: entry.name,
												email: email as string,
												...(date !== null ? { date } : {}),
											})
										}
									>
										Go to {firstName({ name: entry.name, email: email as string })}’s message
									</button>
								) : null}
							</div>
						)
					})}
				</div>
			) : null}
		</div>
	)
}

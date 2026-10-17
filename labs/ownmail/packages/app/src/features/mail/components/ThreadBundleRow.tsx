import { CreditCard, Newspaper } from 'lucide-react'
import { memo } from 'react'
import { cn } from '#shared/lib/utils'
import { type BundleKind, bundleSummary } from '../lib/thread-list-model.js'
import type { MailThread } from '../state/mail-queries.js'
import { THREAD_ROW_CLASS } from './ThreadRow.js'

/** The ring a thread row's stretched link shows on focus, on the bundle button itself. */
const BUNDLE_FOCUS_CLASS =
	'focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring forced-colors:focus-visible:outline-2 forced-colors:focus-visible:outline-offset-[-2px] forced-colors:focus-visible:outline-solid'

/**
 * One row for a day's newsletters or receipts, so people stay on top of the
 * list: an icon tile, the kind with its count, and the senders (newsletters)
 * or who was paid how much (receipts). Clicking it lists its conversations
 * beneath it, indented; clicking again folds them back.
 */
export const ThreadBundleRow = memo(function ThreadBundleRow({
	bundleKey,
	bundle,
	threads,
	expanded,
	navActive,
	onToggle,
}: {
	bundleKey: string
	bundle: BundleKind
	threads: MailThread[]
	expanded: boolean
	navActive: boolean
	onToggle: (bundleKey: string) => void
}) {
	const summary = bundleSummary(bundle, threads)
	const Icon = bundle === 'newsletter' ? Newspaper : CreditCard
	return (
		<button
			type="button"
			className={cn(THREAD_ROW_CLASS, 'thread-bundle', BUNDLE_FOCUS_CLASS)}
			aria-expanded={expanded}
			aria-label={`${summary.title}, ${summary.count} conversations: ${summary.line}`}
			data-nav-row=""
			data-nav-cursor={navActive ? 'true' : undefined}
			data-bundle={bundle}
			data-flip-id={bundleKey}
			onClick={() => onToggle(bundleKey)}
		>
			<span aria-hidden="true" className="thread-bundle-tile bg-muted text-muted-foreground">
				<Icon className="h-4 w-4" />
			</span>
			<span className="thread-bundle-text">
				<span className="thread-bundle-title flex min-w-0 items-baseline gap-cluster">
					<span
						className={cn(
							'thread-bundle-name min-w-0 flex-1 truncate text-sm text-foreground',
							summary.unread ? 'font-semibold' : 'font-normal',
						)}
					>
						{summary.title}
					</span>
					<span className="thread-signal thread-signal-count bg-muted font-data tabular-nums">
						{summary.count}
					</span>
				</span>
				<span className="thread-bundle-line truncate text-[13px] text-muted-foreground">{summary.line}</span>
			</span>
		</button>
	)
})

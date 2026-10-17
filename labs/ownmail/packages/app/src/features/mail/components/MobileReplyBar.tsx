import { Forward, Reply, ReplyAll } from 'lucide-react'
import { createPortal } from 'react-dom'
import { Button } from '#shared/components/ui/button'
import { IconButton } from '#shared/components/ui/icon-button'
import { useMobileThreadActionsTarget } from './ThreadResponseActions.js'

// The respond actions are outlined in the create action's line; only Reply all's icon carries the accent.
const OUTLINED = 'h-11 border-cta-line text-foreground shadow-none'

/**
 * The phone thread's bottom bar (board 03): Reply all is the one labelled
 * button and takes the width, Reply and Forward are square icons beside it.
 * It fills the thread slot of the mobile tab bar, so it shares that bar's
 * glass, height and safe-area inset instead of stacking a second bottom bar.
 * Board 03 draws the bar 76px tall, its hairline and 8px over the 44px
 * buttons with the rest below; the bottom padding gives the device's
 * safe-area inset that room first, so the bar is 76px on a phone without one
 * and the tab bar's height plus the inset on a phone with one.
 */
export function MobileReplyBar({
	onReplyAll,
	onReply,
	onForward,
}: {
	onReplyAll: () => void
	onReply: () => void
	onForward: () => void
}) {
	const target = useMobileThreadActionsTarget()
	if (!target) return null

	return createPortal(
		<div
			data-slot="mobile-reply-bar"
			className="col-span-full flex items-center gap-cluster px-hairline pt-cluster pb-[max(0.5rem,calc(1.4375rem-var(--safe-area-bottom)))]"
		>
			<Button
				type="button"
				variant="outline"
				onClick={onReplyAll}
				className={`${OUTLINED} min-w-0 flex-1 gap-cluster text-[15px] font-semibold`}
			>
				<ReplyAll className="size-[18px] text-cta-icon" aria-hidden="true" />
				Reply all
			</Button>
			<IconButton
				label="Reply"
				variant="outline"
				onClick={onReply}
				className={`${OUTLINED} size-11 bg-transparent`}
			>
				<Reply className="size-5" aria-hidden="true" />
			</IconButton>
			<IconButton
				label="Forward"
				variant="outline"
				onClick={onForward}
				className={`${OUTLINED} size-11 bg-transparent`}
			>
				<Forward className="size-5" aria-hidden="true" />
			</IconButton>
		</div>,
		target,
	)
}

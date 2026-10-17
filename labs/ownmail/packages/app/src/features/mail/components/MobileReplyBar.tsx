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
			className="col-span-full flex items-center gap-cluster px-hairline py-cluster"
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

import { Forward, Reply, ReplyAll } from 'lucide-react'
import { createPortal } from 'react-dom'
import { MOBILE_BOTTOM_BAR_THREAD_ACTIONS_ID } from '#app/components/MobileTabBar'
import { useMounted } from '#shared/components/ClientTime'

export function MobileThreadResponseActions({
	onReply,
	onReplyAll,
	onForward,
}: {
	onReply: () => void
	onReplyAll: () => void
	onForward: () => void
}) {
	const mounted = useMounted()
	const target = mounted ? document.getElementById(MOBILE_BOTTOM_BAR_THREAD_ACTIONS_ID) : null
	if (!target) return null

	return createPortal(
		<>
			<ResponseButton label="Reply to thread" onClick={onReply}>
				<Reply className="h-5 w-5" aria-hidden="true" />
			</ResponseButton>
			<ResponseButton label="Reply all to thread" onClick={onReplyAll}>
				<ReplyAll className="h-5 w-5" aria-hidden="true" />
			</ResponseButton>
			<ResponseButton label="Forward thread" onClick={onForward}>
				<Forward className="h-5 w-5" aria-hidden="true" />
			</ResponseButton>
		</>,
		target,
	)
}

function ResponseButton({
	label,
	onClick,
	children,
}: {
	label: string
	onClick: () => void
	children: React.ReactNode
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			aria-label={label}
			title={label}
			className="mobile-tab min-h-11 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring forced-colors:focus-visible:outline-2 forced-colors:focus-visible:outline-offset-2 forced-colors:focus-visible:outline-solid"
		>
			{children}
		</button>
	)
}

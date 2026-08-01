import { Forward, Reply, ReplyAll } from 'lucide-react'

export function MobileThreadResponseActions({
	onReply,
	onReplyAll,
	onForward,
}: {
	onReply: () => void
	onReplyAll: () => void
	onForward: () => void
}) {
	return (
		<fieldset className="m-0 grid min-w-0 grid-cols-3 gap-2 border-0 p-0 pr-14 sm:hidden">
			<legend className="sr-only">Thread response actions</legend>
			<ResponseButton label="Reply to thread" onClick={onReply}>
				<Reply className="h-4 w-4 shrink-0" />
				<span>Reply</span>
			</ResponseButton>
			<ResponseButton label="Reply all to thread" onClick={onReplyAll}>
				<ReplyAll className="h-4 w-4 shrink-0" />
				<span>Reply all</span>
			</ResponseButton>
			<ResponseButton label="Forward thread" onClick={onForward}>
				<Forward className="h-4 w-4 shrink-0" />
				<span>Forward</span>
			</ResponseButton>
		</fieldset>
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
			className="flex min-h-11 min-w-0 items-center justify-center gap-1.5 rounded-lg border border-border bg-muted/30 px-2 text-sm font-medium text-muted-foreground transition-colors hover:border-ring/30 hover:bg-muted/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-[399px]:flex-col max-[399px]:gap-0.5 max-[399px]:px-1 max-[399px]:text-xs"
		>
			{children}
		</button>
	)
}

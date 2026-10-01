import { Mail, MessagesSquare } from 'lucide-react'
import type { ThreadView } from '#app/preferences/user-preferences'
import { IconButton } from '#shared/components/ui/icon-button'
import { cn } from '#shared/lib/utils'

type ThreadViewOption = { value: ThreadView; label: string; icon: typeof Mail }

export const THREAD_VIEW_OPTIONS: readonly ThreadViewOption[] = [
	{ value: 'messages', label: 'Messages', icon: Mail },
	{ value: 'conversation', label: 'Conversation', icon: MessagesSquare },
]

/**
 * Switches one thread between the standard reader and the Conversation view.
 * Both choices are the shared icon button, so the thread toolbar stays one
 * size. The current view is carried by `aria-pressed` and a fill, never by
 * colour alone.
 */
export function ThreadViewSwitch({
	value,
	onChange,
}: {
	value: ThreadView
	onChange: (value: ThreadView) => void
}) {
	return (
		<fieldset
			data-slot="thread-view-switch"
			className="flex min-w-0 shrink-0 items-center gap-control border-0 p-0"
		>
			<legend className="sr-only">Thread view</legend>
			{THREAD_VIEW_OPTIONS.map(({ value: option, label, icon: Icon }) => (
				<IconButton
					key={option}
					label={`${label} view`}
					aria-pressed={value === option}
					onClick={() => onChange(option)}
					className={cn(value === option && 'bg-accent text-foreground')}
				>
					<Icon aria-hidden="true" />
				</IconButton>
			))}
		</fieldset>
	)
}

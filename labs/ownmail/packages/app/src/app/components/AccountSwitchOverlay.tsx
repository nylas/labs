import { Loader2 } from 'lucide-react'
import { useAccountSwitchStatus } from '../lib/account-switch-status.js'

/** Covers the previous inbox while the next one loads, so its data never mixes
 * with the new inbox on screen. */
export function AccountSwitchOverlay() {
	const switchingTo = useAccountSwitchStatus()
	if (!switchingTo) return null
	return (
		<div className="account-switch-overlay fixed inset-0 z-[100] flex items-center justify-center bg-background/80 px-4 backdrop-blur-sm">
			<div
				role="status"
				aria-live="polite"
				className="flex max-w-full min-w-0 items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 text-sm text-card-foreground shadow-lg"
			>
				<Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" aria-hidden="true" />
				<span className="min-w-0 truncate">
					Switching to <span className="font-medium">{switchingTo}</span>…
				</span>
			</div>
		</div>
	)
}

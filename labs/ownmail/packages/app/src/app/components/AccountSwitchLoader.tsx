import { Loader2 } from 'lucide-react'

/** Stands in for the whole app while the next inbox loads. The root route
 * renders it instead of its outlet, so the previous inbox is unmounted rather
 * than covered: none of its data stays readable, and no mounted query observer
 * can write it back into the cleared cache. */
export function AccountSwitchLoader({ email }: { email: string }) {
	return (
		<div className="account-switch-loader flex min-h-dvh items-center justify-center bg-background px-4">
			<div
				role="status"
				aria-live="polite"
				className="flex max-w-full min-w-0 items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 text-sm text-card-foreground shadow-lg"
			>
				<Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" aria-hidden="true" />
				<span className="min-w-0 truncate">
					Switching to <span className="font-medium">{email}</span>…
				</span>
			</div>
		</div>
	)
}

import { X } from 'lucide-react'
import { type ReactNode, useEffect } from 'react'
import { cn } from '../lib/utils.js'
import { Dialog, DialogContent, DialogTitle } from './ui/dialog.js'

/** Slide-over panel for mobile navigation and sidebars. */
export function Sheet({
	open,
	onClose,
	title,
	side = 'left',
	hideAt = 'md',
	children,
}: {
	open: boolean
	onClose: () => void
	title: string
	side?: 'left' | 'right'
	hideAt?: 'md' | 'lg'
	children: ReactNode
}) {
	useEffect(() => {
		if (!open || typeof window.matchMedia !== 'function') return
		const query = hideAt === 'lg' ? '(min-width: 64rem)' : '(min-width: 48rem)'
		const media = window.matchMedia(query)
		const closeAtDesktopBreakpoint = (event: MediaQueryListEvent | MediaQueryList) => {
			if (event.matches) onClose()
		}
		closeAtDesktopBreakpoint(media)
		media.addEventListener('change', closeAtDesktopBreakpoint)
		return () => media.removeEventListener('change', closeAtDesktopBreakpoint)
	}, [hideAt, onClose, open])

	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				/* v8 ignore else -- @preserve this controlled sheet only acts on dismissal requests */
				if (!next) onClose()
			}}
		>
			<DialogContent
				presentation="side"
				data-side={side}
				aria-label={title}
				onBackdropClick={onClose}
				className={cn(
					'flex w-[min(20rem,calc(100%_-_2rem))] max-w-none flex-col border-border bg-background pt-[var(--safe-area-top)] shadow-2xl',
					side === 'left' ? 'left-0 border-r' : 'right-0 left-auto border-l',
					hideAt === 'lg' ? 'lg:hidden' : 'md:hidden',
				)}
			>
				<div className="flex h-14 shrink-0 items-center justify-between border-b border-border pr-[max(0.75rem,var(--safe-area-right))] pl-[max(0.75rem,var(--safe-area-left))]">
					<DialogTitle className="font-display text-sm font-semibold">{title}</DialogTitle>
					<button
						type="button"
						onClick={onClose}
						aria-label={`Close ${title.toLowerCase()}`}
						className="flex size-9 max-md:size-11 [@media(any-pointer:coarse)]:size-11 items-center justify-center rounded-md text-muted-foreground transition-[background-color,color,transform] duration-[var(--dur-fast)] ease-[var(--ease-out)] hover:bg-muted hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring press forced-colors:focus-visible:outline-2 forced-colors:focus-visible:outline-offset-2 forced-colors:focus-visible:outline-solid"
					>
						<X className="h-4 w-4" />
					</button>
				</div>
				<div className="min-h-0 flex-1 overflow-y-auto pr-[var(--safe-area-right)] pb-[var(--safe-area-bottom)] pl-[var(--safe-area-left)]">
					{children}
				</div>
			</DialogContent>
		</Dialog>
	)
}

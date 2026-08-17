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
				<div className="flex h-14 shrink-0 items-center justify-between border-b border-border px-3">
					<DialogTitle className="font-display text-sm font-semibold">{title}</DialogTitle>
					<button
						type="button"
						onClick={onClose}
						aria-label={`Close ${title.toLowerCase()}`}
						className="flex h-11 w-11 items-center justify-center rounded-lg text-muted-foreground transition-[background-color,color,transform] duration-[var(--dur-fast)] ease-[var(--ease-out)] hover:bg-muted hover:text-foreground active:translate-y-px"
					>
						<X className="h-4 w-4" />
					</button>
				</div>
				<div className="min-h-0 flex-1 overflow-y-auto pb-[var(--safe-area-bottom)]">{children}</div>
			</DialogContent>
		</Dialog>
	)
}

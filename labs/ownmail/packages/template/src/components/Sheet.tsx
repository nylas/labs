import { X } from 'lucide-react'
import { useEffect, useRef, type ReactNode } from 'react'
import { cn } from './ui-model.js'

/** Slide-over panel for mobile navigation and sidebars. */
export function Sheet({
	open,
	onClose,
	title,
	side = 'left',
	children,
}: {
	open: boolean
	onClose: () => void
	title: string
	side?: 'left' | 'right'
	children: ReactNode
}) {
	const panelRef = useRef<HTMLElement>(null)

	useEffect(() => {
		if (!open) return
		function onKeyDown(event: KeyboardEvent) {
			if (event.key === 'Escape') onClose()
		}
		document.addEventListener('keydown', onKeyDown)
		const previous = document.body.style.overflow
		document.body.style.overflow = 'hidden'
		return () => {
			document.removeEventListener('keydown', onKeyDown)
			document.body.style.overflow = previous
		}
	}, [onClose, open])

	useEffect(() => {
		if (open) panelRef.current?.focus()
	}, [open])

	if (!open) return null

	return (
		<div className="fixed inset-0 z-50 md:hidden" role="presentation">
			<button
				type="button"
				aria-label="Close panel"
				className="sheet-backdrop absolute inset-0 bg-foreground/20 backdrop-blur-[2px]"
				onClick={onClose}
			/>
			<aside
				ref={panelRef}
				role="dialog"
				aria-modal="true"
				aria-label={title}
				tabIndex={-1}
				className={cn(
					'absolute top-0 flex h-full w-[min(18rem,calc(100vw-3rem))] flex-col border-border bg-sidebar shadow-2xl outline-none',
					side === 'left' ? 'left-0 border-r' : 'right-0 border-l',
				)}
			>
				<div className="flex items-center justify-between border-b border-border px-4 py-3">
					<span className="font-display text-sm font-semibold">{title}</span>
					<button
						type="button"
						onClick={onClose}
						aria-label="Close"
						className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
					>
						<X className="h-4 w-4" />
					</button>
				</div>
				<div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
			</aside>
		</div>
	)
}

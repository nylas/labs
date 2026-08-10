import { X } from 'lucide-react'
import { type ReactNode, useEffect, useRef } from 'react'
import { cn } from '../lib/utils.js'

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
	const returnFocusRef = useRef<HTMLElement | null>(null)

	useEffect(() => {
		if (!open) return
		returnFocusRef.current = document.activeElement as HTMLElement | null
		function onKeyDown(event: KeyboardEvent) {
			if (event.key === 'Escape') onClose()
			/* v8 ignore start -- focus-loop branches require browser-level Tab traversal; the dialog itself is covered in render tests -- @preserve */
			if (event.key !== 'Tab') return
			const panel = panelRef.current
			if (!panel) return
			const focusable = Array.from(
				panel.querySelectorAll<HTMLElement>(
					'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
				),
			).filter((element) => !element.hasAttribute('hidden'))
			if (focusable.length === 0) {
				event.preventDefault()
				panel.focus()
				return
			}
			const first = focusable[0]
			const last = focusable.at(-1)
			if (event.shiftKey && document.activeElement === first) {
				event.preventDefault()
				last?.focus()
			} else if (!event.shiftKey && document.activeElement === last) {
				event.preventDefault()
				first?.focus()
			}
			/* v8 ignore stop -- @preserve */
		}
		document.addEventListener('keydown', onKeyDown)
		const previous = document.body.style.overflow
		document.body.style.overflow = 'hidden'
		return () => {
			document.removeEventListener('keydown', onKeyDown)
			document.body.style.overflow = previous
			returnFocusRef.current?.focus()
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
					'absolute top-0 flex h-dvh max-h-full w-[min(20rem,calc(100%_-_2rem))] flex-col border-border bg-background pt-[env(safe-area-inset-top)] shadow-2xl outline-none',
					side === 'left' ? 'left-0 border-r' : 'right-0 border-l',
				)}
			>
				<div className="flex h-14 shrink-0 items-center justify-between border-b border-border px-3">
					<span className="font-display text-sm font-semibold">{title}</span>
					<button
						type="button"
						onClick={onClose}
						aria-label={`Close ${title.toLowerCase()}`}
						className="flex h-11 w-11 items-center justify-center rounded-lg text-muted-foreground transition-[background-color,color,transform] duration-[var(--dur-fast)] ease-[var(--ease-out)] hover:bg-muted hover:text-foreground active:translate-y-px"
					>
						<X className="h-4 w-4" />
					</button>
				</div>
				<div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
			</aside>
		</div>
	)
}

import { Check, Columns2, Rows2, Square } from 'lucide-react'
import { type KeyboardEvent, useEffect, useId, useRef, useState } from 'react'
import type { ReadingPane } from '#app/preferences/user-preferences'
import { GLASS_PANEL_CLASS } from '#shared/components/ui/glass'
import { cn } from '#shared/lib/utils'

type ReadingPaneOption = { value: ReadingPane; label: string; icon: typeof Square }

export const READING_PANE_OPTIONS: readonly ReadingPaneOption[] = [
	{ value: 'none', label: 'No split', icon: Square },
	{ value: 'vertical', label: 'Vertical split', icon: Columns2 },
	{ value: 'horizontal', label: 'Horizontal split', icon: Rows2 },
]

/** Chooses how conversations open beside the list. Only wide layouts can
 * split, so the control is hidden where the list is always replaced. */
export function ReadingPaneMenu({
	value,
	onChange,
}: {
	value: ReadingPane
	onChange: (value: ReadingPane) => void
}) {
	const [open, setOpen] = useState(false)
	const rootRef = useRef<HTMLDivElement>(null)
	const triggerRef = useRef<HTMLButtonElement>(null)
	const itemRefs = useRef<Array<HTMLButtonElement | null>>([])
	const menuId = useId()
	// `value` is a validated preference, so it always names one of the options.
	const current = READING_PANE_OPTIONS.find((option) => option.value === value) as ReadingPaneOption
	const CurrentIcon = current.icon

	useEffect(() => {
		if (!open) return
		itemRefs.current[READING_PANE_OPTIONS.findIndex((option) => option.value === value)]?.focus()
		function closeOnOutsidePointer(event: PointerEvent) {
			if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
		}
		document.addEventListener('pointerdown', closeOnOutsidePointer)
		return () => document.removeEventListener('pointerdown', closeOnOutsidePointer)
	}, [open, value])

	function close() {
		setOpen(false)
		triggerRef.current?.focus()
	}

	function onMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
		const index = itemRefs.current.indexOf(document.activeElement as HTMLButtonElement)
		const last = READING_PANE_OPTIONS.length - 1
		const next =
			event.key === 'ArrowDown'
				? index >= last
					? 0
					: index + 1
				: event.key === 'ArrowUp'
					? index <= 0
						? last
						: index - 1
					: event.key === 'Home'
						? 0
						: event.key === 'End'
							? last
							: undefined
		if (event.key === 'Escape' || event.key === 'Tab') {
			event.preventDefault()
			event.stopPropagation()
			close()
			return
		}
		if (next === undefined) return
		event.preventDefault()
		itemRefs.current[next]?.focus()
	}

	return (
		<div ref={rootRef} className="relative hidden xl:block">
			<button
				ref={triggerRef}
				type="button"
				aria-label={`Reading pane: ${current.label}`}
				title="Reading pane"
				aria-haspopup="menu"
				aria-expanded={open}
				aria-controls={open ? menuId : undefined}
				onClick={() => setOpen((isOpen) => !isOpen)}
				className="flex size-9 max-md:size-11 [@media(any-pointer:coarse)]:size-11 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [@media(any-pointer:coarse)]:h-11 [@media(any-pointer:coarse)]:w-11"
			>
				<CurrentIcon className="h-4 w-4" />
			</button>
			{open ? (
				<div
					id={menuId}
					role="menu"
					aria-label="Reading pane"
					onKeyDown={onMenuKeyDown}
					className={cn('absolute right-0 top-[calc(100%+0.25rem)] z-50 w-52 p-1', GLASS_PANEL_CLASS)}
				>
					{READING_PANE_OPTIONS.map((option, index) => {
						const Icon = option.icon
						const selected = option.value === value
						return (
							<button
								key={option.value}
								ref={(element) => {
									itemRefs.current[index] = element
								}}
								type="button"
								role="menuitemradio"
								aria-checked={selected}
								onClick={() => {
									onChange(option.value)
									close()
								}}
								className={cn(
									'flex min-h-11 w-full items-center gap-3 whitespace-nowrap rounded-md px-3 text-left text-sm outline-none hover:bg-muted focus-visible:bg-muted focus-visible:ring-2 focus-visible:ring-ring',
									selected && 'font-medium',
								)}
							>
								<Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
								<span className="flex-1">{option.label}</span>
								{selected ? <Check className="h-4 w-4 shrink-0" aria-hidden="true" /> : null}
							</button>
						)
					})}
				</div>
			) : null}
		</div>
	)
}

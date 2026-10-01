import { Check, Rows2, Rows3, Rows4 } from 'lucide-react'
import { type KeyboardEvent, useEffect, useId, useRef, useState } from 'react'
import type { ListDensity } from '#app/preferences/user-preferences'
import { GLASS_PANEL_CLASS } from '#shared/components/ui/glass'
import { IconButton } from '#shared/components/ui/icon-button'
import { cn } from '#shared/lib/utils'

type ListDensityOption = { value: ListDensity; label: string; icon: typeof Rows2 }

export const LIST_DENSITY_OPTIONS: readonly ListDensityOption[] = [
	{ value: 'default', label: 'Default', icon: Rows2 },
	{ value: 'compact', label: 'Compact', icon: Rows3 },
	{ value: 'condensed', label: 'Condensed', icon: Rows4 },
]

/** Chooses how much of each conversation a list row shows. Compact and
 * Condensed apply only with a mouse or trackpad on desktop layouts, so
 * `.list-density-menu` hides the control where the choice has no effect. */
export function ListDensityMenu({
	value,
	onChange,
}: {
	value: ListDensity
	onChange: (value: ListDensity) => void
}) {
	const [open, setOpen] = useState(false)
	const rootRef = useRef<HTMLDivElement>(null)
	const triggerRef = useRef<HTMLButtonElement>(null)
	const itemRefs = useRef<Array<HTMLButtonElement | null>>([])
	const menuId = useId()
	// `value` is a validated preference, so it always names one of the options.
	const current = LIST_DENSITY_OPTIONS.find((option) => option.value === value) as ListDensityOption
	const CurrentIcon = current.icon

	useEffect(() => {
		if (!open) return
		itemRefs.current[LIST_DENSITY_OPTIONS.findIndex((option) => option.value === value)]?.focus()
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
		const last = LIST_DENSITY_OPTIONS.length - 1
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
		if (event.key === 'Tab') {
			// Tab and Shift+Tab leave the menu: close it, but let the browser move
			// focus to the next or previous control instead of pulling it back.
			setOpen(false)
			return
		}
		if (event.key === 'Escape') {
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
		<div ref={rootRef} className="list-density-menu relative">
			<IconButton
				ref={triggerRef}
				label={`List density: ${current.label}`}
				aria-haspopup="menu"
				aria-expanded={open}
				aria-controls={open ? menuId : undefined}
				onClick={() => setOpen((isOpen) => !isOpen)}
			>
				<CurrentIcon />
			</IconButton>
			{open ? (
				<div
					id={menuId}
					role="menu"
					aria-label="List density"
					onKeyDown={onMenuKeyDown}
					className={cn('absolute right-0 top-[calc(100%+0.25rem)] z-50 w-52 p-1', GLASS_PANEL_CLASS)}
				>
					{LIST_DENSITY_OPTIONS.map((option, index) => {
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

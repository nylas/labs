import { ChevronDown, ChevronUp, type LucideIcon, MoreHorizontal } from 'lucide-react'
import {
	type KeyboardEvent as ReactKeyboardEvent,
	type ReactNode,
	useEffect,
	useId,
	useRef,
	useState,
} from 'react'
import { GLASS_PANEL_CLASS } from '#shared/components/ui/glass'
import { IconButton } from '#shared/components/ui/icon-button'
import { cn } from '#shared/lib/utils'

/** The reader toolbar's icon buttons are 32px with a fine pointer, like the board's toolbar. */
export const READER_ICON_BUTTON_CLASS = 'size-8 text-control-foreground max-md:size-11 max-md:text-foreground'

/**
 * "12 of 14" between Previous (k) and Next (j). It follows the message in
 * focus, so the count always says where the reader is.
 */
export function ThreadStepper({
	position,
	count,
	onStep,
}: {
	position: number
	count: number
	onStep: (step: 1 | -1) => void
}) {
	return (
		<div data-slot="thread-stepper" className="flex items-center gap-control">
			<IconButton
				label="Previous message (k)"
				aria-keyshortcuts="k"
				className={READER_ICON_BUTTON_CLASS}
				disabled={position <= 1}
				onClick={() => onStep(-1)}
			>
				<ChevronUp aria-hidden="true" />
			</IconButton>
			<span aria-live="polite" className="reader-stepper-count font-data tabular-nums">
				{position} of {count}
			</span>
			<IconButton
				label="Next message (j)"
				aria-keyshortcuts="j"
				className={READER_ICON_BUTTON_CLASS}
				disabled={position >= count}
				onClick={() => onStep(1)}
			>
				<ChevronDown aria-hidden="true" />
			</IconButton>
		</div>
	)
}

export type ReaderMenuItem =
	| {
			kind: 'action'
			label: string
			icon: LucideIcon
			onSelect: () => void
			disabled?: boolean
			shortcut?: string
			/** An on/off item (the thread map, the files shelf): a checkbox item with its state. */
			checked?: boolean
	  }
	| { kind: 'link'; label: string; icon: LucideIcon; href: string; download?: boolean }
	| { kind: 'separator'; key: string }

/** Every item the arrow keys move between, in order: plain and checkbox items that are not disabled. */
const menuItemsIn = (menu: HTMLElement): HTMLElement[] =>
	[...menu.querySelectorAll<HTMLElement>('[role^="menuitem"]')].filter(
		(item) => !(item as HTMLButtonElement).disabled,
	)

const menuItemClass =
	'flex min-h-8 w-full items-center gap-3 whitespace-nowrap rounded-md px-3 text-left text-sm outline-none hover:bg-muted focus-visible:bg-muted focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 max-md:min-h-11 [@media(any-pointer:coarse)]:min-h-11'

/**
 * The reader's More menu: panel glass, roving focus, Escape returns to the
 * trigger (design.md "Context menus", clause 8). It holds only what the
 * reader already does: display actions, mute, the thread map, expand or
 * collapse, and the raw download of the latest message.
 */
export function ReaderMoreMenu({ items, label = 'More' }: { items: ReaderMenuItem[]; label?: string }) {
	const [open, setOpen] = useState(false)
	const rootRef = useRef<HTMLDivElement>(null)
	const triggerRef = useRef<HTMLButtonElement>(null)
	const menuRef = useRef<HTMLDivElement>(null)
	const menuId = useId()

	useEffect(() => {
		if (!open) return
		// The menu renders while it is open.
		menuItemsIn(menuRef.current as HTMLElement)[0]?.focus()
		function closeOnOutsidePointer(event: PointerEvent) {
			if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
		}
		document.addEventListener('pointerdown', closeOnOutsidePointer)
		return () => document.removeEventListener('pointerdown', closeOnOutsidePointer)
	}, [open])

	function close() {
		setOpen(false)
		triggerRef.current?.focus()
	}

	function onMenuKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
		// Keys inside the menu never reach the page's shortcuts.
		event.stopPropagation()
		if (event.key === 'Escape' || event.key === 'Tab') {
			event.preventDefault()
			close()
			return
		}
		const step = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0
		if (step === 0) return
		event.preventDefault()
		const menuItems = menuItemsIn(event.currentTarget)
		const index = menuItems.indexOf(document.activeElement as HTMLElement)
		menuItems[(index + step + menuItems.length) % menuItems.length]?.focus()
	}

	return (
		<div ref={rootRef} data-slot="reader-more" className="relative shrink-0">
			<IconButton
				ref={triggerRef}
				label={label}
				aria-haspopup="menu"
				aria-expanded={open}
				aria-controls={open ? menuId : undefined}
				className={READER_ICON_BUTTON_CLASS}
				onClick={() => setOpen((current) => !current)}
			>
				{/* 20px on the phone's top bar, as its Back and Archive are. */}
				<MoreHorizontal aria-hidden="true" className="size-4 max-md:size-5" />
			</IconButton>
			{open ? (
				<div
					ref={menuRef}
					id={menuId}
					role="menu"
					aria-label="Thread actions"
					onKeyDown={onMenuKeyDown}
					className={cn('absolute right-0 top-[calc(100%+0.25rem)] z-50 w-60 p-1', GLASS_PANEL_CLASS)}
				>
					{items.map((item) => {
						if (item.kind === 'separator') {
							return <hr key={item.key} className="my-1 border-0 border-t border-border" />
						}
						const Icon = item.icon
						const content: ReactNode = (
							<>
								<Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
								<span className="flex-1">{item.label}</span>
								{item.kind === 'action' && item.shortcut ? (
									<kbd className="font-data text-xs text-muted-foreground">{item.shortcut}</kbd>
								) : null}
							</>
						)
						if (item.kind === 'link') {
							return (
								<a
									key={item.label}
									role="menuitem"
									href={item.href}
									download={item.download}
									onClick={close}
									className={menuItemClass}
								>
									{content}
								</a>
							)
						}
						return (
							<button
								key={item.label}
								type="button"
								{...(item.checked === undefined
									? { role: 'menuitem' }
									: { role: 'menuitemcheckbox', 'aria-checked': item.checked })}
								disabled={item.disabled}
								aria-keyshortcuts={item.shortcut}
								onClick={() => {
									close()
									item.onSelect()
								}}
								className={menuItemClass}
							>
								{content}
							</button>
						)
					})}
				</div>
			) : null}
		</div>
	)
}

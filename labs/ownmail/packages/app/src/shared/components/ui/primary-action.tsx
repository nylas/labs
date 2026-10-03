import type { LucideIcon } from 'lucide-react'
import type * as React from 'react'
import { cn } from '#shared/lib/utils'

/**
 * The module create action (design.md "CTA voice"): Compose, New event, New
 * contact. It is the first thing in a module's sidebar, an outline in
 * `--cta-line` with the accent on its icon only. The 7px start padding plus its
 * 1px border puts the icon on the same edge as the navigation row icons beneath
 * it (12px sidebar inset + 8px row padding).
 */
export const PRIMARY_ACTION_CLASS =
	'press touch-target flex h-9 w-full min-w-0 items-center gap-2.5 rounded-md border border-cta-line pr-2.5 pl-[7px] text-sm font-medium text-foreground outline-none hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring max-md:min-h-12 forced-colors:focus-visible:outline-2 forced-colors:focus-visible:outline-solid'

/** The icon-only form for a top bar while the sidebar holding the full action is hidden. */
export const PRIMARY_ACTION_ICON_CLASS =
	'press touch-target-square flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-cta-line text-cta-icon outline-none hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring forced-colors:focus-visible:outline-2 forced-colors:focus-visible:outline-solid'

/** The inside of a primary action, for a router `Link` that takes `PRIMARY_ACTION_CLASS`. */
export function PrimaryActionContent({
	icon: Icon,
	label,
	shortcut,
}: {
	icon: LucideIcon
	label: string
	/** The key that performs the action, shown as plain muted text (hidden on touch-first devices). */
	shortcut?: string
}) {
	return (
		<>
			<Icon className="h-4 w-4 shrink-0 text-cta-icon" strokeWidth={2} aria-hidden="true" />
			<span className="min-w-0 flex-1 truncate text-left">{label}</span>
			{shortcut ? (
				<span
					className="primary-action-shortcut text-xs font-medium text-muted-foreground"
					aria-hidden="true"
				>
					{shortcut}
				</span>
			) : null}
		</>
	)
}

export function PrimaryAction({
	icon,
	label,
	shortcut,
	className,
	...props
}: Omit<React.ComponentProps<'button'>, 'children'> & {
	icon: LucideIcon
	label: string
	shortcut?: string
}) {
	return (
		<button
			type="button"
			aria-keyshortcuts={shortcut}
			className={cn(PRIMARY_ACTION_CLASS, className)}
			{...props}
		>
			<PrimaryActionContent icon={icon} label={label} shortcut={shortcut} />
		</button>
	)
}

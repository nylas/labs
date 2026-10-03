import { Diff, Minus, Plus } from 'lucide-react'
import { type ReactNode, type RefObject, useEffect, useId, useMemo, useRef, useState } from 'react'
import {
	availableTimezones,
	type CalendarHourHeight,
	isSupportedTimezone,
} from '#app/preferences/user-preferences'
import { Button } from '#shared/components/ui/button'
import { GLASS_PANEL_CLASS } from '#shared/components/ui/glass'
import { IconButton } from '#shared/components/ui/icon-button'
import { cn } from '#shared/lib/utils'
import { fmtTime, timeZoneOffsetLabel, timeZoneShortName, timezoneCity } from '../lib/calendar.js'
import { hourHeightLabel, stepHourHeight } from '../lib/calendar-zoom.js'

// Panel glass: these open from the day header and float over the grid.
const POPOVER_CLASS = `absolute top-full z-40 mt-control p-hairline text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring ${GLASS_PANEL_CLASS}`

/**
 * A small non-modal popover anchored to its trigger. It closes on Escape (focus
 * returns to the trigger), on a click elsewhere, and when keyboard focus leaves.
 */
function useGridPopover() {
	const [open, setOpen] = useState(false)
	const containerRef = useRef<HTMLDivElement>(null)
	const triggerRef = useRef<HTMLButtonElement>(null)
	const panelRef = useRef<HTMLDivElement>(null)

	useEffect(() => {
		if (!open) return
		panelRef.current?.focus()
		function onClick(event: MouseEvent) {
			if (!containerRef.current?.contains(event.target as Node)) setOpen(false)
		}
		document.addEventListener('click', onClick)
		return () => document.removeEventListener('click', onClick)
	}, [open])

	function close() {
		setOpen(false)
		triggerRef.current?.focus()
	}

	/** Focus already moved elsewhere, so it is not pulled back to the trigger. */
	function leave() {
		setOpen(false)
	}

	return { open, setOpen, close, leave, containerRef, triggerRef, panelRef }
}

function GridPopover({
	label,
	className,
	panelRef,
	onClose,
	onLeave,
	children,
}: {
	label: string
	className: string
	panelRef: RefObject<HTMLDivElement | null>
	onClose: () => void
	onLeave: () => void
	children: ReactNode
}) {
	return (
		<div
			ref={panelRef}
			role="dialog"
			aria-label={label}
			tabIndex={-1}
			className={cn(POPOVER_CLASS, className)}
			onKeyDown={(event) => {
				if (event.key !== 'Escape') return
				event.stopPropagation()
				onClose()
			}}
			onBlur={(event) => {
				const next = event.relatedTarget
				// A click on the popover's own padding moves focus nowhere; only a real move away closes it.
				if (next instanceof Node && !event.currentTarget.parentElement?.contains(next)) onLeave()
			}}
		>
			{children}
		</div>
	)
}

/** The grid zoom control at the right of the day header: one step smaller or larger per press. */
export function GridZoomControl({
	hourHeight,
	onChange,
}: {
	hourHeight: CalendarHourHeight
	onChange: (hourHeight: CalendarHourHeight) => void
}) {
	const popover = useGridPopover()
	const smaller = stepHourHeight(hourHeight, -1)
	const larger = stepHourHeight(hourHeight, 1)
	return (
		<div ref={popover.containerRef} className="relative flex">
			<button
				ref={popover.triggerRef}
				type="button"
				aria-label="Grid zoom"
				title="Grid zoom"
				aria-haspopup="dialog"
				aria-expanded={popover.open}
				onClick={() => popover.setOpen((open) => !open)}
				className="touch-target-square flex size-11 items-center justify-center text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset"
			>
				<Diff className="h-4 w-4" aria-hidden="true" />
			</button>
			{popover.open ? (
				<GridPopover
					label="Grid zoom"
					className="right-0 flex items-center gap-cluster"
					panelRef={popover.panelRef}
					onClose={popover.close}
					onLeave={popover.leave}
				>
					{/* aria-disabled keeps focus on the button when the scale reaches an end. */}
					<IconButton
						label="Zoom out"
						aria-disabled={smaller === null}
						className="aria-disabled:opacity-50"
						onClick={() => {
							if (smaller !== null) onChange(smaller)
						}}
					>
						<Minus aria-hidden="true" />
					</IconButton>
					<span role="status" className="min-w-20 text-center text-sm font-medium text-foreground">
						{hourHeightLabel(hourHeight)}
					</span>
					<IconButton
						label="Zoom in"
						aria-disabled={larger === null}
						className="aria-disabled:opacity-50"
						onClick={() => {
							if (larger !== null) onChange(larger)
						}}
					>
						<Plus aria-hidden="true" />
					</IconButton>
				</GridPopover>
			) : null}
		</div>
	)
}

/**
 * The time gutter's head. It names the zone or zones the ruler shows and opens a
 * popover to add, change, or remove the second one. With a second zone it heads
 * both hour columns in the order they are drawn: the second zone with its
 * offset from the first, then the first with its abbreviation.
 */
export function SecondaryTimezoneControl({
	primaryTimezone,
	secondaryTimezone,
	now,
	onChange,
}: {
	primaryTimezone: string
	secondaryTimezone: string
	now: Date
	onChange: (secondaryTimezone: string) => void
}) {
	const popover = useGridPopover()
	const selectId = useId()
	const primaryName = timeZoneShortName(primaryTimezone, now)
	const secondaryName = secondaryTimezone ? timeZoneShortName(secondaryTimezone, now) : ''
	const offset = secondaryTimezone ? timeZoneOffsetLabel(primaryTimezone, secondaryTimezone, now) : ''
	return (
		<div ref={popover.containerRef} className="relative flex min-w-0 flex-1">
			<button
				ref={popover.triggerRef}
				type="button"
				aria-label={
					secondaryTimezone
						? `Time zones: ${timezoneCity(primaryTimezone)} ${primaryName} and ${timezoneCity(secondaryTimezone)} ${secondaryName}, ${offset}. Change second time zone`
						: `Time zone: ${primaryName}. Add a second time zone`
				}
				aria-haspopup="dialog"
				aria-expanded={popover.open}
				onClick={() => popover.setOpen((open) => !open)}
				className="touch-target flex min-h-11 w-full min-w-0 items-center justify-end text-right transition-colors hover:bg-muted/60 focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset"
			>
				{secondaryTimezone ? (
					<>
						<TimezoneHead city={timezoneCity(secondaryTimezone)} detail={offset} />
						<TimezoneHead city={timezoneCity(primaryTimezone)} detail={primaryName} primary />
					</>
				) : (
					<span className="flex min-w-0 flex-col items-end gap-px px-control">
						<span
							title={timezoneCity(primaryTimezone)}
							className="max-w-full truncate text-[10px] font-semibold text-foreground"
						>
							{primaryName}
						</span>
						<Plus className="h-3 w-3 text-muted-foreground" aria-hidden="true" />
					</span>
				)}
			</button>
			{popover.open ? (
				<GridPopover
					label="Second time zone"
					className="left-0 flex w-72 flex-col gap-cluster"
					panelRef={popover.panelRef}
					onClose={popover.close}
					onLeave={popover.leave}
				>
					<label className="block text-sm font-medium text-foreground" htmlFor={selectId}>
						Second time zone
					</label>
					<SecondaryTimezoneSelect
						id={selectId}
						primaryTimezone={primaryTimezone}
						secondaryTimezone={secondaryTimezone}
						now={now}
						onChange={onChange}
					/>
					{secondaryTimezone ? (
						<Button
							type="button"
							variant="outline"
							className="min-h-11"
							onClick={() => {
								onChange('')
								popover.close()
							}}
						>
							Remove second time zone
						</Button>
					) : null}
				</GridPopover>
			) : null}
		</div>
	)
}

/** One hour column's head: the city, with its offset or abbreviation beneath. */
function TimezoneHead({
	city,
	detail,
	primary = false,
}: {
	city: string
	detail: string
	primary?: boolean
}) {
	return (
		<span className="flex min-w-0 flex-1 flex-col items-end px-control">
			<span
				title={city}
				className={cn(
					'max-w-full truncate text-[10px] font-semibold',
					primary ? 'text-foreground' : 'text-muted-foreground',
				)}
			>
				{city}
			</span>
			<span className="max-w-full truncate text-[10px] text-muted-foreground tabular-nums">{detail}</span>
		</span>
	)
}

function SecondaryTimezoneSelect({
	id,
	primaryTimezone,
	secondaryTimezone,
	now,
	onChange,
}: {
	id: string
	primaryTimezone: string
	secondaryTimezone: string
	now: Date
	onChange: (secondaryTimezone: string) => void
}) {
	// The second zone must differ from the first, so the first is not offered.
	// Each zone shows the time there now and its offset, so it can be chosen by
	// what its clock says rather than by its id alone.
	const timezones = useMemo(
		() =>
			availableTimezones()
				.filter((timezone) => timezone !== primaryTimezone)
				.map((timezone) => ({
					timezone,
					label: `${timezone} · ${fmtTime(now, timezone)} · ${timeZoneOffsetLabel(primaryTimezone, timezone, now)}`,
				})),
		[now, primaryTimezone],
	)
	return (
		<select
			id={id}
			value={secondaryTimezone}
			onChange={(event) => {
				const next = event.target.value
				// The option list can be altered in the page, so the value is validated before it is stored.
				if (next === '' || (isSupportedTimezone(next) && next !== primaryTimezone)) onChange(next)
			}}
			className="h-11 w-full rounded-md border border-border bg-card px-2 text-base outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring"
		>
			<option value="">None</option>
			{timezones.map(({ timezone, label }) => (
				<option key={timezone} value={timezone}>
					{label}
				</option>
			))}
		</select>
	)
}

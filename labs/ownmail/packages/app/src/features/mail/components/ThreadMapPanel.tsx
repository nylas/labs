import { ChevronDown, X } from 'lucide-react'
import {
	type KeyboardEvent,
	type ReactNode,
	useEffect,
	useId,
	useMemo,
	useRef,
	useState,
	useSyncExternalStore,
} from 'react'
import { Dialog, DialogContent, DialogTitle } from '#shared/components/ui/dialog'
import { GlassPanelScope, useGlassPanelProps } from '#shared/components/ui/glass'
import { cn } from '#shared/lib/utils'
import {
	type MapEntry,
	messageNewText,
	type Person,
	personHue,
	personName,
	senderPerson,
	shortDayLabel,
} from '../lib/thread-reading-model.js'
import type { MailMessage } from '../state/mail-queries.js'

export type ThreadMapFilter = 'all' | 'files' | 'you' | { from: string }

/** The reader docks the map beside the stream from `xl`; below it the map is a sheet. */
const DOCKED_QUERY = '(min-width: 80rem)'
const ASKS_YOU_CHIP = 'asks you'

const DOT_CLASS: Record<ReturnType<typeof personHue>, string> = {
	75: 'bg-person-dot-75',
	250: 'bg-person-dot-250',
	32: 'bg-person-dot-32',
	158: 'bg-person-dot-158',
	300: 'bg-person-dot-300',
	200: 'bg-person-dot-200',
}

/** The selected row's dot keeps a soft ring of its own hue. */
const DOT_RING_CLASS: Record<ReturnType<typeof personHue>, string> = {
	75: 'ring-person-dot-75/25',
	250: 'ring-person-dot-250/25',
	32: 'ring-person-dot-32/25',
	158: 'ring-person-dot-158/25',
	300: 'ring-person-dot-300/25',
	200: 'ring-person-dot-200/25',
}

/** A person's hue on the map: the owner is always the green one. */
const hueOf = (person: Person): ReturnType<typeof personHue> =>
	person.isOwner ? 158 : personHue(person.email)

const addressKey = (email: string): string => email.trim().toLowerCase()
const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const hasWord = (text: string, word: string): boolean =>
	word !== '' && new RegExp(`(?:^|[^\\p{L}\\p{N}])${escapeRegExp(word)}(?![\\p{L}\\p{N}])`, 'iu').test(text)

/** Each message's answer for one owner, so a reader re-render does not parse every body again. */
const namesYouCache = new WeakMap<MailMessage, { owner: string; names: boolean }>()

/**
 * The messages the "Names you" filter keeps besides the ones that ask the
 * owner something (those carry the "asks you" chip already): someone else's
 * message whose own text (quoted history and signature removed) names the
 * owner by first name or address. Each body is read once per owner; the
 * reader memoises the list on the messages, owner and first name and passes
 * it to the map.
 */
export function threadMapNamesYou(messages: MailMessage[], owner: string, ownerFirstName: string): string[] {
	const name = ownerFirstName.trim()
	const address = addressKey(owner)
	const cacheKey = `${address}\n${name.toLowerCase()}`
	return messages
		.filter((message) => {
			const cached = namesYouCache.get(message)
			if (cached?.owner === cacheKey) return cached.names
			let names = false
			if (!senderPerson(message, owner).isOwner) {
				const text = messageNewText(message)
				names = hasWord(text, name) || (address !== '' && text.toLowerCase().includes(address))
			}
			namesYouCache.set(message, { owner: cacheKey, names })
			return names
		})
		.map((message) => message.id)
}

const timeFormatters = new Map<string, Intl.DateTimeFormat>()

/** "9:30": the time of day without its period, as the map's narrow date column sets it. */
function shortTime(seconds: number, tz: string): string {
	let formatter = timeFormatters.get(tz)
	if (!formatter) {
		try {
			formatter = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz })
		} catch {
			formatter = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' })
		}
		timeFormatters.set(tz, formatter)
	}
	return formatter
		.formatToParts(seconds * 1000)
		.filter((part) => part.type !== 'dayPeriod')
		.map((part) => part.value)
		.join('')
		.trim()
}

/** The map's date column: "9:30" today, the weekday this week ("Mon"), else "Sep 28". */
export function mapDateLabel(seconds: number, now: number, tz: string): string {
	if (!(seconds > 0)) return ''
	const day = shortDayLabel(seconds, now, tz)
	if (day === 'today') return shortTime(seconds, tz)
	if (day === 'yesterday') {
		try {
			return new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: tz }).format(seconds * 1000)
		} catch {
			return new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'UTC' }).format(seconds * 1000)
		}
	}
	return day
}

/** Chips that are not about files: people added or removed, and "asks you". */
const isPeopleChip = (chip: string): boolean => chip.startsWith('+ ') || chip.startsWith('− ')
const isFileChip = (chip: string): boolean => !isPeopleChip(chip) && chip !== ASKS_YOU_CHIP

/** A row shows this many chips at most; past that, the first ones, a "+n" count and "asks you". */
const MAX_ROW_CHIPS = 3

type RowChip = { label: string; key: string; asks: boolean }

/**
 * The chips a row draws: repeats of one label folded into a count ("jpg ×6"),
 * and no more than `MAX_ROW_CHIPS`, so the sender's name always keeps its room.
 * "asks you" is never the chip that gives way.
 */
export function rowChips(chips: readonly string[]): RowChip[] {
	const counts = new Map<string, number>()
	for (const chip of chips) counts.set(chip, (counts.get(chip) ?? 0) + 1)
	const all = [...counts].map(([chip, count]) => ({
		label: count > 1 ? `${chip} ×${count}` : chip,
		key: chip,
		asks: chip === ASKS_YOU_CHIP,
	}))
	if (all.length <= MAX_ROW_CHIPS) return all
	const asks = all.filter((chip) => chip.asks)
	const others = all.filter((chip) => !chip.asks)
	const kept = others.slice(0, MAX_ROW_CHIPS - 1 - asks.length)
	return [...kept, { label: `+${others.length - kept.length}`, key: 'more', asks: false }, ...asks]
}

/** Whether an entry passes a filter. */
export function mapEntryMatches(
	entry: MapEntry,
	filter: ThreadMapFilter,
	namesYou: ReadonlySet<string> = new Set(),
): boolean {
	if (filter === 'all') return true
	if (filter === 'files') return entry.chips.some(isFileChip)
	if (filter === 'you') return namesYou.has(entry.messageId) || entry.chips.includes(ASKS_YOU_CHIP)
	return addressKey(entry.from.email) === addressKey(filter.from)
}

const entryName = (person: Person): string => (person.isOwner ? 'You' : personName(person, 'full'))

/** Everyone who wrote on the thread, once each, in the order they first wrote. */
function mapSenders(entries: MapEntry[]): Person[] {
	const senders = new Map<string, Person>()
	for (const entry of entries) {
		const key = addressKey(entry.from.email)
		if (key && !senders.has(key)) senders.set(key, entry.from)
	}
	return [...senders.values()]
}

function useDocked(): boolean {
	return useSyncExternalStore(
		(onChange) => {
			if (typeof window.matchMedia !== 'function') return () => {}
			const media = window.matchMedia(DOCKED_QUERY)
			media.addEventListener('change', onChange)
			return () => media.removeEventListener('change', onChange)
		},
		() => typeof window.matchMedia === 'function' && window.matchMedia(DOCKED_QUERY).matches,
		() => false,
	)
}

/** A segment: the pressed one is a plain card fill on the muted group, as board 04 draws it. */
const segmentClass =
	'inline-flex h-7 min-w-0 flex-1 items-center justify-center gap-control whitespace-nowrap rounded-md px-cluster text-xs font-medium text-foreground/70 transition-[background-color,color] duration-[var(--dur-fast)] ease-[var(--ease-out)] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-pressed:bg-card aria-pressed:text-foreground [@media(any-pointer:coarse)]:h-11'
/** Each segment's 1px margin and the group's 1px padding make board 04's 2px gaps and inset. */
const segmentSlotClass = 'm-px'

function FromFilter({
	senders,
	filter,
	onFilter,
}: {
	senders: Person[]
	filter: ThreadMapFilter
	onFilter(f: ThreadMapFilter): void
}) {
	const [open, setOpen] = useState(false)
	const rootRef = useRef<HTMLDivElement>(null)
	const triggerRef = useRef<HTMLButtonElement>(null)
	const menuId = useId()
	const panel = useGlassPanelProps()
	const active = typeof filter === 'object' ? filter : null
	const activePerson = active
		? senders.find((person) => addressKey(person.email) === addressKey(active.from))
		: undefined

	useEffect(() => {
		if (!open) return
		const items = rootRef.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]')
		const checked = rootRef.current?.querySelector<HTMLElement>('[role="menuitemradio"][aria-checked="true"]')
		;(checked ?? items?.[0])?.focus()
		const closeOutside = (event: PointerEvent | FocusEvent) => {
			if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false)
		}
		document.addEventListener('pointerdown', closeOutside)
		document.addEventListener('focusin', closeOutside)
		return () => {
			document.removeEventListener('pointerdown', closeOutside)
			document.removeEventListener('focusin', closeOutside)
		}
	}, [open])

	const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
		if (event.key === 'Escape') {
			event.preventDefault()
			event.stopPropagation()
			setOpen(false)
			triggerRef.current?.focus()
			return
		}
		moveFocus(event, '[role="menuitemradio"]')
	}

	return (
		<div ref={rootRef} className={cn('relative flex min-w-0 flex-1', segmentSlotClass)}>
			<button
				ref={triggerRef}
				type="button"
				aria-pressed={active !== null}
				aria-haspopup="menu"
				aria-expanded={open}
				aria-controls={open ? menuId : undefined}
				onClick={() => setOpen((value) => !value)}
				className={segmentClass}
			>
				<span className="truncate">
					{activePerson
						? `From ${activePerson.isOwner ? 'you' : personName(activePerson, 'first')}`
						: 'From…'}
				</span>
				{activePerson ? <ChevronDown aria-hidden="true" className="size-3 shrink-0" /> : null}
			</button>
			{open ? (
				<div
					id={menuId}
					role="menu"
					aria-label="Messages from"
					onKeyDown={onMenuKeyDown}
					{...panel}
					className={cn(
						panel.className,
						'absolute top-full right-0 z-30 mt-control flex w-56 flex-col p-control',
					)}
				>
					{senders.map((person) => {
						const checked =
							activePerson !== undefined && addressKey(person.email) === addressKey(activePerson.email)
						return (
							<button
								key={addressKey(person.email)}
								type="button"
								role="menuitemradio"
								aria-checked={checked}
								onClick={() => {
									setOpen(false)
									onFilter({ from: person.email })
									triggerRef.current?.focus()
								}}
								className="flex h-8 w-full min-w-0 items-center gap-cluster rounded-md px-cluster text-left text-[13px] hover:bg-muted focus-visible:bg-muted focus-visible:outline-none aria-checked:font-semibold [@media(any-pointer:coarse)]:h-11"
							>
								<span
									aria-hidden="true"
									className={cn('size-2 shrink-0 rounded-full', DOT_CLASS[hueOf(person)])}
								/>
								<span className="truncate">{entryName(person)}</span>
							</button>
						)
					})}
				</div>
			) : null}
		</div>
	)
}

/** Arrow keys move between the items a selector finds; Home and End go to the ends. */
function moveFocus(event: KeyboardEvent<HTMLElement>, selector: string) {
	if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
	const items = [...event.currentTarget.querySelectorAll<HTMLElement>(selector)]
	if (items.length === 0) return
	event.preventDefault()
	const at = items.indexOf(document.activeElement as HTMLElement)
	const next =
		event.key === 'Home'
			? 0
			: event.key === 'End'
				? items.length - 1
				: event.key === 'ArrowDown'
					? Math.min(items.length - 1, at + 1)
					: Math.max(0, at - 1)
	items[next]?.focus()
}

type MapRow =
	| { kind: 'entry'; entry: MapEntry; index: number }
	| { kind: 'event'; text: string; key: string }
	| { kind: 'stopped' }

function mapRows(
	entries: MapEntry[],
	stoppedBeforeIndex: number | null,
	filter: ThreadMapFilter,
	namesYou: ReadonlySet<string>,
): MapRow[] {
	const visible = entries
		.map((entry, index) => ({ entry, index }))
		.filter(({ entry }) => mapEntryMatches(entry, filter, namesYou))
	const showStopped =
		stoppedBeforeIndex !== null &&
		visible.some(({ index }) => index < stoppedBeforeIndex) &&
		visible.some(({ index }) => index >= stoppedBeforeIndex)
	const rows: MapRow[] = []
	let stoppedPlaced = false
	for (const { entry, index } of visible) {
		if (showStopped && !stoppedPlaced && index >= (stoppedBeforeIndex as number)) {
			rows.push({ kind: 'stopped' })
			stoppedPlaced = true
		}
		if (filter === 'all' && entry.event)
			rows.push({ kind: 'event', text: entry.event, key: `event-${entry.messageId}` })
		rows.push({ kind: 'entry', entry, index })
	}
	return rows
}

function MapBody({
	title,
	entries,
	stoppedBeforeIndex,
	filter,
	onFilter,
	selectedId,
	onSelect,
	onClose,
	namesYou,
}: {
	title: ReactNode
	entries: MapEntry[]
	stoppedBeforeIndex: number | null
	filter: ThreadMapFilter
	onFilter(f: ThreadMapFilter): void
	selectedId?: string
	onSelect(messageId: string): void
	onClose(): void
	namesYou: ReadonlySet<string>
}) {
	const [{ now, tz }] = useState(() => ({
		now: Date.now(),
		tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
	}))
	const rows = useMemo(
		() => mapRows(entries, stoppedBeforeIndex, filter, namesYou),
		[entries, stoppedBeforeIndex, filter, namesYou],
	)
	const senders = useMemo(() => mapSenders(entries), [entries])
	const count = entries.length
	// One Tab stop for the whole list (roving tabindex): the row last focused,
	// else the current message, else the first row. Arrow keys move between rows.
	const [focusedId, setFocusedId] = useState<string | null>(null)
	const rowIds = rows.flatMap((row) => (row.kind === 'entry' ? [row.entry.messageId] : []))
	const tabStopId = [focusedId, selectedId].find((id) => id != null && rowIds.includes(id)) ?? rowIds[0]

	return (
		<div className="map-card flex min-h-0 flex-col p-5">
			<div className="flex items-baseline gap-cluster">
				{title}
				<span className="font-data text-xs text-muted-foreground tabular-nums">
					{count === 1 ? '1 message' : `${count} messages`}
				</span>
				<button
					type="button"
					aria-label="Close thread map"
					title="Close thread map"
					onClick={onClose}
					className="inline-flex size-7 shrink-0 items-center justify-center self-center rounded-md text-muted-foreground transition-[background-color,color,transform] duration-[var(--dur-fast)] ease-[var(--ease-out)] hover:bg-muted hover:text-foreground press focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [@media(any-pointer:coarse)]:size-11"
				>
					<X aria-hidden="true" className="size-4" />
				</button>
			</div>

			{/* Four equal columns, as board 04's flex: 1 segments come out: a column does not
			    depend on whether its segment is a button or the From… menu around one. */}
			<fieldset className="m-0 grid min-w-0 grid-cols-4 rounded-lg border-0 bg-muted p-px">
				<legend className="sr-only">Filter</legend>
				<button
					type="button"
					aria-pressed={filter === 'all'}
					onClick={() => onFilter('all')}
					className={cn(segmentClass, segmentSlotClass)}
				>
					All
				</button>
				<button
					type="button"
					aria-pressed={filter === 'files'}
					onClick={() => onFilter('files')}
					className={cn(segmentClass, segmentSlotClass)}
				>
					With files
				</button>
				<button
					type="button"
					aria-pressed={filter === 'you'}
					onClick={() => onFilter('you')}
					className={cn(segmentClass, segmentSlotClass)}
				>
					Names you
				</button>
				<FromFilter senders={senders} filter={filter} onFilter={onFilter} />
			</fieldset>

			{/* biome-ignore lint/a11y/noStaticElementInteractions: arrow keys move between the row buttons inside */}
			<div
				data-slot="thread-map-rows"
				className="flex min-h-0 flex-col overflow-y-auto"
				onKeyDown={(event) => moveFocus(event, 'button[data-map-row]')}
			>
				{rows.length === 0 || !rows.some((row) => row.kind === 'entry') ? (
					<p className="m-0 px-hairline py-cluster text-[13px] text-muted-foreground">No messages match.</p>
				) : null}
				{rows.map((row) => {
					if (row.kind === 'stopped') {
						return (
							<div
								key="stopped"
								data-slot="thread-map-stopped"
								className="map-stopped flex items-center gap-cluster text-xs font-semibold text-cta-icon"
							>
								<span aria-hidden="true" className="h-px flex-1 bg-border" />
								<span>You stopped here</span>
								<span aria-hidden="true" className="h-px flex-1 bg-border" />
							</div>
						)
					}
					if (row.kind === 'event') {
						// Centred as a whole, as board 04 sets it; a wrapped second line stays flush left.
						return (
							<p
								key={row.key}
								className="map-event m-0 flex justify-center text-xs leading-[1.4] text-muted-foreground"
							>
								<span className="min-w-0">{row.text}</span>
							</p>
						)
					}
					const { entry } = row
					const hue = hueOf(entry.from)
					const selected = entry.messageId === selectedId
					const date = mapDateLabel(entry.date, now, tz)
					return (
						<button
							key={entry.messageId}
							type="button"
							data-map-row=""
							data-message-id={entry.messageId}
							aria-current={selected ? 'true' : undefined}
							tabIndex={entry.messageId === tabStopId ? 0 : -1}
							onFocus={() => setFocusedId(entry.messageId)}
							onClick={() => onSelect(entry.messageId)}
							className={cn(
								'map-row flex min-h-[33px] w-full min-w-0 items-center rounded-md text-left text-[13px] leading-[1.35] transition-colors duration-[var(--dur-fast)] hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset [@media(any-pointer:coarse)]:min-h-11',
								entry.unread && 'font-semibold',
								selected && 'bg-list-selected hover:bg-list-selected',
							)}
						>
							<span
								aria-hidden="true"
								className={cn(
									'size-2 shrink-0 rounded-full',
									DOT_CLASS[hue],
									selected && cn('ring-3', DOT_RING_CLASS[hue]),
								)}
							/>
							<span className="min-w-0 flex-1 truncate">
								{entryName(entry.from)}
								{entry.unread ? <span className="sr-only">, new</span> : null}
							</span>
							{rowChips(entry.chips).map((chip) => (
								<span
									key={chip.key}
									className={cn(
										'map-chip inline-flex h-5 shrink-0 items-center rounded-full text-[11px]',
										chip.asks ? 'bg-signal-ask text-signal-ask-foreground' : 'bg-muted text-quiet-foreground',
									)}
								>
									{chip.label}
								</span>
							))}
							<time
								dateTime={entry.date > 0 ? new Date(entry.date * 1000).toISOString() : undefined}
								className={cn(
									'shrink-0 font-data text-xs tabular-nums',
									entry.unread ? 'text-cta-icon' : 'text-muted-foreground',
								)}
							>
								{date}
							</time>
						</button>
					)
				})}
			</div>

			<p className="map-footnote m-0 text-xs leading-[1.5] text-muted-foreground">
				Opens from the dots beside the reader, or with{' '}
				<kbd className="rounded-[3px] bg-muted px-control py-px font-data text-xs font-normal">g m</kbd>.
				Clicking a row scrolls to it and opens it.
			</p>
		</div>
	)
}

/**
 * The thread map (board 04): one row per message, who wrote it and when, with
 * chips for the files it carried (versions or types), people added, and
 * "asks you"; subject changes between rows, a "You stopped here" rule before
 * the first message that was new at open, new rows set semibold with green
 * times, the current message tinted. Filters keep the rows with files, the
 * rows that name the reader, or one sender's rows. Clicking a row hands its
 * message to the reader, which scrolls to it and opens it.
 *
 * Docked beside the reader as panel glass from `xl` (the caller places it in a
 * positioned container); a sheet from the right below that.
 */
export function ThreadMapPanel({
	entries,
	stoppedBeforeIndex,
	filter,
	onFilter,
	selectedId,
	onSelect,
	onClose,
	open,
	namesYouIds,
	docked: dockedOverride,
}: {
	entries: MapEntry[]
	stoppedBeforeIndex: number | null
	filter: ThreadMapFilter
	onFilter(f: ThreadMapFilter): void
	selectedId?: string
	onSelect(messageId: string): void
	onClose(): void
	open: boolean
	/**
	 * Messages that name the reader (`threadMapNamesYou`, memoised by the caller); "Names you" keeps
	 * these and the rows that ask the reader something. Without it the filter keeps only the questions.
	 */
	namesYouIds?: readonly string[]
	/**
	 * Whether the panel docks beside the stream, as the caller decides from the
	 * room its pane has; without it, from `xl` up.
	 */
	docked?: boolean
}) {
	const wide = useDocked()
	const docked = dockedOverride ?? wide
	const titleId = useId()
	const asideRef = useRef<HTMLElement>(null)
	// Keyed on the ids, not the array, so a caller that builds a new list each render keeps the rows memoised.
	const namesYouKey = (namesYouIds ?? []).join('\n')
	// biome-ignore lint/correctness/useExhaustiveDependencies: the key stands for the ids it was made from
	const namesYou = useMemo(() => new Set(namesYouIds ?? []), [namesYouKey])
	const panel = useGlassPanelProps()

	const focusCurrentRow = (root: HTMLElement | null) => {
		const row =
			root?.querySelector<HTMLElement>('button[data-map-row][aria-current="true"]') ??
			root?.querySelector<HTMLElement>('button[data-map-row]')
		row?.scrollIntoView?.({ block: 'nearest' })
		row?.focus({ preventScroll: true })
	}

	// The docked panel takes focus to its current row when it opens and, when it
	// closes, hands focus back to where it came from (the sheet's dialog does both
	// itself). Focus the reader has moved elsewhere in the meantime stays there.
	// biome-ignore lint/correctness/useExhaustiveDependencies: focus moves only when the docked panel opens or closes
	useEffect(() => {
		if (!open || !docked) return
		const aside = asideRef.current
		const returnTo = document.activeElement
		focusCurrentRow(aside)
		return () => {
			const active = document.activeElement
			const lost = !active || active === document.body || aside?.contains(active)
			if (lost && returnTo instanceof HTMLElement && returnTo.isConnected)
				returnTo.focus({ preventScroll: true })
		}
	}, [open, docked])

	const body = (title: ReactNode, select: (messageId: string) => void) => (
		<MapBody
			title={title}
			entries={entries}
			stoppedBeforeIndex={stoppedBeforeIndex}
			filter={filter}
			onFilter={onFilter}
			selectedId={selectedId}
			onSelect={select}
			onClose={onClose}
			namesYou={namesYou}
		/>
	)
	const heading = (
		<h2 id={titleId} className="m-0 min-w-0 flex-1 text-base font-semibold">
			Thread map
		</h2>
	)

	if (docked) {
		if (!open) return null
		return (
			<aside
				ref={asideRef}
				aria-labelledby={titleId}
				data-slot="thread-map-panel"
				onKeyDown={(event) => {
					if (event.key !== 'Escape' || event.defaultPrevented) return
					event.preventDefault()
					event.stopPropagation()
					onClose()
				}}
				{...panel}
				className={cn(
					panel.className,
					// Its rows scroll inside it; the From… menu opens over them, never clipped by the panel.
					'absolute top-region right-region z-30 flex max-h-[calc(100%-2rem)] w-[380px] flex-col',
				)}
			>
				{/* Docked beside the stream, the map stays open while the reader moves to the row. */}
				<GlassPanelScope>{body(heading, onSelect)}</GlassPanelScope>
			</aside>
		)
	}

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
				data-side="right"
				data-slot="thread-map-panel"
				aria-describedby={undefined}
				onBackdropClick={onClose}
				onEscapeKeyDown={(event) => {
					// Escape in the From… menu closes the menu, not the sheet.
					if (event.target instanceof Element && event.target.closest('[role="menu"]')) event.preventDefault()
				}}
				onOpenAutoFocus={(event) => {
					event.preventDefault()
					focusCurrentRow(event.currentTarget as HTMLElement)
				}}
				className="right-0 left-auto flex w-[min(380px,calc(100%_-_2rem))] max-w-none flex-col border-l bg-background pt-[var(--safe-area-top)] pb-[var(--safe-area-bottom)]"
			>
				<div className="flex min-h-0 flex-1 flex-col">
					{/* The sheet covers the stream, so choosing a row closes it to show that message. */}
					{body(
						<DialogTitle asChild>
							<h2 className="m-0 min-w-0 flex-1 text-base font-semibold">Thread map</h2>
						</DialogTitle>,
						(messageId) => {
							onSelect(messageId)
							onClose()
						},
					)}
				</div>
			</DialogContent>
		</Dialog>
	)
}

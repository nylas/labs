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
	asksYou,
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

/**
 * The messages the "Names you" filter keeps: someone else's message whose own
 * text (quoted history and signature removed) names the owner by first name
 * or address, or asks the owner something. The reader passes these to the map.
 */
export function threadMapNamesYou(messages: MailMessage[], owner: string, ownerFirstName: string): string[] {
	const name = ownerFirstName.trim()
	const address = addressKey(owner)
	return messages
		.filter((message) => {
			if (senderPerson(message, owner).isOwner) return false
			const text = messageNewText(message)
			return (
				hasWord(text, name) ||
				(address !== '' && text.toLowerCase().includes(address)) ||
				asksYou(message, owner, ownerFirstName)
			)
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

const segmentClass =
	'inline-flex h-7 min-w-0 flex-1 items-center justify-center gap-control whitespace-nowrap rounded-md px-cluster text-xs font-medium text-foreground/70 transition-[background-color,color] duration-[var(--dur-fast)] ease-[var(--ease-out)] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-pressed:bg-card aria-pressed:text-foreground aria-pressed:shadow-xs [@media(any-pointer:coarse)]:h-11'

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
		<div ref={rootRef} className="relative flex min-w-0 flex-1">
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

	return (
		<div className="flex flex-col gap-cluster p-5">
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

			<fieldset className="m-0 flex min-w-0 gap-px rounded-lg border-2 border-transparent bg-muted p-0">
				<legend className="sr-only">Filter</legend>
				<button
					type="button"
					aria-pressed={filter === 'all'}
					onClick={() => onFilter('all')}
					className={segmentClass}
				>
					All
				</button>
				<button
					type="button"
					aria-pressed={filter === 'files'}
					onClick={() => onFilter('files')}
					className={segmentClass}
				>
					With files
				</button>
				<button
					type="button"
					aria-pressed={filter === 'you'}
					onClick={() => onFilter('you')}
					className={segmentClass}
				>
					Names you
				</button>
				<FromFilter senders={senders} filter={filter} onFilter={onFilter} />
			</fieldset>

			{/* biome-ignore lint/a11y/noStaticElementInteractions: arrow keys move between the row buttons inside */}
			<div className="flex flex-col" onKeyDown={(event) => moveFocus(event, 'button[data-map-row]')}>
				{rows.length === 0 || !rows.some((row) => row.kind === 'entry') ? (
					<p className="m-0 px-hairline py-cluster text-[13px] text-muted-foreground">No messages match.</p>
				) : null}
				{rows.map((row) => {
					if (row.kind === 'stopped') {
						return (
							<div
								key="stopped"
								data-slot="thread-map-stopped"
								className="flex items-center gap-cluster px-hairline py-cluster text-xs font-semibold text-cta-icon"
							>
								<span aria-hidden="true" className="h-px flex-1 bg-border" />
								<span>You stopped here</span>
								<span aria-hidden="true" className="h-px flex-1 bg-border" />
							</div>
						)
					}
					if (row.kind === 'event') {
						return (
							<p
								key={row.key}
								className="m-0 px-hairline py-cluster text-xs leading-[1.4] text-muted-foreground"
							>
								{row.text}
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
							onClick={() => onSelect(entry.messageId)}
							className={cn(
								'flex min-h-[33px] w-full min-w-0 items-center gap-hairline rounded-md px-hairline text-left text-[13px] leading-[1.35] transition-colors duration-[var(--dur-fast)] hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [@media(any-pointer:coarse)]:min-h-11',
								entry.unread && 'font-semibold',
								selected && 'bg-row-selected hover:bg-row-selected',
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
							{entry.chips.map((chip) => (
								<span
									key={chip}
									className={cn(
										'inline-flex h-5 shrink-0 items-center rounded-full px-cluster text-[11px]',
										chip === ASKS_YOU_CHIP
											? 'bg-amber-soft text-amber-soft-foreground'
											: 'bg-muted text-foreground/70',
									)}
								>
									{chip}
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

			<p className="m-0 pt-cluster text-xs leading-[1.5] text-muted-foreground">
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
}: {
	entries: MapEntry[]
	stoppedBeforeIndex: number | null
	filter: ThreadMapFilter
	onFilter(f: ThreadMapFilter): void
	selectedId?: string
	onSelect(messageId: string): void
	onClose(): void
	open: boolean
	/** Messages that name the reader (`threadMapNamesYou`); without it "Names you" keeps the questions to the reader. */
	namesYouIds?: readonly string[]
}) {
	const docked = useDocked()
	const titleId = useId()
	const asideRef = useRef<HTMLElement>(null)
	const namesYou = useMemo(() => new Set(namesYouIds ?? []), [namesYouIds])
	const panel = useGlassPanelProps()

	const focusCurrentRow = (root: HTMLElement | null) => {
		const row =
			root?.querySelector<HTMLElement>('button[data-map-row][aria-current="true"]') ??
			root?.querySelector<HTMLElement>('button[data-map-row]')
		row?.scrollIntoView?.({ block: 'nearest' })
		row?.focus({ preventScroll: true })
	}

	// biome-ignore lint/correctness/useExhaustiveDependencies: focus moves only when the docked panel opens
	useEffect(() => {
		if (open && docked) focusCurrentRow(asideRef.current)
	}, [open, docked])

	const body = (title: ReactNode) => (
		<MapBody
			title={title}
			entries={entries}
			stoppedBeforeIndex={stoppedBeforeIndex}
			filter={filter}
			onFilter={onFilter}
			selectedId={selectedId}
			onSelect={onSelect}
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
					'absolute top-region right-region z-30 max-h-[calc(100%-2rem)] w-[380px] overflow-y-auto',
				)}
			>
				<GlassPanelScope>{body(heading)}</GlassPanelScope>
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
				onOpenAutoFocus={(event) => {
					event.preventDefault()
					focusCurrentRow(event.currentTarget as HTMLElement)
				}}
				className="right-0 left-auto flex w-[min(380px,calc(100%_-_2rem))] max-w-none flex-col border-l bg-background pt-[var(--safe-area-top)] pb-[var(--safe-area-bottom)]"
			>
				<div className="min-h-0 flex-1 overflow-y-auto">
					{body(
						<DialogTitle asChild>
							<h2 className="m-0 min-w-0 flex-1 text-base font-semibold">Thread map</h2>
						</DialogTitle>,
					)}
				</div>
			</DialogContent>
		</Dialog>
	)
}

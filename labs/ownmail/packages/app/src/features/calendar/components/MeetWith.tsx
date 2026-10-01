import { X } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { searchContacts } from '#server/fns'
import { GLASS_PANEL_CLASS } from '#shared/components/ui/glass'
import { IconButton } from '#shared/components/ui/icon-button'
import { Input } from '#shared/components/ui/input'
import { moveHighlight } from '#shared/lib/contact-token'
import { cn } from '#shared/lib/utils'
import { describeRange } from '../lib/calendar-drag.js'
import { eventColorStyle } from '../lib/calendar-ui-model.js'
import {
	type FreeBusyPerson,
	freeBusyEmail,
	MAX_FREE_BUSY_PEOPLE,
	type MeetWithPerson,
	personColor,
	personLabel,
	personStatus,
} from '../lib/free-busy.js'

/** Typing pauses this long before contacts are searched, so no lookup runs per keystroke. */
const SEARCH_DEBOUNCE_MS = 250
const MIN_SEARCH_LENGTH = 2
/** Busy periods read out per person; the grid shows them all. */
const MAX_ANNOUNCED_SLOTS = 20

/**
 * "Meet with…": a people search whose picks are overlaid on the grid as busy
 * blocks. The list beneath is the legend: a swatch, the person's name, and
 * their state in words. The people chosen live only in the page.
 */
export function MeetWith({
	people,
	results,
	loading,
	error,
	shownOnGrid,
	timeZone,
	onChange,
	onRetry,
}: {
	people: MeetWithPerson[]
	results: FreeBusyPerson[]
	loading: boolean
	/** A generic failure message, or null. */
	error: string | null
	/** False in the month view, which has no time grid to draw on. */
	shownOnGrid: boolean
	timeZone: string
	onChange: (people: MeetWithPerson[]) => void
	onRetry: () => void
}) {
	const [draft, setDraft] = useState('')
	const [suggestions, setSuggestions] = useState<MeetWithPerson[]>([])
	const [open, setOpen] = useState(false)
	const [highlight, setHighlight] = useState(0)
	const [invalid, setInvalid] = useState(false)
	const inputId = useId()
	const headingId = useId()
	const helpId = useId()
	const listboxId = useId()
	// Lookups can finish out of order; only the latest may fill the list.
	const searchRequestId = useRef(0)
	const query = draft.trim()
	const full = people.length >= MAX_FREE_BUSY_PEOPLE
	const chosen = people.map((person) => person.email).join('\n')

	useEffect(() => {
		const requestId = ++searchRequestId.current
		if (query.length < MIN_SEARCH_LENGTH) {
			setSuggestions([])
			setOpen(false)
			return
		}
		const timer = setTimeout(async () => {
			let found: MeetWithPerson[] = []
			try {
				found = await searchContacts({ data: { q: query } })
			} catch {
				// Suggestions are best-effort; a full address can still be typed.
			}
			if (requestId !== searchRequestId.current) return
			const taken = new Set(chosen.split('\n'))
			// Only addresses that can be looked up, and nobody already listed.
			const usable = found.flatMap((contact) => {
				const email = freeBusyEmail(contact.email)
				return email && !taken.has(email) ? [{ email, ...(contact.name ? { name: contact.name } : {}) }] : []
			})
			setSuggestions(usable)
			setOpen(usable.length > 0)
			setHighlight(0)
		}, SEARCH_DEBOUNCE_MS)
		return () => clearTimeout(timer)
	}, [chosen, query])

	function add(person: MeetWithPerson) {
		if (!people.some((existing) => existing.email === person.email)) onChange([...people, person])
		setDraft('')
		setSuggestions([])
		setOpen(false)
		setInvalid(false)
	}

	function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
		if (open && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
			event.preventDefault()
			setHighlight(moveHighlight(highlight, event.key === 'ArrowDown' ? 1 : -1, suggestions.length))
			return
		}
		if (event.key === 'Escape' && open) {
			event.preventDefault()
			event.stopPropagation()
			setOpen(false)
			return
		}
		if (event.key !== 'Enter' || !query) return
		event.preventDefault()
		const picked = open ? suggestions[highlight] : undefined
		if (picked) {
			add(picked)
			return
		}
		// Someone who is not a contact can be added by their full address.
		const email = freeBusyEmail(query)
		if (email) add({ email })
		else setInvalid(true)
	}

	const highlighted = open && suggestions[highlight] ? `${listboxId}-option-${highlight}` : undefined

	return (
		<section aria-labelledby={headingId} className="flex flex-col gap-cluster">
			<h2 id={headingId} className="text-xs text-muted-foreground">
				Meet with…
			</h2>
			<div className="relative">
				<label className="sr-only" htmlFor={inputId}>
					Search people to meet with
				</label>
				<Input
					id={inputId}
					value={draft}
					onChange={(event) => {
						setDraft(event.target.value)
						setInvalid(false)
						// The list answered the previous text; Enter must not pick from it for the new text.
						setOpen(false)
					}}
					onKeyDown={onKeyDown}
					onBlur={() => setOpen(false)}
					placeholder="Search people"
					className="h-11"
					type="email"
					inputMode="email"
					autoComplete="off"
					autoCapitalize="none"
					disabled={full}
					aria-invalid={invalid || undefined}
					aria-describedby={helpId}
					role="combobox"
					aria-autocomplete="list"
					aria-expanded={open}
					aria-controls={listboxId}
					aria-activedescendant={highlighted}
				/>
				{open ? (
					<div
						id={listboxId}
						role="listbox"
						aria-label="People suggestions"
						className={cn('absolute z-10 mt-control w-full overflow-hidden py-control', GLASS_PANEL_CLASS)}
					>
						{suggestions.map((suggestion, index) => (
							<div key={suggestion.email} role="presentation">
								<button
									id={`${listboxId}-option-${index}`}
									type="button"
									role="option"
									tabIndex={-1}
									data-highlighted={index === highlight ? 'true' : undefined}
									aria-selected={index === highlight}
									onMouseEnter={() => setHighlight(index)}
									// Keeps focus in the field, so the click lands before the list closes on blur.
									onPointerDown={(event) => event.preventDefault()}
									onClick={() => add(suggestion)}
									className="command-row block min-h-12 w-full px-hairline py-cluster text-left text-sm focus-visible:ring-[3px] focus-visible:ring-ring data-[highlighted=true]:bg-muted"
								>
									<span className="block truncate font-medium">{personLabel(suggestion)}</span>
									{suggestion.name ? (
										<span className="block truncate text-muted-foreground">{suggestion.email}</span>
									) : null}
								</button>
							</div>
						))}
					</div>
				) : null}
			</div>
			<p id={helpId} className="text-xs text-muted-foreground" role={invalid ? 'alert' : undefined}>
				{invalid
					? 'Pick a person from the list or type a full email address.'
					: full
						? `Up to ${MAX_FREE_BUSY_PEOPLE} people at a time.`
						: 'Their busy times appear on the grid. Event details are never shown.'}
			</p>
			{people.length > 0 ? (
				<ul aria-label="People shown on the grid" className="flex flex-col gap-control">
					{people.map((person, index) => {
						const result = results.find((candidate) => candidate.email === person.email)
						const label = personLabel(person)
						return (
							<li key={person.email} className="flex items-center gap-cluster">
								<span
									aria-hidden="true"
									className="event-color busy-block size-[11px] shrink-0 rounded-[3px]"
									style={eventColorStyle(personColor(index))}
								/>
								<span className="min-w-0 flex-1">
									<span className="block truncate text-sm text-foreground" title={person.email}>
										{label}
									</span>
									<span className="block text-xs text-muted-foreground">
										{shownOnGrid ? personStatus(result, loading) : 'Shown in the day and week views'}
									</span>
									{/* The grid's busy blocks are decorative; their times are listed here for assistive technology. */}
									{shownOnGrid && result?.busy.length ? (
										<ul className="sr-only" aria-label={`Busy times for ${label}`}>
											{result.busy.slice(0, MAX_ANNOUNCED_SLOTS).map((slot) => (
												<li key={slot.start}>{describeRange(slot, timeZone)}</li>
											))}
										</ul>
									) : null}
								</span>
								<IconButton
									label={`Remove ${label}`}
									onClick={() => onChange(people.filter((existing) => existing.email !== person.email))}
								>
									<X aria-hidden="true" />
								</IconButton>
							</li>
						)
					})}
				</ul>
			) : null}
			{error && people.length > 0 && shownOnGrid ? (
				<div
					role="alert"
					className="flex flex-col items-start gap-cluster rounded-lg border border-border bg-muted p-hairline text-sm text-foreground"
				>
					<span>{error}</span>
					<button
						type="button"
						onClick={onRetry}
						className="touch-target min-h-11 rounded-md border border-border bg-card px-hairline text-sm font-medium hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:outline-none"
					>
						Try again
					</button>
				</div>
			) : null}
		</section>
	)
}

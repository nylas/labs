import { ArrowRight, CircleHelp, LoaderCircle, Search, X } from 'lucide-react'
import { useId, useMemo, useRef, useState } from 'react'
import {
	applyMailSearchSuggestion,
	mailSearchSuggestions,
	validateMailSearchQuery,
} from '#features/mail/lib/mail-search'
import { cn } from '#shared/lib/utils'

type MailSearchBarProps = {
	value: string
	activeQuery?: string
	onChange: (value: string) => void
	onSubmit: (value: string) => void | Promise<void>
}

export function MailSearchBar({ value, activeQuery, onChange, onSubmit }: MailSearchBarProps) {
	const inputRef = useRef<HTMLInputElement>(null)
	const listboxId = useId()
	const messageId = useId()
	const [focused, setFocused] = useState(false)
	const [helpOpen, setHelpOpen] = useState(false)
	const [activeIndex, setActiveIndex] = useState(-1)
	const [touched, setTouched] = useState(false)
	const [submitting, setSubmitting] = useState(false)
	const [submissionError, setSubmissionError] = useState(false)
	const cursor = inputRef.current?.selectionStart ?? value.length
	const validation = useMemo(() => validateMailSearchQuery(value), [value])
	const suggestions = useMemo(() => mailSearchSuggestions(value, cursor), [cursor, value])
	const hasError = (touched && !validation.valid) || submissionError
	const isActiveQuery =
		validation.valid && Boolean(validation.query) && validation.query === activeQuery?.trim()
	const panelOpen =
		(hasError ||
			(helpOpen && suggestions.length > 0) ||
			(focused && value.trim().length > 0 && suggestions.length > 0)) &&
		!submitting

	function setValue(nextValue: string) {
		onChange(nextValue)
		setTouched(false)
		setSubmissionError(false)
		setActiveIndex(-1)
	}

	function applySuggestion(suggestion: (typeof suggestions)[number]) {
		const next = applyMailSearchSuggestion(value, suggestion)
		setValue(next.value)
		setHelpOpen(false)
		requestAnimationFrame(() => {
			inputRef.current?.focus()
			inputRef.current?.setSelectionRange(next.cursor, next.cursor)
		})
	}

	async function submitValue(nextValue: string) {
		const result = validateMailSearchQuery(nextValue)
		setTouched(true)
		if (!result.valid) return
		setHelpOpen(false)
		setActiveIndex(-1)
		setSubmissionError(false)
		setSubmitting(true)
		try {
			await onSubmit(result.query)
		} catch {
			setSubmissionError(true)
		} finally {
			setSubmitting(false)
		}
	}

	const state = submitting ? 'loading' : hasError ? 'error' : isActiveQuery ? 'success' : 'default'
	const message = submissionError
		? "Search couldn't start. Please try again."
		: validation.valid
			? isActiveQuery
				? 'Showing results for this search.'
				: 'Search terms can match subjects, people, message text, and attachment names.'
			: validation.message

	return (
		<form
			className="mail-search relative flex min-w-0 flex-1 items-center"
			data-state={state}
			onSubmit={(event) => {
				event.preventDefault()
				void submitValue(value)
			}}
			onBlur={(event) => {
				if (event.currentTarget.contains(event.relatedTarget)) return
				setFocused(false)
				setHelpOpen(false)
				if (value.trim()) setTouched(true)
			}}
		>
			<div className="mail-search-control flex min-w-0 flex-1 items-center px-3" data-state={state}>
				<Search className="pointer-events-none h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
				<input
					ref={inputRef}
					id="mail-search"
					type="text"
					role="combobox"
					value={value}
					onChange={(event) => setValue(event.target.value)}
					onFocus={() => setFocused(true)}
					onClick={() => setActiveIndex(-1)}
					onKeyDown={(event) => {
						if (event.key === 'ArrowDown' && suggestions.length > 0) {
							event.preventDefault()
							setFocused(true)
							setActiveIndex((current) => (current + 1) % suggestions.length)
						} else if (event.key === 'ArrowUp' && suggestions.length > 0) {
							event.preventDefault()
							setFocused(true)
							setActiveIndex((current) => (current <= 0 ? suggestions.length - 1 : current - 1))
						} else if (event.key === 'Enter') {
							event.preventDefault()
							if (activeIndex >= 0) applySuggestion(suggestions[activeIndex] as (typeof suggestions)[number])
							else void submitValue(value)
						} else if (event.key === 'Escape' && panelOpen) {
							event.preventDefault()
							setHelpOpen(false)
							setFocused(false)
							setActiveIndex(-1)
						}
					}}
					placeholder="Search mail"
					className="mail-search-field h-11 min-w-0 flex-1 border-0 bg-transparent px-2 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground"
					aria-label="Search mail"
					aria-autocomplete="list"
					aria-controls={panelOpen ? listboxId : undefined}
					aria-expanded={panelOpen}
					aria-activedescendant={activeIndex >= 0 ? `${listboxId}-${activeIndex}` : undefined}
					aria-describedby={messageId}
					aria-invalid={hasError || undefined}
					enterKeyHint="search"
					autoCapitalize="none"
					autoComplete="off"
					spellCheck={false}
				/>
				{value ? (
					<button
						type="button"
						onClick={() => {
							setValue('')
							void submitValue('')
						}}
						aria-label="Clear search"
						className="mail-search-icon-button"
					>
						<X className="h-4 w-4" aria-hidden="true" />
					</button>
				) : (
					<kbd className="kbd mr-1 hidden sm:inline-flex">/</kbd>
				)}
				<button
					type="button"
					onClick={() => {
						setHelpOpen((open) => !open)
						setFocused(true)
						setActiveIndex(-1)
						inputRef.current?.focus()
					}}
					aria-label="Show advanced search help"
					aria-pressed={helpOpen}
					className="mail-search-icon-button"
				>
					<CircleHelp className="h-4 w-4" aria-hidden="true" />
				</button>
			</div>

			<button
				type="submit"
				disabled={submitting}
				className="mail-search-submit"
				data-state={state}
				aria-label={submitting ? 'Searching mail' : 'Submit mail search'}
				title={submitting ? 'Searching' : 'Search'}
			>
				{submitting ? (
					<LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
				) : (
					<ArrowRight className="h-4 w-4" aria-hidden="true" />
				)}
			</button>

			<span id={messageId} className="sr-only" aria-live="polite">
				{message}
			</span>

			{panelOpen ? (
				<div className="mail-search-panel" data-state={hasError ? 'error' : 'default'}>
					{hasError ? (
						<div className="mail-search-error" role="alert">
							{message}
						</div>
					) : (
						<>
							<div className="mail-search-panel-heading">
								<span>{value.trim() ? 'Continue your search' : 'Search with precision'}</span>
								<span className="font-normal text-muted-foreground">↑↓ choose · Enter apply</span>
							</div>
							<div id={listboxId} role="listbox" aria-label="Advanced search suggestions">
								{suggestions.map((suggestion, index) => (
									<div
										key={suggestion.id}
										id={`${listboxId}-${index}`}
										role="option"
										tabIndex={-1}
										aria-selected={index === activeIndex}
										className={cn('mail-search-option', index === activeIndex && 'is-active')}
										onMouseDown={(event) => event.preventDefault()}
										onMouseEnter={() => setActiveIndex(index)}
										onClick={() => applySuggestion(suggestion)}
										onKeyDown={(event) => {
											if (event.key === 'Enter' || event.key === ' ') applySuggestion(suggestion)
										}}
									>
										<span className="font-medium text-foreground">{suggestion.label}</span>
										<span className="text-xs text-muted-foreground">{suggestion.description}</span>
									</div>
								))}
							</div>
							<div className="mail-search-panel-footer">
								<span>
									<code>"phrase"</code> exact
								</span>
								<span>
									<code>OR</code> either
								</span>
								<span>
									<code>-term</code> exclude
								</span>
								<span>
									<code>( )</code> group
								</span>
							</div>
						</>
					)}
				</div>
			) : null}
		</form>
	)
}

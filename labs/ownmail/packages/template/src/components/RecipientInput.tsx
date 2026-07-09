import { X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { cn } from '../lib/utils.js'
import { searchContacts } from '../server/fns.js'
import { addToken, moveHighlight, removeTokenAt, tokensToValue, valueToTokens } from './contact-token.js'
import { Input } from './ui/input.js'

/**
 * Recipient/guest field with contact autocomplete. Committed recipients render
 * as removable chips; the trailing input is where you type or pick the next
 * one. Keeps the comma-separated `value: string` contract so compose drafts and
 * calendar guests can share it unchanged.
 */
export function RecipientInput({
	value,
	onChange,
	placeholder,
	className,
	id = 'recipient-input',
	label = 'Recipients',
}: {
	value: string
	onChange: (next: string) => void
	placeholder?: string
	className?: string
	id?: string
	label?: string
}) {
	const tokens = valueToTokens(value)
	const [draft, setDraft] = useState('')
	const [suggestions, setSuggestions] = useState<{ email: string; name?: string }[]>([])
	const [open, setOpen] = useState(false)
	const [highlight, setHighlight] = useState(0)
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
	// Mirror the draft so the debounced blur handler reads the latest value,
	// not the stale one captured when blur fired (a pick clears it in between).
	const draftRef = useRef('')

	const query = draft.trim()

	function setDraftValue(next: string) {
		draftRef.current = next
		setDraft(next)
	}

	useEffect(() => {
		if (timer.current) clearTimeout(timer.current)
		if (query.length < 2) {
			setSuggestions([])
			setOpen(false)
			return
		}
		timer.current = setTimeout(async () => {
			try {
				const found = await searchContacts({ data: { q: query } })
				setSuggestions(found)
				setOpen(found.length > 0)
				setHighlight(0)
			} catch {
				setSuggestions([]) // autocomplete is best-effort
			}
		}, 250)
		return () => {
			if (timer.current) clearTimeout(timer.current)
		}
	}, [query])

	function commit(raw: string) {
		onChange(tokensToValue(addToken(tokens, raw)))
		setDraftValue('')
		setSuggestions([])
		setOpen(false)
	}

	function removeAt(index: number) {
		onChange(tokensToValue(removeTokenAt(tokens, index)))
	}

	function onInputChange(event: React.ChangeEvent<HTMLInputElement>) {
		const next = event.target.value
		// A comma (typed or pasted) commits everything before the last one.
		if (next.includes(',')) {
			const cut = next.lastIndexOf(',')
			let nextTokens = tokens
			for (const part of next.slice(0, cut).split(',')) nextTokens = addToken(nextTokens, part)
			onChange(tokensToValue(nextTokens))
			setDraftValue(next.slice(cut + 1).trimStart())
			return
		}
		setDraftValue(next)
	}

	function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
		if (open && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
			event.preventDefault()
			setHighlight(moveHighlight(highlight, event.key === 'ArrowDown' ? 1 : -1, suggestions.length))
			return
		}
		if (event.key === 'Enter') {
			const picked = open ? suggestions[highlight] : undefined
			if (picked || draft.trim()) {
				event.preventDefault()
				commit(picked ? picked.email : draft)
			}
			return
		}
		if (event.key === 'Escape' && open) {
			event.preventDefault()
			setOpen(false)
			return
		}
		if (event.key === 'Backspace' && draft === '' && tokens.length > 0) {
			removeAt(tokens.length - 1)
		}
	}

	return (
		// The width class lives on the root so the absolutely-positioned suggestion
		// list (w-full) spans the whole field instead of just the typed content.
		<div className={cn('relative', className)}>
			<label className="sr-only" htmlFor={id}>
				{label}
			</label>
			<div className="flex flex-wrap items-center gap-1">
				{tokens.map((token, index) => (
					<span
						key={token}
						className="inline-flex items-center gap-1 rounded-full bg-muted py-0.5 pr-1 pl-2.5 text-xs text-foreground"
					>
						<span className="max-w-[12rem] truncate">{token}</span>
						<button
							type="button"
							aria-label={`Remove ${token}`}
							onMouseDown={(e) => {
								e.preventDefault()
								removeAt(index)
							}}
							className="flex h-4 w-4 items-center justify-center rounded-full text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
						>
							<X className="h-3 w-3" />
						</button>
					</span>
				))}
				<Input
					id={id}
					value={draft}
					onChange={onInputChange}
					onKeyDown={onKeyDown}
					onBlur={() =>
						setTimeout(() => {
							if (draftRef.current.trim()) commit(draftRef.current)
							setOpen(false)
						}, 150)
					}
					placeholder={tokens.length ? '' : (placeholder ?? 'To (comma-separated)')}
					className="min-h-0 w-auto min-w-[8rem] flex-1 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
					type="email"
					inputMode="email"
					autoComplete="off"
					autoCapitalize="none"
					enterKeyHint="next"
				/>
			</div>
			{open ? (
				<ul className="absolute z-10 mt-1 w-full overflow-hidden rounded-xl border border-border bg-popover py-1 shadow-lg">
					{suggestions.map((suggestion, index) => (
						<li key={suggestion.email}>
							<button
								type="button"
								data-highlighted={index === highlight ? 'true' : undefined}
								onMouseEnter={() => setHighlight(index)}
								onMouseDown={(e) => {
									e.preventDefault()
									commit(suggestion.email)
								}}
								className="command-row block w-full px-3 py-2 text-left text-sm data-[highlighted=true]:bg-muted"
							>
								{suggestion.name ? (
									<>
										<span className="block truncate font-medium">{suggestion.name}</span>
										<span className="block truncate text-muted-foreground">{suggestion.email}</span>
									</>
								) : (
									<span className="block truncate">{suggestion.email}</span>
								)}
							</button>
						</li>
					))}
				</ul>
			) : null}
		</div>
	)
}

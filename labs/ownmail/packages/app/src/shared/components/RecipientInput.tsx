import { X } from 'lucide-react'
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { searchContacts } from '#server/fns'
import { addToken, moveHighlight, removeTokenAt, tokensToValue, valueToTokens } from '../lib/contact-token.js'
import { cn } from '../lib/utils.js'
import { Input } from './ui/input.js'

/**
 * Recipient/guest field with contact autocomplete. Committed recipients render
 * as removable chips; the trailing input is where you type or pick the next
 * one. Keeps the comma-separated `value: string` contract so compose drafts and
 * calendar guests can share it unchanged.
 */
export type RecipientInputHandle = {
	getCurrentValue: () => string
}

type RecipientInputProps = {
	value: string
	onChange: (next: string) => void
	onEdit?: () => void
	placeholder?: string
	className?: string
	id?: string
	label?: string
	disabled?: boolean
	invalid?: boolean
	describedBy?: string
}

export const RecipientInput = forwardRef<RecipientInputHandle, RecipientInputProps>(function RecipientInput(
	{
		value,
		onChange,
		onEdit,
		placeholder,
		className,
		id = 'recipient-input',
		label = 'Recipients',
		disabled = false,
		invalid = false,
		describedBy,
	},
	ref,
) {
	const tokens = valueToTokens(value)
	const [draft, setDraft] = useState('')
	const [suggestions, setSuggestions] = useState<{ email: string; name?: string }[]>([])
	const [open, setOpen] = useState(false)
	const [highlight, setHighlight] = useState(0)
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
	const currentValueRef = useRef(value)
	// Contact lookups can finish out of order. Keep a monotonically increasing
	// request id so a slow response for an earlier draft cannot replace the
	// suggestions for what the user is currently typing.
	const searchRequestId = useRef(0)
	const query = draft.trim()
	currentValueRef.current = query ? tokensToValue(addToken(tokens, query)) : value
	useImperativeHandle(ref, () => ({ getCurrentValue: () => currentValueRef.current }), [])

	function setDraftValue(next: string) {
		currentValueRef.current = next.trim() ? tokensToValue(addToken(tokens, next)) : value
		setDraft(next)
		onEdit?.()
	}

	useEffect(() => {
		const requestId = ++searchRequestId.current
		if (timer.current) clearTimeout(timer.current)
		if (disabled || query.length < 2) {
			setSuggestions([])
			setOpen(false)
			return
		}
		timer.current = setTimeout(async () => {
			try {
				const found = await searchContacts({ data: { q: query } })
				if (requestId !== searchRequestId.current) return
				setSuggestions(found)
				setOpen(found.length > 0)
				setHighlight(0)
			} catch {
				if (requestId !== searchRequestId.current) return
				setSuggestions([]) // autocomplete is best-effort
			}
		}, 250)
		return () => {
			/* v8 ignore else -- @preserve this cleanup exists only after the effect schedules a timer */
			if (timer.current) clearTimeout(timer.current)
		}
	}, [disabled, query])

	function commit(raw: string) {
		const next = tokensToValue(addToken(tokens, raw))
		currentValueRef.current = next
		onChange(next)
		onEdit?.()
		setDraft('')
		setSuggestions([])
		setOpen(false)
	}

	function removeAt(index: number) {
		const next = tokensToValue(removeTokenAt(tokens, index))
		currentValueRef.current = next
		onChange(next)
		onEdit?.()
	}

	function onInputChange(event: React.ChangeEvent<HTMLInputElement>) {
		const next = event.target.value
		// A comma (typed or pasted) commits everything before the last one.
		if (next.includes(',')) {
			const cut = next.lastIndexOf(',')
			let nextTokens = tokens
			for (const part of next.slice(0, cut).split(',')) nextTokens = addToken(nextTokens, part)
			const committed = tokensToValue(nextTokens)
			const remainder = next.slice(cut + 1).trimStart()
			currentValueRef.current = remainder ? tokensToValue(addToken(nextTokens, remainder)) : committed
			onChange(committed)
			onEdit?.()
			setDraft(remainder)
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
		if (event.key === 'Enter' && !event.metaKey && !event.ctrlKey) {
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
		<div className={cn('relative', className)} aria-disabled={disabled || undefined}>
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
							disabled={disabled}
							aria-label={`Remove ${token}`}
							onMouseDown={(e) => {
								e.preventDefault()
								removeAt(index)
							}}
							className="flex h-4 w-4 items-center justify-center rounded-full text-muted-foreground hover:bg-foreground/10 hover:text-foreground disabled:cursor-wait disabled:opacity-50"
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
					onBlur={() => {
						// Blur runs before an external button's click. Commit now so Close
						// snapshots the visible recipient instead of an older controlled value.
						if (draft.trim()) commit(draft)
						setOpen(false)
					}}
					placeholder={tokens.length ? '' : (placeholder ?? 'To (comma-separated)')}
					className="min-h-0 w-auto min-w-[8rem] flex-1 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
					type="email"
					inputMode="email"
					autoComplete="off"
					autoCapitalize="none"
					enterKeyHint="next"
					disabled={disabled}
					aria-invalid={invalid || undefined}
					aria-describedby={describedBy}
				/>
			</div>
			{open ? (
				<ul className="absolute z-10 mt-1 w-full overflow-hidden rounded-xl border border-border bg-popover py-1 shadow-lg">
					{suggestions.map((suggestion, index) => (
						<li key={suggestion.email}>
							<button
								type="button"
								disabled={disabled}
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
})

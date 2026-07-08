import { useEffect, useRef, useState } from 'react'
import { searchContacts } from '../server/fns.js'
import { cn } from './ui-model.js'

/** "To" field with contact autocomplete (best-effort, debounced). */
export function RecipientInput({
	value,
	onChange,
	placeholder,
	className,
}: {
	value: string
	onChange: (next: string) => void
	placeholder?: string
	className?: string
}) {
	const [suggestions, setSuggestions] = useState<{ email: string; name?: string }[]>([])
	const [open, setOpen] = useState(false)
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

	// The fragment after the last comma is what the user is currently typing.
	const activeFragment = (value.split(',').pop() ?? '').trim()

	useEffect(() => {
		if (timer.current) clearTimeout(timer.current)
		if (activeFragment.length < 2) {
			setSuggestions([])
			setOpen(false)
			return
		}
		timer.current = setTimeout(async () => {
			try {
				const found = await searchContacts({ data: { q: activeFragment } })
				setSuggestions(found)
				setOpen(found.length > 0)
			} catch {
				setSuggestions([])
			}
		}, 250)
		return () => {
			if (timer.current) clearTimeout(timer.current)
		}
	}, [activeFragment])

	function pick(email: string) {
		const parts = value.split(',')
		parts[parts.length - 1] = ` ${email}`
		onChange(parts.join(',').replace(/^ /, ''))
		setOpen(false)
	}

	return (
		<div className="relative">
			<label className="sr-only" htmlFor="recipient-input">
				Recipients
			</label>
			<input
				id="recipient-input"
				value={value}
				onChange={(e) => onChange(e.target.value)}
				onBlur={() => setTimeout(() => setOpen(false), 150)}
				placeholder={placeholder ?? 'To (comma-separated)'}
				className={cn('app-input', className)}
				type="email"
				multiple
				inputMode="email"
				autoComplete="email"
				autoCapitalize="none"
				enterKeyHint="next"
			/>
			{open ? (
				<ul className="absolute z-10 mt-1 w-full overflow-hidden rounded-xl border border-border bg-popover py-1 shadow-lg">
					{suggestions.map((s) => (
						<li key={s.email}>
							<button
								type="button"
								onMouseDown={(e) => {
									e.preventDefault()
									pick(s.email)
								}}
								className="command-row block w-full px-3 py-2 text-left text-sm"
							>
								{s.name ? (
									<>
										<span className="font-medium">{s.name}</span>{' '}
										<span className="text-muted-foreground">&lt;{s.email}&gt;</span>
									</>
								) : (
									s.email
								)}
							</button>
						</li>
					))}
				</ul>
			) : null}
		</div>
	)
}

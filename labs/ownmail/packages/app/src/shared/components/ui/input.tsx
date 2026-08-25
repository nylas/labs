import type * as React from 'react'
import { cn } from '#shared/lib/utils'

export function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
	return (
		<input
			type={type}
			data-slot="input"
			className={cn(
				'touch-target flex h-9 w-full min-w-0 rounded-md border border-border bg-card px-3 py-1 text-base shadow-xs outline-none transition-[background-color,border-color,color] duration-[var(--dur-fast)] ease-[var(--ease-out)] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring aria-busy:cursor-wait aria-invalid:border-destructive aria-invalid:ring-[3px] aria-invalid:ring-destructive sm:text-sm [@media(any-pointer:coarse)]:min-h-11 disabled:cursor-not-allowed disabled:opacity-50 forced-colors:focus-visible:outline-2 forced-colors:focus-visible:outline-offset-2 forced-colors:focus-visible:outline-solid',
				className,
			)}
			{...props}
		/>
	)
}

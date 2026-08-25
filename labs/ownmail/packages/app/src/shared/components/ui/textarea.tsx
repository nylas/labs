import type * as React from 'react'
import { cn } from '#shared/lib/utils'

export function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
	return (
		<textarea
			data-slot="textarea"
			className={cn(
				'flex min-h-16 w-full resize-y rounded-md border border-border bg-card px-3 py-2 text-base shadow-xs outline-none transition-[background-color,border-color,color] duration-[var(--dur-fast)] ease-[var(--ease-out)] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring aria-busy:cursor-wait aria-invalid:border-destructive aria-invalid:ring-[3px] aria-invalid:ring-destructive sm:text-sm disabled:cursor-not-allowed disabled:opacity-50 forced-colors:focus-visible:outline-2 forced-colors:focus-visible:outline-offset-2 forced-colors:focus-visible:outline-solid',
				className,
			)}
			{...props}
		/>
	)
}

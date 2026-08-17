import * as SelectPrimitive from '@radix-ui/react-select'
import { Check, ChevronDown } from 'lucide-react'
import type * as React from 'react'
import { cn } from '#shared/lib/utils'

export const Select = SelectPrimitive.Root
export const SelectValue = SelectPrimitive.Value

export function SelectTrigger({
	className,
	children,
	...props
}: React.ComponentProps<typeof SelectPrimitive.Trigger>) {
	return (
		<SelectPrimitive.Trigger
			data-slot="select-trigger"
			className={cn(
				'touch-target flex h-9 items-center justify-between gap-2 rounded-md border border-border bg-card px-3 py-2 text-base shadow-xs outline-none transition-[background-color,border-color,color] duration-[var(--dur-fast)] ease-[var(--ease-out)] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40 sm:text-sm data-[placeholder]:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50 [&>span]:truncate',
				className,
			)}
			{...props}
		>
			{children}
			<SelectPrimitive.Icon asChild>
				<ChevronDown className="h-4 w-4 shrink-0 opacity-60" aria-hidden="true" />
			</SelectPrimitive.Icon>
		</SelectPrimitive.Trigger>
	)
}

export function SelectContent({
	className,
	children,
	...props
}: React.ComponentProps<typeof SelectPrimitive.Content>) {
	return (
		<SelectPrimitive.Portal>
			<SelectPrimitive.Content
				data-slot="select-content"
				position="popper"
				className={cn(
					'relative z-50 max-h-64 min-w-[8rem] w-[var(--radix-select-trigger-width)] overflow-x-hidden overflow-y-auto rounded-md border border-border bg-popover text-popover-foreground shadow-md',
					className,
				)}
				{...props}
			>
				<SelectPrimitive.Viewport className="p-1">{children}</SelectPrimitive.Viewport>
			</SelectPrimitive.Content>
		</SelectPrimitive.Portal>
	)
}

export function SelectItem({
	className,
	children,
	...props
}: React.ComponentProps<typeof SelectPrimitive.Item>) {
	return (
		<SelectPrimitive.Item
			data-slot="select-item"
			className={cn(
				'touch-target relative flex w-full cursor-default items-center rounded-sm py-1.5 pr-8 pl-2 text-sm outline-none select-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
				className,
			)}
			{...props}
		>
			<SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
			<span className="absolute right-2 flex items-center">
				<SelectPrimitive.ItemIndicator>
					<Check className="h-4 w-4" aria-hidden="true" />
				</SelectPrimitive.ItemIndicator>
			</span>
		</SelectPrimitive.Item>
	)
}

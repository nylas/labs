import * as TooltipPrimitive from '@radix-ui/react-tooltip'
import type * as React from 'react'
import { cn } from '#shared/lib/utils'

export function TooltipProvider({
	delayDuration = 200,
	...props
}: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
	return <TooltipPrimitive.Provider data-slot="tooltip-provider" delayDuration={delayDuration} {...props} />
}

type TooltipProps = React.ComponentProps<typeof TooltipPrimitive.Root> & {
	delayDuration?: number
}

/** Self-contained tooltip (bundles its own Provider) so callers don't need a root provider. */
export function Tooltip({ delayDuration, ...props }: TooltipProps) {
	return (
		<TooltipProvider delayDuration={delayDuration}>
			<TooltipPrimitive.Root data-slot="tooltip" {...props} />
		</TooltipProvider>
	)
}

export function TooltipTrigger(props: React.ComponentProps<typeof TooltipPrimitive.Trigger>) {
	return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />
}

export function TooltipContent({
	className,
	sideOffset = 6,
	children,
	...props
}: React.ComponentProps<typeof TooltipPrimitive.Content>) {
	return (
		<TooltipPrimitive.Portal>
			<TooltipPrimitive.Content
				data-slot="tooltip-content"
				sideOffset={sideOffset}
				className={cn(
					'z-50 rounded-md bg-foreground px-2 py-1 text-xs font-medium text-background shadow-md',
					className,
				)}
				{...props}
			>
				{children}
				<TooltipPrimitive.Arrow className="fill-foreground" />
			</TooltipPrimitive.Content>
		</TooltipPrimitive.Portal>
	)
}

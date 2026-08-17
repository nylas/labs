import * as DialogPrimitive from '@radix-ui/react-dialog'
import type * as React from 'react'
import { cn } from '#shared/lib/utils'

export const Dialog = DialogPrimitive.Root
export const DialogTitle = DialogPrimitive.Title

export type DialogPresentation = 'center' | 'bottom-sheet' | 'side'

const PRESENTATION_CLASS: Record<DialogPresentation, string> = {
	center: 'fixed top-1/2 left-1/2 w-full max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-xl',
	'bottom-sheet':
		'fixed inset-x-0 bottom-0 w-full max-h-[calc(100dvh-var(--safe-area-top))] rounded-t-2xl sm:top-1/2 sm:right-auto sm:bottom-auto sm:left-1/2 sm:max-w-lg sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-xl',
	side: 'fixed top-0 bottom-0 h-dvh max-h-full rounded-none',
}

export function DialogOverlay({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
	return (
		<DialogPrimitive.Overlay
			data-slot="dialog-overlay"
			className={cn('dialog-overlay fixed inset-0 z-[60] bg-foreground/25 backdrop-blur-[3px]', className)}
			{...props}
		/>
	)
}

/** Portalled, focus-trapped dialog surface with adaptive native-mobile presentations. */
export function DialogContent({
	className,
	children,
	onBackdropClick,
	presentation = 'center',
	...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
	onBackdropClick?: React.MouseEventHandler<HTMLDivElement>
	presentation?: DialogPresentation
}) {
	return (
		<DialogPrimitive.Portal>
			<DialogOverlay onClick={onBackdropClick} />
			<DialogPrimitive.Content
				data-slot="dialog-content"
				data-presentation={presentation}
				className={cn(
					'dialog-content z-[61] overflow-hidden border border-border bg-popover shadow-2xl outline-none',
					PRESENTATION_CLASS[presentation],
					className,
				)}
				{...props}
			>
				{children}
			</DialogPrimitive.Content>
		</DialogPrimitive.Portal>
	)
}

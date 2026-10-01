/* Hallmark · component: thread display menu · genre: modern-minimal · theme: Quiet
 * states: default · hover · focus · active · disabled · loading · error · success
 * contrast: existing application tokens · pre-emit critique: P5 H5 E5 S5 R5 V5
 */

import { Check, ImageOff, LoaderCircle, SlidersHorizontal } from 'lucide-react'
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { EmailColorMode, EmailLayoutMode } from '../lib/email-render.js'
import { messageHasHtml } from '../lib/mail-ui-model.js'
import type { MailMessage } from '../state/mail-queries.js'
import type { EmailDisplayStatus } from './EmailHtml.js'

const displayOptionClass =
	'inline-flex min-h-11 min-w-0 flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-md px-3 text-xs font-medium text-muted-foreground transition-[background-color,color,transform] duration-[var(--dur-fast)] ease-[var(--ease-out)] hover:bg-muted hover:text-foreground active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-pressed:bg-foreground aria-pressed:text-background'
const imageActionClass =
	'inline-flex min-h-11 w-full min-w-0 items-center justify-center whitespace-nowrap rounded-md px-3 text-sm font-medium transition-[background-color,color,transform] duration-[var(--dur-fast)] ease-[var(--ease-out)] active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-wait disabled:opacity-50'

export function ThreadDisplayMenu({
	messages,
	statuses,
	layoutMode,
	colorMode,
	showColorControl,
	senderTrustStatus,
	originalColorSenders = new Set<string>(),
	originalColorStatus = 'idle',
	onLayoutModeChange,
	onColorModeChange,
	onSenderOriginalColorsChange,
	onShowThreadImages,
	onAlwaysShowImages,
	onTrustSender,
	onRetryImages,
}: {
	messages: MailMessage[]
	statuses: ReadonlyMap<string, EmailDisplayStatus>
	layoutMode: EmailLayoutMode
	colorMode: EmailColorMode
	showColorControl: boolean
	senderTrustStatus: { address?: string; state: 'idle' | 'loading' | 'error' }
	originalColorSenders?: ReadonlySet<string>
	originalColorStatus?: 'idle' | 'error'
	onLayoutModeChange: (mode: EmailLayoutMode) => void
	onColorModeChange: (mode: EmailColorMode) => void
	onSenderOriginalColorsChange?: (address: string, enabled: boolean) => void
	onShowThreadImages: () => void
	onAlwaysShowImages: () => void
	onTrustSender: (address: string) => void
	onRetryImages: () => void
}) {
	const [open, setOpen] = useState(false)
	const rootRef = useRef<HTMLDivElement>(null)
	const triggerRef = useRef<HTMLButtonElement>(null)
	const panelRef = useRef<HTMLElement>(null)
	const panelId = useId()
	const headingId = useId()
	const statusValues = [...statuses.values()]
	const imagesBlocked = statusValues.some(
		(status) => status.remoteImages?.hasRemoteImages === true && status.remoteImages.loaded === false,
	)
	const failedImages = statusValues.reduce(
		(total, status) => total + (status.remoteImages?.failedImages ?? 0),
		0,
	)
	const pendingImages = statusValues.reduce(
		(total, status) => total + (status.remoteImages?.pendingImages ?? 0),
		0,
	)
	const showLayoutControl = layoutMode === 'original' || statusValues.some((status) => status.layoutAvailable)
	const blockedSenders = uniqueBlockedSenders(messages, statuses)
	const colorSenders = onSenderOriginalColorsChange ? uniqueHtmlSenders(messages).slice(0, 4) : []
	const trustableSender = blockedSenders.length === 1 ? blockedSenders[0] : undefined
	const isTrustingSender =
		senderTrustStatus.state === 'loading' && senderTrustStatus.address === trustableSender

	useLayoutEffect(() => {
		if (!open) return
		const panel = panelRef.current
		/* v8 ignore next -- the dialog mounts before React runs this layout effect -- @preserve */
		if (!panel) return
		const firstControl = panel.querySelector<HTMLElement>('button:not(:disabled), a[href]')
		if (firstControl) firstControl.focus()
		else panel.focus()
	}, [open])

	useEffect(() => {
		if (!open) return

		function closeOutside(event: PointerEvent | FocusEvent) {
			const target = event.target
			if (target instanceof Node && !rootRef.current?.contains(target)) setOpen(false)
		}

		function closeOnEscape(event: KeyboardEvent) {
			if (event.key !== 'Escape') return
			event.preventDefault()
			event.stopPropagation()
			setOpen(false)
			triggerRef.current?.focus()
		}

		document.addEventListener('pointerdown', closeOutside)
		document.addEventListener('focusin', closeOutside)
		document.addEventListener('keydown', closeOnEscape)
		return () => {
			document.removeEventListener('pointerdown', closeOutside)
			document.removeEventListener('focusin', closeOutside)
			document.removeEventListener('keydown', closeOnEscape)
		}
	}, [open])

	return (
		<div ref={rootRef} data-slot="thread-display-menu" className="relative shrink-0">
			<button
				ref={triggerRef}
				type="button"
				onClick={() => setOpen((current) => !current)}
				aria-label="Thread display"
				title="Thread display"
				aria-haspopup="dialog"
				aria-expanded={open}
				aria-controls={panelId}
				className="inline-flex size-9 max-md:size-11 [@media(any-pointer:coarse)]:size-11 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground active:bg-accent/80 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring forced-colors:focus-visible:outline-2 forced-colors:focus-visible:outline-offset-2 forced-colors:focus-visible:outline-solid"
			>
				{imagesBlocked || failedImages > 0 ? (
					<ImageOff className="h-4 w-4" aria-hidden="true" />
				) : (
					<SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
				)}
			</button>

			{open ? (
				<section
					ref={panelRef}
					id={panelId}
					role="dialog"
					tabIndex={-1}
					aria-labelledby={headingId}
					className="fixed inset-x-3 bottom-[calc(var(--mobile-tab-bar-height)+var(--safe-area-bottom)+0.75rem)] z-50 max-h-[calc(100dvh-var(--mobile-tab-bar-height)-var(--safe-area-bottom)-2rem)] overflow-y-auto overscroll-contain rounded-lg border border-border bg-popover p-4 text-popover-foreground shadow-sm sm:absolute sm:inset-x-auto sm:right-0 sm:bottom-auto sm:mt-1 sm:w-[min(20rem,calc(100vw-3rem))] sm:max-h-[min(32rem,calc(100dvh-6rem))]"
				>
					<h2 id={headingId} className="font-display text-sm font-semibold text-foreground">
						Thread display
					</h2>

					{imagesBlocked ? (
						<div className="mt-3 border-t border-border pt-3">
							<p className="text-sm leading-relaxed text-muted-foreground">
								External images stay off to limit tracking until you choose how to show them.
							</p>
							<div className="mt-3 grid gap-1.5">
								<button
									type="button"
									onClick={() => {
										onShowThreadImages()
										setOpen(false)
										triggerRef.current?.focus()
									}}
									className={`${imageActionClass} bg-foreground text-background hover:opacity-90`}
								>
									Show images in this thread
								</button>
								{trustableSender ? (
									<button
										type="button"
										disabled={isTrustingSender}
										aria-busy={isTrustingSender || undefined}
										onClick={() => onTrustSender(trustableSender)}
										className={`${imageActionClass} border border-border bg-background text-foreground hover:bg-muted`}
									>
										{isTrustingSender ? (
											<LoaderCircle
												className="h-4 w-4 animate-spin motion-reduce:animate-none"
												aria-hidden="true"
											/>
										) : null}
										<span className="min-w-0 truncate">Always show from {trustableSender}</span>
									</button>
								) : null}
								<button
									type="button"
									onClick={() => {
										onAlwaysShowImages()
										setOpen(false)
										triggerRef.current?.focus()
									}}
									className={`${imageActionClass} text-muted-foreground hover:bg-muted hover:text-foreground`}
								>
									Always show all
								</button>
							</div>
							{senderTrustStatus.state === 'error' ? (
								<p role="alert" className="mt-2 text-xs text-destructive">
									Couldn’t save that image choice. Try again.
								</p>
							) : null}
						</div>
					) : null}

					{failedImages > 0 ? (
						<div className="mt-3 border-t border-border pt-3">
							<p role="status" className="text-sm leading-relaxed text-muted-foreground">
								{failedImages === 1
									? 'One image could not be loaded.'
									: `${failedImages} images could not be loaded.`}
							</p>
							<button
								type="button"
								onClick={onRetryImages}
								className={`${imageActionClass} mt-2 border border-border bg-background text-foreground hover:bg-muted`}
							>
								Retry images
							</button>
						</div>
					) : null}

					{pendingImages > 0 ? (
						<p role="status" className="mt-3 border-t border-border pt-3 text-sm text-muted-foreground">
							Loading {pendingImages === 1 ? 'one image' : `${pendingImages} images`}…
						</p>
					) : null}

					{showLayoutControl ? (
						<fieldset className="mt-3 border-t border-border pt-3">
							<legend className="text-xs font-medium text-foreground">Layout</legend>
							<div className="mt-1.5 flex rounded-md bg-muted/60 p-0.5">
								{(
									[
										['readable', 'Readable'],
										['original', 'Original'],
									] as const
								).map(([mode, label]) => (
									<button
										key={mode}
										type="button"
										aria-pressed={layoutMode === mode}
										onClick={() => onLayoutModeChange(mode)}
										className={displayOptionClass}
									>
										{layoutMode === mode ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : null}
										{label}
									</button>
								))}
							</div>
						</fieldset>
					) : null}

					{showColorControl ? (
						<fieldset className="mt-3 border-t border-border pt-3">
							<legend className="text-xs font-medium text-foreground">Message colors</legend>
							<p className="mt-1 text-xs leading-relaxed text-muted-foreground">
								Automatic adapts light messages and eligible images in dark mode. Original preserves the
								sender’s colors on a light canvas.
							</p>
							<div className="mt-1.5 flex rounded-md bg-muted/60 p-0.5">
								{(
									[
										['automatic', 'Automatic'],
										['original', 'Original'],
									] as const
								).map(([mode, label]) => (
									<button
										key={mode}
										type="button"
										aria-label={`${label} message colors`}
										aria-pressed={colorMode === mode}
										onClick={() => onColorModeChange(mode)}
										className={displayOptionClass}
									>
										{colorMode === mode ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : null}
										{label}
									</button>
								))}
							</div>
							{colorMode === 'automatic' && colorSenders.length > 0 ? (
								<div className="mt-2 grid gap-1">
									{colorSenders.map((sender) => {
										const pressed = originalColorSenders.has(sender)
										return (
											<button
												key={sender}
												type="button"
												aria-pressed={pressed}
												onClick={() => onSenderOriginalColorsChange?.(sender, !pressed)}
												className={`${imageActionClass} justify-between gap-2 border border-border bg-background text-left text-foreground hover:bg-muted aria-pressed:border-foreground`}
											>
												<span className="min-w-0 truncate">Always use original colors from {sender}</span>
												{pressed ? <Check className="h-4 w-4 shrink-0" aria-hidden="true" /> : null}
											</button>
										)
									})}
								</div>
							) : null}
							{originalColorStatus === 'error' ? (
								<p role="alert" className="mt-2 text-xs text-destructive">
									Couldn’t save that color choice. Try again.
								</p>
							) : null}
						</fieldset>
					) : null}

					<a
						href="/settings"
						className="mt-3 inline-flex min-h-11 items-center whitespace-nowrap text-xs font-medium text-muted-foreground underline underline-offset-4 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
					>
						Manage image choices
					</a>
				</section>
			) : null}
		</div>
	)
}

function uniqueBlockedSenders(
	messages: MailMessage[],
	statuses: ReadonlyMap<string, EmailDisplayStatus>,
): string[] {
	const senders = messages.flatMap((message) => {
		const status = statuses.get(message.id)
		if (
			status?.remoteImages?.hasRemoteImages !== true ||
			status.remoteImages.loaded !== false ||
			typeof message.from?.[0]?.email !== 'string'
		) {
			return []
		}
		const sender = message.from[0].email.trim().toLowerCase()
		return sender ? [sender] : []
	})
	return [...new Set(senders)]
}

/** Unique senders of HTML messages, in thread order, as normalized addresses. */
function uniqueHtmlSenders(messages: MailMessage[]): string[] {
	const senders = messages.flatMap((message) => {
		const sender = messageHasHtml(message) ? message.from?.[0]?.email?.trim().toLowerCase() : undefined
		return sender ? [sender] : []
	})
	return [...new Set(senders)]
}

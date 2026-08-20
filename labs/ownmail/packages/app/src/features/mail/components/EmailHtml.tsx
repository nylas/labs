/* Hallmark · component: email display popover · genre: modern-minimal · theme: Quiet
 * states: default · hover · focus · active · disabled · loading · error · success
 * contrast: existing application tokens · pre-emit critique: P5 H5 E4 S5 R5 V5
 */

import { Check, ChevronDown, ImageOff, LoaderCircle, SlidersHorizontal } from 'lucide-react'
import { type Ref, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useUserPreferences } from '#app/preferences/user-preferences'
import {
	applyDarkInvert,
	applyEmailColorMode,
	applyEmailHtml,
	applyEmailImageMode,
	applyEmailLayoutMode,
	applyEmailTheme,
	applyRemoteImages,
	EMAIL_ELEMENT_TAG,
	EMAIL_LAYOUT_STATUS_EVENT,
	EMAIL_REMOTE_IMAGES_EVENT,
	type EmailElementLike,
	type EmailImageMode,
	type EmailLayoutStatusDetail,
	type EmailRemoteImagesDetail,
	type LinkPreviewDetail,
	linkPreviewText,
	previewBoxStyle,
	retryRemoteImages,
	subscribeLinkPreview,
} from '../lib/email-render.js'
import { senderImagesTrusted, trustSenderImages } from '../lib/image-sender-trust.js'
import { sanitizedEmailSupportsDarkMode } from '../lib/sanitize-email.js'
import { ensureEmailElementDefined } from './email-content-element.js'

// The custom element is a host tag, not a React component; the cast just gives it
// a typed ref + style props. At runtime React renders the string as a DOM element.
const OwnmailEmail = EMAIL_ELEMENT_TAG as unknown as (props: {
	ref?: Ref<HTMLElement>
	title?: string
	className?: string
	'data-message-id'?: string
}) => null

const displayTriggerClass =
	'inline-flex min-h-11 shrink-0 items-center gap-2 whitespace-nowrap rounded-md border border-border bg-background px-3 text-xs font-medium text-muted-foreground shadow-xs transition-[background-color,color,transform] duration-[var(--dur-fast)] ease-[var(--ease-out)] hover:bg-muted hover:text-foreground active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
const displayOptionClass =
	'inline-flex min-h-11 min-w-0 flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-md px-3 text-xs font-medium text-muted-foreground transition-[background-color,color,transform] duration-[var(--dur-fast)] ease-[var(--ease-out)] hover:bg-muted hover:text-foreground active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-pressed:bg-foreground aria-pressed:text-background'
const imageActionClass =
	'inline-flex min-h-11 w-full items-center justify-center whitespace-nowrap rounded-md px-3 text-sm font-medium transition-[background-color,color,transform] duration-[var(--dur-fast)] ease-[var(--ease-out)] active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50'

/** Tracks the app's dark theme (the `.dark` class the theme toggle sets on <html>). */
function useIsDark(): boolean {
	const [isDark, setIsDark] = useState(() => document.documentElement.classList.contains('dark'))
	useLayoutEffect(() => {
		const root = document.documentElement
		const update = () => setIsDark(root.classList.contains('dark'))
		update()
		const observer = new MutationObserver(update)
		observer.observe(root, { attributes: true, attributeFilter: ['class'] })
		return () => observer.disconnect()
	}, [])
	return isDark
}

/**
 * Client-only renderer for HTML email. Mounts the `<ownmail-email>` shadow-DOM
 * element, feeds it sanitized HTML, and layers on the app-side chrome that has to
 * live outside the shadow boundary: a hover/tap URL preview and account-controlled
 * automatic darkening.
 *
 * When enabled, a dark app theme inverts email that has no adaptive dark stylesheet
 * of its own so it does not become a blinding white rectangle.
 */
export function EmailHtml({
	html,
	messageId,
	darken = true,
	senderAddress,
}: {
	html: string
	messageId: string
	darken?: boolean
	senderAddress?: string
}) {
	const ref = useRef<(HTMLElement & EmailElementLike) | null>(null)
	const [ready, setReady] = useState(false)
	const [preview, setPreview] = useState<LinkPreviewDetail | null>(null)
	const [layoutControlAvailable, setLayoutControlAvailable] = useState(false)
	const [remoteImages, setRemoteImages] = useState<EmailRemoteImagesDetail | null>(null)
	const [preferences, savePreferences] = useUserPreferences()
	const [displayOpen, setDisplayOpen] = useState(false)
	const [senderTrustStatus, setSenderTrustStatus] = useState<'idle' | 'loading' | 'error'>('idle')
	const displayRootRef = useRef<HTMLDivElement>(null)
	const displayTriggerRef = useRef<HTMLButtonElement>(null)
	const displayPanelId = useId()
	const displayHeadingId = useId()
	const layoutMode = preferences.emailLayoutMode
	const colorMode = preferences.emailColorMode

	const isDark = useIsDark()
	const supportsDark = useMemo(() => sanitizedEmailSupportsDarkMode(html), [html])
	const automaticDarkColors = darken && isDark && colorMode === 'automatic'
	const emailTheme = automaticDarkColors ? 'dark' : 'light'
	const imageMode: EmailImageMode = colorMode
	const invert = automaticDarkColors && !supportsDark

	useLayoutEffect(() => {
		ensureEmailElementDefined()
		setReady(true)
	}, [])

	useLayoutEffect(() => {
		void html
		void messageId
		setLayoutControlAvailable(false)
	}, [html, messageId])

	useLayoutEffect(() => {
		if (!ready || !ref.current) return
		const element = ref.current
		const onLayoutStatus = (event: Event) => {
			const detail = (event as CustomEvent<EmailLayoutStatusDetail>).detail
			if (detail.reflowed || detail.needsFit) setLayoutControlAvailable(true)
		}
		const onRemoteImages = (event: Event) => {
			setRemoteImages((event as CustomEvent<EmailRemoteImagesDetail>).detail)
		}
		element.addEventListener(EMAIL_LAYOUT_STATUS_EVENT, onLayoutStatus)
		element.addEventListener(EMAIL_REMOTE_IMAGES_EVENT, onRemoteImages)
		return () => {
			element.removeEventListener(EMAIL_LAYOUT_STATUS_EVENT, onLayoutStatus)
			element.removeEventListener(EMAIL_REMOTE_IMAGES_EVENT, onRemoteImages)
		}
	}, [ready])

	useLayoutEffect(() => {
		if (ready) applyEmailLayoutMode(ref.current, layoutMode)
	}, [ready, layoutMode])

	useLayoutEffect(() => {
		if (ready) applyEmailTheme(ref.current, emailTheme)
	}, [ready, emailTheme])

	useLayoutEffect(() => {
		if (ready) applyEmailColorMode(ref.current, colorMode)
	}, [ready, colorMode])

	useLayoutEffect(() => {
		if (ready) applyEmailImageMode(ref.current, imageMode)
	}, [ready, imageMode])

	// `ready` re-runs these once the custom element has mounted and `ref.current` is
	// set (the linter can't see the ref dependency, so it is used explicitly here).
	useLayoutEffect(() => {
		if (ready) applyEmailHtml(ref.current, html)
	}, [ready, html])

	useLayoutEffect(() => {
		if (ready) applyDarkInvert(ref.current, invert)
	}, [ready, invert])

	useEffect(() => subscribeLinkPreview(ready ? ref.current : null, setPreview), [ready])

	useEffect(() => {
		// HTML replacement resets the custom element's load consent, so each new
		// sanitized document must reapply the current automatic policy.
		void html
		void messageId
		if (!ready) return
		if (preferences.remoteImagePolicy === 'always') {
			applyRemoteImages(ref.current, true)
			return
		}
		if (!senderAddress) return
		let active = true
		void senderImagesTrusted(senderAddress).then((trusted) => {
			if (active && trusted) applyRemoteImages(ref.current, true)
		})
		return () => {
			active = false
		}
	}, [preferences.remoteImagePolicy, ready, senderAddress, html, messageId])

	useEffect(() => {
		if (!displayOpen) return

		function closeOutside(event: PointerEvent | FocusEvent) {
			const target = event.target
			if (target instanceof Node && !displayRootRef.current?.contains(target)) setDisplayOpen(false)
		}

		function closeOnEscape(event: KeyboardEvent) {
			if (event.key !== 'Escape') return
			event.preventDefault()
			event.stopPropagation()
			setDisplayOpen(false)
			displayTriggerRef.current?.focus()
		}

		document.addEventListener('pointerdown', closeOutside)
		document.addEventListener('focusin', closeOutside)
		document.addEventListener('keydown', closeOnEscape)
		return () => {
			document.removeEventListener('pointerdown', closeOutside)
			document.removeEventListener('focusin', closeOutside)
			document.removeEventListener('keydown', closeOnEscape)
		}
	}, [displayOpen])

	const showLayoutControl = layoutControlAvailable || layoutMode === 'original'
	const hasRemoteImages = remoteImages?.hasRemoteImages === true
	const imagesBlocked = hasRemoteImages && remoteImages.loaded === false
	const failedImages = remoteImages?.failedImages ?? 0
	const pendingImages = remoteImages?.pendingImages ?? 0
	const showColorControl = darken && isDark
	const showDisplayControl = hasRemoteImages || showLayoutControl || showColorControl

	function showImagesOnce() {
		applyRemoteImages(ref.current, true)
		setDisplayOpen(false)
	}

	function alwaysShowImages() {
		savePreferences({ ...preferences, remoteImagePolicy: 'always' })
		applyRemoteImages(ref.current, true)
		setDisplayOpen(false)
	}

	async function alwaysShowSenderImages() {
		/* v8 ignore next -- The loading action is disabled; this guard prevents programmatic re-entry. @preserve */
		if (senderTrustStatus === 'loading') return
		setSenderTrustStatus('loading')
		const trusted = await trustSenderImages(senderAddress)
		if (!trusted) {
			setSenderTrustStatus('error')
			return
		}
		applyRemoteImages(ref.current, true)
		setSenderTrustStatus('idle')
		setDisplayOpen(false)
	}

	return (
		<div className="relative" aria-busy={ready ? undefined : true}>
			{showDisplayControl ? (
				<div ref={displayRootRef} className="relative z-20 mb-1 flex justify-end">
					<button
						ref={displayTriggerRef}
						type="button"
						onClick={() => {
							setSenderTrustStatus('idle')
							setDisplayOpen((current) => !current)
						}}
						aria-expanded={displayOpen}
						aria-controls={displayPanelId}
						className={displayTriggerClass}
					>
						{imagesBlocked || failedImages > 0 ? (
							<ImageOff className="h-4 w-4" />
						) : (
							<SlidersHorizontal className="h-4 w-4" />
						)}
						{imagesBlocked
							? 'Images blocked'
							: failedImages > 0
								? 'Image unavailable'
								: pendingImages > 0
									? 'Loading images'
									: 'Display'}
						<ChevronDown
							className={`h-3.5 w-3.5 transition-transform duration-[var(--dur-fast)] ease-[var(--ease-out)] ${displayOpen ? 'rotate-180' : ''}`}
						/>
					</button>

					{displayOpen ? (
						<section
							id={displayPanelId}
							role="dialog"
							aria-labelledby={displayHeadingId}
							className="fixed inset-x-3 bottom-20 z-30 max-h-[calc(100dvh-7rem)] overflow-y-auto overscroll-contain rounded-lg border border-border bg-popover p-4 text-popover-foreground shadow-sm sm:absolute sm:inset-x-auto sm:bottom-auto sm:right-0 sm:top-full sm:z-20 sm:mt-1 sm:w-[min(20rem,calc(100vw-3rem))] sm:max-h-[min(32rem,calc(100dvh-6rem))]"
						>
							<h3 id={displayHeadingId} className="font-display text-sm font-semibold text-foreground">
								Message display
							</h3>

							{imagesBlocked ? (
								<div className="mt-3 border-t border-border pt-3">
									<p className="text-sm leading-relaxed text-muted-foreground">
										External images stay off to limit tracking until you choose how to show them.
									</p>
									<div className="mt-3 grid gap-1.5">
										<button
											type="button"
											onClick={showImagesOnce}
											className={`${imageActionClass} bg-foreground text-background hover:opacity-90`}
										>
											Show once
										</button>
										{senderAddress ? (
											<button
												type="button"
												disabled={senderTrustStatus === 'loading'}
												aria-busy={senderTrustStatus === 'loading' || undefined}
												onClick={() => void alwaysShowSenderImages()}
												className={`${imageActionClass} border border-border bg-background text-foreground hover:bg-muted`}
											>
												{senderTrustStatus === 'loading' ? (
													<LoaderCircle className="h-4 w-4 animate-spin motion-reduce:animate-none" />
												) : null}
												{senderTrustStatus === 'loading' ? 'Saving…' : 'Always from sender'}
											</button>
										) : null}
										<button
											type="button"
											onClick={alwaysShowImages}
											className={`${imageActionClass} text-muted-foreground hover:bg-muted hover:text-foreground`}
										>
											Always show all
										</button>
									</div>
									{senderTrustStatus === 'error' ? (
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
										onClick={() => retryRemoteImages(ref.current)}
										className={`${imageActionClass} mt-2 border border-border bg-background text-foreground hover:bg-muted`}
									>
										Retry images
									</button>
								</div>
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
												onClick={() => savePreferences({ ...preferences, emailLayoutMode: mode })}
												className={displayOptionClass}
											>
												{layoutMode === mode ? <Check className="h-3.5 w-3.5" /> : null}
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
										Automatic adapts light messages and eligible images for dark mode. Original preserves the
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
												onClick={() => savePreferences({ ...preferences, emailColorMode: mode })}
												className={displayOptionClass}
											>
												{colorMode === mode ? <Check className="h-3.5 w-3.5" /> : null}
												{label}
											</button>
										))}
									</div>
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
			) : null}
			{ready ? (
				<OwnmailEmail
					ref={ref}
					title={`Email content ${messageId}`}
					data-message-id={messageId}
					className="block w-full"
				/>
			) : (
				<div
					data-slot="html-email-placeholder"
					role="status"
					aria-label="Loading email content"
					className="min-h-24 min-w-0 max-w-full rounded-xl border border-border bg-muted/40"
				/>
			)}

			{preview && preview.href !== null ? (
				// Anchored next to the pointer (not a fixed corner) so the reader sees the
				// real link target right where they are looking — an anti-phishing aid.
				<div
					className="pointer-events-none fixed z-50 max-w-[min(90vw,32rem)] truncate rounded-md bg-foreground px-2.5 py-1.5 text-xs font-medium text-background shadow-lg"
					style={previewBoxStyle(
						{ x: preview.x, y: preview.y },
						{ width: window.innerWidth, height: window.innerHeight },
					)}
				>
					{linkPreviewText(preview.href)}
				</div>
			) : null}
		</div>
	)
}

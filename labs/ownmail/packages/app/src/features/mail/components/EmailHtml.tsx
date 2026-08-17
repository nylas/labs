import { type Ref, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
	applyDarkInvert,
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
	type EmailLayoutMode,
	type EmailLayoutStatusDetail,
	type EmailRemoteImagesDetail,
	type LinkPreviewDetail,
	linkPreviewText,
	previewBoxStyle,
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
}) => null

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
	const [layoutMode, setLayoutMode] = useState<EmailLayoutMode>('readable')
	const [imageMode, setImageMode] = useState<EmailImageMode>('automatic')
	const [layoutStatus, setLayoutStatus] = useState<EmailLayoutStatusDetail | null>(null)
	const [remoteImages, setRemoteImages] = useState<EmailRemoteImagesDetail | null>(null)

	const isDark = useIsDark()
	const supportsDark = useMemo(() => sanitizedEmailSupportsDarkMode(html), [html])
	const invert = darken && isDark && !supportsDark

	useLayoutEffect(() => {
		ensureEmailElementDefined()
		setReady(true)
	}, [])

	useLayoutEffect(() => {
		if (!ready || !ref.current) return
		const element = ref.current
		const onLayoutStatus = (event: Event) => {
			setLayoutStatus((event as CustomEvent<EmailLayoutStatusDetail>).detail)
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
		if (ready) applyEmailTheme(ref.current, isDark ? 'dark' : 'light')
	}, [ready, isDark])

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
		if (!ready || !senderAddress) return
		let active = true
		void senderImagesTrusted(senderAddress).then((trusted) => {
			if (active && trusted) applyRemoteImages(ref.current, true)
		})
		return () => {
			active = false
		}
	}, [ready, senderAddress])

	const showLayoutControl =
		layoutMode === 'original' || layoutStatus?.reflowed === true || layoutStatus?.needsFit === true

	return (
		<div className="relative" aria-busy={ready ? undefined : true}>
			{remoteImages?.hasRemoteImages && !remoteImages.loaded ? (
				<div className="mb-2 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
					<span>Remote images are blocked to protect your privacy.</span>
					<div className="ml-auto flex flex-wrap justify-end gap-1">
						<button
							type="button"
							className="min-h-11 shrink-0 rounded-md px-3 font-medium text-foreground underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
							onClick={() => applyRemoteImages(ref.current, true)}
						>
							Load images
						</button>
						{senderAddress ? (
							<button
								type="button"
								className="min-h-11 shrink-0 rounded-md px-3 font-medium text-foreground underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
								onClick={() => {
									void trustSenderImages(senderAddress).then((trusted) => {
										if (trusted) applyRemoteImages(ref.current, true)
									})
								}}
							>
								Always load from sender
							</button>
						) : null}
					</div>
				</div>
			) : null}
			{remoteImages?.hasRemoteImages && remoteImages.loaded ? (
				<div className="mb-2 flex justify-end">
					<fieldset className="inline-flex rounded-lg border border-border bg-muted/50 p-0.5 text-xs">
						<legend className="sr-only">Image colors</legend>
						{(
							[
								['automatic', 'Automatic'],
								['original', 'Original colors'],
							] as const
						).map(([mode, label]) => (
							<button
								key={mode}
								type="button"
								aria-pressed={imageMode === mode}
								onClick={() => setImageMode(mode)}
								className="min-h-11 rounded-md px-3 font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-pressed:bg-background aria-pressed:text-foreground aria-pressed:shadow-sm"
							>
								{label}
							</button>
						))}
					</fieldset>
				</div>
			) : null}
			{showLayoutControl ? (
				<div className="mb-2 flex justify-end">
					<fieldset className="inline-flex rounded-lg border border-border bg-muted/50 p-0.5 text-xs">
						<legend className="sr-only">Email layout</legend>
						{(['readable', 'original'] as const).map((mode) => (
							<button
								key={mode}
								type="button"
								aria-pressed={layoutMode === mode}
								onClick={() => setLayoutMode(mode)}
								className="min-h-11 rounded-md px-3 font-medium capitalize text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-pressed:bg-background aria-pressed:text-foreground aria-pressed:shadow-sm"
							>
								{mode}
							</button>
						))}
					</fieldset>
				</div>
			) : null}
			{ready ? (
				<OwnmailEmail ref={ref} title={`Email content ${messageId}`} className="block w-full" />
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

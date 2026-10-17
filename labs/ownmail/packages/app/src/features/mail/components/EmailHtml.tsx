/* Hallmark · component: email display popover · genre: modern-minimal · theme: Quiet
 * states: default · hover · focus · active · disabled · loading · error · success
 * contrast: existing application tokens · pre-emit critique: P5 H5 E4 S5 R5 V5
 */

import { type CSSProperties, type Ref, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { accountScope } from '#app/lib/account-scope'
import { useUserPreferences } from '#app/preferences/user-preferences'
import { cn } from '#shared/lib/utils'
import { senderDomain } from '../lib/edge-states.js'
import {
	applyEmailColorMode,
	applyEmailHtml,
	applyEmailImageMode,
	applyEmailKnownPaper,
	applyEmailLayoutMode,
	applyEmailTheme,
	applyRemoteImages,
	EMAIL_CANVAS_EVENT,
	EMAIL_ELEMENT_TAG,
	EMAIL_LAYOUT_STATUS_EVENT,
	EMAIL_REMOTE_IMAGES_EVENT,
	type EmailCanvasDetail,
	type EmailColorMode,
	type EmailElementLike,
	type EmailImageMode,
	type EmailLayoutMode,
	type EmailLayoutStatusDetail,
	type EmailRemoteImagesDetail,
	type LinkPreviewDetail,
	linkPreviewText,
	previewBoxStyle,
	retryRemoteImages,
	subscribeLinkPreview,
} from '../lib/email-render.js'
import { rememberEmail, rememberedEmail, renderedEmailKey } from '../lib/email-render-memory.js'
import { blockedImageCount, installEdgeState } from '../lib/held-images.js'
import { senderImagesTrusted, trustSenderImages } from '../lib/image-sender-trust.js'
import { inertLinksHtml } from '../lib/inert-links.js'
import { openMessageWindow } from '../lib/open-message-window.js'
import { ensureEmailElementDefined } from './email-content-element.js'
import { FitToWidthBar } from './FitToWidthBar.js'
import { ImagesHiddenBar } from './ImagesHiddenBar.js'
import { useThreadColumnInset } from './ThreadColumn.js'

// The custom element is a host tag, not a React component; the cast just gives it
// a typed ref + style props. At runtime React renders the string as a DOM element.
const OwnmailEmail = EMAIL_ELEMENT_TAG as unknown as (props: {
	ref?: Ref<HTMLElement>
	title?: string
	className?: string
	style?: CSSProperties
	'data-message-id'?: string
	'data-email-prose'?: string
}) => null

type Fit = { scale: number; naturalWidth: number }

export type EmailDisplayStatus = {
	layoutAvailable: boolean
	remoteImages: EmailRemoteImagesDetail | null
}

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
 * When enabled, a dark app theme lets the element adapt light-only email color by
 * color (never with a filter). The element reports the presentation it chose and
 * the sender canvas through `onCanvas`, so the thread can extend that canvas, and
 * this wrapper reserves the last measured height so a reopened message never jumps.
 */
export function EmailHtml({
	html,
	messageId,
	darken = true,
	senderAddress,
	layoutMode = 'readable',
	colorMode = 'automatic',
	loadRemoteImagesForThread = false,
	loadRemoteImagesForSender = false,
	retryRevision = 0,
	onDisplayStatus,
	onCanvas,
	senderName,
	linksDisabled = false,
	fontSize = 16,
	windowTitle = 'Email',
	windowHtml,
	chromeInset = false,
	prose = false,
}: {
	html: string
	messageId: string
	darken?: boolean
	senderAddress?: string
	layoutMode?: EmailLayoutMode
	colorMode?: EmailColorMode
	loadRemoteImagesForThread?: boolean
	loadRemoteImagesForSender?: boolean
	retryRevision?: number
	onDisplayStatus?: (messageId: string, status: EmailDisplayStatus | null) => void
	onCanvas?: (detail: EmailCanvasDetail) => void
	/** The sender's display name, for "Always for Voyage". */
	senderName?: string
	/** Links in the message do nothing (the sender failed checks or is a lookalike). */
	linksDisabled?: boolean
	/** The inherited body size: 16px in the reader, 17px on a phone. */
	fontSize?: 16 | 17
	/** The title of the window "Open in window" opens. */
	windowTitle?: string
	/** The whole message for "Open in window", history and signature included; defaults to `html`. */
	windowHtml?: string
	/** Designed mail runs edge to edge on a phone; its bars keep the prose gutter. */
	chromeInset?: boolean
	/** Ordinary written mail: its paragraphs take the reader's rhythm (12px apart, none above the first). */
	prose?: boolean
}) {
	const ref = useRef<(HTMLElement & EmailElementLike) | null>(null)
	const [ready, setReady] = useState(false)
	const [preview, setPreview] = useState<LinkPreviewDetail | null>(null)
	const [layoutControlAvailable, setLayoutControlAvailable] = useState(false)
	const [remoteImages, setRemoteImages] = useState<EmailRemoteImagesDetail | null>(null)
	const [hiddenImages, setHiddenImages] = useState(0)
	const [imagesShown, setImagesShown] = useState(false)
	const [trust, setTrust] = useState<'idle' | 'pending' | 'error'>('idle')
	const [fit, setFit] = useState<Fit | null>(null)
	const [actualSize, setActualSize] = useState(false)
	const actualSizeRef = useRef(actualSize)
	actualSizeRef.current = actualSize
	const [preferences] = useUserPreferences()
	const lastRetryRevisionRef = useRef(retryRevision)
	const displayStatusCallbackRef = useRef(onDisplayStatus)
	displayStatusCallbackRef.current = onDisplayStatus
	const canvasCallbackRef = useRef(onCanvas)
	canvasCallbackRef.current = onCanvas

	const furnitureInset = useThreadColumnInset()
	const isDark = useIsDark()
	const automaticDarkColors = darken && isDark && colorMode === 'automatic'
	const emailTheme = automaticDarkColors ? 'dark' : 'light'
	const imageMode: EmailImageMode = colorMode
	const memoryKey = renderedEmailKey(messageId, emailTheme, colorMode)
	const remembered = rememberedEmail(memoryKey)
	const [measured, setMeasured] = useState(false)

	useLayoutEffect(() => {
		ensureEmailElementDefined()
		setReady(true)
	}, [])

	useLayoutEffect(() => {
		void html
		void messageId
		setLayoutControlAvailable(false)
		setRemoteImages(null)
		setMeasured(false)
		setHiddenImages(0)
		setImagesShown(false)
		setTrust('idle')
		setFit(null)
		setActualSize(false)
	}, [html, messageId])

	useLayoutEffect(() => {
		if (!ready || !ref.current) return
		const element = ref.current
		const onLayoutStatus = (event: Event) => {
			const detail = (event as CustomEvent<EmailLayoutStatusDetail>).detail
			if (detail.reflowed || detail.needsFit) setLayoutControlAvailable(true)
			// The bar says "Fitted to width" only when the scaled layout really fits;
			// past the legibility floor the message still pans, and saying it was
			// fitted would be false. At actual size the element is as wide as the
			// layout and reports no scale; the fitted measurement stays so the bar
			// can return to it.
			const fitted = detail.scale < 1 && detail.naturalWidth * detail.scale <= detail.containerWidth + 1
			setFit((current) =>
				fitted
					? { scale: detail.scale, naturalWidth: detail.naturalWidth }
					: actualSizeRef.current
						? current
						: null,
			)
		}
		const onRemoteImages = (event: Event) => {
			setRemoteImages((event as CustomEvent<EmailRemoteImagesDetail>).detail)
			setHiddenImages(blockedImageCount(element.shadowRoot))
		}
		const onCanvasStatus = (event: Event) => {
			const detail = (event as CustomEvent<EmailCanvasDetail>).detail
			if (detail.height > 0) rememberEmail(memoryKey, detail)
			// The element measures inside an animation frame; commit the thread's
			// canvas band in that same frame so it never paints a step behind.
			flushSync(() => {
				setMeasured(true)
				canvasCallbackRef.current?.(detail)
			})
		}
		element.addEventListener(EMAIL_LAYOUT_STATUS_EVENT, onLayoutStatus)
		element.addEventListener(EMAIL_REMOTE_IMAGES_EVENT, onRemoteImages)
		element.addEventListener(EMAIL_CANVAS_EVENT, onCanvasStatus)
		return () => {
			element.removeEventListener(EMAIL_LAYOUT_STATUS_EVENT, onLayoutStatus)
			element.removeEventListener(EMAIL_REMOTE_IMAGES_EVENT, onRemoteImages)
			element.removeEventListener(EMAIL_CANVAS_EVENT, onCanvasStatus)
		}
	}, [ready, memoryKey])

	// A reopened message extends its last known canvas before the renderer measures.
	useLayoutEffect(() => {
		const known = rememberedEmail(memoryKey)
		if (known) canvasCallbackRef.current?.(known)
	}, [memoryKey])

	// Before the theme, colors and HTML below, so the element's first strategy already knows.
	useLayoutEffect(() => {
		if (ready) applyEmailKnownPaper(ref.current, rememberedEmail(memoryKey)?.strategy === 'paper')
	}, [ready, memoryKey])

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

	// Inert links lose their destinations before the element ever sees them, so
	// no context menu, long press or drag can carry a live URL out.
	const renderedHtml = useMemo(() => (linksDisabled ? inertLinksHtml(html) : html), [html, linksDisabled])

	// `ready` re-runs these once the custom element has mounted and `ref.current` is
	// set (the linter can't see the ref dependency, so it is used explicitly here).
	useLayoutEffect(() => {
		if (ready) applyEmailHtml(ref.current, renderedHtml)
	}, [ready, renderedHtml])

	// After the HTML, so the shadow root exists. The element replaces only its
	// content root, so the sheet survives every re-render of the message, and
	// the held-image placeholders follow each new document.
	useLayoutEffect(() => {
		void renderedHtml
		const shadow = ready ? ref.current?.shadowRoot : null
		if (!shadow) return
		return installEdgeState(shadow, linksDisabled)
	}, [ready, renderedHtml, linksDisabled])

	// Belt and braces: anything still link-like swallows every activation.
	useEffect(() => {
		const element = ready ? ref.current : null
		if (!element || !linksDisabled) return
		const stop = (event: Event) => {
			const link = event
				.composedPath()
				.find((target) => target instanceof Element && (target.tagName === 'A' || target.tagName === 'AREA'))
			if (!link) return
			event.preventDefault()
			event.stopPropagation()
		}
		element.addEventListener('click', stop, true)
		element.addEventListener('auxclick', stop, true)
		return () => {
			element.removeEventListener('click', stop, true)
			element.removeEventListener('auxclick', stop, true)
		}
	}, [ready, linksDisabled])

	useEffect(() => subscribeLinkPreview(ready ? ref.current : null, setPreview), [ready])

	useEffect(() => {
		// HTML replacement resets the custom element's load consent, so each new
		// sanitized document must reapply the current automatic policy.
		void html
		void messageId
		if (!ready) return
		if (
			preferences.remoteImagePolicy === 'always' ||
			loadRemoteImagesForThread ||
			loadRemoteImagesForSender ||
			imagesShown
		) {
			applyRemoteImages(ref.current, true)
			return
		}
		if (!senderAddress) return
		let active = true
		void senderImagesTrusted(senderAddress, accountScope()).then((trusted) => {
			if (active && trusted) applyRemoteImages(ref.current, true)
		})
		return () => {
			active = false
		}
	}, [
		preferences.remoteImagePolicy,
		ready,
		senderAddress,
		html,
		messageId,
		loadRemoteImagesForThread,
		loadRemoteImagesForSender,
		imagesShown,
	])

	useLayoutEffect(() => {
		onDisplayStatus?.(messageId, { layoutAvailable: layoutControlAvailable, remoteImages })
	}, [layoutControlAvailable, messageId, onDisplayStatus, remoteImages])

	useLayoutEffect(() => () => displayStatusCallbackRef.current?.(messageId, null), [messageId])

	useLayoutEffect(() => {
		if (!ready || retryRevision <= lastRetryRevisionRef.current) return
		lastRetryRevisionRef.current = retryRevision
		if ((remoteImages?.failedImages ?? 0) > 0) retryRemoteImages(ref.current)
	}, [ready, remoteImages, retryRevision])

	const domain = senderDomain(senderAddress)
	const imagesHeld =
		remoteImages?.hasRemoteImages === true &&
		!remoteImages.loaded &&
		!imagesShown &&
		preferences.remoteImagePolicy !== 'always'
	const showAtActualSize = actualSize && fit !== null
	const elementStyle: CSSProperties = {
		...(fontSize === 17 ? { fontSize: '17px', lineHeight: 1.55 } : {}),
		...(showAtActualSize ? { width: `${fit.naturalWidth}px`, maxWidth: 'none' } : {}),
	}
	// Never offer to trust for good a sender whose identity failed its checks.
	const onAlways =
		senderAddress && !linksDisabled
			? () => {
					// The images come in now; remembering the sender for next time can fail on its own.
					setImagesShown(true)
					setTrust('pending')
					void trustSenderImages(senderAddress, accountScope()).then((trusted) =>
						setTrust(trusted ? 'idle' : 'error'),
					)
				}
			: undefined

	return (
		<>
			<div
				className={showAtActualSize ? 'relative overflow-x-auto' : 'relative'}
				aria-busy={ready ? undefined : true}
				style={!measured && remembered ? { minHeight: remembered.height } : undefined}
			>
				{ready ? (
					<OwnmailEmail
						ref={ref}
						title={`Email content ${messageId}`}
						data-message-id={messageId}
						{...(prose ? { 'data-email-prose': '' } : {})}
						className="block w-full"
						style={elementStyle}
					/>
				) : (
					<div
						data-slot="html-email-placeholder"
						role="status"
						aria-label="Loading email content"
						className={remembered ? 'min-w-0 max-w-full' : 'min-h-24 min-w-0 max-w-full'}
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

			{fit || imagesHeld || trust === 'error' ? (
				<div
					data-slot="email-edge-bars"
					// Under a designed email the bars line up with the message's other furniture, past the avatar.
					className={chromeInset ? cn('px-4 sm:px-0', furnitureInset && 'md:pl-11') : undefined}
				>
					{fit ? (
						<FitToWidthBar
							scale={fit.scale}
							actualSize={showAtActualSize}
							onToggleActualSize={() => setActualSize((current) => !current)}
							onOpenWindow={() =>
								openMessageWindow(windowHtml ?? html, {
									title: windowTitle,
									allowRemoteImages: remoteImages?.loaded === true,
									linksDisabled,
								})
							}
						/>
					) : null}
					{imagesHeld ? (
						<ImagesHiddenBar
							count={hiddenImages}
							domain={domain}
							{...(senderName ? { senderName } : {})}
							onShow={() => setImagesShown(true)}
							{...(onAlways ? { onAlways } : {})}
						/>
					) : null}
					{trust === 'error' ? (
						<p role="alert" className="mt-3 text-xs text-danger-soft-foreground">
							Couldn’t remember this sender. Images are shown for this message only.
						</p>
					) : null}
				</div>
			) : null}
		</>
	)
}

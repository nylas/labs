/* Hallmark · component: email display popover · genre: modern-minimal · theme: Quiet
 * states: default · hover · focus · active · disabled · loading · error · success
 * contrast: existing application tokens · pre-emit critique: P5 H5 E4 S5 R5 V5
 */

import { type CSSProperties, type Ref, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { accountScope } from '#app/lib/account-scope'
import { useUserPreferences } from '#app/preferences/user-preferences'
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
import { senderImagesTrusted, trustSenderImages } from '../lib/image-sender-trust.js'
import { openMessageWindow } from '../lib/open-message-window.js'
import { ensureEmailElementDefined } from './email-content-element.js'
import { FitToWidthBar } from './FitToWidthBar.js'
import { ImagesHiddenBar } from './ImagesHiddenBar.js'

// The custom element is a host tag, not a React component; the cast just gives it
// a typed ref + style props. At runtime React renders the string as a DOM element.
const OwnmailEmail = EMAIL_ELEMENT_TAG as unknown as (props: {
	ref?: Ref<HTMLElement>
	title?: string
	className?: string
	style?: CSSProperties
	'data-message-id'?: string
}) => null

/** Marks the reader's own edge-state rules inside the message's shadow root. */
export const EDGE_STYLE_ATTRIBUTE = 'data-ownmail-edge-style'

const BLOCKED_IMAGE = '.email-root img:not([src]):not([srcset])'

/**
 * Edge-state rules layered after the element's own: a blocked image with alt
 * text or a declared size keeps that space as a striped placeholder showing
 * its alt text (the readable layout otherwise drops it), and disabled links
 * stop looking clickable. Colours come from the app tokens, which inherit
 * into the shadow tree.
 */
export function edgeShadowStyle(linksDisabled: boolean): string {
	const selectors = [
		`:host ${BLOCKED_IMAGE}[alt]:not([alt=""])`,
		`:host ${BLOCKED_IMAGE}[width][height]:not([width="0"]):not([width="1"]):not([height="0"]):not([height="1"])`,
	]
	const held = (suffix = '') => selectors.map((selector) => `${selector}${suffix}`).join(',')
	return [
		// The browser's own alt rendering (a broken-image glyph and corner text) is
		// hidden; the stripes cover it and the alt text is centred over them.
		`${held()}{display:inline-block!important;position:relative!important;box-sizing:border-box!important;max-width:100%;vertical-align:top;border-radius:4px;overflow:hidden;font-size:0!important;color:transparent!important;background:repeating-linear-gradient(135deg,var(--muted,#f1f2f1) 0 6px,color-mix(in oklch,var(--muted,#f1f2f1),var(--foreground,#1a1a1a) 4%) 6px 12px)!important;}`,
		`${held('::before')}{content:'';position:absolute;inset:0;background:inherit;}`,
		`${held('::after')}{content:attr(alt);position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:4px;text-align:center;font:11px/1.4 var(--font-sans,sans-serif);color:var(--muted-foreground,#6b7680);}`,
		`:host ${BLOCKED_IMAGE}[alt]:not([alt=""]):not([height]){min-height:54px;min-width:120px;}`,
		linksDisabled ? ':host .email-root a[href]{cursor:default!important;}' : '',
	].join('\n')
}

/** Blocked images a reader would have seen: everything but tracking pixels. */
export function blockedImageCount(root: ParentNode | null | undefined): number {
	if (!root) return 0
	return [...root.querySelectorAll(BLOCKED_IMAGE)].filter((image) => {
		const width = image.getAttribute('width')
		const height = image.getAttribute('height')
		return !(width !== null && height !== null && Number(width) <= 2 && Number(height) <= 2)
	}).length
}

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
	chromeInset = false,
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
	/** Designed mail runs edge to edge on a phone; its bars keep the prose gutter. */
	chromeInset?: boolean
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
			// At actual size the element is as wide as the layout and reports no
			// scale; the fitted measurement stays so the bar can return to it.
			setFit((current) =>
				detail.scale < 1
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

	// `ready` re-runs these once the custom element has mounted and `ref.current` is
	// set (the linter can't see the ref dependency, so it is used explicitly here).
	useLayoutEffect(() => {
		if (ready) applyEmailHtml(ref.current, html)
	}, [ready, html])

	// After the HTML, so the shadow root exists. The element replaces only its
	// content root, so this sheet survives every re-render of the message; a
	// new document re-checks it all the same.
	useLayoutEffect(() => {
		void html
		const shadow = ready ? ref.current?.shadowRoot : null
		if (!shadow) return
		let sheet = shadow.querySelector<HTMLStyleElement>(`style[${EDGE_STYLE_ATTRIBUTE}]`)
		if (!sheet) {
			sheet = document.createElement('style')
			sheet.setAttribute(EDGE_STYLE_ATTRIBUTE, '')
			shadow.appendChild(sheet)
		}
		sheet.textContent = edgeShadowStyle(linksDisabled)
	}, [ready, html, linksDisabled])

	// Disabled links swallow every activation before the browser follows them.
	useEffect(() => {
		const element = ready ? ref.current : null
		if (!element || !linksDisabled) return
		const stop = (event: Event) => {
			const link = event
				.composedPath()
				.find((target) => target instanceof Element && target.tagName === 'A' && target.hasAttribute('href'))
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
	const onAlways = senderAddress
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
				<div data-slot="email-edge-bars" className={chromeInset ? 'px-4 sm:px-0' : undefined}>
					{fit ? (
						<FitToWidthBar
							scale={fit.scale}
							actualSize={showAtActualSize}
							onToggleActualSize={() => setActualSize((current) => !current)}
							onOpenWindow={() =>
								openMessageWindow(html, {
									title: windowTitle,
									allowRemoteImages: remoteImages?.loaded === true,
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

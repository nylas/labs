/* Hallmark · component: email display popover · genre: modern-minimal · theme: Quiet
 * states: default · hover · focus · active · disabled · loading · error · success
 * contrast: existing application tokens · pre-emit critique: P5 H5 E4 S5 R5 V5
 */

import { type Ref, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { accountScope } from '#app/lib/account-scope'
import { useUserPreferences } from '#app/preferences/user-preferences'
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
import { senderImagesTrusted } from '../lib/image-sender-trust.js'
import { ensureEmailElementDefined } from './email-content-element.js'

// The custom element is a host tag, not a React component; the cast just gives it
// a typed ref + style props. At runtime React renders the string as a DOM element.
const OwnmailEmail = EMAIL_ELEMENT_TAG as unknown as (props: {
	ref?: Ref<HTMLElement>
	title?: string
	className?: string
	'data-message-id'?: string
}) => null

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
}) {
	const ref = useRef<(HTMLElement & EmailElementLike) | null>(null)
	const [ready, setReady] = useState(false)
	const [preview, setPreview] = useState<LinkPreviewDetail | null>(null)
	const [layoutControlAvailable, setLayoutControlAvailable] = useState(false)
	const [remoteImages, setRemoteImages] = useState<EmailRemoteImagesDetail | null>(null)
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
			loadRemoteImagesForSender
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

	return (
		<div
			className="relative"
			aria-busy={ready ? undefined : true}
			style={!measured && remembered ? { minHeight: remembered.height } : undefined}
		>
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
	)
}

import { type Ref, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
	applyDarkInvert,
	applyEmailHtml,
	EMAIL_ELEMENT_TAG,
	type EmailElementLike,
	emailSupportsDarkMode,
	type LinkPreviewDetail,
	linkPreviewText,
	previewBoxStyle,
	subscribeLinkPreview,
} from '../lib/email-render.js'
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
}: {
	html: string
	messageId: string
	darken?: boolean
}) {
	const ref = useRef<(HTMLElement & EmailElementLike) | null>(null)
	const [ready, setReady] = useState(false)
	const [preview, setPreview] = useState<LinkPreviewDetail | null>(null)

	const isDark = useIsDark()
	const supportsDark = useMemo(() => emailSupportsDarkMode(html), [html])
	const invert = darken && isDark && !supportsDark

	useLayoutEffect(() => {
		ensureEmailElementDefined()
		setReady(true)
	}, [])

	// `ready` re-runs these once the custom element has mounted and `ref.current` is
	// set (the linter can't see the ref dependency, so it is used explicitly here).
	useLayoutEffect(() => {
		if (ready) applyEmailHtml(ref.current, html)
	}, [ready, html])

	useLayoutEffect(() => {
		if (ready) applyDarkInvert(ref.current, invert)
	}, [ready, invert])

	useEffect(() => subscribeLinkPreview(ready ? ref.current : null, setPreview), [ready])

	return (
		<div className="relative" aria-busy={ready ? undefined : true}>
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

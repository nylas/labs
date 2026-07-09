import { Moon, Sun } from 'lucide-react'
import { type Ref, useEffect, useMemo, useRef, useState } from 'react'
import { ensureEmailElementDefined } from './email-content-element.js'
import {
	applyDarkInvert,
	applyEmailHtml,
	EMAIL_ELEMENT_TAG,
	type EmailElementLike,
	emailSupportsDarkMode,
	linkPreviewText,
	subscribeLinkPreview,
} from './email-render.js'
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip.js'

// The custom element is a host tag, not a React component; the cast just gives it
// a typed ref + style props. At runtime React renders the string as a DOM element.
const OwnmailEmail = EMAIL_ELEMENT_TAG as unknown as (props: {
	ref?: Ref<HTMLElement>
	title?: string
	className?: string
}) => null

/** Tracks the app's dark theme (the `.dark` class the theme toggle sets on <html>). */
function useIsDark(): boolean {
	const [isDark, setIsDark] = useState(false)
	useEffect(() => {
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
 * live outside the shadow boundary: a hover/tap URL preview and the auto-dark toggle.
 *
 * Auto-dark defaults on: when the app is dark and the email has no dark styles of
 * its own, we invert it so it isn't a blinding white rectangle. The user can turn
 * that off per message to see the email's true colors.
 */
export function EmailHtml({ html, messageId }: { html: string; messageId: string }) {
	const ref = useRef<(HTMLElement & EmailElementLike) | null>(null)
	const [ready, setReady] = useState(false)
	const [preview, setPreview] = useState<string | null>(null)
	const [autoDark, setAutoDark] = useState(true)

	const isDark = useIsDark()
	const supportsDark = useMemo(() => emailSupportsDarkMode(html), [html])
	const invert = autoDark && isDark && !supportsDark
	const showToggle = isDark && !supportsDark

	useEffect(() => {
		ensureEmailElementDefined()
		setReady(true)
	}, [])

	// `ready` re-runs these once the custom element has mounted and `ref.current` is
	// set (the linter can't see the ref dependency, so it is used explicitly here).
	useEffect(() => {
		if (ready) applyEmailHtml(ref.current, html)
	}, [ready, html])

	useEffect(() => {
		if (ready) applyDarkInvert(ref.current, invert)
	}, [ready, invert])

	useEffect(() => subscribeLinkPreview(ready ? ref.current : null, setPreview), [ready])

	return (
		<div className="relative">
			{showToggle ? (
				// Float in the top-right corner so the toggle never pushes the email down
				// (a full-width row here left an awkward empty band under the sender header).
				<div className="absolute right-2 top-2 z-10">
					<Tooltip>
						<TooltipTrigger asChild>
							<button
								type="button"
								onClick={() => setAutoDark((value) => !value)}
								aria-pressed={autoDark}
								aria-label="Toggle automatic dark mode for this email"
								className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background/80 px-2 py-1 text-xs text-muted-foreground shadow-sm backdrop-blur transition-colors hover:bg-muted"
							>
								{autoDark ? <Moon className="h-3.5 w-3.5" /> : <Sun className="h-3.5 w-3.5" />}
								{autoDark ? 'Dark' : 'Original'}
							</button>
						</TooltipTrigger>
						<TooltipContent>
							{autoDark ? 'Showing an auto-darkened version' : 'Showing the email’s original colors'}
						</TooltipContent>
					</Tooltip>
				</div>
			) : null}

			{ready ? (
				<OwnmailEmail ref={ref} title={`Email content ${messageId}`} className="block w-full" />
			) : null}

			{preview !== null ? (
				<div className="pointer-events-none fixed bottom-3 left-3 z-50 max-w-[min(90vw,32rem)] truncate rounded-md bg-foreground px-2.5 py-1.5 text-xs font-medium text-background shadow-lg">
					{linkPreviewText(preview)}
				</div>
			) : null}
		</div>
	)
}

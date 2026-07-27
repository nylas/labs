/**
 * Pure logic + thin DOM adapters for the HTML-email renderer. Everything here is
 * free of module-load-time DOM references so it can be imported on the server
 * (TanStack Start SSR) and unit-tested directly. The stateful shadow-DOM plumbing
 * lives in the `ownmail-email` custom element; this module holds the decisions it
 * (and the React wrapper) delegate to.
 */

/** Tag name of the shadow-DOM email custom element. Single source of truth. */
export const EMAIL_ELEMENT_TAG = 'ownmail-email'

/** Event the element dispatches (composed, bubbling) as links are hovered/focused. */
export const LINK_PREVIEW_EVENT = 'link-preview'

/**
 * Detail payload of a {@link LINK_PREVIEW_EVENT}: the hovered link (or null to
 * clear) plus the viewport point to anchor the preview to — the pointer position
 * for mouse hovers, or the link's own position for keyboard focus. When clearing,
 * the point is unused and reported as the origin.
 */
export interface LinkPreviewDetail {
	href: string | null
	x: number
	y: number
}

/** A viewport-relative point the preview anchors to. */
export interface PreviewPoint {
	x: number
	y: number
}

/**
 * Inline style that places the URL preview beside the cursor rather than in a
 * fixed corner — an anti-phishing aid, so the real link target sits right where
 * the reader is already looking. The box is offset off the pointer, and flipped
 * toward the viewport interior once the pointer passes the halfway line, so it
 * stays on-screen without having to measure the rendered box.
 */
export function previewBoxStyle(
	point: PreviewPoint,
	viewport: { width: number; height: number },
): { left: number; top: number; transform: string } {
	const offset = 16
	const flipX = point.x > viewport.width / 2
	const flipY = point.y > viewport.height / 2
	return {
		left: flipX ? point.x - offset : point.x + offset,
		top: flipY ? point.y - offset : point.y + offset,
		transform: `translate(${flipX ? '-100%' : '0'}, ${flipY ? '-100%' : '0'})`,
	}
}

/** Minimal structural view of the element the React wrapper drives imperatively. */
export interface EmailElementLike extends EventTarget {
	emailHtml: string
}

const MAX_PREVIEW_LENGTH = 120

/**
 * Does the email ship an adaptive dark-mode stylesheet? If it does we leave its
 * colors alone rather than force a filter-based inversion on top of styles it
 * already adapts. A bare `color-scheme` declaration is not sufficient: providers
 * commonly include it in metadata that our sanitizer removes, and it does not
 * itself supply dark colors for the message content.
 */
export function emailSupportsDarkMode(html: string): boolean {
	return /@media[^{]*\(\s*prefers-color-scheme\s*:\s*dark\s*\)/i.test(html)
}

/**
 * Downscale factor so content of `contentWidth` fits inside `containerWidth`.
 * Never upscales (emails are rarely narrower than the pane, and blowing them up
 * looks broken). Non-positive measurements — jsdom, or a not-yet-laid-out pane —
 * mean "don't scale".
 */
export function computeScale(contentWidth: number, containerWidth: number): number {
	if (contentWidth <= 0 || containerWidth <= 0) return 1
	return Math.min(1, containerWidth / contentWidth)
}

/** Height the scaled content occupies, so the host box tracks the shrunk email. */
export function scaledHeight(naturalHeight: number, scale: number): number {
	return Math.ceil(naturalHeight * scale)
}

/** The full URL shown in the hover/tap preview, trimmed and length-capped. */
export function linkPreviewText(href: string): string {
	const trimmed = href.trim()
	if (trimmed.length <= MAX_PREVIEW_LENGTH) return trimmed
	return `${trimmed.slice(0, MAX_PREVIEW_LENGTH - 1)}…`
}

/**
 * Stylesheet injected into the email's shadow root. The shadow boundary already
 * scopes these rules away from the app; they set sane email defaults and the
 * opt-in dark inversion. Inversion flips the whole document, then re-flips media
 * so photos and logos keep their real colors (the classic "smart invert").
 */
export function shadowStyleText(): string {
	// Emails are authored for a white canvas, so we always render them on one — that
	// keeps minimally-styled mail (plain <p> text) readable in either theme. Dark mode
	// filters the custom-element host rather than `.email-root`, because provider
	// styles live in this shadow tree and commonly use broad selectors such as `div`.
	// The host is outside those selectors, so a hard-coded white newsletter cannot
	// cancel the transform. Layout/paint containment also bounds positioned provider
	// content to the message surface. Media is re-inverted so photos keep true colors.
	return `
:host{display:block;position:static!important;inset:auto!important;z-index:auto!important;contain:layout paint;isolation:isolate;overflow:hidden;}
.email-root{position:relative!important;inset:auto!important;z-index:auto!important;contain:none!important;isolation:isolate;overflow:visible!important;background:#ffffff;color:#1a1a1a;padding:20px;border-radius:12px;overflow-wrap:anywhere;word-break:break-word;}
.email-root img{max-width:100%;height:auto;}
.email-root table{max-width:100%;}
:host([data-dark-invert]){color-scheme:dark;filter:invert(1) hue-rotate(180deg)!important;}
:host([data-dark-invert]) .email-root img,
:host([data-dark-invert]) .email-root video,
:host([data-dark-invert]) .email-root [style*="background-image"]{filter:invert(1) hue-rotate(180deg)!important;}
`.trim()
}

/** Push `html` onto the element if it is mounted; a no-op before the ref attaches. */
export function applyEmailHtml(element: EmailElementLike | null, html: string): void {
	if (element) element.emailHtml = html
}

/** Reflect the dark-inversion decision as the attribute the shadow CSS keys off. */
export function applyDarkInvert(element: Element | null, invert: boolean): void {
	if (!element) return
	if (invert) element.setAttribute('data-dark-invert', '')
	else element.removeAttribute('data-dark-invert')
}

/**
 * Subscribe to the element's link-preview events and forward the href to `onChange`.
 * Returns an unsubscribe function; when `element` is null (pre-mount) it is a no-op,
 * so callers can wire this straight into an effect without a guard of their own.
 */
export function subscribeLinkPreview(
	element: EventTarget | null,
	onChange: (detail: LinkPreviewDetail) => void,
): () => void {
	if (!element) return () => {}
	const handler = (event: Event) => onChange((event as CustomEvent<LinkPreviewDetail>).detail)
	element.addEventListener(LINK_PREVIEW_EVENT, handler)
	return () => element.removeEventListener(LINK_PREVIEW_EVENT, handler)
}

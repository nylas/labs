/* Hallmark · component: email reader · genre: modern-minimal · theme: Quiet · pre-emit critique: P5 H5 E5 S5 R5 V5 · contrast: pass · mobile: pass */
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

/** Event emitted when the message's readable/original layout state changes. */
export const EMAIL_LAYOUT_STATUS_EVENT = 'email-layout-status'

/** Event emitted when remote image resources are blocked or explicitly loaded. */
export const EMAIL_REMOTE_IMAGES_EVENT = 'email-remote-images'

export type EmailLayoutMode = 'readable' | 'original'
export type EmailTheme = 'light' | 'dark'
export type EmailImageMode = 'automatic' | 'original'
export type EmailColorMode = 'automatic' | 'original'

/** Measurements the React wrapper can use to offer an Original/Readable control. */
export interface EmailLayoutStatusDetail {
	mode: EmailLayoutMode
	naturalWidth: number
	containerWidth: number
	scale: number
	reflowed: boolean
	needsFit: boolean
}

export interface EmailRemoteImagesDetail {
	failedImages?: number
	hasRemoteImages: boolean
	loaded: boolean
	pendingImages?: number
}

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
	retryFailedImages?: () => void
}

const MAX_PREVIEW_LENGTH = 120

/**
 * Does the email ship an adaptive dark-mode stylesheet? If it does we leave its
 * colors alone rather than force a filter-based inversion on top of styles it
 * already adapts. A bare `color-scheme` declaration is not sufficient: providers
 * commonly include it in metadata that our sanitizer removes, and it does not
 * itself supply dark colors for the message content.
 */
/** @deprecated Rendering decisions use sanitizedEmailSupportsDarkMode instead. */
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

/**
 * Measure the horizontal extent of content a reader can actually see.
 *
 * `scrollWidth` alone is unsafe for email: invisible preheaders, tracking pixels,
 * and absolutely-positioned nodes at `left:9999px` can make an otherwise narrow
 * message microscopic. This adapter counts visible normal-flow element and text
 * rectangles, while allowing genuinely visible positioned decoration that still
 * intersects the message canvas. A zero result means layout geometry is not
 * available (notably in jsdom), and callers may use a conservative fallback.
 */
export function meaningfulContentWidth(root: HTMLElement): number {
	const rootRect = root.getBoundingClientRect()
	const rootWidth = rootRect.width || root.clientWidth
	let minInline = 0
	let maxInline = rootWidth
	let hasGeometry = rootWidth > 0

	const rootStyle = getComputedStyle(root)
	const inlineStartPadding = Number.parseFloat(rootStyle.paddingInlineStart) || 0
	const inlineEndPadding = Number.parseFloat(rootStyle.paddingInlineEnd) || 0
	const geometryCache = new WeakMap<Element, { hidden: boolean; positioned: boolean }>()
	const geometryState = (element: Element): { hidden: boolean; positioned: boolean } => {
		const cached = geometryCache.get(element)
		if (cached) return cached
		const parentState =
			element.parentElement && element.parentElement !== root
				? geometryState(element.parentElement)
				: { hidden: false, positioned: false }
		const style = getComputedStyle(element)
		const inlineStyle = element instanceof HTMLElement ? element.style : undefined
		const clipsOverflow =
			style.overflow === 'hidden' ||
			style.overflow === 'clip' ||
			style.overflowY === 'hidden' ||
			style.overflowY === 'clip'
		const rect = element.getBoundingClientRect()
		const clipsAllContent =
			clipsOverflow && (rect.height <= 0 || style.height === '0px' || style.maxHeight === '0px')
		const state = {
			hidden:
				parentState.hidden ||
				element.hasAttribute('hidden') ||
				style.display === 'none' ||
				style.visibility === 'hidden' ||
				style.visibility === 'collapse' ||
				Number.parseFloat(style.opacity) === 0 ||
				Number.parseFloat(inlineStyle?.opacity ?? '') === 0 ||
				clipsAllContent,
			positioned: parentState.positioned || style.position === 'absolute' || style.position === 'fixed',
		}
		geometryCache.set(element, state)
		return state
	}

	const includeRect = (rect: DOMRect | DOMRectReadOnly, positioned: boolean): void => {
		if (rect.width <= 0 || rect.height <= 0) return
		if (positioned && rootWidth > 0 && (rect.right <= rootRect.left || rect.left >= rootRect.right)) {
			return
		}

		hasGeometry = true
		minInline = Math.min(minInline, rect.left - rootRect.left - inlineStartPadding)
		maxInline = Math.max(maxInline, rect.right - rootRect.left + inlineEndPadding)
	}

	for (const element of root.querySelectorAll<HTMLElement>('*')) {
		const { hidden, positioned } = geometryState(element)
		if (hidden) continue
		for (const rect of element.getClientRects()) includeRect(rect, positioned)
	}

	// Element boxes do not always include overflowing no-wrap text. Ranges do, so
	// include text fragments without falling back to an ancestor's contaminated
	// scrollWidth.
	const view = root.ownerDocument.defaultView
	const showText = view?.NodeFilter.SHOW_TEXT ?? 4
	const walker = root.ownerDocument.createTreeWalker(root, showText)
	let textNode = walker.nextNode()
	while (textNode) {
		if (textNode.textContent?.trim()) {
			const parent = textNode.parentElement
			/* v8 ignore else -- a TreeWalker rooted at an element only yields attached descendants -- @preserve */
			if (parent) {
				const { hidden, positioned } = geometryState(parent)
				if (!hidden) {
					const range = root.ownerDocument.createRange()
					range.selectNodeContents(textNode)
					if (typeof range.getClientRects === 'function') {
						for (const rect of range.getClientRects()) includeRect(rect, positioned)
					}
					range.detach()
				}
			}
		}
		textNode = walker.nextNode()
	}

	return hasGeometry ? Math.ceil(maxInline - minInline) : 0
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
 * scopes these rules away from the app; zero-specificity resets provide stable
 * defaults without beating sender CSS, while the host rules enforce containment
 * and opt-in dark inversion. Inversion flips the whole document, then re-flips
 * media so photos and logos keep their real colors (the classic "smart invert").
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
:host{--ownmail-email-theme:light;--ownmail-email-link-color:#075985;display:block;position:static!important;inset:auto!important;z-index:auto!important;contain:layout paint;container:ownmail-email / inline-size;isolation:isolate;overflow:hidden;max-width:100%;color:#1a1a1a;color-scheme:light;}
:host([data-email-theme="dark"]){--ownmail-email-theme:dark;--ownmail-email-link-color:#7dd3fc;color:#e5e7eb;color-scheme:dark;}
.email-root{box-sizing:border-box!important;position:relative!important;inset:auto!important;z-index:auto!important;contain:none!important;isolation:isolate;overflow:visible!important;width:var(--ownmail-email-natural-width,100%)!important;max-width:none!important;transform:scale(var(--ownmail-email-scale,1))!important;transform-origin:top left!important;background:transparent!important;color:inherit;padding:20px;overflow-wrap:anywhere;word-break:break-word;}
.email-root[data-ownmail-direction="rtl"]{transform-origin:top right!important;}
:where(.email-root) :where(*, *::before, *::after){box-sizing:border-box;}
:where(.email-root) :where(html, body){display:block;min-width:0;}
:where(.email-root) :where(body){margin:0;}
:where(.email-root) :where(body:not([bgcolor])){background-color:transparent;}
:where(.email-root) :where(pre){max-width:100%;white-space:pre-wrap;overflow-wrap:anywhere;}
:where(.email-root) :where(a[href]){color:var(--ownmail-email-link-color);text-decoration:underline!important;text-decoration-thickness:max(1px,.08em)!important;text-underline-offset:.15em!important;}
:where(.email-root) [data-ownmail-inherited-color="dark"]{color:#1a1a1a!important;}
:where(.email-root) [data-ownmail-inherited-color="light"]{color:#f5f5f5!important;}
:where(.email-root) :where(a[href]):focus-visible{outline:2px solid CanvasText!important;outline-offset:2px!important;border-radius:2px!important;box-shadow:0 0 0 4px Canvas!important;}
:host(:not([data-layout-mode="original"])) .email-root :where(html, body, table, img, video, svg, canvas){max-width:100%!important;}
:host(:not([data-layout-mode="original"])) .email-root :where(table){min-width:0!important;table-layout:auto;}
:host(:not([data-layout-mode="original"])) .email-root :where(td, th){min-width:0!important;overflow-wrap:anywhere!important;word-break:break-word!important;}
:host(:not([data-layout-mode="original"])) .email-root :where([nowrap], [style*="white-space" i][style*="nowrap" i]){white-space:normal!important;}
:host(:not([data-layout-mode="original"])) .email-root :where(img, video, svg, canvas){height:auto;}
:host(:not([data-layout-mode="original"])) .email-root :where(img:not([src]):not([srcset])){display:none!important;}
:host([data-dark-invert]){--ownmail-email-link-color:#075985;color-scheme:dark;filter:invert(1) hue-rotate(180deg)!important;}
:host([data-dark-invert]) .email-root{background:#fff!important;color:#1a1a1a!important;}
:host([data-color-mode="original"][data-email-theme="light"]) .email-root{background:#fff!important;color:#1a1a1a!important;}
:host([data-dark-invert]) .email-root :where(img:is([src], [srcset]), video, svg, canvas){filter:invert(1) hue-rotate(180deg)!important;}
:where(.email-root) [data-ownmail-background-media]{position:relative!important;isolation:isolate;}
:host([data-dark-invert]) :where(.email-root) [data-ownmail-background-media]{background-image:none!important;}
:host([data-dark-invert]) :where(.email-root) [data-ownmail-background-media]::before{content:""!important;position:absolute!important;inset:0!important;z-index:-1!important;pointer-events:none!important;background-image:var(--ownmail-background-image)!important;background-position:var(--ownmail-background-position)!important;background-size:var(--ownmail-background-size)!important;background-repeat:var(--ownmail-background-repeat)!important;background-origin:var(--ownmail-background-origin)!important;background-clip:var(--ownmail-background-clip)!important;filter:invert(1) hue-rotate(180deg)!important;}
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

/** Reflect the app theme used by rewritten provider color-scheme queries. */
export function applyEmailTheme(element: Element | null, theme: EmailTheme): void {
	if (!element) return
	element.setAttribute('data-email-theme', theme)
}

/** Opt a single rendered message into loading its previously blocked remote images. */
export function applyRemoteImages(element: Element | null, load: boolean): void {
	if (!element) return
	if (load) element.setAttribute('data-load-remote-images', '')
	else element.removeAttribute('data-load-remote-images')
}

/** Retry failed images through their existing signed, same-origin proxy URLs. */
export function retryRemoteImages(element: EmailElementLike | null): void {
	element?.retryFailedImages?.()
}

/** Select safe automatic variants or untouched colors without bypassing the proxy. */
export function applyEmailImageMode(element: Element | null, mode: EmailImageMode): void {
	if (element) element.setAttribute('data-image-mode', mode)
}

/** Preserve sender colors or allow OwnMail's safe automatic dark treatment. */
export function applyEmailColorMode(element: Element | null, mode: EmailColorMode): void {
	if (element) element.setAttribute('data-color-mode', mode)
}

/** Reflect the reader's compatibility layout choice onto the custom element. */
export function applyEmailLayoutMode(element: Element | null, mode: EmailLayoutMode): void {
	if (!element) return
	element.setAttribute('data-layout-mode', mode)
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

/**
 * The reader's edge-state layer inside a message's shadow root (design.md
 * "Edge states"): images held back by the remote-image policy keep their
 * declared space as striped placeholders that name what they show, and
 * disabled links stop looking clickable.
 *
 * A held image is hidden and a real placeholder element follows it, sized
 * from the image's own width and height (attributes or inline pixels). Text
 * on a real element renders in every engine; generated content on an `<img>`
 * does not. The element re-renders its content root when images are allowed
 * or the layout changes, which drops the placeholders with the old nodes; an
 * observer on the root puts them back for the new document.
 */

/** Marks the reader's own edge-state rules inside the message's shadow root. */
export const EDGE_STYLE_ATTRIBUTE = 'data-ownmail-edge-style'
/** On a held image: the reader hid it behind a placeholder. */
export const HELD_IMAGE_ATTRIBUTE = 'data-ownmail-held'
/** On the placeholder that stands in for a held image. */
export const HELD_PLACEHOLDER_ATTRIBUTE = 'data-ownmail-held-image'

/** On an image that failed to load: it is hidden behind its fallback. */
export const FAILED_IMAGE_ATTRIBUTE = 'data-ownmail-image-failed'
/** On the fallback that names a failed image, in the image's declared space. */
export const IMAGE_FALLBACK_ATTRIBUTE = 'data-ownmail-image-fallback'

export const BLOCKED_IMAGE = '.email-root img:not([src]):not([srcset])'

/** A placeholder with no declared height is as tall as the board draws one. */
const DEFAULT_HELD_HEIGHT = 54
const MIN_HELD_WIDTH = 120

/**
 * Edge-state rules layered after the element's own. Colours come from the
 * app tokens, which inherit into the shadow tree.
 */
export function edgeShadowStyle(linksDisabled: boolean): string {
	return [
		`:host .email-root img:is([${HELD_IMAGE_ATTRIBUTE}],[${FAILED_IMAGE_ATTRIBUTE}]){display:none!important;}`,
		// An image that failed after it was allowed keeps its place the same way, naming what it showed.
		`:host .email-root :is([${HELD_PLACEHOLDER_ATTRIBUTE}],[${IMAGE_FALLBACK_ATTRIBUTE}]){display:inline-flex!important;align-items:center!important;justify-content:center!important;box-sizing:border-box!important;max-width:100%!important;vertical-align:top;margin:0;border-radius:4px;overflow:hidden;padding:4px;text-align:center;font:11px/1.4 var(--font-sans,sans-serif)!important;color:var(--muted-foreground,#6b7680)!important;background:repeating-linear-gradient(135deg,var(--image-held,#f2f3f2) 0 6px,var(--image-held-stripe,#ecedec) 6px 12px)!important;}`,
		linksDisabled ? ':host .email-root a{cursor:default!important;text-decoration:none!important;}' : '',
	].join('\n')
}

/** A declared size in CSS pixels: `600`, `600px`; anything relative reads as unknown. */
function pixels(value: string | null | undefined): number | null {
	const match = /^\s*(\d+(?:\.\d+)?)(?:px)?\s*$/i.exec(value ?? '')
	if (!match) return null
	const size = Number(match[1])
	return size > 0 ? size : null
}

/** The size an image declares, from its attributes or its inline style. */
export function declaredImageSize(image: Element): { width: number | null; height: number | null } {
	const style = (image as HTMLElement).style
	return {
		width: pixels(image.getAttribute('width')) ?? pixels(style?.width),
		height: pixels(image.getAttribute('height')) ?? pixels(style?.height),
	}
}

/** A tracking pixel: declared no bigger than 2×2. */
function isPixel({ width, height }: { width: number | null; height: number | null }): boolean {
	return width !== null && height !== null && width <= 2 && height <= 2
}

/** Whether a reader would have seen this blocked image: it has alt text or a real declared size. */
function heldWorthy(image: Element): boolean {
	const size = declaredImageSize(image)
	if (isPixel(size)) return false
	return Boolean(image.getAttribute('alt')?.trim()) || (size.width !== null && size.height !== null)
}

/** Blocked images a reader would have seen: everything but tracking pixels. */
export function blockedImageCount(root: ParentNode | null | undefined): number {
	if (!root) return 0
	return [...root.querySelectorAll(BLOCKED_IMAGE)].filter((image) => !isPixel(declaredImageSize(image)))
		.length
}

/**
 * The box a held image keeps: its declared width (never wider than the pane)
 * and, when both sides are declared, its aspect ratio, so the placeholder is
 * exactly as tall as the image will be. A width alone keeps a 54px band.
 */
export function heldImageBox(image: Element): Record<string, string> {
	const { width, height } = declaredImageSize(image)
	if (width !== null && height !== null) {
		return { width: `${width}px`, height: 'auto', 'aspect-ratio': `${width} / ${height}` }
	}
	if (width !== null) return { width: `${width}px`, height: `${DEFAULT_HELD_HEIGHT}px` }
	return {
		width: 'auto',
		'min-width': `${MIN_HELD_WIDTH}px`,
		height: `${height ?? DEFAULT_HELD_HEIGHT}px`,
	}
}

/** Put a sized placeholder after every held image under `root` that does not have one yet. */
export function holdBlockedImages(root: Pick<ParentNode, 'querySelectorAll'>): number {
	let added = 0
	for (const image of root.querySelectorAll(BLOCKED_IMAGE)) {
		if (image.hasAttribute(HELD_IMAGE_ATTRIBUTE) || !heldWorthy(image)) continue
		const placeholder = image.ownerDocument.createElement('span')
		placeholder.setAttribute(HELD_PLACEHOLDER_ATTRIBUTE, '')
		const alt = image.getAttribute('alt')?.trim() ?? ''
		if (alt) {
			placeholder.setAttribute('role', 'img')
			placeholder.setAttribute('aria-label', alt)
			placeholder.textContent = alt
		} else {
			placeholder.setAttribute('aria-hidden', 'true')
		}
		for (const [property, value] of Object.entries(heldImageBox(image))) {
			placeholder.style.setProperty(property, value, 'important')
		}
		image.setAttribute(HELD_IMAGE_ATTRIBUTE, '')
		image.parentNode?.insertBefore(placeholder, image.nextSibling)
		added += 1
	}
	return added
}

/**
 * Install the edge-state layer in a message's shadow root: the rules, the
 * placeholders for the current document, and an observer that restores them
 * whenever the element swaps its document. Returns the cleanup.
 */
export function installEdgeState(shadow: ShadowRoot, linksDisabled: boolean): () => void {
	let sheet = shadow.querySelector<HTMLStyleElement>(`style[${EDGE_STYLE_ATTRIBUTE}]`)
	if (!sheet) {
		sheet = shadow.ownerDocument.createElement('style')
		sheet.setAttribute(EDGE_STYLE_ATTRIBUTE, '')
		shadow.appendChild(sheet)
	}
	sheet.textContent = edgeShadowStyle(linksDisabled)
	holdBlockedImages(shadow)
	const root = shadow.querySelector('.email-root')
	/* v8 ignore next -- the element creates its content root with the shadow root, before any HTML arrives. @preserve */
	if (!root) return () => {}
	// Only the root's own children: the placeholders themselves never re-trigger it.
	const observer = new MutationObserver(() => holdBlockedImages(shadow))
	observer.observe(root, { childList: true })
	return () => observer.disconnect()
}

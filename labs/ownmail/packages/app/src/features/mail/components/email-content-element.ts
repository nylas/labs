import {
	computeScale,
	EMAIL_ELEMENT_TAG,
	EMAIL_LAYOUT_STATUS_EVENT,
	EMAIL_REMOTE_IMAGES_EVENT,
	type EmailLayoutMode,
	type EmailLayoutStatusDetail,
	type EmailRemoteImagesDetail,
	LINK_PREVIEW_EVENT,
	type LinkPreviewDetail,
	meaningfulContentWidth,
	type PreviewPoint,
	scaledHeight,
	shadowStyleText,
} from '../lib/email-render.js'
import {
	PICTURE_MEDIA_ATTRIBUTE,
	type PictureMediaDefinition,
	sanitizedDocumentHasRemoteImages,
	sanitizeEmailDocument,
} from '../lib/sanitize-email.js'

/**
 * `<ownmail-email>` — a Shadow-DOM custom element that renders sanitized email
 * HTML in isolation from the app's styles. It owns four concerns the surrounding
 * React app should not: CSS scoping (the shadow root), sanitization at the render
 * boundary, forcing links to open safely in a new tab, and shrink-to-fit scaling
 * for wide (non-responsive) emails on narrow screens. It reports link hovers back
 * to the host via a composed {@link LINK_PREVIEW_EVENT} so the app can show a URL
 * preview, and reflects the host-controlled `data-dark-invert` attribute (pure CSS).
 *
 * Registration is deferred to {@link ensureEmailElementDefined} — called only on
 * the client — so importing this module never touches `HTMLElement`/`customElements`
 * on the server.
 */

/** The href of the nearest ancestor anchor of an event target, or null. */
export function anchorHref(target: EventTarget | null): string | null {
	if (!(target instanceof Element)) return null
	const anchor = target.closest('a[href]')
	return anchor ? anchor.getAttribute('href') : null
}

/**
 * Where to anchor the preview for a hover/focus event on a link. Mouse hovers
 * carry a pointer position; keyboard focus does not, so fall back to the link's
 * own on-screen box (its bottom-left) so the preview still lands next to it.
 * Only called once a link href is known, so the target is an element inside a link.
 */
export function previewPoint(event: Event, target: EventTarget | null): PreviewPoint {
	if (event instanceof MouseEvent) return { x: event.clientX, y: event.clientY }
	const anchor = (target as Element).closest('a[href]') as Element
	const rect = anchor.getBoundingClientRect()
	return { x: rect.left, y: rect.bottom }
}

/** Force every link to open in a new tab without leaking the opener. */
export function rewriteAnchors(root: HTMLElement): void {
	for (const anchor of root.querySelectorAll<HTMLAnchorElement>('a[href]')) {
		anchor.setAttribute('target', '_blank')
		anchor.setAttribute('rel', 'noopener noreferrer nofollow')
		anchor.style.setProperty('text-decoration', 'underline', 'important')
		anchor.style.setProperty('text-decoration-thickness', 'max(1px, .08em)', 'important')
		anchor.style.setProperty('text-underline-offset', '.15em', 'important')
	}
}

const focusStyle = new WeakMap<HTMLAnchorElement, Map<string, { priority: string; value: string }>>()

function enforceAnchorFocus(target: EventTarget | null, focused: boolean): void {
	if (!(target instanceof Element)) return
	const anchor = target.closest('a[href]') as HTMLAnchorElement | null
	if (!anchor) return
	const properties = ['outline', 'outline-offset', 'border-radius', 'box-shadow']
	if (focused) {
		if (!focusStyle.has(anchor)) {
			focusStyle.set(
				anchor,
				new Map(
					properties.map((property) => [
						property,
						{
							priority: anchor.style.getPropertyPriority(property),
							value: anchor.style.getPropertyValue(property),
						},
					]),
				),
			)
		}
		anchor.style.setProperty('outline', '2px solid CanvasText', 'important')
		anchor.style.setProperty('outline-offset', '2px', 'important')
		anchor.style.setProperty('border-radius', '2px', 'important')
		anchor.style.setProperty('box-shadow', '0 0 0 4px Canvas', 'important')
		return
	}
	const stored = focusStyle.get(anchor)
	if (!stored) return
	for (const [property, value] of stored) {
		if (value.value) anchor.style.setProperty(property, value.value, value.priority)
		else anchor.style.removeProperty(property)
	}
	focusStyle.delete(anchor)
}

function setImportantStyle(element: HTMLElement | SVGElement, property: string, value: string): void {
	if (
		element.style.getPropertyValue(property) === value &&
		element.style.getPropertyPriority(property) === 'important'
	) {
		return
	}
	element.style.setProperty(property, value, 'important')
}

const NARROW_TABLE_REFLOW_WIDTH = 400

function stackTableForNarrowPane(table: HTMLTableElement): void {
	const sections = [table, ...table.querySelectorAll<HTMLElement>('thead, tbody, tfoot, tr, td, th')]
	for (const section of sections) {
		if (getComputedStyle(section).display === 'none') continue
		setImportantStyle(section, 'box-sizing', 'border-box')
		setImportantStyle(section, 'display', 'block')
		setImportantStyle(section, 'min-width', '0px')
		setImportantStyle(section, 'max-width', '100%')
		setImportantStyle(section, 'width', '100%')
	}
}

function isolateBackgroundMedia(root: HTMLElement): void {
	for (const element of root.querySelectorAll<HTMLElement | SVGElement>('*')) {
		if (['HEAD', 'STYLE', 'TITLE', 'META', 'LINK'].includes(element.tagName)) continue
		const style = getComputedStyle(element)
		if (!style.backgroundImage || style.backgroundImage === 'none') continue
		element.setAttribute('data-ownmail-background-media', '')
		for (const property of ['image', 'position', 'size', 'repeat', 'origin', 'clip'] as const) {
			setImportantStyle(
				element,
				`--ownmail-background-${property}`,
				style.getPropertyValue(`background-${property}`),
			)
		}
	}
}

interface RgbColor {
	alpha: number
	blue: number
	green: number
	red: number
}

const INHERITED_COLOR_ATTRIBUTE = 'data-ownmail-inherited-color'
const contrastColorStyle = new WeakMap<
	HTMLElement | SVGElement,
	{ hadStyle: boolean; priority: string; value: string }
>()
const PICTURE_PANE_FEATURE = /^\(\s*(min|max)-width\s*:\s*(\d*\.?\d+)(px|em|rem)\s*\)$/i
const CONTROLLED_IMAGE_PATH = /^\/email-images\/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/
const CONTROLLED_IMAGE_IN_TEXT = /\/email-images\/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+(?:\?[^\s"')>,]+)?/g
const IMAGE_FALLBACK_ATTRIBUTE = 'data-ownmail-image-fallback'
const IMAGE_BACKING_ATTRIBUTE = 'data-ownmail-image-backing'

/** Keep dark transparent pixels legible when the proxy returned an unadapted format or original colors. */
/* v8 ignore start -- pixel sampling and canvas failures are exercised by the Chromium suite -- @preserve */
function updateDarkImageBacking(image: HTMLImageElement, darkInvert: boolean): void {
	image.removeAttribute(IMAGE_BACKING_ATTRIBUTE)
	if (!darkInvert || image.naturalWidth <= 0 || image.naturalHeight <= 0) return
	const longestSide = Math.max(image.naturalWidth, image.naturalHeight)
	const scale = Math.min(1, 48 / longestSide)
	const width = Math.max(1, Math.round(image.naturalWidth * scale))
	const height = Math.max(1, Math.round(image.naturalHeight * scale))
	try {
		const canvas = document.createElement('canvas')
		canvas.width = width
		canvas.height = height
		const context = canvas.getContext('2d', { willReadFrequently: true })
		if (!context) throw new Error('Canvas unavailable')
		context.drawImage(image, 0, 0, width, height)
		const pixels = context.getImageData(0, 0, width, height).data
		let transparent = false
		let visible = 0
		let luma = 0
		for (let offset = 0; offset < pixels.length; offset += 4) {
			const alpha = pixels[offset + 3] ?? 0
			if (alpha < 248) transparent = true
			if (alpha <= 16) continue
			const red = pixels[offset] ?? 0
			const green = pixels[offset + 1] ?? 0
			const blue = pixels[offset + 2] ?? 0
			luma += (red * 0.2126 + green * 0.7152 + blue * 0.0722) / 255
			visible += 1
		}
		if (transparent && visible > 0 && luma / visible < 0.55) {
			image.setAttribute(IMAGE_BACKING_ATTRIBUTE, '')
		}
	} catch {
		// A controlled image should be same-origin; fail visibly if a runtime cannot inspect it.
		image.setAttribute(IMAGE_BACKING_ATTRIBUTE, '')
	}
}
/* v8 ignore stop -- @preserve */

function treatedImageUrl(
	value: string,
	mode: 'automatic' | 'original',
	theme: 'dark' | 'light',
): string | null {
	let parsed: URL
	try {
		parsed = new URL(value, window.location.origin)
	} catch {
		return null
	}
	if (parsed.origin !== window.location.origin || !CONTROLLED_IMAGE_PATH.test(parsed.pathname)) return null
	parsed.searchParams.set('mode', mode)
	parsed.searchParams.set('theme', theme)
	return `${parsed.pathname}${parsed.search}${parsed.hash}`
}

function treatImageUrlsInText(
	value: string,
	mode: 'automatic' | 'original',
	theme: 'dark' | 'light',
): string {
	/* v8 ignore next -- the matcher accepts only controlled paths that treatedImageUrl can parse -- @preserve */
	return value.replace(CONTROLLED_IMAGE_IN_TEXT, (url) => treatedImageUrl(url, mode, theme) ?? url)
}

/** Apply the reader's color policy to every controlled image reference before insertion. */
export function applyControlledImageTreatment(
	root: HTMLElement,
	mode: 'automatic' | 'original',
	theme: 'dark' | 'light',
): void {
	for (const element of [root, ...root.querySelectorAll<HTMLElement>('*')]) {
		for (const attribute of ['src', 'poster', 'background', 'href', 'xlink:href']) {
			const value = element.getAttribute(attribute)
			if (!value) continue
			const treated = treatedImageUrl(value, mode, theme)
			if (treated) element.setAttribute(attribute, treated)
		}
		for (const attribute of ['srcset', 'style']) {
			const value = element.getAttribute(attribute)
			if (!value) continue
			const treated = treatImageUrlsInText(value, mode, theme)
			if (treated !== value) element.setAttribute(attribute, treated)
		}
	}
	for (const style of root.querySelectorAll('style')) {
		style.textContent = treatImageUrlsInText(style.textContent, mode, theme)
	}
}

function parsedPictureMedia(value: string): PictureMediaDefinition | null {
	try {
		const parsed = JSON.parse(value) as unknown
		if (!parsed || typeof parsed !== 'object' || !('branches' in parsed)) return null
		const branches = parsed.branches
		if (!Array.isArray(branches) || branches.length === 0 || branches.length > 128) return null
		for (const branch of branches) {
			if (!branch || typeof branch !== 'object' || Array.isArray(branch)) return null
			const keys = Object.keys(branch)
			if (
				keys.length === 0 ||
				keys.some((key) => !['media', 'pane', 'theme'].includes(key)) ||
				('theme' in branch && branch.theme !== 'dark' && branch.theme !== 'light') ||
				('media' in branch &&
					(typeof branch.media !== 'string' || branch.media.length === 0 || branch.media.length > 4_096)) ||
				('pane' in branch &&
					(!Array.isArray(branch.pane) ||
						branch.pane.length === 0 ||
						branch.pane.length > 16 ||
						branch.pane.some(
							(condition: unknown) => typeof condition !== 'string' || !PICTURE_PANE_FEATURE.test(condition),
						)))
			) {
				return null
			}
		}
		return { branches } as PictureMediaDefinition
	} catch {
		return null
	}
}

function paneConditionMatches(condition: string, paneWidth: number): boolean {
	const match = condition.match(PICTURE_PANE_FEATURE)
	/* v8 ignore next -- parsedPictureMedia validates every pane condition before this helper is called -- @preserve */
	if (!match) return false
	const boundary = match[1]
	/* v8 ignore next -- the validated pane feature always captures its numeric value and unit -- @preserve */
	const width = Number(match[2]) * ((match[3] as string).toLowerCase() === 'px' ? 1 : 16)
	return boundary === 'min' ? paneWidth >= width : paneWidth <= width
}

/** Materialize trusted picture art direction from app theme + reading-pane width. */
export function applyPictureSourceMedia(root: HTMLElement, theme: 'dark' | 'light', paneWidth: number): void {
	for (const source of root.querySelectorAll<HTMLSourceElement>(
		`picture > source[${PICTURE_MEDIA_ATTRIBUTE}]`,
	)) {
		const definition = parsedPictureMedia(
			/* v8 ignore next -- the selector requires this attribute -- @preserve */
			source.getAttribute(PICTURE_MEDIA_ATTRIBUTE) ?? '',
		)
		const active = definition?.branches.filter(
			(branch) =>
				(!branch.theme || branch.theme === theme) &&
				(!branch.pane || branch.pane.every((condition) => paneConditionMatches(condition, paneWidth))),
		)
		const media =
			!active || active.length === 0
				? 'not all'
				: active.some((branch) => !branch.media)
					? 'all'
					: active.map((branch) => branch.media).join(', ')
		if (source.getAttribute('media') !== media) source.setAttribute('media', media)
	}
}

function computedRgb(value: string): RgbColor | null {
	const match = value.match(
		/^rgba?\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)(?:\s*,\s*(\d*\.?\d+))?\s*\)$/i,
	)
	if (!match) return null
	const [red, green, blue, alpha = '1'] = match.slice(1)
	/* v8 ignore next -- the expression requires all three captured RGB channels -- @preserve */
	if (red === undefined || green === undefined || blue === undefined) return null
	return {
		red: Math.min(255, Number(red)),
		green: Math.min(255, Number(green)),
		blue: Math.min(255, Number(blue)),
		alpha: Math.min(1, Number(alpha)),
	}
}

function compositeColor(foreground: RgbColor, background: RgbColor): RgbColor {
	const alpha = foreground.alpha + background.alpha * (1 - foreground.alpha)
	/* v8 ignore next -- callers require a painted foreground and background -- @preserve */
	if (alpha === 0) return foreground
	return {
		red:
			(foreground.red * foreground.alpha + background.red * background.alpha * (1 - foreground.alpha)) /
			alpha,
		green:
			(foreground.green * foreground.alpha + background.green * background.alpha * (1 - foreground.alpha)) /
			alpha,
		blue:
			(foreground.blue * foreground.alpha + background.blue * background.alpha * (1 - foreground.alpha)) /
			alpha,
		alpha,
	}
}

function relativeLuminance(color: RgbColor): number {
	const channel = (value: number): number => {
		const normalized = value / 255
		return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4
	}
	return channel(color.red) * 0.2126 + channel(color.green) * 0.7152 + channel(color.blue) * 0.0722
}

function colorContrast(first: RgbColor, second: RgbColor): number {
	const firstLuminance = relativeLuminance(first)
	const secondLuminance = relativeLuminance(second)
	return (
		(Math.max(firstLuminance, secondLuminance) + 0.05) / (Math.min(firstLuminance, secondLuminance) + 0.05)
	)
}

/**
 * Keep text readable when a partially adaptive template leaves a local surface
 * light. Transparent text wrappers are evaluated against their nearest painted
 * ancestor, and authored colors are preserved unless their effective contrast
 * falls below the readability threshold. Processing in document order lets a
 * light card inside a dark adaptive canvas choose dark text without flattening
 * the canvas's genuinely dark treatment.
 */
export function applyInheritedSurfaceContrast(root: HTMLElement, enabled: boolean): void {
	for (const marked of root.querySelectorAll<HTMLElement | SVGElement>(`[${INHERITED_COLOR_ATTRIBUTE}]`)) {
		const original = contrastColorStyle.get(marked)
		if (original) {
			if (original.value) marked.style.setProperty('color', original.value, original.priority)
			else marked.style.removeProperty('color')
			if (!original.hadStyle && marked.style.length === 0) marked.removeAttribute('style')
			contrastColorStyle.delete(marked)
		}
		marked.removeAttribute(INHERITED_COLOR_ATTRIBUTE)
	}
	if (!enabled) return
	const surfaceCache = new WeakMap<Element, RgbColor | null>()
	const ambiguousSurface = new WeakSet<Element>()
	const rootSurface = computedRgb(getComputedStyle(root).backgroundColor)
	surfaceCache.set(root, rootSurface?.alpha ? rootSurface : null)

	for (const element of root.querySelectorAll<HTMLElement | SVGElement>('*')) {
		const style = getComputedStyle(element)
		/* v8 ignore next -- every descendant's parent was cached earlier in document order -- @preserve */
		const parent = element.parentElement as Element
		const parentSurface = surfaceCache.get(parent) as RgbColor | null
		const paintsBox = !['contents', 'none'].includes(style.display)
		const layer = paintsBox ? computedRgb(style.backgroundColor) : null
		const surface = layer?.alpha
			? parentSurface
				? compositeColor(layer, parentSurface)
				: layer
			: parentSurface
		surfaceCache.set(element, surface)
		const ambiguous =
			(paintsBox && Boolean(style.backgroundImage) && style.backgroundImage !== 'none') ||
			(ambiguousSurface.has(parent) && (!layer || layer.alpha < 0.95))
		if (ambiguous) ambiguousSurface.add(element)
		if (
			['HEAD', 'STYLE', 'TITLE', 'META', 'LINK'].includes(element.tagName) ||
			ambiguous ||
			!surface ||
			surface.alpha < 0.95
		) {
			continue
		}
		const color = computedRgb(style.color)
		if (!color) continue
		const renderedColor = color.alpha < 1 ? compositeColor(color, surface) : color
		if (colorContrast(renderedColor, surface) >= 4.5) continue

		const dark = { red: 26, green: 26, blue: 26, alpha: 1 }
		const light = { red: 245, green: 245, blue: 245, alpha: 1 }
		const fallback = colorContrast(dark, surface) >= colorContrast(light, surface) ? 'dark' : 'light'
		contrastColorStyle.set(element, {
			hadStyle: element.hasAttribute('style'),
			priority: element.style.getPropertyPriority('color'),
			value: element.style.getPropertyValue('color'),
		})
		element.setAttribute(INHERITED_COLOR_ATTRIBUTE, fallback)
		element.style.setProperty('color', fallback === 'dark' ? '#1a1a1a' : '#f5f5f5', 'important')
	}
}

function createEmailElementClass(Base: typeof HTMLElement) {
	return class extends Base {
		static get observedAttributes(): string[] {
			return [
				'data-layout-mode',
				'data-load-remote-images',
				'data-email-theme',
				'data-dark-invert',
				'data-image-mode',
				'data-message-id',
			]
		}

		private html = ''
		private contentRoot: HTMLDivElement | null = null
		private resizeObserver: ResizeObserver | undefined
		private mutationObserver: MutationObserver | undefined
		private measurementFrame: number | undefined
		private measurementQueued = false
		private observedWidth = -1
		private lastLayoutStatus = ''
		private hasRemoteImages = false
		private lastRemoteImagesStatus = ''
		private imageStates = new WeakMap<HTMLImageElement, 'failed' | 'loaded' | 'pending'>()
		private imageRetry = 0

		connectedCallback(): void {
			const root = this.ensureShadow()
			this.resizeObserver ??= new ResizeObserver(() => {
				const width = this.clientWidth
				if (width === this.observedWidth) return
				this.observedWidth = width
				this.scheduleMeasure()
			})
			// Observing only the host width avoids the ResizeObserver feedback loop caused
			// by observing content whose transform/height this element itself changes.
			this.resizeObserver.observe(this)

			this.mutationObserver ??= new MutationObserver((records) => {
				const relevant = records.some(
					(record) =>
						record.type !== 'attributes' || record.target !== root || record.attributeName !== 'style',
				)
				if (relevant) this.scheduleMeasure()
			})
			this.mutationObserver.observe(root, {
				subtree: true,
				childList: true,
				characterData: true,
				attributes: true,
				attributeFilter: ['class', 'dir', 'hidden', 'height', 'src', 'srcset', 'style', 'width'],
			})

			document.fonts?.addEventListener('loadingdone', this.handleFontsLoaded)
			void document.fonts?.ready.then(() => this.scheduleMeasure())
			this.renderContent(root)
		}

		attributeChangedCallback(name: string, oldValue: string | null, newValue: string | null): void {
			if (oldValue === newValue) return
			if (name === 'data-message-id') {
				this.hasRemoteImages = false
				this.lastRemoteImagesStatus = ''
				this.removeAttribute('data-load-remote-images')
				if (this.contentRoot) this.renderContent(this.contentRoot)
				return
			}
			if (['data-layout-mode', 'data-load-remote-images'].includes(name) && this.contentRoot) {
				this.renderContent(this.contentRoot)
				return
			}
			if (name === 'data-email-theme' && this.contentRoot) {
				applyPictureSourceMedia(this.contentRoot, this.emailTheme(), this.clientWidth)
				applyControlledImageTreatment(this.contentRoot, this.imageMode(), this.emailTheme())
			}
			if (name === 'data-image-mode' && this.contentRoot) {
				applyControlledImageTreatment(this.contentRoot, this.imageMode(), this.emailTheme())
			}
			if (['data-dark-invert', 'data-email-theme', 'data-image-mode'].includes(name) && this.contentRoot) {
				for (const image of this.contentRoot.querySelectorAll<HTMLImageElement>('img')) {
					if (image.complete) updateDarkImageBacking(image, this.darkImageBackingEnabled())
				}
			}
			this.scheduleMeasure()
		}

		private ensureShadow(): HTMLDivElement {
			if (this.contentRoot) return this.contentRoot
			const shadow = this.attachShadow({ mode: 'open' })
			const root = document.createElement('div')
			root.className = 'email-root'
			shadow.appendChild(root)
			const style = document.createElement('style')
			style.textContent = shadowStyleText()
			// Keep OwnMail's containment and dark-mode rules last in the shadow
			// cascade. Sanitized email styles may contain broad selectors such as
			// `div`, but they must not disable the reader's safety boundary or theme.
			shadow.appendChild(style)
			this.contentRoot = root
			shadow.addEventListener('pointerover', this.handleEnter)
			shadow.addEventListener('focusin', this.handleEnter)
			shadow.addEventListener('pointerout', this.handleLeave)
			shadow.addEventListener('focusout', this.handleLeave)
			shadow.addEventListener('load', this.handleMediaSettled, true)
			shadow.addEventListener('error', this.handleMediaSettled, true)
			return root
		}

		disconnectedCallback(): void {
			this.resizeObserver?.disconnect()
			this.mutationObserver?.disconnect()
			document.fonts?.removeEventListener('loadingdone', this.handleFontsLoaded)
			if (this.measurementFrame !== undefined && typeof cancelAnimationFrame === 'function') {
				cancelAnimationFrame(this.measurementFrame)
			}
			this.measurementFrame = undefined
			this.measurementQueued = false
			this.observedWidth = -1
		}

		set emailHtml(value: string) {
			if (value !== this.html) {
				this.hasRemoteImages = false
				this.lastRemoteImagesStatus = ''
				this.removeAttribute('data-load-remote-images')
			}
			this.html = value
			if (this.contentRoot) this.renderContent(this.contentRoot)
		}

		get emailHtml(): string {
			return this.html
		}

		private renderContent(root: HTMLDivElement): void {
			const loadRemoteImages = this.hasAttribute('data-load-remote-images')
			const documentElement = sanitizeEmailDocument(this.html, {
				allowRemoteImages: loadRemoteImages,
				// The message is embedded in a reading pane, so sender breakpoints must
				// follow that pane in both layouts. Original preserves sender CSS and
				// structure; it must not bind responsive rules to the outer app viewport.
				rewriteViewportMedia: true,
			})
			if (documentElement) {
				const blockedRemoteImages = sanitizedDocumentHasRemoteImages(documentElement)
				if (!loadRemoteImages) this.hasRemoteImages = blockedRemoteImages
				applyPictureSourceMedia(documentElement, this.emailTheme(), this.clientWidth)
				applyControlledImageTreatment(documentElement, this.imageMode(), this.emailTheme())
			}
			root.replaceChildren(...(documentElement ? [documentElement] : []))
			this.imageStates = new WeakMap()
			for (const image of root.querySelectorAll<HTMLImageElement>('img')) {
				if (this.controlledImageReferences(image)) this.imageStates.set(image, 'pending')
				if (image.complete) updateDarkImageBacking(image, this.darkImageBackingEnabled())
			}
			applyInheritedSurfaceContrast(root, false)
			rewriteAnchors(root)
			isolateBackgroundMedia(root)
			this.lastLayoutStatus = ''
			this.emitCurrentRemoteImagesStatus(loadRemoteImages)
			this.scheduleMeasure()
		}

		retryFailedImages(): void {
			const root = this.contentRoot
			if (!root) return
			const failed = Array.from(root.querySelectorAll<HTMLImageElement>('img')).filter(
				(image) => this.imageStates.get(image) === 'failed',
			)
			if (failed.length === 0) return
			this.imageRetry += 1
			for (const image of failed) {
				this.imageStates.set(image, 'pending')
				image.hidden = false
				image.removeAttribute('data-ownmail-image-failed')
				if (image.nextElementSibling?.matches(`[${IMAGE_FALLBACK_ATTRIBUTE}]`)) {
					image.nextElementSibling.remove()
				}
				const references: Array<{ attribute: 'src' | 'srcset'; element: Element }> = [
					{ attribute: 'src', element: image },
					{ attribute: 'srcset', element: image },
				]
				for (const source of image.closest('picture')?.querySelectorAll('source[srcset]') ?? []) {
					references.push({ attribute: 'srcset', element: source })
				}
				for (const { attribute, element } of references) {
					const value = element.getAttribute(attribute)
					if (!value) continue
					element.setAttribute(
						attribute,
						value.replace(CONTROLLED_IMAGE_IN_TEXT, (url) => {
							const parsed = new URL(url, window.location.origin)
							parsed.searchParams.set('retry', String(this.imageRetry))
							return `${parsed.pathname}${parsed.search}`
						}),
					)
				}
			}
			this.emitCurrentRemoteImagesStatus(true)
			this.scheduleMeasure()
		}

		private controlledImageReferences(image: HTMLImageElement): boolean {
			return ['src', 'srcset'].some(
				(attribute) => (image.getAttribute(attribute) ?? '').search(CONTROLLED_IMAGE_IN_TEXT) >= 0,
			)
		}

		private emitCurrentRemoteImagesStatus(loadRemoteImages: boolean): void {
			let failedImages = 0
			let pendingImages = 0
			/* v8 ignore next -- Status emission only occurs after the shadow content root is initialized. @preserve */
			for (const image of this.contentRoot?.querySelectorAll<HTMLImageElement>('img') ?? []) {
				const state = this.imageStates.get(image)
				if (state === 'failed') failedImages += 1
				if (state === 'pending') pendingImages += 1
			}
			this.emitRemoteImagesStatus({
				failedImages,
				hasRemoteImages: this.hasRemoteImages,
				loaded: loadRemoteImages && this.hasRemoteImages,
				pendingImages,
			})
		}

		/** Shrink the content to fit the pane; wide emails scale down, never up. */
		measure(): void {
			const content = this.contentRoot
			if (!content) return
			const containerWidth = this.clientWidth
			if (containerWidth <= 0) return

			// Always measure from a trusted, unscaled pane-width canvas. Otherwise a
			// previous transform or natural width becomes part of the next measurement.
			content.style.setProperty('--ownmail-email-scale', '1', 'important')
			content.style.setProperty('--ownmail-email-natural-width', `${containerWidth}px`, 'important')
			content.style.setProperty('box-sizing', 'border-box', 'important')
			content.style.setProperty('width', `${containerWidth}px`, 'important')
			content.style.setProperty('max-width', 'none', 'important')
			content.style.setProperty('transform', 'scale(var(--ownmail-email-scale, 1))', 'important')
			const rtl = this.updateLogicalDirection(content)
			const mode = this.layoutMode()
			const reflowed = mode === 'readable' && this.applyReadableLayout(content, containerWidth)
			applyPictureSourceMedia(content, this.emailTheme(), containerWidth)
			applyInheritedSurfaceContrast(
				content,
				this.getAttribute('data-email-theme') === 'dark' && !this.hasAttribute('data-dark-invert'),
			)
			// The contrast pass restores and reapplies its inline fallback synchronously;
			// discard those observer records so the repair cannot schedule itself forever.
			this.mutationObserver?.takeRecords()
			const visibleWidth = mode === 'original' ? meaningfulContentWidth(content) : containerWidth
			const naturalWidth =
				mode === 'original' ? Math.max(containerWidth, visibleWidth || content.scrollWidth) : containerWidth
			content.style.setProperty('--ownmail-email-natural-width', `${naturalWidth}px`, 'important')
			content.style.setProperty('width', `${naturalWidth}px`, 'important')

			const scale = mode === 'original' ? computeScale(naturalWidth, containerWidth) : 1
			content.style.setProperty('--ownmail-email-scale', `${scale}`, 'important')
			content.style.setProperty(
				'left',
				rtl && scale < 1 ? `${containerWidth - naturalWidth}px` : '0px',
				'important',
			)
			if (scale < 1) {
				this.style.height = `${scaledHeight(content.scrollHeight, scale)}px`
			} else {
				this.style.height = ''
			}

			this.emitLayoutStatus({
				mode,
				naturalWidth,
				containerWidth,
				scale,
				reflowed,
				needsFit: naturalWidth > containerWidth,
			})
		}

		private scheduleMeasure(): void {
			if (!this.isConnected || this.measurementQueued) return
			this.measurementQueued = true
			const run = (): void => {
				this.measurementQueued = false
				this.measurementFrame = undefined
				if (this.isConnected) this.measure()
			}
			if (typeof requestAnimationFrame === 'function') {
				this.measurementFrame = requestAnimationFrame(run)
			} else {
				queueMicrotask(run)
			}
		}

		private layoutMode(): EmailLayoutMode {
			return this.getAttribute('data-layout-mode') === 'original' ? 'original' : 'readable'
		}

		private emailTheme(): 'dark' | 'light' {
			return this.getAttribute('data-email-theme') === 'dark' ? 'dark' : 'light'
		}

		private imageMode(): 'automatic' | 'original' {
			return this.getAttribute('data-image-mode') === 'original' ? 'original' : 'automatic'
		}

		private darkImageBackingEnabled(): boolean {
			return this.emailTheme() === 'dark' && this.hasAttribute('data-dark-invert')
		}

		private updateLogicalDirection(content: HTMLElement): boolean {
			const documentElement = content.querySelector('html')
			const body = content.querySelector('body')
			const declared = body?.getAttribute('dir') ?? documentElement?.getAttribute('dir')
			const direction =
				declared?.toLowerCase() === 'rtl' || (body && getComputedStyle(body).direction === 'rtl')
			content.setAttribute('data-ownmail-direction', direction ? 'rtl' : 'ltr')
			content.style.setProperty('transform-origin', direction ? 'top right' : 'top left', 'important')
			return Boolean(direction)
		}

		private applyReadableLayout(content: HTMLElement, containerWidth: number): boolean {
			let changed = content.scrollWidth > containerWidth
			const contentStyle = getComputedStyle(content)
			const horizontalPadding = [contentStyle.paddingLeft, contentStyle.paddingRight]
				.map(Number.parseFloat)
				.filter(Number.isFinite)
				.reduce((total, padding) => total + padding, 0)
			const readableWidth = Math.max(0, containerWidth - horizontalPadding)
			const contentRect = content.getBoundingClientRect()
			const plans: Array<{
				canResize: boolean
				element: HTMLElement | SVGElement
				normalizeHorizontalMargins: boolean
				normalizeNoWrap: boolean
				raiseFont: boolean
				tooWide: boolean
			}> = []
			for (const element of content.querySelectorAll('*')) {
				if (!(element instanceof HTMLElement || element instanceof SVGElement)) continue
				if (['HEAD', 'STYLE', 'TITLE', 'META', 'LINK'].includes(element.tagName)) continue
				const style = getComputedStyle(element)
				const rect = element.getBoundingClientRect()
				const width = Number.parseFloat(style.width)
				const minWidth = Number.parseFloat(style.minWidth)
				const declaredPixels = [
					element.getAttribute('width') ?? '',
					element.style.width,
					element.style.minWidth,
				]
					.map((value) => value.trim().match(/^(\d+(?:\.\d+)?)(?:px)?$/i)?.[1])
					.filter((value): value is string => value !== undefined)
					.map(Number)
				const scrollWidth =
					element instanceof HTMLElement ? element.scrollWidth : element.getBoundingClientRect().width
				const tooWide =
					declaredPixels.some((declaredWidth) => declaredWidth > readableWidth) ||
					(Number.isFinite(width) && width > readableWidth) ||
					(Number.isFinite(minWidth) && minWidth > readableWidth) ||
					scrollWidth > readableWidth
				const isInline = style.display === 'inline' || style.display === 'contents'
				const canResize = !isInline || ['IMG', 'VIDEO', 'SVG', 'CANVAS'].includes(element.tagName)
				const overflowsPane = rect.left < contentRect.left - 0.5 || rect.right > contentRect.right + 0.5
				const normalizeHorizontalMargins =
					overflowsPane &&
					[style.marginLeft, style.marginRight]
						.map(Number.parseFloat)
						.some((margin) => Number.isFinite(margin) && margin !== 0)
				const normalizeNoWrap =
					(element.hasAttribute('nowrap') || style.whiteSpace === 'nowrap') && (tooWide || overflowsPane)
				const hasDirectText = Array.from(element.childNodes).some(
					(node) => node.nodeType === Node.TEXT_NODE && Boolean(node.textContent?.trim()),
				)
				const fontSize = Number.parseFloat(style.fontSize)
				const raiseFont = hasDirectText && Number.isFinite(fontSize) && fontSize < 12
				if (tooWide || normalizeHorizontalMargins || normalizeNoWrap || raiseFont) {
					plans.push({ canResize, element, normalizeHorizontalMargins, normalizeNoWrap, raiseFont, tooWide })
					changed = true
				}
			}
			for (const {
				canResize,
				element,
				normalizeHorizontalMargins,
				normalizeNoWrap,
				raiseFont,
				tooWide,
			} of plans) {
				if (tooWide && canResize) {
					setImportantStyle(element, 'box-sizing', 'border-box')
					setImportantStyle(element, 'min-width', '0px')
					setImportantStyle(element, 'max-width', '100%')
				}
				if (tooWide && canResize && !['TD', 'TH', 'TR'].includes(element.tagName)) {
					setImportantStyle(element, 'width', '100%')
				}
				if (element.tagName === 'TABLE' && tooWide) {
					setImportantStyle(element, 'table-layout', 'fixed')
					if (readableWidth < NARROW_TABLE_REFLOW_WIDTH) {
						stackTableForNarrowPane(element as HTMLTableElement)
					}
				}
				if (normalizeHorizontalMargins) {
					setImportantStyle(element, 'margin-left', '0px')
					setImportantStyle(element, 'margin-right', '0px')
					setImportantStyle(element, 'margin-inline-start', '0px')
					setImportantStyle(element, 'margin-inline-end', '0px')
				}
				if (normalizeNoWrap) setImportantStyle(element, 'white-space', 'normal')
				if (raiseFont) {
					setImportantStyle(element, 'font-size', '12px')
				}
			}
			// Ancestor width constraints can reduce a flex/grid allocation after the
			// initial measurements. Re-evaluate nowrap descendants against that final
			// allocation so their min-content width cannot keep the pane overflowing.
			/* v8 ignore start -- final flex/grid allocation is exercised by the Chromium suite -- @preserve */
			for (const element of content.querySelectorAll<HTMLElement>('[nowrap], [style*="white-space" i]')) {
				const style = getComputedStyle(element)
				if (!element.hasAttribute('nowrap') && style.whiteSpace !== 'nowrap') continue
				const rect = element.getBoundingClientRect()
				const parentRect = element.parentElement?.getBoundingClientRect() ?? contentRect
				const exceedsOwnBox = element.scrollWidth > rect.width + 0.5
				const exceedsAllocation = rect.left < parentRect.left - 0.5 || rect.right > parentRect.right + 0.5
				if (!exceedsOwnBox && !exceedsAllocation) continue
				setImportantStyle(element, 'white-space', 'normal')
				changed = true
			}
			/* v8 ignore stop -- @preserve */
			return changed
		}

		private emitLayoutStatus(detail: EmailLayoutStatusDetail): void {
			const status = JSON.stringify(detail)
			if (status === this.lastLayoutStatus) return
			this.lastLayoutStatus = status
			this.dispatchEvent(
				new CustomEvent(EMAIL_LAYOUT_STATUS_EVENT, { detail, bubbles: true, composed: true }),
			)
		}

		private emitRemoteImagesStatus(detail: EmailRemoteImagesDetail): void {
			const status = JSON.stringify(detail)
			if (status === this.lastRemoteImagesStatus) return
			this.lastRemoteImagesStatus = status
			this.dispatchEvent(
				new CustomEvent(EMAIL_REMOTE_IMAGES_EVENT, { detail, bubbles: true, composed: true }),
			)
		}

		private readonly handleMediaSettled = (event: Event): void => {
			if (event.target instanceof HTMLImageElement) {
				const image = event.target
				if (event.type === 'load') updateDarkImageBacking(image, this.darkImageBackingEnabled())
				else image.removeAttribute(IMAGE_BACKING_ATTRIBUTE)
				if (this.imageStates.has(image)) {
					this.imageStates.set(image, event.type === 'error' ? 'failed' : 'loaded')
					if (event.type === 'error') {
						image.hidden = true
						image.setAttribute('data-ownmail-image-failed', '')
						if (!image.nextElementSibling?.matches(`[${IMAGE_FALLBACK_ATTRIBUTE}]`)) {
							const fallback = document.createElement('span')
							const label = image.alt.trim() || 'Image unavailable'
							fallback.setAttribute(IMAGE_FALLBACK_ATTRIBUTE, '')
							fallback.setAttribute('role', 'img')
							fallback.setAttribute('aria-label', label)
							fallback.textContent = label
							image.parentNode?.insertBefore(fallback, image.nextSibling)
						}
					} else {
						image.hidden = false
						image.removeAttribute('data-ownmail-image-failed')
						if (image.nextElementSibling?.matches(`[${IMAGE_FALLBACK_ATTRIBUTE}]`)) {
							image.nextElementSibling.remove()
						}
					}
					this.emitCurrentRemoteImagesStatus(this.hasAttribute('data-load-remote-images'))
				}
				this.scheduleMeasure()
				return
			}
			if (event.target instanceof HTMLVideoElement) this.scheduleMeasure()
		}

		private readonly handleFontsLoaded = (): void => this.scheduleMeasure()

		private readonly handleEnter = (event: Event): void => {
			if (event.type === 'focusin') enforceAnchorFocus(event.target, true)
			const href = anchorHref(event.target)
			if (href) this.emitPreview(href, previewPoint(event, event.target))
		}

		private readonly handleLeave = (event: Event): void => {
			if (event.type === 'focusout') enforceAnchorFocus(event.target, false)
			this.emitPreview(null)
		}

		private emitPreview(href: string | null, point: PreviewPoint = { x: 0, y: 0 }): void {
			const detail: LinkPreviewDetail = { href, x: point.x, y: point.y }
			this.dispatchEvent(new CustomEvent(LINK_PREVIEW_EVENT, { detail, bubbles: true, composed: true }))
		}
	}
}

/** Register `<ownmail-email>` once, on the client. A no-op on the server or if already defined. */
export function ensureEmailElementDefined(): void {
	if (typeof customElements === 'undefined') return
	if (customElements.get(EMAIL_ELEMENT_TAG)) return
	customElements.define(EMAIL_ELEMENT_TAG, createEmailElementClass(HTMLElement))
}

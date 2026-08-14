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
import { sanitizedDocumentHasRemoteImages, sanitizeEmailDocument } from '../lib/sanitize-email.js'

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
		anchor.style.setProperty('color', 'LinkText', 'important')
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

function createEmailElementClass(Base: typeof HTMLElement) {
	return class extends Base {
		static get observedAttributes(): string[] {
			return ['data-layout-mode', 'data-load-remote-images']
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
			if (!['data-layout-mode', 'data-load-remote-images'].includes(name) || oldValue === newValue) return
			if (this.contentRoot) this.renderContent(this.contentRoot)
			else this.scheduleMeasure()
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
				rewriteViewportMedia: this.layoutMode() === 'readable',
			})
			if (documentElement) {
				const blockedRemoteImages = sanitizedDocumentHasRemoteImages(documentElement)
				if (!loadRemoteImages) this.hasRemoteImages = blockedRemoteImages
			}
			root.replaceChildren(...(documentElement ? [documentElement] : []))
			rewriteAnchors(root)
			isolateBackgroundMedia(root)
			this.lastLayoutStatus = ''
			this.emitRemoteImagesStatus({
				hasRemoteImages: this.hasRemoteImages,
				loaded: loadRemoteImages && this.hasRemoteImages,
			})
			this.scheduleMeasure()
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
			const plans: Array<{
				element: HTMLElement | SVGElement
				isInline: boolean
				normalizeNoWrap: boolean
				raiseFont: boolean
				tooWide: boolean
			}> = []
			for (const element of content.querySelectorAll('*')) {
				if (!(element instanceof HTMLElement || element instanceof SVGElement)) continue
				if (['HEAD', 'STYLE', 'TITLE', 'META', 'LINK'].includes(element.tagName)) continue
				const style = getComputedStyle(element)
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
					declaredPixels.some((declaredWidth) => declaredWidth > containerWidth) ||
					(Number.isFinite(width) && width > containerWidth) ||
					(Number.isFinite(minWidth) && minWidth > containerWidth) ||
					scrollWidth > containerWidth
				const isInline = style.display === 'inline' || style.display === 'contents'
				const normalizeNoWrap = element.hasAttribute('nowrap') || style.whiteSpace === 'nowrap'
				const hasDirectText = Array.from(element.childNodes).some(
					(node) => node.nodeType === Node.TEXT_NODE && Boolean(node.textContent?.trim()),
				)
				const fontSize = Number.parseFloat(style.fontSize)
				const raiseFont = hasDirectText && Number.isFinite(fontSize) && fontSize < 12
				if (tooWide || normalizeNoWrap || raiseFont) {
					plans.push({ element, isInline, normalizeNoWrap, raiseFont, tooWide })
					changed = true
				}
			}
			for (const { element, isInline, normalizeNoWrap, raiseFont, tooWide } of plans) {
				if (tooWide && !isInline) {
					setImportantStyle(element, 'min-width', '0px')
					setImportantStyle(element, 'max-width', '100%')
				}
				if (tooWide && !isInline && !['TD', 'TH', 'TR'].includes(element.tagName)) {
					setImportantStyle(element, 'width', '100%')
				}
				if (element.tagName === 'TABLE' && tooWide) {
					setImportantStyle(element, 'table-layout', 'fixed')
				}
				if (normalizeNoWrap) setImportantStyle(element, 'white-space', 'normal')
				if (raiseFont) {
					setImportantStyle(element, 'font-size', '12px')
				}
			}
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
			if (event.target instanceof HTMLImageElement || event.target instanceof HTMLVideoElement) {
				this.scheduleMeasure()
			}
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

import {
	computeScale,
	EMAIL_ELEMENT_TAG,
	LINK_PREVIEW_EVENT,
	type LinkPreviewDetail,
	type PreviewPoint,
	scaledHeight,
	shadowStyleText,
} from '../lib/email-render.js'
import { sanitizeEmailDocument } from '../lib/sanitize-email.js'

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
	for (const anchor of root.querySelectorAll('a[href]')) {
		anchor.setAttribute('target', '_blank')
		anchor.setAttribute('rel', 'noopener noreferrer nofollow')
	}
}

function createEmailElementClass(Base: typeof HTMLElement) {
	return class extends Base {
		private html = ''
		private contentRoot: HTMLDivElement | null = null
		private observer: ResizeObserver | undefined

		connectedCallback(): void {
			const root = this.ensureShadow()
			this.observer ??= new ResizeObserver(() => this.measure())
			// Observe the host (pane width changes → re-fit) and the content (late-loading
			// images/reflow grow it → re-measure so the box height stays right and the
			// thread can scroll the whole email into view).
			this.observer.observe(this)
			this.observer.observe(root)
			this.renderContent(root)
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
			return root
		}

		disconnectedCallback(): void {
			this.observer?.disconnect()
		}

		set emailHtml(value: string) {
			this.html = value
			if (this.contentRoot) this.renderContent(this.contentRoot)
		}

		get emailHtml(): string {
			return this.html
		}

		private renderContent(root: HTMLDivElement): void {
			const documentElement = sanitizeEmailDocument(this.html)
			root.replaceChildren(...(documentElement ? [documentElement] : []))
			rewriteAnchors(root)
			this.measure()
		}

		/** Shrink the content to fit the pane; wide emails scale down, never up. */
		measure(): void {
			const content = this.contentRoot
			if (!content) return
			const scale = computeScale(content.scrollWidth, this.clientWidth)
			if (scale < 1) {
				content.style.transformOrigin = 'top left'
				content.style.transform = `scale(${scale})`
				this.style.height = `${scaledHeight(content.scrollHeight, scale)}px`
			} else {
				content.style.transform = ''
				this.style.height = ''
			}
		}

		private readonly handleEnter = (event: Event): void => {
			const href = anchorHref(event.target)
			if (href) this.emitPreview(href, previewPoint(event, event.target))
		}

		private readonly handleLeave = (): void => {
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

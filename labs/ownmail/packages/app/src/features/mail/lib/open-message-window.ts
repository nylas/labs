import { disableLinks } from './inert-links.js'
import { sanitizeEmailDocument } from './sanitize-email.js'

/**
 * Nothing in an opened message runs, loads from elsewhere, or submits
 * anywhere. Images load only from the app's own proxy, named outright because
 * a blob page's own origin is not one every engine matches as 'self'.
 */
const windowPolicy = (origin: string): string =>
	`default-src 'none'; img-src 'self' ${origin} data: blob:; style-src 'unsafe-inline'; font-src data:; base-uri 'none'; form-action 'none'`

/** OwnMail's own image proxy, the only image source the sanitizer keeps. */
const PROXIED_IMAGE = /(^|[\s,("'])(\/email-images\/)/g

const escapeHtml = (text: string): string =>
	text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export type MessageWindowOptions = {
	title: string
	allowRemoteImages: boolean
	/** The sender is not to be trusted: links keep their words and lose their destinations. */
	linksDisabled?: boolean
	/** The app origin proxied images load from; a blob page cannot resolve a root-relative URL. */
	origin?: string
}

/**
 * Proxied images in the page point at the app's own origin. The reader loads
 * a message's images only through OwnMail's proxy (`/email-images/…`), and a
 * page opened from a blob URL has no base to resolve that path against.
 */
function absoluteProxiedImages(root: HTMLElement, origin: string): void {
	const absolute = (value: string) => value.replace(PROXIED_IMAGE, `$1${origin}$2`)
	for (const element of [root, ...root.querySelectorAll<HTMLElement>('*')]) {
		for (const attribute of ['src', 'srcset', 'poster', 'background', 'style']) {
			const value = element.getAttribute(attribute)
			if (value?.includes('/email-images/')) element.setAttribute(attribute, absolute(value))
		}
	}
	for (const style of root.querySelectorAll('style')) {
		if (style.textContent.includes('/email-images/')) style.textContent = absolute(style.textContent)
	}
}

/**
 * The page "Open in window" shows: the same sanitized document the reader
 * renders, at its own width, under a policy that allows no script, no remote
 * resource and no form submission. Its images come through the same proxy as
 * the reader's; inert links stay inert. Null when there is nothing to show.
 */
export function messageWindowDocument(
	html: string,
	{ title, allowRemoteImages, linksDisabled = false, origin = window.location.origin }: MessageWindowOptions,
): string | null {
	const sanitized = sanitizeEmailDocument(html, { allowRemoteImages })
	if (!sanitized) return null
	absoluteProxiedImages(sanitized, origin)
	if (linksDisabled) disableLinks(sanitized)
	// Live links open beside the message; inert ones have nowhere to go.
	const base = linksDisabled ? '' : '<base target="_blank">'
	return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${escapeHtml(windowPolicy(origin))}"><meta name="referrer" content="no-referrer"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title>${base}</head><body style="margin:0">${sanitized.outerHTML}</body></html>`
}

/** Open a message's sanitized HTML in a new window from a short-lived blob URL. */
export function openMessageWindow(html: string, options: MessageWindowOptions): boolean {
	const page = messageWindowDocument(html, options)
	if (!page) return false
	const url = URL.createObjectURL(new Blob([page], { type: 'text/html' }))
	window.open(url, '_blank', 'noopener')
	window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
	return true
}

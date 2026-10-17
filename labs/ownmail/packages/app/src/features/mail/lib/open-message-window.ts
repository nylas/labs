import { sanitizeEmailDocument } from './sanitize-email.js'

/** Nothing in an opened message runs, loads from elsewhere, or submits anywhere. */
const WINDOW_POLICY =
	"default-src 'none'; img-src 'self' data: blob:; style-src 'unsafe-inline'; font-src data:; base-uri 'none'; form-action 'none'"

const escapeHtml = (text: string): string =>
	text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/**
 * The page "Open in window" shows: the same sanitized document the reader
 * renders, at its own width, under a policy that allows no script, no remote
 * resource and no form submission. Null when the message has nothing to show.
 */
export function messageWindowDocument(
	html: string,
	{ title, allowRemoteImages }: { title: string; allowRemoteImages: boolean },
): string | null {
	const sanitized = sanitizeEmailDocument(html, { allowRemoteImages })
	if (!sanitized) return null
	return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${WINDOW_POLICY}"><meta name="referrer" content="no-referrer"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title><base target="_blank"></head><body style="margin:0">${sanitized.outerHTML}</body></html>`
}

/** Open a message's sanitized HTML in a new window from a short-lived blob URL. */
export function openMessageWindow(
	html: string,
	options: { title: string; allowRemoteImages: boolean },
): boolean {
	const page = messageWindowDocument(html, options)
	if (!page) return false
	const url = URL.createObjectURL(new Blob([page], { type: 'text/html' }))
	window.open(url, '_blank', 'noopener')
	window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
	return true
}

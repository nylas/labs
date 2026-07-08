import DOMPurify from 'dompurify'

/** Sanitize untrusted email HTML before sandboxed iframe rendering. */
export function sanitizeEmailHtml(html: string): string {
	return DOMPurify.sanitize(html, {
		USE_PROFILES: { html: true },
		ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|cid):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i,
	})
}

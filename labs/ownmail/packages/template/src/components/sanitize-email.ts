import sanitizeHtml from 'sanitize-html'

/** Sanitize untrusted email HTML before sandboxed iframe rendering. */
export function sanitizeEmailHtml(html: string): string {
	return sanitizeHtml(html, {
		allowedTags: sanitizeHtml.defaults.allowedTags.concat([
			'img',
			'h1',
			'h2',
			'h3',
			'table',
			'thead',
			'tbody',
			'tr',
			'td',
			'th',
		]),
		allowedAttributes: {
			...sanitizeHtml.defaults.allowedAttributes,
			img: ['src', 'alt', 'title', 'width', 'height'],
			a: ['href', 'name', 'target', 'rel'],
			td: ['colspan', 'rowspan', 'align'],
			th: ['colspan', 'rowspan', 'align'],
		},
		allowedSchemes: ['http', 'https', 'mailto', 'cid'],
		allowProtocolRelative: false,
	})
}

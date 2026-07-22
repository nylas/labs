import { useMounted } from '#shared/components/ClientTime'
import { ownMailDraftMarkdown } from '../lib/html-to-markdown.js'
import { messageHasHtml } from '../lib/mail-ui-model.js'
import { markdownToEmailHtml } from '../lib/markdown-model.js'
import type { MailMessage } from '../state/mail-queries.js'
import { EmailHtml } from './EmailHtml.js'

export function MessageBody({ message }: { message: MailMessage }) {
	const mounted = useMounted()

	// Only messages attested by our drafts-endpoint fallback can receive OwnMail's
	// explicit Markdown storage envelope. Render that exact envelope as the same
	// final HTML used for sending; never trust provider folder membership or fields.
	const draftMarkdown =
		message.ownmailDraft === true && message.body ? ownMailDraftMarkdown(message.body) : undefined
	if (draftMarkdown !== undefined) {
		const html = markdownToEmailHtml(draftMarkdown)
		if (!mounted) return html ? <HtmlBodyPlaceholder /> : null
		return <EmailHtml html={html} messageId={message.id} />
	}

	if (messageHasHtml(message)) {
		// Keep server and initial hydration output identical without presenting an
		// HTML message as plaintext. Untrusted markup only reaches EmailHtml's
		// sanitizer and isolated shadow root after the client has mounted.
		if (!mounted) return <HtmlBodyPlaceholder />
		/* v8 ignore next -- `?? ''` is unreachable: this branch only runs when messageHasHtml() confirmed message.body is a non-empty string */
		return <EmailHtml html={message.body ?? ''} messageId={message.id} />
	}

	const text = plainBodyText(message)
	if (!text) return null

	return <PlainBody text={text} />
}

function HtmlBodyPlaceholder() {
	return (
		<div
			data-slot="html-email-placeholder"
			role="status"
			aria-label="Loading email content"
			className="min-h-24 min-w-0 max-w-full rounded-xl border border-border bg-muted/40"
		/>
	)
}

/** Keep plaintext literal and React-escaped while normalizing platform newlines. */
function plainBodyText(message: MailMessage): string {
	const body = typeof message.body === 'string' && message.body.trim() ? message.body : undefined
	const snippet = typeof message.snippet === 'string' ? message.snippet : ''
	return (body ?? snippet).replace(/\r\n?/g, '\n').trim()
}

function PlainBody({ text }: { text: string }) {
	const paragraphs = text.split(/\n{2,}/)
	return (
		<div
			data-slot="plain-email-content"
			className="min-w-0 max-w-full space-y-3 overflow-hidden rounded-xl border border-border bg-card p-5 shadow-sm"
		>
			{paragraphs.map((paragraph) => (
				<p
					key={paragraph.slice(0, 48)}
					className="whitespace-pre-wrap break-words text-[0.9375rem] leading-[1.7] text-foreground [overflow-wrap:anywhere]"
				>
					{paragraph}
				</p>
			))}
		</div>
	)
}

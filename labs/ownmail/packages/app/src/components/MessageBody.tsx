import type { MailMessage } from '../state/mail-queries.js'
import { useMounted } from './ClientTime.js'
import { EmailHtml } from './EmailHtml.js'
import { ownMailDraftMarkdown } from './html-to-markdown.js'
import { markdownToEmailHtml } from './markdown-model.js'
import { messageBodyParagraphs, messageHasHtml } from './ui-model.js'

export function MessageBody({ message }: { message: MailMessage }) {
	const mounted = useMounted()

	// Only messages attested by our drafts-endpoint fallback can receive OwnMail's
	// explicit Markdown storage envelope. Render that exact envelope as the same
	// final HTML used for sending; never trust provider folder membership or fields.
	const draftMarkdown =
		message.ownmailDraft === true && message.body ? ownMailDraftMarkdown(message.body) : undefined
	if (draftMarkdown !== undefined) {
		const html = markdownToEmailHtml(draftMarkdown)
		if (!mounted) {
			const plain = messageBodyParagraphs({ ...message, body: html })
			return plain.length > 0 ? <PlainBody paragraphs={plain} /> : null
		}
		return <EmailHtml html={html} messageId={message.id} />
	}

	if (messageHasHtml(message)) {
		const plain = messageBodyParagraphs(message)
		if (!mounted) {
			return plain.length > 0 ? <PlainBody paragraphs={plain} /> : null
		}
		/* v8 ignore next -- `?? ''` is unreachable: this branch only runs when messageHasHtml() confirmed message.body is a non-empty string */
		return <EmailHtml html={message.body ?? ''} messageId={message.id} />
	}

	const paragraphs = messageBodyParagraphs(message)
	if (paragraphs.length === 0) return null

	return <PlainBody paragraphs={paragraphs} />
}

function PlainBody({ paragraphs }: { paragraphs: string[] }) {
	return (
		<div className="space-y-3 text-[0.9375rem] leading-[1.7] text-foreground">
			{paragraphs.map((paragraph) => (
				<p key={paragraph.slice(0, 48)} className="whitespace-pre-line text-pretty">
					{paragraph}
				</p>
			))}
		</div>
	)
}

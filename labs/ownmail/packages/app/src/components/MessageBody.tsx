import type { MailMessage } from '../state/mail-queries.js'
import { useMounted } from './ClientTime.js'
import { EmailHtml } from './EmailHtml.js'
import { messageBodyParagraphs } from './ui-model.js'

export function MessageBody({ message }: { message: MailMessage }) {
	const mounted = useMounted()
	const html = message.body

	// Nylas defines Message.body as the message's HTML body. Do not sniff its tags
	// or run it through compose-only Markdown transforms: even a tagless fragment
	// belongs on the sanitized, isolated HTML path. Plain text is only a fallback
	// when the provider did not return a body.
	if (typeof html === 'string' && html.trim() !== '') {
		const plain = messageBodyParagraphs(message)
		if (!mounted) {
			return plain.length > 0 ? <PlainBody paragraphs={plain} /> : null
		}
		return <EmailHtml html={html} messageId={message.id} />
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

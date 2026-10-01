import { useMemo, useState } from 'react'
import { useMounted } from '#shared/components/ClientTime'
import { prepareEmailMessageContent, splitPlainQuotedHistory } from '../lib/email-message-content.js'
import type { EmailCanvasDetail, EmailColorMode, EmailLayoutMode } from '../lib/email-render.js'
import { ownMailDraftMarkdown } from '../lib/html-to-markdown.js'
import { messageHasHtml } from '../lib/mail-ui-model.js'
import { markdownToEmailHtml } from '../lib/markdown-model.js'
import type { MailMessage } from '../state/mail-queries.js'
import { type EmailDisplayStatus, EmailHtml } from './EmailHtml.js'
import { ThreadColumn } from './ThreadColumn.js'

export function MessageBody({
	message,
	darkenEmail = true,
	layoutMode = 'readable',
	colorMode = 'automatic',
	loadRemoteImagesForThread = false,
	loadRemoteImagesForSender = false,
	retryRevision = 0,
	onDisplayStatus,
}: {
	message: MailMessage
	darkenEmail?: boolean
	layoutMode?: EmailLayoutMode
	colorMode?: EmailColorMode
	loadRemoteImagesForThread?: boolean
	loadRemoteImagesForSender?: boolean
	retryRevision?: number
	onDisplayStatus?: (messageId: string, status: EmailDisplayStatus | null) => void
}) {
	const mounted = useMounted()

	// Only messages attested by our drafts-endpoint fallback can receive OwnMail's
	// explicit Markdown storage envelope. Render that exact envelope as the same
	// final HTML used for sending; never trust provider folder membership or fields.
	const draftMarkdown =
		message.ownmailDraft === true && message.body ? ownMailDraftMarkdown(message.body) : undefined
	if (draftMarkdown !== undefined) {
		const html = markdownToEmailHtml(draftMarkdown)
		if (!mounted) return html ? <HtmlBodyPlaceholder /> : null
		return (
			<PreparedHtmlBody
				html={html}
				message={message}
				darkenEmail={darkenEmail}
				layoutMode={layoutMode}
				colorMode={colorMode}
				loadRemoteImagesForThread={loadRemoteImagesForThread}
				loadRemoteImagesForSender={loadRemoteImagesForSender}
				retryRevision={retryRevision}
				onDisplayStatus={onDisplayStatus}
			/>
		)
	}

	if (messageHasHtml(message)) {
		// Keep server and initial hydration output identical without presenting an
		// HTML message as plaintext. Untrusted markup only reaches EmailHtml's
		// sanitizer and isolated shadow root after the client has mounted.
		if (!mounted) return <HtmlBodyPlaceholder />
		/* v8 ignore next -- `?? ''` is unreachable: this branch only runs when messageHasHtml() confirmed message.body is a non-empty string -- @preserve */
		return (
			<PreparedHtmlBody
				html={message.body ?? ''}
				message={message}
				darkenEmail={darkenEmail}
				layoutMode={layoutMode}
				colorMode={colorMode}
				loadRemoteImagesForThread={loadRemoteImagesForThread}
				loadRemoteImagesForSender={loadRemoteImagesForSender}
				retryRevision={retryRevision}
				onDisplayStatus={onDisplayStatus}
			/>
		)
	}

	const text = plainBodyText(message)
	if (!text) return null

	return <PlainBody text={text} />
}

function PreparedHtmlBody({
	html,
	message,
	darkenEmail,
	layoutMode,
	colorMode,
	loadRemoteImagesForThread,
	loadRemoteImagesForSender,
	retryRevision,
	onDisplayStatus,
}: {
	html: string
	message: MailMessage
	darkenEmail: boolean
	layoutMode: EmailLayoutMode
	colorMode: EmailColorMode
	loadRemoteImagesForThread: boolean
	loadRemoteImagesForSender: boolean
	retryRevision: number
	onDisplayStatus?: (messageId: string, status: EmailDisplayStatus | null) => void
}) {
	const prepared = useMemo(
		() => prepareEmailMessageContent(html, message.id, message.attachments ?? [], message.ownmailImageTokens),
		[html, message.attachments, message.id, message.ownmailImageTokens],
	)
	const [canvas, setCanvas] = useState<EmailCanvasDetail | null>(null)
	// The band extends the sender's canvas across the whole reading pane; the
	// message itself stays on the thread column.
	const band = canvas?.canvas ?? null
	return (
		<div
			data-slot="email-canvas-band"
			data-email-strategy={canvas?.strategy}
			className={band ? 'w-full py-3' : 'w-full'}
			style={band ? { backgroundColor: band } : undefined}
		>
			<ThreadColumn designed={!prepared.isProse}>
				<div
					data-slot="html-email-content"
					className={prepared.isProse ? 'w-full min-w-0 max-w-[72ch]' : 'w-full min-w-0'}
				>
					<EmailHtml
						html={prepared.html}
						messageId={message.id}
						darken={darkenEmail}
						senderAddress={message.from?.[0]?.email}
						layoutMode={layoutMode}
						colorMode={colorMode}
						loadRemoteImagesForThread={loadRemoteImagesForThread}
						loadRemoteImagesForSender={loadRemoteImagesForSender}
						retryRevision={retryRevision}
						onDisplayStatus={onDisplayStatus}
						onCanvas={setCanvas}
					/>
				</div>
			</ThreadColumn>
		</div>
	)
}

function HtmlBodyPlaceholder() {
	return (
		<ThreadColumn>
			<div
				data-slot="html-email-placeholder"
				role="status"
				aria-label="Loading email content"
				className="min-h-24 min-w-0 max-w-full"
			/>
		</ThreadColumn>
	)
}

/** Keep plaintext literal and React-escaped while normalizing platform newlines. */
function plainBodyText(message: MailMessage): string {
	const body = typeof message.body === 'string' && message.body.trim() ? message.body : undefined
	const snippet = typeof message.snippet === 'string' ? message.snippet : ''
	return (body ?? snippet).replace(/\r\n?/g, '\n').trim()
}

function PlainBody({ text }: { text: string }) {
	const content = splitPlainQuotedHistory(text)
	const paragraphs = content.visible ? content.visible.split(/\n{2,}/) : []
	return (
		<ThreadColumn>
			<div data-slot="plain-email-content" className="w-full min-w-0">
				<div data-slot="plain-email-prose" className="max-w-[72ch] space-y-3">
					{paragraphs.map((paragraph) => (
						<p
							key={paragraph.slice(0, 48)}
							className="whitespace-pre-wrap break-words text-base leading-relaxed text-foreground [overflow-wrap:anywhere]"
						>
							{paragraph}
						</p>
					))}
					{content.quoted ? (
						<details className="border-t border-border text-muted-foreground">
							<summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
								Show quoted text
							</summary>
							<p className="whitespace-pre-wrap break-words text-sm leading-relaxed [overflow-wrap:anywhere]">
								{content.quoted}
							</p>
						</details>
					) : null}
				</div>
			</div>
		</ThreadColumn>
	)
}

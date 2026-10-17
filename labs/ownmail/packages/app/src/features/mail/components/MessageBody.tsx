import { useMemo, useState } from 'react'
import { useMounted } from '#shared/components/ClientTime'
import { cn } from '#shared/lib/utils'
import { splitHtmlBody, splitPlainBody } from '../lib/body-disclosure.js'
import { reflowPlainText, textKey } from '../lib/edge-states.js'
import { prepareEmailMessageContent } from '../lib/email-message-content.js'
import type { EmailCanvasDetail, EmailColorMode, EmailLayoutMode } from '../lib/email-render.js'
import { ownMailDraftMarkdown } from '../lib/html-to-markdown.js'
import { messageHasHtml } from '../lib/mail-ui-model.js'
import { markdownToEmailHtml } from '../lib/markdown-model.js'
import type { MailMessage } from '../state/mail-queries.js'
import { type EmailDisplayStatus, EmailHtml } from './EmailHtml.js'
import { BodyDisclosures, type GoToQuoted } from './QuotedDisclosure.js'
import { ThreadColumn } from './ThreadColumn.js'

type BodyOptions = {
	darkenEmail: boolean
	layoutMode: EmailLayoutMode
	colorMode: EmailColorMode
	loadRemoteImagesForThread: boolean
	loadRemoteImagesForSender: boolean
	retryRevision: number
	onDisplayStatus?: (messageId: string, status: EmailDisplayStatus | null) => void
	linksDisabled: boolean
	bodyFontSize: 16 | 17
	onGoToQuoted?: GoToQuoted
}

/** Body type: 16px at 1.6 in the reader, 17px at 1.55 on a phone. */
const PROSE_SIZE: Record<16 | 17, string> = {
	16: 'text-base leading-relaxed',
	17: 'text-[17px] leading-[1.55]',
}

export function MessageBody({
	message,
	darkenEmail = true,
	layoutMode = 'readable',
	colorMode = 'automatic',
	loadRemoteImagesForThread = false,
	loadRemoteImagesForSender = false,
	retryRevision = 0,
	onDisplayStatus,
	linksDisabled = false,
	bodyFontSize = 16,
	onGoToQuoted,
}: {
	message: MailMessage
	darkenEmail?: boolean
	layoutMode?: EmailLayoutMode
	colorMode?: EmailColorMode
	loadRemoteImagesForThread?: boolean
	loadRemoteImagesForSender?: boolean
	retryRevision?: number
	onDisplayStatus?: (messageId: string, status: EmailDisplayStatus | null) => void
	/** The sender failed checks or looks like someone else: links in the body do nothing. */
	linksDisabled?: boolean
	bodyFontSize?: 16 | 17
	/** Opens the thread message a quoted entry came from; without it, quotes show in full with no link. */
	onGoToQuoted?: GoToQuoted
}) {
	const mounted = useMounted()
	const options: BodyOptions = {
		darkenEmail,
		layoutMode,
		colorMode,
		loadRemoteImagesForThread,
		loadRemoteImagesForSender,
		retryRevision,
		onDisplayStatus,
		linksDisabled,
		bodyFontSize,
		onGoToQuoted,
	}

	// Only messages attested by our drafts-endpoint fallback can receive OwnMail's
	// explicit Markdown storage envelope. Render that exact envelope as the same
	// final HTML used for sending; never trust provider folder membership or fields.
	const draftMarkdown =
		message.ownmailDraft === true && message.body ? ownMailDraftMarkdown(message.body) : undefined
	if (draftMarkdown !== undefined) {
		const html = markdownToEmailHtml(draftMarkdown)
		if (!mounted) return html ? <HtmlBodyPlaceholder /> : null
		return <PreparedHtmlBody html={html} message={message} {...options} />
	}

	if (messageHasHtml(message)) {
		// Keep server and initial hydration output identical without presenting an
		// HTML message as plaintext. Untrusted markup only reaches EmailHtml's
		// sanitizer and isolated shadow root after the client has mounted.
		if (!mounted) return <HtmlBodyPlaceholder />
		/* v8 ignore next -- `?? ''` is unreachable: this branch only runs when messageHasHtml() confirmed message.body is a non-empty string -- @preserve */
		return <PreparedHtmlBody html={message.body ?? ''} message={message} {...options} />
	}

	// An empty body renders nothing here; the reader shows <EmptyBody> in its place.
	const text = plainBodyText(message)
	if (!text) return null

	return <PlainBody text={text} bodyFontSize={bodyFontSize} onGoToQuoted={onGoToQuoted} />
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
	linksDisabled,
	bodyFontSize,
	onGoToQuoted,
}: BodyOptions & { html: string; message: MailMessage }) {
	const prepared = useMemo(
		() => prepareEmailMessageContent(html, message.id, message.attachments ?? [], message.ownmailImageTokens),
		[html, message.attachments, message.id, message.ownmailImageTokens],
	)
	// What the person wrote renders as their HTML; a trailing history and
	// signature leave the document for the quiet pills beneath it.
	const body = useMemo(() => splitHtmlBody(prepared.html), [prepared.html])
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
						html={body.html}
						messageId={message.id}
						darken={darkenEmail}
						senderAddress={message.from?.[0]?.email}
						senderName={message.from?.[0]?.name}
						layoutMode={layoutMode}
						colorMode={colorMode}
						loadRemoteImagesForThread={loadRemoteImagesForThread}
						loadRemoteImagesForSender={loadRemoteImagesForSender}
						retryRevision={retryRevision}
						onDisplayStatus={onDisplayStatus}
						onCanvas={setCanvas}
						linksDisabled={linksDisabled}
						fontSize={bodyFontSize}
						{...(message.subject ? { windowTitle: message.subject } : {})}
						chromeInset={!prepared.isProse}
					/>
					<div className={prepared.isProse ? undefined : 'px-4 sm:px-0'}>
						<BodyDisclosures disclosure={body} onGoToQuoted={onGoToQuoted} />
					</div>
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

/**
 * Plain text, reflowed: hard-wrapped lines join into paragraphs, each
 * paragraph takes its direction from its own text, and code or indented
 * blocks stay exactly as written in mono on a muted chip.
 */
function PlainBody({
	text,
	bodyFontSize,
	onGoToQuoted,
}: {
	text: string
	bodyFontSize: 16 | 17
	onGoToQuoted?: GoToQuoted
}) {
	const content = useMemo(() => splitPlainBody(text), [text])
	const blocks = useMemo(() => reflowPlainText(content.visible), [content.visible])
	return (
		<ThreadColumn>
			<div data-slot="plain-email-content" className="w-full min-w-0">
				<div data-slot="plain-email-prose" className="max-w-[72ch] space-y-3">
					{blocks.map((block, index) =>
						block.kind === 'code' ? (
							<pre
								key={textKey(block.text, index)}
								dir="ltr"
								className="m-0 w-fit max-w-full overflow-x-auto rounded-sm bg-muted px-1 py-px font-mono text-xs leading-normal whitespace-pre text-foreground"
							>
								{block.text}
							</pre>
						) : (
							<p
								key={textKey(block.text, index)}
								dir="auto"
								className={cn(
									'whitespace-pre-wrap break-words text-foreground [overflow-wrap:anywhere]',
									PROSE_SIZE[bodyFontSize],
								)}
							>
								{block.text}
							</p>
						),
					)}
					<BodyDisclosures disclosure={content} onGoToQuoted={onGoToQuoted} />
				</div>
			</div>
		</ThreadColumn>
	)
}

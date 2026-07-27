import type { Folder } from '@nylas-labs/cli-kit/v3'
import { type EventTone, eventColorClass } from '#shared/lib/color-tone'
import type { MailDraft, MailMessage, MailThread } from '../state/mail-queries.js'

export type MailFolderId = 'inbox' | 'starred' | 'sent' | 'drafts' | 'archive' | 'trash'
export const STAR_HOVER_CLASS = 'hover:text-[var(--event-amber)]'
export const STAR_FILLED_CLASS = 'fill-[var(--event-amber)] text-[var(--event-amber)]'

export const MAIL_FOLDERS: Array<{ id: MailFolderId; label: string }> = [
	{ id: 'inbox', label: 'Inbox' },
	{ id: 'starred', label: 'Starred' },
	{ id: 'sent', label: 'Sent' },
	{ id: 'drafts', label: 'Drafts' },
	{ id: 'archive', label: 'Archive' },
	{ id: 'trash', label: 'Trash' },
]

export const LABELS: Array<{ id: string; name: string; tone: EventTone }> = [
	{ id: 'work', name: 'Work', tone: 'blue' },
	{ id: 'personal', name: 'Personal', tone: 'teal' },
	{ id: 'finance', name: 'Finance', tone: 'amber' },
	{ id: 'travel', name: 'Travel', tone: 'rose' },
]

/** Shared chrome dimensions — keep rail, header, and column spacers on the same grid. */

export function folderCount(folders: Folder[], folderId: string): number {
	return folders.find((folder) => folder.id === folderId)?.unread_count ?? 0
}

export function sidebarFolderCount(folders: Folder[], folderId: string): number {
	const folder = folders.find((item) => item.id === folderId)
	if (!folder) return 0
	if (folderId === 'starred' || folderId === 'drafts') return folder.total_count ?? 0
	return folder.unread_count ?? 0
}

export function mailFolderTitle(folderId: string, folders: Folder[] = []): string {
	const systemFolder = MAIL_FOLDERS.find((folder) => folder.id === folderId)
	if (systemFolder) return systemFolder.label
	if (LABELS.some((label) => label.id === folderId) || folders.some((folder) => folder.id === folderId)) {
		return 'Filtered'
	}
	return folderId
		.split(/[-_\s]+/)
		.filter(Boolean)
		.map((part) => part[0]?.toUpperCase() + part.slice(1))
		.join(' ')
}

export function totalUnread(folders: Folder[]): number {
	return folders.reduce((sum, folder) => sum + (folder.unread_count ?? 0), 0)
}

export function threadSender(thread: MailThread, folderId: string): string {
	const participant =
		folderId === 'sent' || folderId === 'drafts'
			? (thread.latest_draft_or_message?.to?.[0] ?? thread.participants?.[0])
			: thread.participants?.[0]
	if (folderId === 'sent' || folderId === 'drafts') return participantLabel(participant) || 'Sent'
	return participantLabel(participant) || '(unknown sender)'
}

function participantLabel(participant: NonNullable<MailThread['participants']>[number] | undefined): string {
	return participant?.name || participant?.email || ''
}

export function threadTimestamp(thread: MailThread): number | undefined {
	const received = thread.latest_message_received_date ?? 0
	const sent = thread.latest_message_sent_date ?? 0
	return Math.max(received, sent) || undefined
}

export function threadRouteFolderId(thread: MailThread): MailFolderId {
	return (
		(thread.folders?.find((folder): folder is MailFolderId =>
			MAIL_FOLDERS.some((standard) => standard.id === folder),
		) as MailFolderId | undefined) ?? 'inbox'
	)
}

export function messagePreview(message: MailMessage): string {
	if (message.snippet) return readableSnippet(message.snippet)
	if (!message.body) return ''
	return plainTextFromHtml(message.body)
}

/** Project provider-supplied snippets onto one readable, tag-free text line. */
export function readableSnippet(snippet: string | null | undefined): string {
	if (!snippet) return ''
	return plainTextFromHtml(snippet)
}

export function collapsedMessagePreview(message: MailMessage): string {
	return messageBodyParagraphs(message)[0] ?? messagePreview(message)
}

export function messageBodyParagraphs(message: MailMessage): string[] {
	const source = message.body ? plainTextFromHtml(message.body, true) : readableSnippet(message.snippet)
	return source
		.split(/\n{2,}/)
		.map((paragraph) =>
			paragraph
				.replace(/[ \t]+\n/g, '\n')
				.replace(/\s+/g, ' ')
				.trim(),
		)
		.filter(Boolean)
}

export function messageHasHtml(message: MailMessage): boolean {
	const body = message.body?.trim()
	if (!body) return false
	return /<[a-z][\s\S]*>/i.test(body)
}

function plainTextFromHtml(html: string, preserveParagraphs = false): string {
	const paragraphBreak = preserveParagraphs ? '\n\n' : ' '
	const source = hasHtmlMarkup(html) ? htmlTextContent(html, paragraphBreak) : html
	const text = decodeHtmlEntities(source).replace(/\u00a0/g, ' ')
	return text
		.replace(/[ \t]+/g, ' ')
		.replace(preserveParagraphs ? /\n{3,}/g : /\s+/g, preserveParagraphs ? '\n\n' : ' ')
		.trim()
}

const HTML_MARKUP_TAGS = new Set([
	'a',
	'abbr',
	'acronym',
	'address',
	'applet',
	'area',
	'article',
	'aside',
	'audio',
	'b',
	'base',
	'bdi',
	'bdo',
	'big',
	'blockquote',
	'body',
	'br',
	'button',
	'canvas',
	'caption',
	'center',
	'cite',
	'code',
	'col',
	'colgroup',
	'data',
	'datalist',
	'dd',
	'del',
	'details',
	'dfn',
	'dialog',
	'dir',
	'div',
	'dl',
	'dt',
	'em',
	'embed',
	'fieldset',
	'figcaption',
	'figure',
	'font',
	'footer',
	'form',
	'frame',
	'frameset',
	'h1',
	'h2',
	'h3',
	'h4',
	'h5',
	'h6',
	'head',
	'header',
	'hgroup',
	'hr',
	'html',
	'i',
	'iframe',
	'img',
	'input',
	'ins',
	'kbd',
	'label',
	'legend',
	'li',
	'link',
	'main',
	'map',
	'mark',
	'marquee',
	'math',
	'menu',
	'meta',
	'meter',
	'nav',
	'nobr',
	'noembed',
	'noframes',
	'noscript',
	'object',
	'ol',
	'optgroup',
	'option',
	'output',
	'p',
	'param',
	'picture',
	'plaintext',
	'pre',
	'progress',
	'q',
	'rb',
	'rp',
	'rt',
	'rtc',
	'ruby',
	's',
	'samp',
	'script',
	'search',
	'section',
	'select',
	'small',
	'slot',
	'source',
	'span',
	'strike',
	'strong',
	'style',
	'sub',
	'summary',
	'sup',
	'svg',
	'table',
	'tbody',
	'td',
	'template',
	'textarea',
	'tfoot',
	'th',
	'thead',
	'time',
	'title',
	'tr',
	'track',
	'tt',
	'u',
	'ul',
	'var',
	'video',
	'wbr',
	'xmp',
])

function hasHtmlMarkup(value: string): boolean {
	let cursor = 0
	while (cursor < value.length) {
		const start = value.indexOf('<', cursor)
		if (start === -1) return false
		const end = htmlTokenEnd(value, start)
		if (end === -1) return false
		const tag = value.slice(start + 1, end)
		const trimmed = tag.trimStart()
		const tagName = htmlTagName(tag)
		if ((tagName && HTML_MARKUP_TAGS.has(tagName)) || trimmed.startsWith('!') || trimmed.startsWith('?'))
			return true
		cursor = end + 1
	}
	return false
}

function decodeHtmlEntities(value: string): string {
	return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, body: string) => {
		const named = decodeNamedEntity(body)
		if (named !== undefined) return named
		if (body[0] !== '#') return entity
		const codePoint =
			body[1]?.toLowerCase() === 'x' ? Number.parseInt(body.slice(2), 16) : Number(body.slice(1))
		return safeCodePoint(codePoint)
	})
}

function htmlTextContent(html: string, paragraphBreak: string): string {
	let text = ''
	let cursor = 0
	while (cursor < html.length) {
		const tagStart = html.indexOf('<', cursor)
		if (tagStart === -1) {
			text += html.slice(cursor)
			break
		}
		text += html.slice(cursor, tagStart)
		const tagEnd = htmlTokenEnd(html, tagStart)
		if (tagEnd === -1) {
			text += html.slice(tagStart)
			break
		}
		const tag = html.slice(tagStart + 1, tagEnd)
		const tagName = htmlTagName(tag)
		if (!tagName) {
			const trimmed = tag.trimStart()
			if (trimmed.startsWith('!') || trimmed.startsWith('?')) {
				text += ' '
				cursor = tagEnd + 1
				continue
			}
			text += '<'
			cursor = tagStart + 1
			continue
		}
		if (tagName === 'script' || tagName === 'style') {
			cursor = afterRawTextElement(html, tagEnd + 1, tagName)
			text += ' '
			continue
		}
		if (tagName === 'br') text += '\n'
		else if (isClosingBlockTag(tag, tagName)) text += paragraphBreak
		else text += ' '
		cursor = tagEnd + 1
	}
	return text
}

function afterRawTextElement(html: string, cursor: number, tagName: 'script' | 'style'): number {
	let next = cursor
	while (next < html.length) {
		const closeStart = html.indexOf('<', next)
		if (closeStart === -1) return html.length
		if (!isRawTextClosingCandidate(html, closeStart, tagName)) {
			next = closeStart + 1
			continue
		}
		const closeEnd = htmlTokenEnd(html, closeStart)
		if (closeEnd === -1) return html.length
		return closeEnd + 1
	}
	return html.length
}

function isRawTextClosingCandidate(html: string, tagStart: number, tagName: 'script' | 'style'): boolean {
	let index = tagStart + 1
	while (index < html.length && isAsciiWhitespace(html.charCodeAt(index))) index++
	if (html[index] !== '/') return false
	index++
	while (index < html.length && isAsciiWhitespace(html.charCodeAt(index))) index++
	if (html.slice(index, index + tagName.length).toLowerCase() !== tagName) return false
	const next = html.charCodeAt(index + tagName.length)
	return Number.isNaN(next) || next === 47 || next === 62 || isAsciiWhitespace(next)
}

function htmlTokenEnd(html: string, tagStart: number): number {
	if (html.startsWith('<!--', tagStart)) {
		const commentEnd = html.indexOf('-->', tagStart + 4)
		return commentEnd === -1 ? html.length : commentEnd + 2
	}

	let quote = ''
	for (let index = tagStart + 1; index < html.length; index++) {
		const character = html[index]
		if (quote) {
			if (character === quote) quote = ''
			continue
		}
		if (character === '"' || character === "'") quote = character
		else if (character === '>') return index
	}
	return -1
}

function htmlTagName(tag: string): string {
	let index = 0
	if (tag[index] === '/') index++
	const start = index
	if (!isAsciiLetter(tag.charCodeAt(index))) return ''
	while (index < tag.length && isTagNameChar(tag.charCodeAt(index))) index++
	return tag.slice(start, index).toLowerCase()
}

function isClosingTag(tag: string): boolean {
	return tag[0] === '/'
}

function isClosingBlockTag(tag: string, tagName: string): boolean {
	const headingLevel = tagName[1]
	return (
		isClosingTag(tag) &&
		(tagName === 'p' ||
			tagName === 'div' ||
			tagName === 'li' ||
			tagName === 'tr' ||
			(tagName.length === 2 &&
				tagName[0] === 'h' &&
				headingLevel !== undefined &&
				headingLevel >= '1' &&
				headingLevel <= '6'))
	)
}

function isAsciiWhitespace(code: number): boolean {
	return code === 9 || code === 10 || code === 12 || code === 13 || code === 32
}

function isTagNameChar(code: number): boolean {
	return (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122)
}

function isAsciiLetter(code: number): boolean {
	return (code >= 65 && code <= 90) || (code >= 97 && code <= 122)
}

function decodeNamedEntity(body: string): string | undefined {
	if (body.toLowerCase() === 'nbsp') return ' '
	if (body.toLowerCase() === 'amp') return '&'
	if (body.toLowerCase() === 'lt') return '<'
	if (body.toLowerCase() === 'gt') return '>'
	if (body.toLowerCase() === 'quot') return '"'
	if (body.toLowerCase() === 'apos' || body === '#39') return "'"
	return undefined
}

function safeCodePoint(codePoint: number): string {
	if (!Number.isInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff) return ''
	return String.fromCodePoint(codePoint)
}

export function draftRecipientList(draft: MailDraft): string {
	return draft.to?.map((person) => person.email).join(', ') || '(no recipient)'
}

export function draftRecipientName(draft: MailDraft): string {
	const recipient = draft.to?.[0]
	return recipient?.name || recipient?.email || '(no recipient)'
}

export function replyDraftSearch(message: MailMessage): {
	to: string
	subject: string
	replyToMessageId: string
} {
	const to = message.reply_to?.[0]?.email ?? message.from?.[0]?.email ?? ''
	const subject = message.subject?.startsWith('Re:') ? message.subject : `Re: ${message.subject ?? ''}`
	return { to, subject, replyToMessageId: message.id }
}

export function replyAllDraftSearch(
	message: MailMessage,
	mailboxEmail: string,
): {
	to: string
	subject: string
	replyToMessageId: string
} {
	const own = mailboxEmail.trim().toLowerCase()
	const recipients = uniqueEmails([
		...(message.reply_to ?? []),
		...(message.from ?? []),
		...(message.to ?? []),
		...(message.cc ?? []),
	]).filter((email) => email.toLowerCase() !== own)
	const subject = message.subject?.startsWith('Re:') ? message.subject : `Re: ${message.subject ?? ''}`
	return { to: recipients.join(', '), subject, replyToMessageId: message.id }
}

export function forwardDraftSearch(message: MailMessage): {
	to: string
	subject: string
	body: string
} {
	const subject = message.subject?.startsWith('Fwd:') ? message.subject : `Fwd: ${message.subject ?? ''}`
	const from = message.from
		?.map((person) => person.name || person.email)
		.filter(Boolean)
		.join(', ')
	const to = message.to
		?.map((person) => person.name || person.email)
		.filter(Boolean)
		.join(', ')
	const date = message.date ? new Date(message.date * 1000).toLocaleString() : ''
	const body = messageBodyParagraphs(message).join('\n\n')
	return {
		to: '',
		subject,
		body: [
			'',
			'',
			'---------- Forwarded message ---------',
			from ? `From: ${from}` : '',
			date ? `Date: ${date}` : '',
			message.subject ? `Subject: ${message.subject}` : '',
			to ? `To: ${to}` : '',
			'',
			body,
		]
			.filter((line, index) => index < 2 || line)
			.join('\n')
			.slice(0, 4000),
	}
}

function uniqueEmails(participants: NonNullable<MailMessage['to']>): string[] {
	const seen = new Set<string>()
	const emails: string[] = []
	for (const participant of participants) {
		const email = participant.email?.trim()
		if (!email) continue
		const key = email.toLowerCase()
		if (seen.has(key)) continue
		seen.add(key)
		emails.push(email)
	}
	return emails
}

export function threadLabels(thread: MailThread): typeof LABELS {
	const folderIds = new Set(thread.folders ?? [])
	return LABELS.filter((label) => folderIds.has(label.id))
}

export function labelDotClass(labelId: string, fallbackIndex = 0): string {
	const tone = LABELS.find((label) => label.id === labelId)?.tone
	if (tone) return eventColorClass(tone, 'bg')
	const fallbackTone = fallbackIndex % 4
	if (fallbackTone === 1) return eventColorClass('teal', 'bg')
	if (fallbackTone === 2) return eventColorClass('amber', 'bg')
	if (fallbackTone === 3) return eventColorClass('rose', 'bg')
	return eventColorClass('blue', 'bg')
}

export function isMailLabel(folderId: string | undefined): boolean {
	return Boolean(folderId && LABELS.some((label) => label.id === folderId))
}

export function labelBaseFolderId(
	currentFolderId: string | undefined,
	currentBaseFolderId?: string,
): string | undefined {
	if (isMailLabel(currentFolderId)) return currentBaseFolderId ?? 'inbox'
	return currentFolderId
}

export function labelToggleFolderId(
	currentFolderId: string | undefined,
	labelId: string,
	currentBaseFolderId?: string,
): string {
	return currentFolderId === labelId ? (currentBaseFolderId ?? 'inbox') : labelId
}

export function liveSearchTarget(
	value: string,
	currentPathname: string,
	folderId?: string,
	_selectedThreadId?: string,
):
	| { kind: 'search'; q: string; folderId?: string }
	| { kind: 'folder'; folderId: string }
	| { kind: 'thread'; folderId: string; threadId: string }
	| { kind: 'stay' } {
	const q = value.trim()
	if (q) return { kind: 'search', q, ...(folderId ? { folderId } : {}) }
	if (!currentPathname.startsWith('/mail/search')) return { kind: 'stay' }
	return { kind: 'folder', folderId: folderId ?? 'inbox' }
}

export function searchListSearch(q: string, folderId?: string): { q: string; folderId?: string } {
	return { q, ...(folderId ? { folderId } : {}) }
}

export function mailFolderIdFromPath(pathname: string): string | undefined {
	const match = pathname.match(/^\/mail\/f\/([^/]+)/)
	return match?.[1] ? decodeURIComponent(match[1]) : undefined
}

export function activeMailSidebarFolderId(pathname: string, scopedFolderId?: string): string | undefined {
	return mailFolderIdFromPath(pathname) ?? scopedFolderId
}

export function mailSearchInputValue(pathname: string, routeQuery?: string): string {
	return pathname.startsWith('/mail/search') ? (routeQuery ?? '') : ''
}

/**
 * When the composer is closed, prefer a real browser back so the compose
 * history entry is popped instead of pushing another entry (which would let
 * the browser Back button re-open the composer). Only safe when a prior
 * in-app entry exists — otherwise the caller navigates explicitly.
 */
export function shouldUseBrowserBackForComposeClose(historyState: unknown): boolean {
	if (!historyState || typeof historyState !== 'object') return false
	const index = (historyState as { __TSR_index?: unknown }).__TSR_index
	return typeof index === 'number' && index > 0
}

export function composeSearchFromMailLocation(
	pathname: string,
	folderId?: string,
	selectedThreadId?: string,
): { folderId?: string; threadId?: string } {
	const match = pathname.match(/^\/mail\/f\/([^/]+)\/t\/([^/]+)/)
	if (match?.[1] && match[2]) {
		return { folderId: decodeURIComponent(match[1]), threadId: decodeURIComponent(match[2]) }
	}
	return {
		...(folderId ? { folderId } : {}),
		...(selectedThreadId ? { threadId: selectedThreadId } : {}),
	}
}

export function composeBackdropThreadSearch(input: {
	folderId: string
	threadId: string
	draftId?: string
	replyToMessageId?: string
	to?: string
	subject?: string
	body?: string
}): {
	folderId: string
	threadId: string
	draft?: string
	replyToMessageId?: string
	to?: string
	subject?: string
	body?: string
} {
	return {
		folderId: input.folderId,
		threadId: input.threadId,
		...(input.draftId ? { draft: input.draftId } : {}),
		...(input.replyToMessageId ? { replyToMessageId: input.replyToMessageId } : {}),
		...(input.to ? { to: input.to } : {}),
		...(input.subject ? { subject: input.subject } : {}),
		...(input.body ? { body: input.body } : {}),
	}
}

export function composeBackdropReplySearch(input: {
	folderId: string
	threadId: string
	message: MailMessage
}): ReturnType<typeof composeBackdropThreadSearch> {
	return composeBackdropThreadSearch({
		folderId: input.folderId,
		threadId: input.threadId,
		...replyDraftSearch(input.message),
	})
}

export function composeBackdropListSearch(input: {
	folderId: string
	draftId?: string
	replyToMessageId?: string
	to?: string
	subject?: string
	body?: string
}): {
	folderId: string
	draft?: string
	replyToMessageId?: string
	to?: string
	subject?: string
	body?: string
} {
	return {
		folderId: input.folderId,
		...(input.draftId ? { draft: input.draftId } : {}),
		...(input.replyToMessageId ? { replyToMessageId: input.replyToMessageId } : {}),
		...(input.to ? { to: input.to } : {}),
		...(input.subject ? { subject: input.subject } : {}),
		...(input.body ? { body: input.body } : {}),
	}
}

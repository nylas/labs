import type { Calendar, Draft, Event, Folder, Message, Thread } from '@nylas-labs/cli-kit/v3'
import { eventTimes, startOfDay } from './calendar.js'

export type MailFolderId = 'inbox' | 'starred' | 'sent' | 'drafts' | 'archive' | 'trash'
export type EventTone = 'blue' | 'teal' | 'amber' | 'rose'

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

export function cn(...classes: Array<string | false | null | undefined>): string {
	return classes.filter(Boolean).join(' ')
}

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

export function threadSender(thread: Thread, folderId: string): string {
	const participant = thread.participants?.[0]
	if (folderId === 'sent' || folderId === 'drafts') return participant?.name || participant?.email || 'Sent'
	return participant?.name || participant?.email || '(unknown sender)'
}

export function threadTimestamp(thread: Thread): number | undefined {
	const received = thread.latest_message_received_date ?? 0
	const sent = thread.latest_message_sent_date ?? 0
	return Math.max(received, sent) || undefined
}

export function threadRouteFolderId(thread: Thread): MailFolderId {
	return (
		(thread.folders?.find((folder): folder is MailFolderId =>
			MAIL_FOLDERS.some((standard) => standard.id === folder),
		) as MailFolderId | undefined) ?? 'inbox'
	)
}

export function formatListDate(epochSeconds?: number): string {
	if (!epochSeconds) return ''
	const date = new Date(epochSeconds * 1000)
	const now = new Date()
	if (date.toDateString() === now.toDateString()) {
		return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
	}
	const diffDays = Math.floor((startOfDay(now).getTime() - startOfDay(date).getTime()) / 86_400_000)
	if (diffDays > 0 && diffDays < 7) {
		return date.toLocaleDateString(undefined, { weekday: 'short' })
	}
	return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export function initials(nameOrEmail: string): string {
	const source = nameOrEmail.includes('@') ? (nameOrEmail.split('@')[0] ?? nameOrEmail) : nameOrEmail
	return source
		.split(/[.\s_-]+/)
		.map((part) => part[0])
		.filter(Boolean)
		.slice(0, 2)
		.join('')
		.toUpperCase()
}

export function messagePreview(message: Message): string {
	if (message.snippet) return message.snippet
	if (!message.body) return ''
	return plainTextFromHtml(message.body)
}

export function collapsedMessagePreview(message: Message): string {
	return messageBodyParagraphs(message)[0] ?? messagePreview(message)
}

export function messageBodyParagraphs(message: Message): string[] {
	const source = message.body ? plainTextFromHtml(message.body, true) : (message.snippet ?? '')
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

function plainTextFromHtml(html: string, preserveParagraphs = false): string {
	const paragraphBreak = preserveParagraphs ? '\n\n' : ' '
	return decodeHtmlEntities(
		html
			.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
			.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
			.replace(/<br\s*\/?>/gi, '\n')
			.replace(/<\/(p|div|li|tr|h[1-6])>/gi, paragraphBreak)
			.replace(/<[^>]*>/g, ' ')
			.replace(/\u00a0/g, ' ')
			.replace(/[ \t]+/g, ' ')
			.replace(preserveParagraphs ? /\n{3,}/g : /\s+/g, preserveParagraphs ? '\n\n' : ' ')
			.trim(),
	)
}

function decodeHtmlEntities(value: string): string {
	return value
		.replace(/&nbsp;/gi, ' ')
		.replace(/&amp;/gi, '&')
		.replace(/&lt;/gi, '<')
		.replace(/&gt;/gi, '>')
		.replace(/&quot;/gi, '"')
		.replace(/&#39;/gi, "'")
		.replace(/&#(\d+);/g, (_, code: string) => safeCodePoint(Number(code)))
		.replace(/&#x([0-9a-f]+);/gi, (_, code: string) => safeCodePoint(Number.parseInt(code, 16)))
}

function safeCodePoint(codePoint: number): string {
	if (!Number.isInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff) return ''
	return String.fromCodePoint(codePoint)
}

export function draftRecipientList(draft: Draft): string {
	return draft.to?.map((person) => person.email).join(', ') || '(no recipient)'
}

export function draftRecipientName(draft: Draft): string {
	const recipient = draft.to?.[0]
	return recipient?.name || recipient?.email || '(no recipient)'
}

export function replyDraftSearch(message: Message): {
	to: string
	subject: string
	replyToMessageId: string
} {
	const to = message.reply_to?.[0]?.email ?? message.from?.[0]?.email ?? ''
	const subject = message.subject?.startsWith('Re:') ? message.subject : `Re: ${message.subject ?? ''}`
	return { to, subject, replyToMessageId: message.id }
}

export function threadLabels(thread: Thread): typeof LABELS {
	const folderIds = new Set(thread.folders ?? [])
	return LABELS.filter((label) => folderIds.has(label.id))
}

export function labelBadgeClass(tone: EventTone): string {
	if (tone === 'teal') return 'bg-event-teal/10 text-event-teal border-l-[3px] border-event-teal'
	if (tone === 'amber') return 'bg-event-amber/12 text-event-amber border-l-[3px] border-event-amber'
	if (tone === 'rose') return 'bg-event-rose/10 text-event-rose border-l-[3px] border-event-rose'
	return 'bg-event-blue/10 text-event-blue border-l-[3px] border-event-blue'
}

export function labelDotClass(labelId: string, fallbackIndex = 0): string {
	const tone = LABELS.find((label) => label.id === labelId)?.tone
	if (tone === 'teal') return 'bg-event-teal'
	if (tone === 'amber') return 'bg-event-amber'
	if (tone === 'rose') return 'bg-event-rose'
	if (tone === 'blue') return 'bg-event-blue'
	const fallbackTone = fallbackIndex % 4
	if (fallbackTone === 1) return 'bg-event-teal'
	if (fallbackTone === 2) return 'bg-event-amber'
	if (fallbackTone === 3) return 'bg-event-rose'
	return 'bg-event-blue'
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
	selectedThreadId?: string,
):
	| { kind: 'search'; q: string; folderId?: string }
	| { kind: 'folder'; folderId: string }
	| { kind: 'thread'; folderId: string; threadId: string }
	| { kind: 'stay' } {
	const q = value.trim()
	if (q) return { kind: 'search', q, ...(folderId ? { folderId } : {}) }
	if (!currentPathname.startsWith('/mail/search')) return { kind: 'stay' }
	if (selectedThreadId) return { kind: 'thread', folderId: folderId ?? 'inbox', threadId: selectedThreadId }
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
}): {
	folderId: string
	threadId: string
	draft?: string
	replyToMessageId?: string
	to?: string
	subject?: string
} {
	return {
		folderId: input.folderId,
		threadId: input.threadId,
		...(input.draftId ? { draft: input.draftId } : {}),
		...(input.replyToMessageId ? { replyToMessageId: input.replyToMessageId } : {}),
		...(input.to ? { to: input.to } : {}),
		...(input.subject ? { subject: input.subject } : {}),
	}
}

export function composeBackdropListSearch(input: {
	folderId: string
	draftId?: string
	replyToMessageId?: string
	to?: string
	subject?: string
}): {
	folderId: string
	draft?: string
	replyToMessageId?: string
	to?: string
	subject?: string
} {
	return {
		folderId: input.folderId,
		...(input.draftId ? { draft: input.draftId } : {}),
		...(input.replyToMessageId ? { replyToMessageId: input.replyToMessageId } : {}),
		...(input.to ? { to: input.to } : {}),
		...(input.subject ? { subject: input.subject } : {}),
	}
}

const TONE_RGB: Record<EventTone, [number, number, number]> = {
	blue: [37, 99, 235],
	teal: [20, 184, 166],
	amber: [245, 158, 11],
	rose: [244, 63, 94],
}

export function toneFromHex(hex?: string): EventTone | undefined {
	const rgb = parseHexColor(hex)
	if (!rgb) return undefined
	let closest: EventTone = 'blue'
	let closestDistance = Number.POSITIVE_INFINITY
	for (const tone of Object.keys(TONE_RGB) as EventTone[]) {
		const color = TONE_RGB[tone]
		const distance = (rgb[0] - color[0]) ** 2 + (rgb[1] - color[1]) ** 2 + (rgb[2] - color[2]) ** 2
		if (distance < closestDistance) {
			closest = tone
			closestDistance = distance
		}
	}
	return closest
}

export function calendarTone(calendar: Pick<Calendar, 'id' | 'name' | 'hex_color'>, index = 0): EventTone {
	return (
		toneFromHex(calendar.hex_color) ??
		namedCalendarTone(`${calendar.name ?? ''} ${calendar.id ?? ''}`) ??
		fallbackTone(index)
	)
}

export function eventTone(
	event: Event,
	index = 0,
	calendar?: Pick<Calendar, 'id' | 'name' | 'hex_color'>,
): EventTone {
	const titleTone = eventTitleTone(event.title ?? '')
	if (titleTone) return titleTone
	if (calendar) return calendarTone(calendar, index)
	const calendarIdTone = namedCalendarTone(event.calendar_id ?? '')
	if (calendarIdTone) return calendarIdTone
	const contextualTone = eventTitleContextTone(event.title ?? '')
	if (contextualTone) return contextualTone
	return fallbackTone(index)
}

function parseHexColor(hex?: string): [number, number, number] | undefined {
	const value = hex?.trim().replace(/^#/, '')
	if (!value) return undefined
	const normalized =
		value.length === 3
			? value
					.split('')
					.map((char) => `${char}${char}`)
					.join('')
			: value
	if (!/^[0-9a-fA-F]{6}$/.test(normalized)) return undefined
	return [
		Number.parseInt(normalized.slice(0, 2), 16),
		Number.parseInt(normalized.slice(2, 4), 16),
		Number.parseInt(normalized.slice(4, 6), 16),
	]
}

function namedCalendarTone(value: string): EventTone | undefined {
	const normalized = value.toLowerCase()
	if (/work/.test(normalized)) return 'blue'
	if (/focus/.test(normalized)) return 'amber'
	if (/social/.test(normalized)) return 'rose'
	if (/personal|primary/.test(normalized)) return 'teal'
	return undefined
}

function eventTitleTone(title: string): EventTone | undefined {
	const normalized = title.toLowerCase()
	if (/flight|dinner|coffee|lunch/.test(normalized)) return 'rose'
	if (/dentist|home|gym|hike|dipsea/.test(normalized)) return 'teal'
	if (/pay rent|rent|focus|writing|sprint|prs|deep/.test(normalized)) return 'amber'
	return undefined
}

function eventTitleContextTone(title: string): EventTone | undefined {
	const normalized = title.toLowerCase()
	if (/roadmap|manager|standup|design system|planning|team|work/.test(normalized)) return 'blue'
	if (/travel|social/.test(normalized)) return 'rose'
	return undefined
}

function fallbackTone(index: number): EventTone {
	return (['blue', 'teal', 'amber', 'rose'] as const)[index % 4] ?? 'blue'
}

export function eventHour(event: Event): { startHour: number; endHour: number; allDay: boolean } {
	const times = eventTimes(event)
	return {
		startHour: times.start.getHours() + times.start.getMinutes() / 60,
		endHour: times.end.getHours() + times.end.getMinutes() / 60,
		allDay: times.allDay,
	}
}

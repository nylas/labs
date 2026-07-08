import type { Draft, Event, Folder, Message, Thread } from '@nylas-labs/cli-kit/v3'
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

export function eventTone(event: Event, index = 0): EventTone {
	const title = `${event.title ?? ''} ${event.calendar_id ?? ''}`.toLowerCase()
	if (/social|travel|flight|dinner|coffee|lunch/.test(title)) return 'rose'
	if (/personal|dentist|home|gym|hike|dipsea/.test(title)) return 'teal'
	if (/focus|writing|sprint|prs|pay rent|deep/.test(title)) return 'amber'
	if (/work|roadmap|manager|standup|design system|planning|team/.test(title)) return 'blue'
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

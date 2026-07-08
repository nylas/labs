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

export function totalUnread(folders: Folder[]): number {
	return folders.reduce((sum, folder) => sum + (folder.unread_count ?? 0), 0)
}

export function threadSender(thread: Thread, folderId: string): string {
	const participant = thread.participants?.[0]
	if (folderId === 'sent' || folderId === 'drafts') return participant?.email ?? 'Sent'
	return participant?.name || participant?.email || '(unknown sender)'
}

export function threadTimestamp(thread: Thread): number | undefined {
	return thread.latest_message_received_date ?? thread.latest_message_sent_date
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
	return message.body
		.replace(/<[^>]*>/g, ' ')
		.replace(/\s+/g, ' ')
		.trim()
}

export function draftRecipientList(draft: Draft): string {
	return draft.to?.map((person) => person.email).join(', ') || '(no recipient)'
}

export function eventTone(event: Event, index = 0): EventTone {
	const title = `${event.title ?? ''} ${event.calendar_id ?? ''}`.toLowerCase()
	if (/focus|write|review|deep/.test(title)) return 'amber'
	if (/personal|dentist|home|gym/.test(title)) return 'teal'
	if (/travel|flight|dinner|coffee|lunch|social/.test(title)) return 'rose'
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

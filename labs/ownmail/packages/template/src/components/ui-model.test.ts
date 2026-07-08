import type { Calendar, Event, Folder, Message, Thread } from '@nylas-labs/cli-kit/v3'
import { describe, expect, it, vi } from 'vitest'
import { fmtCompactTime, fmtTime, formatFullDate } from './calendar.js'
import {
	calendarTone,
	collapsedMessagePreview,
	draftRecipientList,
	draftRecipientName,
	eventHour,
	eventTone,
	folderCount,
	formatListDate,
	initials,
	labelDotClass,
	labelToggleFolderId,
	liveSearchTarget,
	mailFolderTitle,
	messageBodyParagraphs,
	messagePreview,
	replyDraftSearch,
	sidebarFolderCount,
	threadLabels,
	threadRouteFolderId,
	threadSender,
	threadTimestamp,
	toneFromHex,
	totalUnread,
} from './ui-model.js'

describe('ui-model mail helpers', () => {
	it('summarizes folder unread counts for the reference sidebar', () => {
		const folders = [
			{ id: 'inbox', unread_count: 3 },
			{ id: 'sent', unread_count: 0 },
			{ id: 'trash', unread_count: 2 },
		] as Folder[]

		expect(folderCount(folders, 'inbox')).toBe(3)
		expect(folderCount(folders, 'archive')).toBe(0)
		expect(totalUnread(folders)).toBe(5)
	})

	it('uses reference sidebar count semantics for starred and drafts', () => {
		const folders = [
			{ id: 'inbox', unread_count: 2, total_count: 8 },
			{ id: 'starred', unread_count: 1, total_count: 2 },
			{ id: 'drafts', unread_count: 0, total_count: 1 },
		] as Folder[]

		expect(sidebarFolderCount(folders, 'inbox')).toBe(2)
		expect(sidebarFolderCount(folders, 'starred')).toBe(2)
		expect(sidebarFolderCount(folders, 'drafts')).toBe(1)
	})

	it('formats API folder titles for list headers', () => {
		expect(mailFolderTitle('inbox')).toBe('Inbox')
		expect(mailFolderTitle('work')).toBe('Filtered')
		expect(
			mailFolderTitle('client_projects', [{ id: 'client_projects', name: 'Client Projects' }] as Folder[]),
		).toBe('Filtered')
		expect(mailFolderTitle('shared-team')).toBe('Shared Team')
	})

	it('chooses sender text based on the active folder', () => {
		const thread = {
			participants: [{ name: 'Grace Hopper', email: 'grace@example.com' }],
		} as Thread

		expect(threadSender(thread, 'inbox')).toBe('Grace Hopper')
		expect(threadSender(thread, 'sent')).toBe('Grace Hopper')
	})

	it('chooses the latest thread timestamp across sent and received dates', () => {
		const thread = {
			latest_message_received_date: 100,
			latest_message_sent_date: 200,
		} as Thread

		expect(threadTimestamp(thread)).toBe(200)
	})

	it('routes search rows through real mail folders, not label folders', () => {
		expect(threadRouteFolderId({ folders: ['work', 'archive'] } as Thread)).toBe('archive')
		expect(threadRouteFolderId({ folders: ['personal', 'travel'] } as Thread)).toBe('inbox')
		expect(threadRouteFolderId({ folders: ['sent'] } as Thread)).toBe('sent')
	})

	it('formats initials and strips html previews', () => {
		expect(initials('Ada Lovelace')).toBe('AL')
		expect(initials('ada.lovelace@example.com')).toBe('AL')
		expect(messagePreview({ body: '<p>Hello <strong>there</strong></p>' } as Message)).toBe('Hello there')
	})

	it('uses the first body paragraph for collapsed message previews', () => {
		const message = {
			snippet: 'Long provider snippet',
			body: '<p>Hi Ada,</p><p>Longer message body.</p>',
		} as Message

		expect(collapsedMessagePreview(message)).toBe('Hi Ada,')
		expect(collapsedMessagePreview({ snippet: 'Snippet fallback' } as Message)).toBe('Snippet fallback')
	})

	it('projects html message bodies into safe plain-text paragraphs', () => {
		const message = {
			body: '<p>Hello &amp; welcome,</p><p>Line one<br>Line two</p><script>alert(1)</script>',
		} as Message

		expect(messageBodyParagraphs(message)).toEqual(['Hello & welcome,', 'Line one Line two'])
	})

	it('formats relative list dates like the reference thread list', () => {
		vi.useFakeTimers()
		vi.setSystemTime(new Date('2026-07-08T12:00:00Z'))

		expect(formatListDate(Date.parse('2026-07-08T08:30:00Z') / 1000)).toMatch(/8:30|4:30/)
		expect(formatListDate(Date.parse('2026-07-07T08:30:00Z') / 1000)).toMatch(/Tue|Jul/)
		expect(formatListDate(Date.parse('2026-06-20T08:30:00Z') / 1000)).toBe('Jun 20')

		vi.useRealTimers()
	})

	it('formats draft recipients safely', () => {
		expect(
			draftRecipientList({ to: [{ email: 'a@example.com' }, { email: 'b@example.com' }] } as never),
		).toBe('a@example.com, b@example.com')
		expect(draftRecipientList({} as never)).toBe('(no recipient)')
		expect(draftRecipientName({ to: [{ name: 'Grace Hopper', email: 'grace@example.com' }] } as never)).toBe(
			'Grace Hopper',
		)
		expect(draftRecipientName({ to: [{ email: 'grace@example.com' }] } as never)).toBe('grace@example.com')
	})

	it('builds reference compose defaults for replies', () => {
		expect(
			replyDraftSearch({
				id: 'msg-1',
				subject: 'Q3 roadmap',
				from: [{ email: 'grace@example.com' }],
			} as Message),
		).toEqual({
			to: 'grace@example.com',
			subject: 'Re: Q3 roadmap',
			replyToMessageId: 'msg-1',
		})
		expect(
			replyDraftSearch({
				id: 'msg-2',
				subject: 'Re: Q3 roadmap',
				reply_to: [{ email: 'team@example.com' }],
				from: [{ email: 'grace@example.com' }],
			} as Message),
		).toMatchObject({ to: 'team@example.com', subject: 'Re: Q3 roadmap' })
	})

	it('maps Nylas folder labels to reference row badges', () => {
		const thread = { folders: ['inbox', 'work', 'travel'] } as Thread

		expect(threadLabels(thread).map((label) => label.name)).toEqual(['Work', 'Travel'])
	})

	it('keeps reference label dot colors stable by label id', () => {
		expect(labelDotClass('work', 3)).toBe('bg-event-blue')
		expect(labelDotClass('personal', 0)).toBe('bg-event-teal')
		expect(labelDotClass('finance', 1)).toBe('bg-event-amber')
		expect(labelDotClass('travel', 2)).toBe('bg-event-rose')
		expect(labelDotClass('custom', 2)).toBe('bg-event-amber')
	})

	it('toggles an active label back to the reference default inbox view', () => {
		expect(labelToggleFolderId('work', 'work')).toBe('inbox')
		expect(labelToggleFolderId('inbox', 'work')).toBe('work')
		expect(labelToggleFolderId(undefined, 'work')).toBe('work')
	})

	it('routes live search changes like the reference search box', () => {
		expect(liveSearchTarget(' hiking ', '/mail/f/inbox')).toEqual({ kind: 'search', q: 'hiking' })
		expect(liveSearchTarget('', '/mail/search')).toEqual({ kind: 'inbox' })
		expect(liveSearchTarget('', '/mail/f/inbox')).toEqual({ kind: 'stay' })
	})
})

describe('ui-model calendar helpers', () => {
	it('formats reference-style calendar dialog dates and times', () => {
		const date = new Date('2026-07-08T10:30:00')

		expect(formatFullDate(date)).toBe('Wednesday, July 8')
		expect(formatFullDate(date, true)).toBe('Wednesday, July 8, 2026')
		expect(fmtTime(new Date('2026-07-08T08:00:00'))).toBe('8 AM')
		expect(fmtCompactTime(date)).toBe('10:30 AM')
		expect(fmtCompactTime(new Date('2026-07-08T11:00:00'))).toBe('11 AM')
	})

	it('assigns stable event tones from event context', () => {
		expect(eventTone({ title: 'Morning focus block' } as Event)).toBe('amber')
		expect(eventTone({ title: 'Dentist' } as Event)).toBe('teal')
		expect(eventTone({ title: 'Flight to Lisbon' } as Event)).toBe('rose')
		expect(eventTone({ title: 'Roadmap review with Grace', calendar_id: 'work' } as Event)).toBe('blue')
		expect(eventTone({ title: 'Review PRs', calendar_id: 'focus' } as Event)).toBe('amber')
		expect(eventTone({ title: 'Pay rent' } as Event)).toBe('amber')
		expect(eventTone({ title: 'Dipsea trail hike', calendar_id: 'social' } as Event)).toBe('teal')
	})

	it('maps real Nylas calendar colors onto the reference event palette', () => {
		expect(toneFromHex('#2563eb')).toBe('blue')
		expect(toneFromHex('#14b8a6')).toBe('teal')
		expect(toneFromHex('#f59e0b')).toBe('amber')
		expect(toneFromHex('#f43f5e')).toBe('rose')
		expect(calendarTone({ id: 'primary', name: 'Personal', hex_color: '#14b8a6' } as Calendar)).toBe('teal')
		expect(calendarTone({ id: 'social', name: 'Social' } as Calendar)).toBe('rose')
		expect(
			eventTone({ title: 'Design system sync', calendar_id: 'custom-work-calendar' } as Event, 0, {
				id: 'custom-work-calendar',
				name: 'Team',
				hex_color: '#2563eb',
			} as Calendar),
		).toBe('blue')
	})

	it('converts Nylas event times to decimal hours', () => {
		const event = {
			when: {
				start_time: Date.parse('2026-07-08T09:30:00Z') / 1000,
				end_time: Date.parse('2026-07-08T11:00:00Z') / 1000,
			},
		} as Event

		const hours = eventHour(event)
		expect(hours.startHour % 1).toBe(0.5)
		expect(hours.endHour - hours.startHour).toBe(1.5)
		expect(hours.allDay).toBe(false)
	})
})

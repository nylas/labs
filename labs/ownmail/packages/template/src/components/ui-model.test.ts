import type { Event, Folder, Message, Thread } from '@nylas-labs/cli-kit/v3'
import { describe, expect, it, vi } from 'vitest'
import {
	draftRecipientList,
	eventHour,
	eventTone,
	folderCount,
	formatListDate,
	initials,
	messagePreview,
	threadSender,
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

	it('chooses sender text based on the active folder', () => {
		const thread = {
			participants: [{ name: 'Grace Hopper', email: 'grace@example.com' }],
		} as Thread

		expect(threadSender(thread, 'inbox')).toBe('Grace Hopper')
		expect(threadSender(thread, 'sent')).toBe('grace@example.com')
	})

	it('formats initials and strips html previews', () => {
		expect(initials('Ada Lovelace')).toBe('AL')
		expect(initials('ada.lovelace@example.com')).toBe('AL')
		expect(messagePreview({ body: '<p>Hello <strong>there</strong></p>' } as Message)).toBe('Hello there')
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
	})
})

describe('ui-model calendar helpers', () => {
	it('assigns stable event tones from event context', () => {
		expect(eventTone({ title: 'Morning focus block' } as Event)).toBe('amber')
		expect(eventTone({ title: 'Dentist' } as Event)).toBe('teal')
		expect(eventTone({ title: 'Flight to Lisbon' } as Event)).toBe('rose')
		expect(eventTone({ title: 'Roadmap review' } as Event)).toBe('amber')
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

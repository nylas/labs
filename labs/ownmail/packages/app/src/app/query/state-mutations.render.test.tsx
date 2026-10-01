// @vitest-environment jsdom
import type { Contact, Event } from '@nylas-labs/cli-kit/v3'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({
	createContact: vi.fn(),
	createEvent: vi.fn(),
	deleteContact: vi.fn(),
	deleteDraft: vi.fn(),
	deleteEvent: vi.fn(),
	getContacts: vi.fn(),
	markThreadRead: vi.fn(),
	rsvpEvent: vi.fn(),
	saveDraft: vi.fn(),
	sendDraft: vi.fn(),
	updateContact: vi.fn(),
	updateEvent: vi.fn(),
	updateThreadState: vi.fn(),
}))

vi.mock('#features/calendar/server/calendar-fns', () => ({
	createEvent: api.createEvent,
	deleteEvent: api.deleteEvent,
	getEvents: vi.fn(),
	rsvpEvent: api.rsvpEvent,
	updateEvent: api.updateEvent,
}))
vi.mock('#server/fns', () => ({
	createContact: api.createContact,
	deleteContact: api.deleteContact,
	deleteDraft: api.deleteDraft,
	getContact: vi.fn(),
	getContacts: api.getContacts,
	getMailboxInfo: vi.fn(),
	markThreadRead: api.markThreadRead,
	saveDraft: api.saveDraft,
	sendDraft: api.sendDraft,
	updateContact: api.updateContact,
	updateThreadState: api.updateThreadState,
}))

import { resetAccountScope, setAccountScope } from '#app/lib/account-scope'
import {
	type CalendarRouteData,
	calendarKeys,
	calendarStateTestApi,
	resetCalendarConfirmedEffects,
	useCreateEventMutation,
	useDeleteEventMutation,
	useRescheduleEventMutation,
	useRsvpEventMutation,
	useUpdateEventMutation,
} from '#features/calendar/state/calendar-state'
import {
	type ContactsPages,
	contactsKeys,
	useContactsPages,
	useCreateContactMutation,
	useDeleteContactMutation,
	useUpdateContactMutation,
} from '#features/contacts/state/contacts-state'
import {
	markThreadReadOnOpen,
	openThreadDetail,
	useDeleteDraftMutation,
	useSaveDraftMutation,
	useSendDraftMutation,
	useUpdateThreadMutation,
} from '#features/mail/state/mail-mutations'
import {
	type MailDraft,
	type MailFolder,
	type MailThreadListData,
	mailKeys,
} from '#features/mail/state/mail-queries'

let client: QueryClient
const wrapper = ({ children }: { children: ReactNode }) => (
	<QueryClientProvider client={client}>{children}</QueryClientProvider>
)
const event = {
	id: 'event-1',
	calendar_id: 'calendar-1',
	title: 'Planning',
	when: { object: 'timespan', start_time: 100, end_time: 200 },
	participants: [{ email: 'one@example.com' }, { email: 'two@example.com' }],
} as Event
const calendarData = { events: [event] } as CalendarRouteData
const contact = { id: 'contact-1', given_name: 'Ada' } as Contact
const contactPages = { pages: [{ contacts: [contact] }], pageParams: [undefined] } as ContactsPages
const draft = { id: 'draft-1', subject: 'Draft' } as MailDraft
const folders = [{ id: 'drafts', total_count: 1 }] as MailFolder[]

beforeEach(() => {
	vi.clearAllMocks()
	client = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
	client.setQueryData(calendarKeys.range(0, 1000), calendarData)
	client.setQueryData(contactsKeys.list(), contactPages)
	client.setQueryData(contactsKeys.detail(contact.id), contact)
	client.setQueryData(mailKeys.drafts(), [draft])
	client.setQueryData(mailKeys.folders(), folders)
	client.setQueryData<MailThreadListData>(mailKeys.threadList({ folderId: 'inbox' }), {
		pages: [{ threads: [{ id: 'thread-1', folders: ['inbox'], unread: true }] }],
		pageParams: [undefined],
	})
})

afterEach(cleanup)

describe('calendar mutation hooks', () => {
	it('reconciles create/update/delete/rsvp fallback receipts', async () => {
		api.createEvent.mockResolvedValue({ eventId: 'event-2' })
		api.updateEvent.mockResolvedValue({ eventId: event.id })
		api.deleteEvent.mockResolvedValue({ removedEventId: event.id })
		api.rsvpEvent.mockResolvedValue({ eventId: event.id, status: 'yes' })
		const create = renderHook(() => useCreateEventMutation(), { wrapper }).result
		await act(() => create.current.mutateAsync({ title: 'Created', startTime: 300, endTime: 400 }))
		expect(client.getQueryData<CalendarRouteData>(calendarKeys.range(0, 1000))?.events).toContainEqual(
			expect.objectContaining({ id: 'event-2', title: 'Created' }),
		)

		const update = renderHook(() => useUpdateEventMutation(event), { wrapper }).result
		await act(() =>
			update.current.mutateAsync({
				eventId: event.id,
				title: 'Updated',
				location: 'HQ',
				description: 'Notes',
			}),
		)
		expect(client.getQueryData<CalendarRouteData>(calendarKeys.range(0, 1000))?.events[0]).toMatchObject({
			title: 'Updated',
			location: 'HQ',
			description: 'Notes',
		})

		const rsvpStatuses = () =>
			client
				.getQueryData<CalendarRouteData>(calendarKeys.range(0, 1000))
				?.events[0]?.participants?.map((participant) => participant.status)
		const rsvp = renderHook(() => useRsvpEventMutation(event.id), { wrapper }).result
		// Before the mailbox is known nobody's answer is guessed.
		await act(() => rsvp.current.mutateAsync({ eventId: event.id, status: 'yes' }))
		expect(rsvpStatuses()).toEqual([undefined, undefined])
		// The signed-in user is the second guest: only their entry takes the answer.
		client.setQueryData(['account', 'mailbox-info'], { email: 'Two@example.com' })
		await act(() => rsvp.current.mutateAsync({ eventId: event.id, status: 'yes' }))
		expect(rsvpStatuses()).toEqual([undefined, 'yes'])
		// A rejected RSVP restores the previous answer.
		api.rsvpEvent.mockRejectedValueOnce(new Error('offline'))
		await act(() => rsvp.current.mutateAsync({ eventId: event.id, status: 'no' }).catch(() => undefined))
		expect(rsvpStatuses()).toEqual([undefined, 'yes'])

		const remove = renderHook(() => useDeleteEventMutation(event.id), { wrapper }).result
		await act(() => remove.current.mutateAsync({ eventId: event.id }))
		expect(client.getQueryData<CalendarRouteData>(calendarKeys.range(0, 1000))?.events).not.toContainEqual(
			event,
		)
	})

	it('uses canonical event receipts and rolls back a failed optimistic update', async () => {
		const canonical = { ...event, title: 'Canonical' }
		api.createEvent.mockResolvedValue({ eventId: canonical.id, event: canonical })
		const create = renderHook(() => useCreateEventMutation(), { wrapper }).result
		await act(() =>
			create.current.mutateAsync({
				title: 'Local',
				startTime: 300,
				endTime: 400,
			}),
		)
		expect(client.getQueryData<CalendarRouteData>(calendarKeys.range(0, 1000))?.events).toContainEqual(
			canonical,
		)
		api.updateEvent.mockResolvedValue({
			eventId: event.id,
			event: { ...canonical, location: 'Canonical HQ' },
		})
		const canonicalUpdate = renderHook(() => useUpdateEventMutation(canonical), { wrapper }).result
		await act(() =>
			canonicalUpdate.current.mutateAsync({
				eventId: event.id,
				location: 'Local HQ',
				startTime: 500,
				endTime: 600,
			}),
		)
		expect(client.getQueryData<CalendarRouteData>(calendarKeys.range(0, 1000))?.events[0]?.location).toBe(
			'Canonical HQ',
		)

		api.updateEvent.mockRejectedValue(new Error('offline'))
		const update = renderHook(() => useUpdateEventMutation(event), { wrapper }).result
		await expect(
			act(() => update.current.mutateAsync({ eventId: event.id, title: 'Should roll back' })),
		).rejects.toThrow('offline')
		expect(client.getQueryData<CalendarRouteData>(calendarKeys.range(0, 1000))?.events).toContainEqual({
			...canonical,
			location: 'Canonical HQ',
		})
	})

	const cachedEvent = () => client.getQueryData<CalendarRouteData>(calendarKeys.range(0, 1000))?.events[0]

	it('moves a dragged event at once, sends only its new times, and keeps the provider copy', async () => {
		let confirm: (value: unknown) => void = () => {}
		api.updateEvent.mockReturnValueOnce(
			new Promise((resolve) => {
				confirm = resolve
			}),
		)
		const reschedule = renderHook(() => useRescheduleEventMutation(), { wrapper }).result
		let saved: Promise<unknown> = Promise.resolve()
		act(() => {
			saved = reschedule.current.mutateAsync({ event, startTime: 300, endTime: 400 })
		})
		// The grid shows the new times before the provider answers.
		await waitFor(() => expect(cachedEvent()?.when).toMatchObject({ start_time: 300, end_time: 400 }))
		// A drag changes times only: title, guests and notes are never resent.
		expect(api.updateEvent).toHaveBeenCalledExactlyOnceWith({
			data: { eventId: event.id, calendarId: 'calendar-1', startTime: 300, endTime: 400 },
		})
		const canonical = { ...event, title: 'Canonical', when: { start_time: 300, end_time: 400 } }
		await act(async () => {
			confirm({ event: canonical })
			await saved
		})
		expect(cachedEvent()).toEqual(canonical)
	})

	it('keeps the dropped times when the provider confirms without returning the event', async () => {
		api.updateEvent.mockResolvedValue({ eventId: event.id })
		const reschedule = renderHook(() => useRescheduleEventMutation(), { wrapper }).result
		// An event with no calendar of its own is sent without one; the server uses the primary.
		const loose = { ...event, calendar_id: '' } as Event
		await act(() => reschedule.current.mutateAsync({ event: loose, startTime: 500, endTime: 700 }))
		expect(api.updateEvent).toHaveBeenCalledExactlyOnceWith({
			data: { eventId: event.id, startTime: 500, endTime: 700 },
		})
		expect(cachedEvent()?.when).toMatchObject({ start_time: 500, end_time: 700 })

		// An event that is no longer cached is still confirmed from the copy that was dragged.
		client.setQueryData(calendarKeys.range(0, 1000), { events: [] } as unknown as CalendarRouteData)
		await act(() => reschedule.current.mutateAsync({ event, startTime: 600, endTime: 800 }))
		expect(cachedEvent()?.when).toMatchObject({ start_time: 600, end_time: 800 })
	})

	it('puts a dragged event back where it was when the provider refuses the move', async () => {
		api.updateEvent.mockRejectedValue(new Error('offline'))
		const reschedule = renderHook(() => useRescheduleEventMutation(), { wrapper }).result
		await expect(
			act(() => reschedule.current.mutateAsync({ event, startTime: 300, endTime: 400 })),
		).rejects.toThrow('offline')
		expect(cachedEvent()).toEqual(event)
	})

	it('shows a second drag of the same event at once, and restores the first if the second is refused', async () => {
		// What a view draws: the cached range with remembered receipts replayed over it.
		const drawn = () => {
			const data = client.getQueryData<CalendarRouteData>(calendarKeys.range(0, 1000)) as CalendarRouteData
			return calendarStateTestApi.reconcileCalendarData(client, data, { start: 0, end: 1000 }).events[0]?.when
		}
		api.updateEvent.mockResolvedValueOnce({ eventId: event.id })
		const reschedule = renderHook(() => useRescheduleEventMutation(), { wrapper }).result
		await act(() => reschedule.current.mutateAsync({ event, startTime: 300, endTime: 400 }))
		expect(drawn()).toMatchObject({ start_time: 300, end_time: 400 })

		// Dragged again before the provider answers: the first receipt must not draw it back at 300.
		let refuse: (reason: unknown) => void = () => {}
		api.updateEvent.mockReturnValueOnce(
			new Promise((_resolve, reject) => {
				refuse = reject
			}),
		)
		const moved = { ...event, when: { object: 'timespan', start_time: 300, end_time: 400 } } as Event
		let saved: Promise<unknown> = Promise.resolve()
		act(() => {
			saved = reschedule.current.mutateAsync({ event: moved, startTime: 500, endTime: 600 }).catch(() => {})
		})
		await waitFor(() => expect(drawn()).toMatchObject({ start_time: 500, end_time: 600 }))

		// Refused: the event returns to its last confirmed times, still guarded by that receipt.
		await act(async () => {
			refuse(new Error('offline'))
			await saved
		})
		expect(drawn()).toMatchObject({ start_time: 300, end_time: 400 })
		client.setQueryData(calendarKeys.range(0, 1000), calendarData)
		expect(drawn()).toMatchObject({ start_time: 300, end_time: 400 })
	})

	it('shows a second edit of the same event at once, like a second drag', async () => {
		const drawnTitle = () => {
			const data = client.getQueryData<CalendarRouteData>(calendarKeys.range(0, 1000)) as CalendarRouteData
			return calendarStateTestApi.reconcileCalendarData(client, data, { start: 0, end: 1000 }).events[0]
				?.title
		}
		api.updateEvent.mockResolvedValueOnce({ eventId: event.id })
		const update = renderHook(() => useUpdateEventMutation(event), { wrapper }).result
		await act(() => update.current.mutateAsync({ eventId: event.id, title: 'First edit' }))
		expect(drawnTitle()).toBe('First edit')

		// Edited again before the provider answers: the first receipt must not draw the old title back.
		let refuse: (reason: unknown) => void = () => {}
		api.updateEvent.mockReturnValueOnce(
			new Promise((_resolve, reject) => {
				refuse = reject
			}),
		)
		let saved: Promise<unknown> = Promise.resolve()
		act(() => {
			saved = update.current.mutateAsync({ eventId: event.id, title: 'Second edit' }).catch(() => {})
		})
		await waitFor(() => expect(drawnTitle()).toBe('Second edit'))
		await act(async () => {
			refuse(new Error('offline'))
			await saved
		})
		// Refused: back to the last confirmed title, still guarded by its receipt.
		expect(drawnTitle()).toBe('First edit')
	})

	it('keeps another inbox receipts when an event is changed here', async () => {
		api.updateEvent.mockResolvedValue({ eventId: event.id })
		const reschedule = renderHook(() => useRescheduleEventMutation(), { wrapper }).result
		// The same event id confirmed in another inbox a moment ago.
		setAccountScope('other@example.com')
		calendarStateTestApi.rememberConfirmedCalendarEffect(client, {
			type: 'updated',
			event: { ...event, title: 'Other inbox' } as Event,
		})
		resetAccountScope()
		await act(() => reschedule.current.mutateAsync({ event, startTime: 300, endTime: 400 }))
		setAccountScope('other@example.com')
		expect(
			calendarStateTestApi.reconcileCalendarData(client, { events: [event] }, { start: 0, end: 1000 })
				.events[0]?.title,
		).toBe('Other inbox')
		resetAccountScope()
	})

	it('draws a confirmed second drag from its own receipt, not the one before it', async () => {
		api.updateEvent.mockResolvedValue({ eventId: event.id })
		const reschedule = renderHook(() => useRescheduleEventMutation(), { wrapper }).result
		await act(() => reschedule.current.mutateAsync({ event, startTime: 300, endTime: 400 }))
		await act(() => reschedule.current.mutateAsync({ event, startTime: 500, endTime: 600 }))
		// A stale provider read arriving now is corrected to the latest confirmed times only.
		client.setQueryData(calendarKeys.range(0, 1000), calendarData)
		const data = client.getQueryData<CalendarRouteData>(calendarKeys.range(0, 1000)) as CalendarRouteData
		expect(
			calendarStateTestApi.reconcileCalendarData(client, data, { start: 0, end: 1000 }).events[0]?.when,
		).toMatchObject({ start_time: 500, end_time: 600 })
	})

	describe('overlapping changes to one event', () => {
		type Deferred = { resolve: (value: unknown) => void; reject: (reason: unknown) => void }
		type Sent = Deferred & { data: { eventId: string; startTime?: number; title?: string } }
		/** Each request that reaches the provider is recorded and held until the test settles it. */
		function holdUpdates(): Sent[] {
			const sent: Sent[] = []
			api.updateEvent.mockImplementation(
				({ data }: { data: Sent['data'] }) =>
					new Promise((resolve, reject) => {
						sent.push({ data, resolve, reject })
					}),
			)
			return sent
		}
		const drawn = () => {
			const data = client.getQueryData<CalendarRouteData>(calendarKeys.range(0, 1000)) as CalendarRouteData
			return calendarStateTestApi.reconcileCalendarData(client, data, { start: 0, end: 1000 }).events[0]
		}
		/** A stale provider read lands: what is drawn must still be the last confirmed state. */
		const afterStaleRead = () => {
			client.setQueryData(calendarKeys.range(0, 1000), calendarData)
			return drawn()
		}
		const at = (start: number) =>
			({ ...event, when: { object: 'timespan', start_time: start, end_time: start + 100 } }) as Event
		const flush = () => act(async () => {})

		/** Drags the same event to each start in turn, without waiting for any request to settle. */
		async function drag(...starts: number[]) {
			const sent = holdUpdates()
			const reschedule = renderHook(() => useRescheduleEventMutation(), { wrapper }).result
			const settled: Promise<unknown>[] = []
			let from = event
			for (const start of starts) {
				const dragged = from
				act(() => {
					settled.push(
						reschedule.current
							.mutateAsync({ event: dragged, startTime: start, endTime: start + 100 })
							.catch(() => {}),
					)
				})
				await flush()
				// The grid follows the latest intent at once, sent or not.
				expect(drawn()?.when).toMatchObject({ start_time: start })
				from = at(start)
			}
			const settle = async (index: number, outcome: 'resolve' | 'reject', value: unknown) => {
				await act(async () => {
					;(sent[index] as Sent)[outcome](value)
				})
				await flush()
			}
			return { sent, settle, settled }
		}

		it('does not send the second change until the first settles, so the provider ends at the second position', async () => {
			const { sent, settle } = await drag(300, 500)
			// Two requests racing could be applied by the provider in either order.
			expect(sent.map((request) => request.data.startTime)).toEqual([300])
			await settle(0, 'resolve', { event: at(300) })
			// The first answer does not draw the event back while the second is on its way.
			expect(drawn()?.when).toMatchObject({ start_time: 500 })
			expect(sent.map((request) => request.data.startTime)).toEqual([300, 500])
			await settle(1, 'resolve', { event: at(500) })
			expect(drawn()?.when).toMatchObject({ start_time: 500 })
			expect(afterStaleRead()?.when).toMatchObject({ start_time: 500 })
		})

		it('sends only the first and the last of three rapid changes', async () => {
			const { sent, settle, settled } = await drag(300, 500, 700)
			expect(sent).toHaveLength(1)
			await settle(0, 'resolve', { event: at(300) })
			// The change in the middle was replaced before its turn and never reaches the provider.
			expect(sent.map((request) => request.data.startTime)).toEqual([300, 700])
			await settle(1, 'resolve', { event: at(700) })
			await Promise.all(settled)
			expect(api.updateEvent).toHaveBeenCalledTimes(2)
			expect(afterStaleRead()?.when).toMatchObject({ start_time: 700 })
		})

		it('still sends and confirms the second change when the first fails, without undoing it', async () => {
			const { sent, settle } = await drag(300, 500)
			await settle(0, 'reject', new Error('offline'))
			expect(drawn()?.when).toMatchObject({ start_time: 500 })
			expect(sent.map((request) => request.data.startTime)).toEqual([300, 500])
			await settle(1, 'resolve', { event: at(500) })
			expect(afterStaleRead()?.when).toMatchObject({ start_time: 500 })
		})

		it('rolls a failed final change back to the last position the provider confirmed', async () => {
			const { settle } = await drag(300, 500)
			await settle(0, 'resolve', { event: { ...at(300), title: 'Canonical' } })
			await settle(1, 'reject', new Error('offline'))
			expect(drawn()).toMatchObject({ title: 'Canonical', when: { start_time: 300 } })
			// That confirmation still guards against a stale read.
			expect(afterStaleRead()?.when).toMatchObject({ start_time: 300 })
		})

		it('rolls back to a first position that was confirmed before the second change was made', async () => {
			api.updateEvent.mockResolvedValueOnce({ event: at(300) })
			const reschedule = renderHook(() => useRescheduleEventMutation(), { wrapper }).result
			await act(() => reschedule.current.mutateAsync({ event, startTime: 300, endTime: 400 }))
			api.updateEvent.mockRejectedValueOnce(new Error('offline'))
			await act(() =>
				reschedule.current.mutateAsync({ event: at(300), startTime: 500, endTime: 600 }).catch(() => {}),
			)
			expect(drawn()?.when).toMatchObject({ start_time: 300 })
		})

		it('returns to the original time when every change is refused, including one never sent', async () => {
			const { settle } = await drag(300, 500, 700)
			await settle(0, 'reject', new Error('offline'))
			await settle(1, 'reject', new Error('offline'))
			// Not left at 300 or 500: the provider confirmed neither.
			expect(drawn()?.when).toMatchObject({ start_time: 100 })
		})

		it('restores every cached range when refused changes moved the event between ranges', async () => {
			// A second, later range is cached too, as a prefetched week would be.
			const LATER = calendarKeys.range(450, 2000)
			client.setQueryData(LATER, { events: [] } as unknown as CalendarRouteData)
			const starts = (key: readonly unknown[]) =>
				client
					.getQueryData<CalendarRouteData>(key)
					?.events.map((item) => (item.when as { start_time: number }).start_time)
			// The second drag reaches the later range; the first never did.
			const { settle } = await drag(300, 500)
			expect(starts(LATER)).toEqual([500])
			await settle(0, 'reject', new Error('offline'))
			await settle(1, 'reject', new Error('offline'))
			expect(starts(calendarKeys.range(0, 1000))).toEqual([100])
			expect(starts(LATER)).toEqual([])
		})

		it('drops a change still waiting its turn when the inbox is switched, and lets nothing land afterwards', async () => {
			const { sent, settle, settled } = await drag(300, 500)
			resetCalendarConfirmedEffects(client)
			client.setQueryData(calendarKeys.range(0, 1000), calendarData)
			await settle(0, 'resolve', { event: at(300) })
			await Promise.all(settled)
			// The waiting change was never sent, and the late answer wrote nothing into the next inbox.
			expect(sent).toHaveLength(1)
			expect(api.updateEvent).toHaveBeenCalledOnce()
			expect(drawn()?.when).toMatchObject({ start_time: 100 })
		})

		it('does not send a change made in the instant the inbox is switched', async () => {
			const sent = holdUpdates()
			const reschedule = renderHook(() => useRescheduleEventMutation(), { wrapper }).result
			let saved: Promise<unknown> = Promise.resolve()
			act(() => {
				saved = reschedule.current.mutateAsync({ event, startTime: 300, endTime: 400 })
				resetCalendarConfirmedEffects(client)
			})
			await act(async () => {
				await saved
			})
			expect(sent).toHaveLength(0)
		})

		it('keeps changes to different events independent: neither waits for the other', async () => {
			const other = { ...event, id: 'event-2', title: 'Other' } as Event
			client.setQueryData(calendarKeys.range(0, 1000), { events: [event, other] } as CalendarRouteData)
			const sent = holdUpdates()
			const reschedule = renderHook(() => useRescheduleEventMutation(), { wrapper }).result
			const settled: Promise<unknown>[] = []
			act(() => {
				settled.push(reschedule.current.mutateAsync({ event, startTime: 300, endTime: 400 }))
			})
			await flush()
			act(() => {
				settled.push(reschedule.current.mutateAsync({ event: other, startTime: 700, endTime: 800 }))
			})
			await flush()
			expect(sent.map((request) => request.data.eventId)).toEqual([event.id, other.id])
			await act(async () => {
				;(sent[1] as Sent).resolve({ eventId: other.id })
				;(sent[0] as Sent).resolve({ eventId: event.id })
				await Promise.all(settled)
			})
			const events = client.getQueryData<CalendarRouteData>(calendarKeys.range(0, 1000))?.events
			expect(events?.map((item) => (item.when as { start_time: number }).start_time)).toEqual([300, 700])
		})

		it('gives the editor the same guarantee: saves of one event reach the provider in order', async () => {
			const sent = holdUpdates()
			const update = renderHook(() => useUpdateEventMutation(event), { wrapper }).result
			const settled: Promise<unknown>[] = []
			for (const title of ['First', 'Second', 'Third']) {
				act(() => {
					settled.push(update.current.mutateAsync({ eventId: event.id, title }).catch(() => {}))
				})
				await flush()
				expect(drawn()?.title).toBe(title)
			}
			expect(sent.map((request) => request.data.title)).toEqual(['First'])
			// An older save failing does not undo the newer one, which is sent next.
			await act(async () => {
				;(sent[0] as Sent).reject(new Error('offline'))
			})
			await flush()
			expect(drawn()?.title).toBe('Third')
			expect(sent.map((request) => request.data.title)).toEqual(['First', 'Third'])
			await act(async () => {
				;(sent[1] as Sent).resolve({ event: { ...event, title: 'Third' } })
				await Promise.all(settled)
			})
			expect(afterStaleRead()?.title).toBe('Third')
		})
	})

	describe('confirmed receipts while changes overlap', () => {
		const RANGE = { start: 0, end: 1000 }
		const other = {
			id: 'event-2',
			calendar_id: 'calendar-1',
			title: 'Other',
			when: { object: 'timespan', start_time: 600, end_time: 700 },
		} as Event
		const moved = (source: Event, start: number) =>
			({ ...source, when: { object: 'timespan', start_time: start, end_time: start + 100 } }) as Event
		const stale = { events: [event, other] } as CalendarRouteData
		/** What a view draws for an event once an eventually consistent provider read lands. */
		const drawnAfterStaleRead = (eventId: string) => {
			client.setQueryData(calendarKeys.range(RANGE.start, RANGE.end), stale)
			const when = calendarStateTestApi
				.reconcileCalendarData(client, stale, RANGE)
				.events.find((candidate) => candidate.id === eventId)?.when
			return (when as { start_time: number }).start_time
		}

		beforeEach(() => {
			client.setQueryData(calendarKeys.range(RANGE.start, RANGE.end), stale)
		})

		it('keeps another event confirmation when a change that was pending before it fails afterwards', async () => {
			let refuse: (reason: unknown) => void = () => {}
			api.updateEvent.mockImplementation(({ data }: { data: { eventId: string } }) =>
				data.eventId === event.id
					? new Promise((_resolve, reject) => {
							refuse = reject
						})
					: Promise.resolve({ event: moved(other, 800) }),
			)
			const reschedule = renderHook(() => useRescheduleEventMutation(), { wrapper }).result
			let pending: Promise<unknown> = Promise.resolve()
			// A is moved and its request is still with the provider...
			act(() => {
				pending = reschedule.current.mutateAsync({ event, startTime: 300, endTime: 400 }).catch(() => {})
			})
			await act(async () => {})
			// ...while B is moved and confirmed.
			await act(() => reschedule.current.mutateAsync({ event: other, startTime: 800, endTime: 900 }))
			await act(async () => {
				refuse(new Error('offline'))
				await pending
			})
			// A's failure triggers a refetch; a stale read must not move B back.
			expect(drawnAfterStaleRead(other.id)).toBe(800)
			expect(drawnAfterStaleRead(event.id)).toBe(100)
		})
	})

	it('fails closed when an update hook has no authorized event', async () => {
		const update = renderHook(() => useUpdateEventMutation(null), { wrapper }).result
		await expect(act(() => update.current.mutateAsync({ eventId: 'missing', title: 'No' }))).rejects.toThrow(
			'Event is required',
		)
	})
})

describe('contact mutation hooks', () => {
	it('uses fallback receipts for create/update and propagates delete', async () => {
		api.createContact.mockResolvedValue({ contactId: 'contact-2' })
		api.updateContact.mockResolvedValue({ contactId: contact.id })
		api.deleteContact.mockResolvedValue({ removedContactId: contact.id })
		const create = renderHook(() => useCreateContactMutation(), { wrapper }).result
		await act(() =>
			create.current.mutateAsync({
				givenName: 'Grace',
				emails: [{ email: ' grace@example.com ', type: ' work ' }],
				phoneNumbers: [{ number: ' 123 ', type: ' mobile ' }],
			}),
		)
		expect(client.getQueryData<Contact>(contactsKeys.detail('contact-2'))).toMatchObject({
			given_name: 'Grace',
			emails: [{ email: 'grace@example.com', type: 'work' }],
			phone_numbers: [{ number: '123', type: 'mobile' }],
		})

		const update = renderHook(() => useUpdateContactMutation(contact), { wrapper }).result
		await act(() => update.current.mutateAsync({ surname: 'Lovelace' }))
		expect(client.getQueryData<Contact>(contactsKeys.detail(contact.id))?.surname).toBe('Lovelace')

		const remove = renderHook(() => useDeleteContactMutation(contact.id), { wrapper }).result
		await act(() => remove.current.mutateAsync())
		expect(client.getQueryData(contactsKeys.detail(contact.id))).toBeUndefined()
	})

	it('uses canonical receipts and restores snapshots after failures', async () => {
		const canonical = { ...contact, given_name: 'Canonical' }
		api.createContact.mockResolvedValue({ contactId: canonical.id, contact: canonical })
		const create = renderHook(() => useCreateContactMutation(), { wrapper }).result
		await act(() =>
			create.current.mutateAsync({
				givenName: 'Local',
			}),
		)
		expect(client.getQueryData(contactsKeys.detail(canonical.id))).toEqual(canonical)
		api.updateContact.mockResolvedValue({
			contactId: contact.id,
			contact: { ...canonical, surname: 'Server' },
		})
		const canonicalUpdate = renderHook(() => useUpdateContactMutation(canonical), { wrapper }).result
		await act(() => canonicalUpdate.current.mutateAsync({ surname: 'Local' }))
		expect(client.getQueryData<Contact>(contactsKeys.detail(contact.id))?.surname).toBe('Server')

		api.updateContact.mockRejectedValue(new Error('offline'))
		const update = renderHook(() => useUpdateContactMutation(contact), { wrapper }).result
		await expect(act(() => update.current.mutateAsync({ givenName: 'Rollback' }))).rejects.toThrow('offline')
		expect(client.getQueryData<Contact>(contactsKeys.detail(contact.id))?.surname).toBe('Server')
	})

	it('fetches the first contact page without a cursor during explicit reconciliation', async () => {
		api.getContacts.mockResolvedValue({ contacts: [] })
		const contacts = renderHook(() => useContactsPages({ contacts: [contact] }), { wrapper }).result
		await act(() => contacts.current.refetch())
		expect(api.getContacts).toHaveBeenCalledWith({ data: {} })
	})

	it('fails closed when an update hook has no authorized contact', async () => {
		const update = renderHook(() => useUpdateContactMutation(null), { wrapper }).result
		await expect(act(() => update.current.mutateAsync({ givenName: 'No' }))).rejects.toThrow(
			'Contact is required',
		)
	})
})

describe('mail mutation hooks', () => {
	it('commits canonical receipts for thread and draft lifecycle mutations', async () => {
		api.updateThreadState.mockResolvedValue({
			thread: { id: 'thread-1', folders: ['inbox'], unread: false },
			folders: [{ id: 'inbox', unread_count: 0 }],
		})
		const updateThread = renderHook(() => useUpdateThreadMutation(), { wrapper }).result
		await act(() =>
			updateThread.current.mutateAsync({
				threadId: 'thread-1',
				unread: false,
			}),
		)

		api.saveDraft.mockResolvedValue({
			draftId: draft.id,
			draft: { id: draft.id, grant_id: 'private', subject: 'Canonical' },
			created: false,
			folders: [{ id: 'drafts', total_count: 1 }],
		})
		const save = renderHook(() => useSaveDraftMutation(), { wrapper }).result
		await act(() =>
			save.current.mutateAsync({
				draftId: draft.id,
				to: '',
				subject: 'Local',
				body: '',
			}),
		)
		expect(client.getQueryData<MailDraft[]>(mailKeys.drafts())?.[0]).toEqual({
			id: draft.id,
			subject: 'Canonical',
		})

		api.sendDraft.mockResolvedValue({
			removedDraftId: draft.id,
			message: { id: 'message-1', grant_id: 'private', folders: ['sent'] },
			folders: [{ id: 'drafts', total_count: 0 }],
		})
		const send = renderHook(() => useSendDraftMutation(), { wrapper }).result
		await act(() =>
			send.current.mutateAsync({
				draftId: draft.id,
				to: 'you@example.com',
				subject: 'Sent',
				body: 'Body',
			}),
		)
		expect(client.getQueryData<MailDraft[]>(mailKeys.drafts())).toEqual([])

		api.deleteDraft.mockResolvedValue({
			removedDraftId: draft.id,
			folders: [{ id: 'drafts', total_count: 0 }],
		})
		const removeDraft = renderHook(() => useDeleteDraftMutation(), { wrapper }).result
		await act(() => removeDraft.current.mutateAsync(draft.id))
	})

	it('rolls back rejected optimistic mail operations', async () => {
		api.updateThreadState.mockRejectedValue(new Error('offline'))
		const mutation = renderHook(() => useUpdateThreadMutation(), { wrapper }).result
		await expect(
			act(() => mutation.current.mutateAsync({ threadId: 'thread-1', starred: true })),
		).rejects.toThrow('offline')
		expect(
			client.getQueryData<MailThreadListData>(mailKeys.threadList({ folderId: 'inbox' }))?.pages[0]
				?.threads[0]?.starred,
		).toBeUndefined()
	})
})

describe('marking a thread read on open', () => {
	const inboxKey = mailKeys.threadList({ folderId: 'inbox' })
	const cachedRow = () => client.getQueryData<MailThreadListData>(inboxKey)?.pages[0]?.threads[0]
	const inboxFolders = [{ id: 'inbox', unread_count: 1 }] as MailFolder[]

	beforeEach(() => client.setQueryData(mailKeys.folders(), inboxFolders))

	it('updates the row and folder badge before the provider answers, then keeps the canonical receipt', async () => {
		let answer: (value: unknown) => void = () => {}
		api.markThreadRead.mockReturnValue(new Promise((resolve) => (answer = resolve)))

		expect(markThreadReadOnOpen(client, 'thread-1')).toBe(true)
		await vi.waitFor(() => expect(cachedRow()?.unread).toBe(false))
		expect(client.getQueryData<MailFolder[]>(mailKeys.folders())?.[0]?.unread_count).toBe(0)
		expect(client.isMutating()).toBe(1)

		answer({ thread: { id: 'thread-1', grant_id: 'private', folders: ['inbox'], unread: false } })
		await vi.waitFor(() => expect(client.isMutating()).toBe(0))
		expect(api.markThreadRead).toHaveBeenCalledWith({ data: { threadId: 'thread-1' } })
		expect(cachedRow()).toEqual({ id: 'thread-1', folders: ['inbox'], unread: false })
	})

	it('sends one read per open even when the loader and reader both ask', async () => {
		api.markThreadRead.mockResolvedValue({ thread: { id: 'thread-1', unread: false } })
		expect(markThreadReadOnOpen(client, 'thread-1')).toBe(true)
		expect(markThreadReadOnOpen(client, 'thread-1')).toBe(true)
		await vi.waitFor(() => expect(client.isMutating()).toBe(0))
		expect(api.markThreadRead).toHaveBeenCalledTimes(1)
	})

	it('skips threads that are already read or not cached', () => {
		expect(markThreadReadOnOpen(client, 'unknown-thread')).toBe(false)
		expect(markThreadReadOnOpen(client, 'thread-1', { id: 'thread-1', unread: false })).toBe(false)
		expect(api.markThreadRead).not.toHaveBeenCalled()
	})

	it('restores the unread row and badge when the provider rejects the read', async () => {
		api.markThreadRead.mockRejectedValue(new Error('offline'))
		markThreadReadOnOpen(client, 'thread-1')
		await vi.waitFor(() => expect(client.isMutating()).toBe(0))
		expect(cachedRow()?.unread).toBe(true)
		expect(client.getQueryData<MailFolder[]>(mailKeys.folders())?.[0]?.unread_count).toBe(1)
	})

	it('never writes read state during server rendering', () => {
		vi.stubGlobal('window', undefined)
		try {
			expect(markThreadReadOnOpen(client, 'thread-1')).toBe(false)
		} finally {
			vi.unstubAllGlobals()
		}
		expect(api.markThreadRead).not.toHaveBeenCalled()
	})

	it('does not cancel the detail request that is loading the opened thread', async () => {
		api.markThreadRead.mockResolvedValue({ thread: { id: 'thread-1', unread: false } })
		let deliver: (value: unknown) => void = () => {}
		const detailKey = mailKeys.threadDetail('thread-1')
		const loading = client.fetchQuery({
			queryKey: detailKey,
			queryFn: () => new Promise((resolve) => (deliver = resolve)),
		})

		const opened = openThreadDetail(client, 'thread-1', { preload: false, queryKey: detailKey }, async () => {
			deliver({ thread: { id: 'thread-1', unread: true }, messages: [] })
			return (await loading) as { thread: { id: string; unread: boolean } }
		})

		// The detail was read before the provider applied the read; it must not
		// flip the reader back to unread.
		await expect(opened).resolves.toEqual({ thread: { id: 'thread-1', unread: false }, messages: [] })
		expect(client.getQueryData(detailKey)).toEqual({
			thread: { id: 'thread-1', unread: false },
			messages: [],
		})
	})

	it('aligns an uncached search selection with the read already sent', async () => {
		api.markThreadRead.mockResolvedValue({ thread: { id: 'thread-1', unread: false } })
		await expect(
			openThreadDetail(client, 'thread-1', { preload: false }, async () => ({
				thread: { id: 'thread-1', unread: true },
			})),
		).resolves.toEqual({ thread: { id: 'thread-1', unread: false } })
		await vi.waitFor(() => expect(client.isMutating()).toBe(0))
	})

	it('returns an aligned reader to unread when the provider later rejects the read', async () => {
		let reject: (reason: unknown) => void = () => {}
		api.markThreadRead.mockReturnValue(new Promise((_resolve, fail) => (reject = fail)))
		const detailKey = mailKeys.threadDetail('thread-1')

		const opened = await openThreadDetail(
			client,
			'thread-1',
			{ preload: false, queryKey: detailKey },
			async () => ({
				thread: { id: 'thread-1', unread: true },
				messages: [],
			}),
		)
		expect(opened.thread.unread).toBe(false)

		reject(new Error('offline'))
		await vi.waitFor(() => expect(client.isMutating()).toBe(0))
		// Row, badge, and reader must agree: the thread is still unread.
		expect(cachedRow()?.unread).toBe(true)
		expect(client.getQueryData<{ thread: { unread: boolean } }>(detailKey)?.thread.unread).toBe(true)
	})

	it('does not report a thread read when its read failed before the conversation loaded', async () => {
		api.markThreadRead.mockRejectedValue(new Error('offline'))
		let deliver: () => void = () => {}
		const loaded = new Promise<void>((resolve) => (deliver = resolve))

		const opening = openThreadDetail(client, 'thread-1', { preload: false }, async () => {
			await loaded
			return { thread: { id: 'thread-1', unread: true } }
		})
		await vi.waitFor(() => expect(client.isMutating()).toBe(0))
		deliver()

		await expect(opening).resolves.toEqual({ thread: { id: 'thread-1', unread: true } })
		expect(cachedRow()?.unread).toBe(true)
	})

	it('leaves read state untouched for hover preloads and read threads', async () => {
		const detail = { thread: { id: 'thread-1', unread: true } }
		await expect(openThreadDetail(client, 'thread-1', { preload: true }, async () => detail)).resolves.toBe(
			detail,
		)
		expect(api.markThreadRead).not.toHaveBeenCalled()
		expect(cachedRow()?.unread).toBe(true)

		api.markThreadRead.mockResolvedValue({ thread: { id: 'thread-1', unread: false } })
		const read = { thread: { id: 'thread-1', unread: false } }
		await expect(openThreadDetail(client, 'thread-1', { preload: false }, async () => read)).resolves.toBe(
			read,
		)
		const unaligned = { thread: { id: 'thread-2', unread: true } }
		await expect(
			openThreadDetail(client, 'thread-2', { preload: false }, async () => unaligned),
		).resolves.toBe(unaligned)
		await vi.waitFor(() => expect(client.isMutating()).toBe(0))
	})
})

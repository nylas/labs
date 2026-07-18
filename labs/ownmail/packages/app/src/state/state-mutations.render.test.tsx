// @vitest-environment jsdom
import type { Contact, Event } from '@nylas-labs/cli-kit/v3'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({
	createContact: vi.fn(),
	createEvent: vi.fn(),
	deleteContact: vi.fn(),
	deleteDraft: vi.fn(),
	deleteEvent: vi.fn(),
	getContacts: vi.fn(),
	rsvpEvent: vi.fn(),
	saveDraft: vi.fn(),
	sendDraft: vi.fn(),
	updateContact: vi.fn(),
	updateEvent: vi.fn(),
	updateThreadState: vi.fn(),
}))

vi.mock('../server/calendar-fns.js', () => ({
	createEvent: api.createEvent,
	deleteEvent: api.deleteEvent,
	getEvents: vi.fn(),
	rsvpEvent: api.rsvpEvent,
	updateEvent: api.updateEvent,
}))
vi.mock('../server/fns.js', () => ({
	createContact: api.createContact,
	deleteContact: api.deleteContact,
	deleteDraft: api.deleteDraft,
	getContact: vi.fn(),
	getContacts: api.getContacts,
	getMailboxInfo: vi.fn(),
	saveDraft: api.saveDraft,
	sendDraft: api.sendDraft,
	updateContact: api.updateContact,
	updateThreadState: api.updateThreadState,
}))

import {
	type CalendarRouteData,
	calendarKeys,
	useCreateEventMutation,
	useDeleteEventMutation,
	useRsvpEventMutation,
	useUpdateEventMutation,
} from './calendar-state.js'
import {
	type ContactsPages,
	contactsKeys,
	useContactsPages,
	useCreateContactMutation,
	useDeleteContactMutation,
	useUpdateContactMutation,
} from './contacts-state.js'
import {
	useDeleteDraftMutation,
	useSaveDraftMutation,
	useSendDraftMutation,
	useUpdateThreadMutation,
} from './mail-mutations.js'
import { type MailDraft, type MailFolder, type MailThreadListData, mailKeys } from './mail-queries.js'

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
	client.setQueryData(calendarKeys.range(1, 2), calendarData)
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
		expect(client.getQueryData<CalendarRouteData>(calendarKeys.range(1, 2))?.events).toContainEqual(
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
		expect(client.getQueryData<CalendarRouteData>(calendarKeys.range(1, 2))?.events[0]).toMatchObject({
			title: 'Updated',
			location: 'HQ',
			description: 'Notes',
		})

		const rsvp = renderHook(() => useRsvpEventMutation(event.id), { wrapper }).result
		await act(() => rsvp.current.mutateAsync({ eventId: event.id, status: 'yes' }))
		expect(
			client.getQueryData<CalendarRouteData>(calendarKeys.range(1, 2))?.events[0]?.participants?.[0]?.status,
		).toBe('yes')
		expect(
			client.getQueryData<CalendarRouteData>(calendarKeys.range(1, 2))?.events[0]?.participants?.[1]?.status,
		).toBeUndefined()

		const remove = renderHook(() => useDeleteEventMutation(event.id), { wrapper }).result
		await act(() => remove.current.mutateAsync({ eventId: event.id }))
		expect(client.getQueryData<CalendarRouteData>(calendarKeys.range(1, 2))?.events).not.toContainEqual(event)
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
		expect(client.getQueryData<CalendarRouteData>(calendarKeys.range(1, 2))?.events).toContainEqual(canonical)
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
		expect(client.getQueryData<CalendarRouteData>(calendarKeys.range(1, 2))?.events[0]?.location).toBe(
			'Canonical HQ',
		)

		api.updateEvent.mockRejectedValue(new Error('offline'))
		const update = renderHook(() => useUpdateEventMutation(event), { wrapper }).result
		await expect(
			act(() => update.current.mutateAsync({ eventId: event.id, title: 'Should roll back' })),
		).rejects.toThrow('offline')
		expect(client.getQueryData<CalendarRouteData>(calendarKeys.range(1, 2))?.events).toContainEqual({
			...canonical,
			location: 'Canonical HQ',
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

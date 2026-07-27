import type { Calendar, Event, Folder, Message, Thread } from '@nylas-labs/cli-kit/v3'
import { describe, expect, it, vi } from 'vitest'
import { fmtAgendaTime, fmtCompactTime, fmtTime, formatFullDate } from '#features/calendar/lib/calendar'
import { DEFAULT_MAIL_FOLDER_ID } from '../config/route-paths.js'
import {
	activeMailSidebarFolderId,
	calendarTone,
	collapsedMessagePreview,
	composeBackdropListSearch,
	composeBackdropReplySearch,
	composeBackdropThreadSearch,
	composeSearchFromMailLocation,
	draftRecipientList,
	draftRecipientName,
	eventChipClass,
	eventColorClass,
	eventHour,
	eventTone,
	folderCount,
	formatListDate,
	forwardDraftSearch,
	initials,
	labelBadgeClass,
	labelBaseFolderId,
	labelDotClass,
	labelToggleFolderId,
	liveSearchTarget,
	mailFolderIdFromPath,
	mailFolderTitle,
	mailSearchInputValue,
	messageBodyParagraphs,
	messageHasHtml,
	messagePreview,
	readableSnippet,
	replyAllDraftSearch,
	replyDraftSearch,
	STAR_FILLED_CLASS,
	STAR_HOVER_CLASS,
	searchListSearch,
	shouldUseBrowserBackForComposeClose,
	sidebarFolderCount,
	threadLabels,
	threadRouteFolderId,
	threadSender,
	threadTimestamp,
	toneFromHex,
	totalUnread,
} from './ui-model.js'

describe('ui-model mail helpers', () => {
	it('uses inbox as the reference default mail folder', () => {
		expect(DEFAULT_MAIL_FOLDER_ID).toBe('inbox')
	})

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
			participants: [{ name: 'Ada Lovelace', email: 'ada@example.com' }],
			latest_draft_or_message: {
				to: [{ name: 'Grace Hopper', email: 'grace@example.com' }],
			},
		} as Thread

		expect(threadSender(thread, 'inbox')).toBe('Ada Lovelace')
		expect(threadSender(thread, 'sent')).toBe('Grace Hopper')
		expect(threadSender({ participants: [{ email: 'team@example.com' }] } as Thread, 'sent')).toBe(
			'team@example.com',
		)
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

	it('projects provider snippets and OwnMail draft envelopes onto readable text', () => {
		expect(readableSnippet('<p>This is a <strong>test</strong></p>')).toBe('This is a test')
		expect(readableSnippet('<pre data-ownmail-markdown="1">This is a test</pre>')).toBe('This is a test')
		expect(readableSnippet('<pre data-ownmail-markdown="1">**ready** &amp; waiting</pre>')).toBe(
			'**ready** & waiting',
		)
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

	it('detects html bodies for rich rendering', () => {
		expect(messageHasHtml({ body: '<p>Hello</p>' } as Message)).toBe(true)
		expect(messageHasHtml({ body: 'plain text' } as Message)).toBe(false)
	})

	it('does not leak script contents from spaced script end tags', () => {
		const message = {
			body: '<p>Hello</p><script>alert(1)</script ><p>Goodbye</p>',
		} as Message

		expect(messageBodyParagraphs(message)).toEqual(['Hello', 'Goodbye'])
	})

	it('decodes html entities once when building message previews', () => {
		expect(messagePreview({ body: '<p>&amp;lt;script&amp;gt;</p>' } as Message)).toBe('&lt;script&gt;')
		expect(messagePreview({ body: '<p>&lt;hello&gt; &amp; welcome</p>' } as Message)).toBe(
			'<hello> & welcome',
		)
	})

	it('formats relative list dates like the reference thread list', () => {
		vi.useFakeTimers()
		vi.setSystemTime(new Date('2026-07-08T12:00:00Z'))

		expect(formatListDate(Date.parse('2026-07-08T08:30:00Z') / 1000)).toMatch(/8:30|4:30/)
		expect(formatListDate(Date.parse('2026-07-07T08:30:00Z') / 1000)).toMatch(/Tue|Jul/)
		expect(formatListDate(Date.parse('2026-06-20T08:30:00Z') / 1000)).toBe('Jun 20')
		// A missing/zero timestamp yields an empty label.
		expect(formatListDate(undefined)).toBe('')

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

	it('builds reply-all defaults without addressing the mailbox owner', () => {
		expect(
			replyAllDraftSearch(
				{
					id: 'msg-1',
					subject: 'Q3 roadmap',
					from: [{ email: 'grace@example.com' }],
					to: [{ email: 'ada@ownmail.com' }, { email: 'katherine@example.com' }],
					cc: [{ email: 'Grace@example.com' }, { email: 'alan@example.com' }],
				} as Message,
				'ada@ownmail.com',
			),
		).toEqual({
			to: 'grace@example.com, katherine@example.com, alan@example.com',
			subject: 'Re: Q3 roadmap',
			replyToMessageId: 'msg-1',
		})
	})

	it('builds forward defaults with quoted visible message content', () => {
		const forward = forwardDraftSearch({
			id: 'msg-1',
			subject: 'Q3 roadmap',
			date: Date.parse('2026-07-08T10:00:00Z') / 1000,
			from: [{ name: 'Grace Hopper', email: 'grace@example.com' }],
			to: [{ name: 'Ada Lovelace', email: 'ada@ownmail.com' }],
			body: '<p>First paragraph.</p><p>Second paragraph.</p>',
		} as Message)

		expect(forward.to).toBe('')
		expect(forward.subject).toBe('Fwd: Q3 roadmap')
		expect(forward.body).toContain('---------- Forwarded message ---------')
		expect(forward.body).toContain('From: Grace Hopper')
		expect(forward.body).toContain('To: Ada Lovelace')
		expect(forward.body).toContain('First paragraph.')
		expect(forward.body).toContain('Second paragraph.')
	})

	it('maps Nylas folder labels to reference row badges', () => {
		const thread = { folders: ['inbox', 'work', 'travel'] } as Thread

		expect(threadLabels(thread).map((label) => label.name)).toEqual(['Work', 'Travel'])
		expect(labelBadgeClass('blue')).toBe(
			'label-badge border border-[var(--event-blue)]/20 bg-[var(--event-blue)]/8 text-[var(--event-blue)]',
		)
		expect(labelBadgeClass('amber')).toBe(
			'label-badge border border-[var(--event-amber)]/20 bg-[var(--event-amber)]/10 text-[var(--event-amber)]',
		)
	})

	it('uses reference CSS-variable star accent classes', () => {
		expect(STAR_HOVER_CLASS).toBe('hover:text-[var(--event-amber)]')
		expect(STAR_FILLED_CLASS).toBe('fill-[var(--event-amber)] text-[var(--event-amber)]')
	})

	it('uses reference CSS-variable event color utilities', () => {
		expect(eventColorClass('blue', 'bg')).toBe('bg-[var(--event-blue)]')
		expect(eventColorClass('teal', 'text')).toBe('text-[var(--event-teal)]')
		expect(eventColorClass('rose', 'border')).toBe('border-[var(--event-rose)]')
		expect(eventChipClass('teal')).toBe(
			'event-chip text-[var(--event-teal)] border border-[var(--event-teal)]/20',
		)
	})

	it('keeps reference label dot colors stable by label id', () => {
		expect(labelDotClass('work', 3)).toBe('bg-[var(--event-blue)]')
		expect(labelDotClass('personal', 0)).toBe('bg-[var(--event-teal)]')
		expect(labelDotClass('finance', 1)).toBe('bg-[var(--event-amber)]')
		expect(labelDotClass('travel', 2)).toBe('bg-[var(--event-rose)]')
		expect(labelDotClass('custom', 2)).toBe('bg-[var(--event-amber)]')
	})

	it('cycles unknown label ids through the four fallback dot tones by index', () => {
		// Ids that match no known label fall back to a deterministic 4-tone rotation.
		expect(labelDotClass('unknown', 0)).toBe('bg-[var(--event-blue)]')
		expect(labelDotClass('unknown', 1)).toBe('bg-[var(--event-teal)]')
		expect(labelDotClass('unknown', 2)).toBe('bg-[var(--event-amber)]')
		expect(labelDotClass('unknown', 3)).toBe('bg-[var(--event-rose)]')
	})

	it('toggles an active label back to the reference default inbox view', () => {
		expect(labelToggleFolderId('work', 'work')).toBe('inbox')
		expect(labelToggleFolderId('work', 'work', 'sent')).toBe('sent')
		expect(labelToggleFolderId('inbox', 'work')).toBe('work')
		expect(labelToggleFolderId(undefined, 'work')).toBe('work')
		expect(labelBaseFolderId('sent')).toBe('sent')
		expect(labelBaseFolderId('work', 'sent')).toBe('sent')
		expect(labelBaseFolderId('work')).toBe('inbox')
	})

	it('routes live search changes like the reference search box', () => {
		expect(liveSearchTarget(' hiking ', '/mail/f/inbox', 'inbox')).toEqual({
			kind: 'search',
			q: 'hiking',
			folderId: 'inbox',
		})
		expect(liveSearchTarget(' Welcome ', '/mail/f/work', 'work')).toEqual({
			kind: 'search',
			q: 'Welcome',
			folderId: 'work',
		})
		expect(liveSearchTarget('', '/mail/search', 'inbox', 'thread-roadmap')).toEqual({
			kind: 'folder',
			folderId: 'inbox',
		})
		expect(liveSearchTarget('', '/mail/search', 'work')).toEqual({ kind: 'folder', folderId: 'work' })
		expect(liveSearchTarget('', '/mail/f/inbox')).toEqual({ kind: 'stay' })
		expect(searchListSearch('roadmap', 'inbox')).toEqual({ q: 'roadmap', folderId: 'inbox' })
		expect(searchListSearch('roadmap')).toEqual({ q: 'roadmap' })
	})

	it('keeps the reference sidebar folder active for scoped compose routes', () => {
		expect(mailFolderIdFromPath('/mail/f/inbox')).toBe('inbox')
		expect(mailFolderIdFromPath('/mail/f/work/t/thread-roadmap')).toBe('work')
		expect(mailFolderIdFromPath('/mail/compose')).toBeUndefined()
		expect(activeMailSidebarFolderId('/mail/f/sent', 'inbox')).toBe('sent')
		expect(activeMailSidebarFolderId('/mail/compose', 'inbox')).toBe('inbox')
		expect(activeMailSidebarFolderId('/mail/search', 'work')).toBe('work')
	})

	it('shows the route search query in the reference header input only on search routes', () => {
		expect(mailSearchInputValue('/mail/search', 'roadmap')).toBe('roadmap')
		expect(mailSearchInputValue('/mail/search', undefined)).toBe('')
		expect(mailSearchInputValue('/mail/f/inbox', 'roadmap')).toBe('')
	})

	it('only uses browser back for compose close after in-app route navigation', () => {
		expect(shouldUseBrowserBackForComposeClose({ __TSR_index: 1 })).toBe(true)
		expect(shouldUseBrowserBackForComposeClose({ __TSR_index: 0 })).toBe(false)
		expect(shouldUseBrowserBackForComposeClose({})).toBe(false)
		expect(shouldUseBrowserBackForComposeClose(null)).toBe(false)
	})

	it('keeps the reference backdrop context when opening compose', () => {
		expect(composeSearchFromMailLocation('/mail/f/sent', 'sent')).toEqual({ folderId: 'sent' })
		expect(composeSearchFromMailLocation('/mail/f/work', 'work')).toEqual({ folderId: 'work' })
		expect(composeSearchFromMailLocation('/mail/f/inbox/t/thread-roadmap', 'inbox')).toEqual({
			folderId: 'inbox',
			threadId: 'thread-roadmap',
		})
		expect(composeSearchFromMailLocation('/mail/search', 'inbox', 'thread-roadmap')).toEqual({
			folderId: 'inbox',
			threadId: 'thread-roadmap',
		})
		expect(
			composeBackdropThreadSearch({
				folderId: 'inbox',
				threadId: 'thread-travel',
				draftId: 'draft-1',
				replyToMessageId: 'msg-1',
				to: 'grace@example.com',
				subject: 'Re: Q3 roadmap',
			}),
		).toEqual({
			folderId: 'inbox',
			threadId: 'thread-travel',
			draft: 'draft-1',
			replyToMessageId: 'msg-1',
			to: 'grace@example.com',
			subject: 'Re: Q3 roadmap',
		})
		expect(
			composeBackdropListSearch({
				folderId: 'inbox',
				draftId: 'draft-1',
				replyToMessageId: 'msg-1',
				to: 'grace@example.com',
				subject: 'Re: Q3 roadmap',
			}),
		).toEqual({
			folderId: 'inbox',
			draft: 'draft-1',
			replyToMessageId: 'msg-1',
			to: 'grace@example.com',
			subject: 'Re: Q3 roadmap',
		})
		expect(
			composeBackdropReplySearch({
				folderId: 'work',
				threadId: 'thread-roadmap',
				message: {
					id: 'msg-1',
					subject: 'Q3 roadmap',
					from: [{ email: 'grace@example.com' }],
				} as Message,
			}),
		).toEqual({
			folderId: 'work',
			threadId: 'thread-roadmap',
			replyToMessageId: 'msg-1',
			to: 'grace@example.com',
			subject: 'Re: Q3 roadmap',
		})
	})
})

describe('ui-model calendar helpers', () => {
	it('formats reference-style calendar dialog dates and times', () => {
		const date = new Date('2026-07-08T10:30:00')

		expect(formatFullDate(date)).toBe('Wednesday, July 8')
		expect(formatFullDate(date, true)).toBe('Wednesday, July 8, 2026')
		expect(fmtTime(new Date('2026-07-08T08:00:00'))).toBe('8 AM')
		expect(fmtAgendaTime(new Date('2026-07-08T08:00:00'))).toBe('8:00')
		expect(fmtAgendaTime(new Date('2026-07-08T15:30:00'))).toBe('15:30')
		expect(fmtCompactTime(date)).toBe('10:30 AM')
		expect(fmtCompactTime(new Date('2026-07-08T11:00:00'))).toBe('11 AM')
		// Noon crosses into PM and 12 % 12 === 0 must display as 12, not 0.
		expect(fmtCompactTime(new Date('2026-07-08T12:00:00'))).toBe('12 PM')
		// Afternoon time keeps the minutes and the PM period.
		expect(fmtCompactTime(new Date('2026-07-08T15:45:00'))).toBe('3:45 PM')
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
		// Three-digit shorthand hex (#14b -> 1144bb) must expand before mapping to a tone.
		expect(toneFromHex('#1a6')).toBe(toneFromHex('#11aa66'))
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

	it('keeps reference event-specific tones ahead of calendar colors', () => {
		expect(
			eventTone({ title: 'Flight to Lisbon', calendar_id: 'primary' } as Event, 0, {
				id: 'primary',
				name: 'Personal',
				hex_color: '#14b8a6',
			} as Calendar),
		).toBe('rose')
		expect(
			eventTone({ title: 'Pay rent', calendar_id: 'primary' } as Event, 0, {
				id: 'primary',
				name: 'Personal',
				hex_color: '#14b8a6',
			} as Calendar),
		).toBe('amber')
		expect(
			eventTone({ title: 'Dipsea trail hike', calendar_id: 'social' } as Event, 0, {
				id: 'social',
				name: 'Social',
				hex_color: '#f43f5e',
			} as Calendar),
		).toBe('teal')
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

	it('uses safe default hours for a malformed event time', () => {
		const event = { id: 'invalid', calendar_id: 'work', when: null } as unknown as Event

		expect(eventHour(event)).toEqual({ startHour: 0, endHour: 0, allDay: false })
	})
})

describe('ui-model sidebar and sender fallbacks', () => {
	it('treats a missing total_count on a count-by-total folder as zero', () => {
		// starred/drafts show a total (not unread) count; an API folder omitting it must read as 0.
		expect(sidebarFolderCount([{ id: 'starred' }] as Folder[], 'starred')).toBe(0)
		expect(sidebarFolderCount([{ id: 'drafts' }] as Folder[], 'drafts')).toBe(0)
	})

	it('treats a folder with no unread_count as contributing zero to the sidebar total', () => {
		expect(totalUnread([{ id: 'inbox' }, { id: 'work', unread_count: 4 }] as Folder[])).toBe(4)
	})

	it('labels senderless sent/drafts rows as "Sent" and inbox rows as unknown', () => {
		// A sent/drafts row with no addressable recipient still needs a stable label.
		expect(threadSender({} as Thread, 'sent')).toBe('Sent')
		expect(threadSender({} as Thread, 'drafts')).toBe('Sent')
		// A sent row with no outgoing recipient falls back to the thread participant.
		expect(threadSender({ participants: [{ name: 'Ada Lovelace' }] } as Thread, 'sent')).toBe('Ada Lovelace')
		// A drafts row names the outgoing recipient when present.
		expect(
			threadSender({ latest_draft_or_message: { to: [{ name: 'Grace Hopper' }] } } as Thread, 'drafts'),
		).toBe('Grace Hopper')
		// An inbox row with no participants reads as an unknown sender.
		expect(threadSender({} as Thread, 'inbox')).toBe('(unknown sender)')
	})
})

describe('ui-model plain-text projection edge cases', () => {
	it('prefers a readable provider snippet before parsing any body', () => {
		expect(messagePreview({ snippet: 'Quick note', body: '<p>ignored</p>' } as Message)).toBe('Quick note')
		expect(messagePreview({ snippet: '<p>Quick <b>note</b></p>', body: '<p>ignored</p>' } as Message)).toBe(
			'Quick note',
		)
	})

	it('preserves ordinary less-than and greater-than comparisons as plaintext', () => {
		expect(readableSnippet('1 < 2')).toBe('1 < 2')
		expect(readableSnippet('1 < 2 > 0')).toBe('1 < 2 > 0')
		expect(readableSnippet('1 < 2 > 3 < 4 >')).toBe('1 < 2 > 3 < 4 >')
		expect(readableSnippet('x < y > z')).toBe('x < y > z')
		expect(messagePreview({ body: 'Budget: 1 < 2 > 0' } as Message)).toBe('Budget: 1 < 2 > 0')
		expect(messagePreview({ body: '<p>Budget: 1 < 2 > 0</p>' } as Message)).toBe('Budget: 1 < 2 > 0')
	})

	it('skips HTML comments and document declarations in readable snippets', () => {
		expect(readableSnippet('Hello<!-- provider metadata -->world')).toBe('Hello world')
		expect(readableSnippet('<!doctype html><p>Hello</p>')).toBe('Hello')
	})

	it('falls back to the snippet and then to nothing when a message has no body', () => {
		// No body + snippet → snippet paragraph; no body + no snippet → empty (?? '' guard).
		expect(messageBodyParagraphs({ snippet: 'Only snippet' } as Message)).toEqual(['Only snippet'])
		expect(messageBodyParagraphs({} as Message)).toEqual([])
	})

	it('passes an unrecognized named entity through untouched', () => {
		// Unknown entities (not #-numeric, not a known name) must not be dropped or mangled.
		expect(messagePreview({ body: '<p>Look: &foo; here</p>' } as Message)).toBe('Look: &foo; here')
	})

	it('stops parsing safely at an unterminated tag', () => {
		// A trailing "<" with no ">" is emitted as literal text rather than swallowing the rest.
		expect(messagePreview({ body: '<p>hi</p><broken' } as Message)).toBe('hi <broken')
	})

	it('drops raw-text element contents even when the closing tag is missing or malformed', () => {
		// No further "<" after <script>: everything to end of string is dropped.
		expect(messagePreview({ body: '<p>a</p><script>alert(1)' } as Message)).toBe('a')
		// A "<" with no ">" inside the raw-text run: still dropped to end of string.
		expect(messagePreview({ body: '<p>a</p><script>data<oops' } as Message)).toBe('a')
		// Inner tags (open and mismatched-close) are skipped until the real </script>.
		expect(messagePreview({ body: '<p>a</p><script>x<span>y</span>z</script><p>b</p>' } as Message)).toBe(
			'a b',
		)
		// Obfuscated raw-text closers are recognized so their hidden content cannot leak into the preview.
		expect(messagePreview({ body: '<p>a</p><script>hidden< / script ><p>b</p>' } as Message)).toBe('a b')
		// Raw-text run that ends on an unclosed inner tag: scan exhausts the string, dropping the rest.
		expect(messagePreview({ body: '<p>a</p><script>x<span>' } as Message)).toBe('a')
	})

	it('keeps invalid tag-like text with whitespace after the opening bracket literal', () => {
		expect(messagePreview({ body: '<p>a</p>< p >b</ p >c< /p >d' } as Message)).toBe('a < p >b</ p >c< /p >d')
	})

	it('only breaks paragraphs on real heading levels h1–h6', () => {
		// <h2> is a block heading (paragraph break); <h0> and <h7> are out of range and are not.
		expect(messageBodyParagraphs({ body: '<h2>Real</h2><h0>Zero</h0><h7>Seven</h7>' } as Message)).toEqual([
			'Real',
			'Zero Seven',
		])
	})

	it('does not treat non-heading two-letter or longer closing tags as block breaks', () => {
		// </ul> is length-2 but not an "h" heading; </span> is longer than two chars — neither breaks.
		expect(messageBodyParagraphs({ body: '<ul>a</ul>b' } as Message)).toEqual(['a b'])
		expect(messageBodyParagraphs({ body: '<span>a</span>b' } as Message)).toEqual(['a b'])
	})

	it('decodes nbsp, quot, apostrophe and numeric code points, dropping out-of-range ones', () => {
		// &nbsp; → space; &quot; exercises the entity chain past &gt;.
		expect(messagePreview({ body: '<p>a&nbsp;b</p>' } as Message)).toBe('a b')
		expect(messagePreview({ body: '<p>&quot;q&quot;</p>' } as Message)).toBe('"q"')
		// Both &apos; and &#39; must decode to a single quote.
		expect(messagePreview({ body: '<p>it&apos;s &#39;go&#39;</p>' } as Message)).toBe("it's 'go'")
		// A valid numeric entity decodes; an out-of-range code point is dropped, not rendered.
		expect(messagePreview({ body: '<p>&#65;&#x110000;&#66;</p>' } as Message)).toBe('AB')
	})
})

describe('ui-model compose default fallbacks', () => {
	it('builds a reply with empty recipient and bare subject when the source has neither', () => {
		// A message with no reply_to/from addresses and no subject still yields a valid reply seed.
		expect(replyDraftSearch({ id: 'm1' } as Message)).toEqual({
			to: '',
			subject: 'Re: ',
			replyToMessageId: 'm1',
		})
	})

	it('reply-all skips blank recipient emails and tolerates a missing from list', () => {
		expect(
			replyAllDraftSearch({ id: 'm1', to: [{ email: '' }, { email: 'x@y.com' }] } as Message, 'me@z.com'),
		).toEqual({ to: 'x@y.com', subject: 'Re: ', replyToMessageId: 'm1' })
	})

	it('reply-all keeps an existing "Re:" subject instead of double-prefixing it', () => {
		expect(
			replyAllDraftSearch(
				{ id: 'm2', subject: 'Re: Kept', from: [{ email: 'a@b.com' }] } as Message,
				'me@z.com',
			),
		).toEqual({ to: 'a@b.com', subject: 'Re: Kept', replyToMessageId: 'm2' })
	})

	it('forwards a bare message with a bare subject and no From line', () => {
		const forward = forwardDraftSearch({ id: 'm1' } as Message)
		expect(forward.to).toBe('')
		expect(forward.subject).toBe('Fwd: ')
		// With no sender, the quoted header omits the "From:" line entirely.
		expect(forward.body).not.toContain('From:')
	})

	it('forwarding keeps an existing "Fwd:" subject instead of double-prefixing it', () => {
		expect(forwardDraftSearch({ id: 'm3', subject: 'Fwd: Kept' } as Message).subject).toBe('Fwd: Kept')
	})

	it('treats a thread with no folders as carrying no labels', () => {
		expect(threadLabels({} as Thread)).toEqual([])
	})

	it('defaults live search folder navigation to the inbox when no folder is scoped', () => {
		expect(liveSearchTarget('', '/mail/search')).toEqual({ kind: 'folder', folderId: 'inbox' })
	})
})

describe('ui-model tone resolution fallbacks', () => {
	it('resolves calendar tones by name when no color maps, then by index', () => {
		// Name/id keyword tones when there is no hex color.
		expect(calendarTone({ id: 'team-work', name: 'Work' } as Calendar)).toBe('blue')
		expect(calendarTone({ id: 'focus-cal', name: 'Focus' } as Calendar)).toBe('amber')
		expect(calendarTone({ id: 'primary', name: 'My Cal' } as Calendar)).toBe('teal')
		// No color and no keyword → deterministic index rotation.
		expect(calendarTone({ id: 'zzz', name: 'Zzz' } as Calendar, 2)).toBe('amber')
		// A calendar with neither name nor id still resolves via the index fallback.
		expect(calendarTone({} as Calendar, 0)).toBe('blue')
	})

	it('falls back through title, calendar name and context tones for untitled events', () => {
		// Untitled event with an unmatched calendar id lands on the index fallback.
		expect(eventTone({ calendar_id: 'random' } as Event, 1)).toBe('teal')
		// Contextual title tones apply when nothing more specific matches.
		expect(eventTone({ title: 'Beach travel day' } as Event)).toBe('rose')
		expect(eventTone({ title: 'Roadmap sync', calendar_id: 'xyz' } as Event)).toBe('blue')
	})

	it('returns no tone for an unparseable or missing hex color', () => {
		expect(toneFromHex('not-a-hex')).toBeUndefined()
		expect(toneFromHex(undefined)).toBeUndefined()
	})
})

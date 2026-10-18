import type { Message } from '@nylas-labs/cli-kit/v3'
import { describe, expect, it } from 'vitest'
import { foldPlan, newSinceDivider, rowParticipants } from '#features/mail/lib/thread-reading-model'
import { VIRTUALIZE_AFTER } from '#features/mail/lib/thread-stream'
import { messageHeaderFacts, rawHeaderText } from '#features/mail/server/header-facts'
import { toMailMessage, toMailThread } from '#features/mail/state/mail-queries'
import {
	daysBackTo,
	designReviewVersions,
	mockMessageHeaders,
	rfc5322Date,
	UNAVAILABLE_MESSAGE_IDS,
	upcoming,
} from './dev-mock-mail.fixture.js'
import { createDevMailbox, mockDrafts, mockFolders, mockThreadMessages, mockThreads } from './dev-mocks.js'

const DAY = 86_400
const now = () => Math.floor(Date.now() / 1000)
const localDay = (epochSeconds: number) => new Date(epochSeconds * 1000).toDateString()
const daysBetween = (epochSeconds: number) =>
	Math.round(
		(new Date(new Date().toDateString()).getTime() - new Date(localDay(epochSeconds)).getTime()) /
			(DAY * 1000),
	)
const inbox = () => mockThreads({ folderId: 'inbox' }).threads
const thread = (id: string) => inbox().find((candidate) => candidate.id === id)
const activity = (candidate: { latest_message_received_date?: number; latest_message_sent_date?: number }) =>
	Math.max(candidate.latest_message_received_date ?? 0, candidate.latest_message_sent_date ?? 0)
const words = (html: string) =>
	html
		.replace(/<[^>]*>/g, ' ')
		.replace(/\s+/g, ' ')
		.trim()
		.split(' ').length

describe('board 02: the inbox list', () => {
	it('orders Today and Yesterday exactly as the thread-list board, then leads This week with the bundles', () => {
		const ids = inbox().map((candidate) => candidate.id)
		expect(ids.slice(0, 7)).toEqual([
			'thread-roadmap',
			'thread-calendar-invite',
			'thread-hiking',
			'thread-dentist',
			'thread-failed-send',
			'thread-offsite',
			'thread-staging',
		])
		expect(ids.slice(7, 9)).toEqual(['thread-newsletter', 'thread-invoice'])
		const days = inbox().map((candidate) => daysBetween(activity(candidate)))
		expect(days.slice(0, 4)).toEqual([0, 0, 0, 0])
		expect(days.slice(4, 7)).toEqual([1, 1, 1])
		expect(days.slice(7).every((day) => day >= 2 && day <= 6)).toBe(true)
	})

	it('keeps a thread longer than the reader mounts at once, in Archive, off the boards’ inbox', () => {
		const messages = mockThreadMessages('thread-incident-log').messages
		expect(messages.length).toBeGreaterThan(VIRTUALIZE_AFTER)
		expect(thread('thread-incident-log')).toBeUndefined()
		expect(mockThreads({ folderId: 'archive' }).threads.map((candidate) => candidate.id)).toContain(
			'thread-incident-log',
		)
	})

	it('counts 6 unread conversations in the inbox', () => {
		expect(mockFolders().find((folder) => folder.id === 'inbox')?.unread_count).toBe(6)
		expect(
			inbox()
				.filter((candidate) => candidate.unread)
				.map((candidate) => candidate.id)
				.sort(),
		).toEqual([
			'thread-calendar-invite',
			'thread-lenny',
			'thread-lookalike',
			'thread-roadmap',
			'thread-staging',
			'thread-staging-freeze',
		])
	})

	it('shows the board times: 9:41, 8:52, 7:30 and 6:58 today; 5:14 and 2:10 PM yesterday', () => {
		const time = (epochSeconds: number | undefined) =>
			new Date((epochSeconds ?? 0) * 1000).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
		expect(time(activity(thread('thread-roadmap') ?? {}))).toBe('9:41 AM')
		expect(time(activity(thread('thread-calendar-invite') ?? {}))).toBe('8:52 AM')
		expect(time(activity(thread('thread-hiking') ?? {}))).toBe('7:30 AM')
		expect(time(thread('thread-dentist')?.latest_draft_or_message?.date)).toBe('6:58 AM')
		expect(time(activity(thread('thread-failed-send') ?? {}))).toBe('5:14 PM')
		expect(time(activity(thread('thread-staging') ?? {}))).toBe('2:10 PM')
	})

	it('leads a conversation with its reply draft and lists the draft ids', () => {
		const dentist = thread('thread-dentist')
		expect(dentist?.latest_draft_or_message).toMatchObject({
			id: 'draft-dentist-reply',
			subject: 'Re: Reminder: appointment Thursday 2:30 PM',
			to: [{ name: 'Bright Smile Dental' }],
		})
		expect((dentist as { draft_ids?: string[] }).draft_ids).toEqual(['draft-dentist-reply'])
		// Board 02's copy, word for word.
		expect(dentist?.latest_draft_or_message?.snippet).toBe(
			'Could we move this to Friday morning instead? I have a…',
		)
		expect(thread('thread-offsite')?.snippet).toBe('Thanks for pulling this together. A couple of notes…')
		expect(thread('thread-roadmap')?.latest_draft_or_message?.id).toBe('msg-roadmap-14')
		expect(thread('thread-roadmap')).not.toHaveProperty('draft_ids')

		const billing = mockDrafts().find((draft) => draft.id === 'draft-billing-reply')
		expect(billing?.reply_to_message_id).toBe('msg-billing-1')
		expect(now() - (billing?.date ?? 0)).toBeGreaterThanOrEqual(2 * 3600 - 5)
		expect(now() - (billing?.date ?? 0)).toBeLessThan(2 * 3600 + 60)
	})

	it('schedules the offsite reply for next Monday at 9:00 AM', () => {
		const scheduled = mockThreadMessages('thread-offsite').messages.at(-1) as Message & { send_at?: number }
		const sendAt = new Date((scheduled.send_at ?? 0) * 1000)
		expect(scheduled.from?.[0]?.email).toBe('ada@ownmail.com')
		expect(sendAt.getDay()).toBe(1)
		expect([sendAt.getHours(), sendAt.getMinutes()]).toEqual([9, 0])
		expect(sendAt.getTime()).toBeGreaterThan(Date.now())
	})

	it('bounces the Meridian Bank question from the mailer daemon right after it was sent', () => {
		const [question, bounce] = mockThreadMessages('thread-failed-send').messages
		expect(question?.from?.[0]?.email).toBe('ada@ownmail.com')
		expect(question?.to?.[0]?.name).toBe('Meridian Bank')
		expect(bounce?.from?.[0]?.email).toBe('mailer-daemon@ownmail.com')
		expect(bounce?.subject).toMatch(/^Undeliverable/)
	})

	it('puts 31 people and 12 replies on the muted eng-all conversation', () => {
		const staging = thread('thread-staging')
		expect(staging?.subject).toBe('Re: Who broke staging? (again)')
		expect(staging?.participants).toHaveLength(31)
		expect(staging?.participants?.[0]?.email).toBe('eng-all@vercel.com')
		const { messages } = mockThreadMessages('thread-staging')
		expect(messages).toHaveLength(13)
		expect(messages.filter((message) => message.unread)).toHaveLength(12)
	})

	it('names Katherine alone, in full, on the design review invite row', () => {
		const invite = thread('thread-calendar-invite')
		expect(invite).toBeDefined()
		expect(rowParticipants(toMailThread(invite as NonNullable<typeof invite>), 'ada@ownmail.com')).toEqual({
			names: 'Katherine Johnson',
			more: 0,
		})
	})

	it('bundles four newsletters and three receipts with the board amounts', () => {
		const sender = (id: string) => mockThreadMessages(id).messages[0]?.from?.[0]
		expect(
			['thread-newsletter', 'thread-lenny', 'thread-stratechery', 'thread-figma'].map(
				(id) => sender(id)?.name,
			),
		).toEqual(['The Dispatch', 'Lenny’s', 'Stratechery', 'Figma'])
		expect(
			['thread-invoice', 'thread-voyage-receipt', 'thread-apple-receipt'].map(
				(id) => `${sender(id)?.name} ${/\$[\d,]+\.\d{2}/.exec(thread(id)?.snippet ?? '')?.[0]}`,
			),
		).toEqual(['Stripe $4,200.00', 'Voyage $612.40', 'Apple $2.99'])
		const newest = (ids: string[]) => Math.max(...ids.map((id) => activity(thread(id) ?? {})))
		expect(
			newest(['thread-newsletter', 'thread-lenny', 'thread-stratechery', 'thread-figma']),
		).toBeGreaterThan(newest(['thread-invoice', 'thread-voyage-receipt', 'thread-apple-receipt']))
	})
})

describe('boards 01, 03 and 04: the long roadmap thread', () => {
	const { messages } = mockThreadMessages('thread-roadmap')

	it('has 14 messages, the last three unread, with the subject changing after message 5', () => {
		expect(messages).toHaveLength(14)
		expect(messages.filter((message) => message.unread).map((message) => message.id)).toEqual([
			'msg-roadmap-12',
			'msg-roadmap-13',
			'msg-roadmap-14',
		])
		expect(messages.slice(0, 5).every((message) => message.subject?.endsWith('Q3 roadmap'))).toBe(true)
		expect(
			messages
				.slice(5)
				.every((message) => message.subject?.endsWith('Q3 product roadmap: final review before Friday')),
		).toBe(true)
	})

	it('was last read on a Tuesday and spans from the Monday two weeks before it to today', () => {
		const lastRead = messages[10]?.date ?? 0
		const tuesday = daysBetween(lastRead)
		expect(new Date(lastRead * 1000).getDay()).toBe(2)
		expect(tuesday).toBe(daysBackTo(2, 2))
		expect(tuesday).toBeGreaterThanOrEqual(2)
		expect(tuesday).toBeLessThanOrEqual(8)
		expect(daysBetween(messages[9]?.date ?? 0)).toBe(tuesday)
		expect(daysBetween(messages[0]?.date ?? 0)).toBe(tuesday + 15)
		expect(new Date((messages[0]?.date ?? 0) * 1000).getDay()).toBe(1)
		// Alan answers the Wednesday after, always before today's v4 and Mary's question.
		expect(daysBetween(messages[11]?.date ?? 0)).toBe(tuesday - 1)
		expect(new Date((messages[11]?.date ?? 0) * 1000).getDay()).toBe(3)
		expect(daysBetween(messages[12]?.date ?? 0)).toBe(0)
		expect(daysBetween(messages[13]?.date ?? 0)).toBe(0)
		const dates = messages.map((message) => message.date ?? 0)
		expect(dates).toEqual([...dates].sort((a, b) => a - b))
		expect(
			new Date((messages[11]?.date ?? 0) * 1000).toLocaleTimeString('en-US', {
				hour: 'numeric',
				minute: '2-digit',
			}),
		).toBe('4:12 PM')
	})

	it('says “3 new since Tuesday” whenever that Tuesday is within the week', () => {
		const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
		const divider = newSinceDivider(
			messages.map((message) => toMailMessage(message)),
			{ unreadIds: ['msg-roadmap-12', 'msg-roadmap-13', 'msg-roadmap-14'] },
			Date.now(),
			tz,
		)
		expect(divider).toMatchObject({ beforeIndex: 11, count: 3 })
		if (daysBackTo(2, 2) <= 6) expect(divider?.label).toBe('3 new since Tuesday')
	})

	it('folds as the boards draw it: the first message, nine earlier ones, Katherine’s line, then the new three', () => {
		const plan = foldPlan(
			messages.map((message) => toMailMessage(message)),
			{
				owner: 'ada@ownmail.com',
				ownerFirstName: 'Ada',
				unreadIds: ['msg-roadmap-12', 'msg-roadmap-13', 'msg-roadmap-14'],
				expandedRuns: new Set(),
				openIds: new Set(),
			},
		)
		expect(plan.map((item) => (item.kind === 'folded' ? { folded: item.indices } : item))).toEqual([
			{ kind: 'line', index: 0 },
			{ folded: [1, 2, 3, 4, 5, 6, 7, 8, 9] },
			{ kind: 'line', index: 10 },
			{ kind: 'open', index: 11 },
			{ kind: 'open', index: 12 },
			{ kind: 'open', index: 13 },
		])
		// No read message that Ada did not write names her.
		const namesAda = messages
			.slice(1, 11)
			.filter(
				(message) => message.from?.[0]?.email !== 'ada@ownmail.com' && /\bAda\b/.test(message.body ?? ''),
			)
		expect(namesAda).toEqual([])
	})

	it('brings Mary in on message 13 and has her ask Ada on message 14', () => {
		const mentions = messages.map((message) =>
			[...(message.from ?? []), ...(message.to ?? []), ...(message.cc ?? [])].some(
				(person) => person.name === 'Mary Jackson',
			),
		)
		expect(mentions.indexOf(true)).toBe(12)
		expect(messages[13]?.from?.[0]?.name).toBe('Mary Jackson')
		expect(messages[13]?.body).toContain('Ada, can you confirm that date with them?')
	})

	it('carries four roadmap versions and three other files', () => {
		const files = messages.flatMap((message) =>
			(message.attachments ?? []).map((attachment) => `${message.from?.[0]?.name}:${attachment.filename}`),
		)
		expect(files).toEqual([
			'Grace Hopper:Q3-roadmap-v1.pdf',
			'Ada Lovelace:planning-notes.docx',
			'Alan Turing:sync-flow.png',
			'Grace Hopper:Q3-roadmap-v2.pdf',
			'Grace Hopper:Q3-roadmap-v3.pdf',
			'Katherine Johnson:onboarding-funnel.xlsx',
			'Grace Hopper:Q3-roadmap-v4.pdf',
		])
	})

	it('gives Alan’s message the four paragraphs, his signature and two quoted messages', () => {
		const body = messages[11]?.body ?? ''
		expect(body).toContain('Otherwise this is ready. Nice work pulling it together.')
		expect(body).toContain('<div class="gmail_signature">Alan Turing<br>Principal Engineer, Bletchley')
		expect(body.match(/class="gmail_quote"><div dir="ltr" class="gmail_attr">/g)).toHaveLength(2)
		expect(body).toMatch(/On \w{3}, \w{3} \d{1,2}, \d{4} at 6:02 PM Grace Hopper/)
		expect(messages[11]?.to?.map((person) => person.email)).toEqual([
			'ada@ownmail.com',
			'grace.hopper@vercel.com',
		])
		expect(messages[11]?.cc?.map((person) => person.email)).toEqual([
			'katherine.johnson@vercel.com',
			'pm-leads@vercel.com',
		])
	})
})

describe('board 05 and 06: header facts served by the dev mailbox', () => {
	const mailbox = createDevMailbox()

	async function facts(threadId: string) {
		const { data } = await mailbox.listMessages({ thread_id: threadId, fields: 'include_headers' })
		return Object.fromEntries(
			data.map((message) => [
				message.id,
				messageHeaderFacts((message as { headers?: unknown }).headers, message.from?.[0]?.email),
			]),
		)
	}

	it('serves headers only when they are asked for', async () => {
		const { data } = await mailbox.listMessages({ thread_id: 'thread-roadmap' })
		expect(data.some((message) => 'headers' in message)).toBe(false)
	})

	it('lists a thread newest first, as the provider does, so a capped lookup covers the newest', async () => {
		const { data } = await mailbox.listMessages({ thread_id: 'thread-roadmap' })
		expect(data.length).toBeGreaterThan(1)
		const dates = data.map((message) => message.date)
		expect(dates).toEqual([...dates].sort((a, b) => b - a))
	})

	it('verifies Alan and places him seven hours behind UTC', async () => {
		const roadmap = await facts('thread-roadmap')
		expect(roadmap['msg-roadmap-12']).toEqual({
			verified: true,
			authFailed: false,
			listUnsubscribe: false,
			dateOffsetMinutes: -420,
		})
		expect(roadmap['msg-roadmap-4']?.verified).toBe(false)
		expect(roadmap['msg-roadmap-13']?.dateOffsetMinutes).toBe(-new Date().getTimezoneOffset() || 0)
	})

	it('fails the Meridian lookalike’s sender checks and keeps the real bank verified', async () => {
		expect((await facts('thread-lookalike'))['msg-lookalike-1']).toMatchObject({
			verified: false,
			authFailed: true,
		})
		expect((await facts('thread-statement'))['msg-statement-1']).toMatchObject({
			verified: true,
			authFailed: false,
		})
		expect(mockThreadMessages('thread-statement').messages[0]?.from?.[0]).toEqual({
			name: 'Meridian Bank',
			email: 'statements@meridianbank.com',
		})
	})

	it('reports Grace’s personal Reply-To, the eng-all list and newsletter unsubscribe links', async () => {
		expect((await facts('thread-reply-to'))['msg-reply-to-1']?.replyTo).toBe('grace.personal@fastmail.com')
		expect((await facts('thread-staging-freeze'))['msg-freeze-1']).toMatchObject({
			listId: 'eng-all.vercel.com',
			listUnsubscribe: true,
			unsubscribeMailto: 'mailto:eng-all+unsubscribe@vercel.com?subject=unsubscribe',
		})
		expect((await facts('thread-newsletter'))['msg-newsletter-1']).toMatchObject({
			listUnsubscribe: true,
			unsubscribeUrl: 'https://ownmail.example.com/unsubscribe',
		})
	})

	it('serves raw MIME whose header block the server can show', async () => {
		const html = await mailbox.getRawMime('msg-roadmap-12')
		const headers = rawHeaderText(html.data.raw_mime) ?? ''
		expect(headers).toContain('From: "Alan Turing" <alan@bletchley.dev>')
		expect(headers).toContain('Cc: "Katherine Johnson" <katherine.johnson@vercel.com>, pm-leads@vercel.com')
		expect(headers).toMatch(/Date: \w{3}, \d{1,2} \w{3} \d{4} \d{2}:\d{2}:00 -0700/)
		expect(headers).toContain('Content-Type: text/html; charset=utf-8')
		expect(headers).not.toContain('Otherwise this is ready')
		const plain = rawHeaderText((await mailbox.getRawMime('msg-release-1')).data.raw_mime)
		expect(plain).toContain('Content-Type: text/plain; charset=utf-8')
		await expect(mailbox.getRawMime('missing')).rejects.toThrow('Not found')
	})

	it('builds plain headers for a message with nothing set', () => {
		expect(mockMessageHeaders({ id: 'bare', grant_id: 'g' })).toEqual([
			{ name: 'From', value: '' },
			{ name: 'To', value: '' },
			{ name: 'Subject', value: '' },
			{ name: 'Date', value: rfc5322Date(0, -new Date(0).getTimezoneOffset()) },
			{ name: 'Message-ID', value: '<bare@mock.ownmail.dev>' },
			{ name: 'MIME-Version', value: '1.0' },
		])
		expect(rfc5322Date(1_791_987_120, -420)).toBe('Wed, 14 Oct 2026 07:12:00 -0700')
		expect(rfc5322Date(1_791_987_120, 330)).toBe('Wed, 14 Oct 2026 19:42:00 +0530')
	})
})

describe('board 06: edge cases', () => {
	const mailbox = createDevMailbox()

	it('fails two of the launch checklist’s fourteen messages', async () => {
		const { data } = await mailbox.getThread('thread-launch-checklist')
		expect(data.message_ids).toHaveLength(14)
		const settled = await Promise.allSettled((data.message_ids ?? []).map((id) => mailbox.getMessage(id)))
		expect(settled.filter((result) => result.status === 'fulfilled')).toHaveLength(12)
		expect(data.message_ids?.filter((_id, index) => settled[index]?.status === 'rejected')).toEqual(
			UNAVAILABLE_MESSAGE_IDS,
		)
	})

	it('sends the design review invite four times, one hour later each time', async () => {
		const texts = await Promise.all(
			designReviewVersions.map(async (version) =>
				(await mailbox.downloadAttachment(version.attachmentId, version.messageId)).text(),
			),
		)
		const start = (text: string) => /DTSTART:(\S+)/.exec(text)?.[1] ?? ''
		expect(texts.every((text) => text.includes('UID:design-review@ownmail.dev'))).toBe(true)
		expect(texts.map((text) => /SEQUENCE:(\d)/.exec(text)?.[1])).toEqual(['0', '1', '2', '3'])
		const starts = texts.map((text) =>
			Date.parse(start(text).replace(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z/, '$1-$2-$3T$4:$5:$6Z')),
		)
		expect(starts.map((value, index) => (starts[3] as number) - value - (3 - index) * 3_600_000)).toEqual([
			0, 0, 0, 0,
		])
		const latest = new Date(starts[3] as number)
		expect([latest.getDay(), latest.getHours(), latest.getMinutes()]).toEqual([4, 14, 0])
		expect(new Date(starts[2] as number).getHours()).toBe(13)
		await expect(mailbox.downloadAttachment('att-calendar-invite', 'msg-calendar-invite-v1')).rejects.toThrow(
			'Not found',
		)
	})

	it('keeps one message of the venue thread in Trash and forks a side thread with fewer people', () => {
		const main = mockThreadMessages('thread-offsite-venues')
		expect(
			main.messages.filter((message) => message.folders?.includes('trash')).map((message) => message.id),
		).toEqual(['msg-venues-3'])
		const side = mockThreadMessages('thread-offsite-venues-side')
		const people = (candidate: typeof main) =>
			new Set(candidate.thread.participants?.map((participant) => participant.email))
		expect([...people(side)].every((email) => people(main).has(email))).toBe(true)
		expect(people(side).size).toBeLessThan(people(main).size)
		expect(side.thread.subject?.replace(/^Re: /, '')).toBe(main.thread.subject)
		expect((side.messages[0]?.date ?? 0) > (main.messages[0]?.date ?? 0)).toBe(true)
	})

	it('has an empty body with one file, a missing subject and a removed participant', () => {
		const empty = mockThreadMessages('thread-empty-body').messages[0]
		expect(empty?.body).toBe('')
		expect(empty?.attachments?.map((attachment) => attachment.filename)).toEqual(['contract-signed.pdf'])
		expect(mockThreadMessages('thread-no-subject').thread.subject).toBe('')
		expect(mockThreadMessages('thread-no-subject').messages[0]?.body).toContain(
			'Can you send me the Lisbon hotel',
		)
		const [first, reply] = mockThreadMessages('thread-removed').messages
		expect(
			first?.to?.some((person) => person.name === 'Katherine Johnson') || first?.from?.[0]?.name,
		).toBeTruthy()
		expect(reply?.from?.[0]?.name).toBe('Alan Turing')
		expect(
			[...(reply?.to ?? []), ...(reply?.cc ?? [])].some((person) => person.name === 'Katherine Johnson'),
		).toBe(false)
	})

	it('bounces Ada’s reply to mary@nasa.gov and keeps her draft under Mary’s message', () => {
		const { messages, thread: billing } = mockThreadMessages('thread-billing-launch')
		expect(messages.map((message) => message.from?.[0]?.email)).toEqual([
			'mjackson@vercel.com',
			'ada@ownmail.com',
			'mailer-daemon@ownmail.com',
		])
		expect(messages[2]?.body).toContain('mary@nasa.gov')
		expect(billing.latest_draft_or_message?.id).toBe('draft-billing-reply')
	})

	it('sends a long contract, a hard-wrapped plain-text note and wide or image-heavy designed mail', () => {
		const msa = mockThreadMessages('thread-msa').messages[0]?.body ?? ''
		expect([...msa.matchAll(/<h2>([^<]+)<\/h2>/g)].map((match) => match[1])).toEqual([
			'Scope',
			'Payment',
			'Term',
			'Liability',
			'Notices',
		])
		expect(words(msa)).toBeGreaterThan(1_500)
		expect(words(msa) / 238).toBeLessThan(6.5)
		expect(msa).toContain('the indemnity clause in section 4 still caps liability at')

		const plain = mockThreadMessages('thread-release').messages[0]?.body ?? ''
		expect(plain).not.toMatch(/<[a-z]/i)
		expect(plain.split('\n')).toEqual([
			'The release went out at 6 and the rollback plan is in the doc. Ping me',
			'if staging looks off tonight.',
			'',
			'شكراً، سأراجع المستند صباح الغد.',
			'',
			'    git checkout release/3.2',
		])

		const voyage = mockThreadMessages('thread-travel').messages[0]?.body ?? ''
		const images = [
			...voyage.matchAll(/<img src="https:\/\/voyage\.com\/[^"]+" width="\d+" height="\d+" alt="([^"]+)"/g),
		]
		expect(images).toHaveLength(7)
		expect(images.map((match) => match[1])).toEqual(
			expect.arrayContaining(['Lisbon skyline', 'Boarding pass QR']),
		)
		expect(mockThreadMessages('thread-figma').messages[0]?.body).toContain('width="640"')
	})

	it('copies 238 people by name on Alan’s eng-all announcement', () => {
		const announcement = mockThreadMessages('thread-staging-freeze').messages[0]
		expect(announcement?.to).toEqual([{ email: 'eng-all@vercel.com' }])
		expect(announcement?.cc).toHaveLength(238)
		expect(new Set(announcement?.cc?.map((person) => person.email)).size).toBe(238)
		expect(announcement?.cc?.some((person) => person.email === 'ada@ownmail.com')).toBe(false)
	})
})

describe('mock clock helpers', () => {
	it('picks the next given weekday, a full week ahead when it is today', () => {
		const today = new Date().getDay()
		const next = new Date(upcoming(today, 9, 0) * 1000)
		expect(daysBetween(upcoming(today, 9, 0))).toBe(-7)
		expect(next.getDay()).toBe(today)
		expect(daysBetween(upcoming((today + 1) % 7, 9, 0))).toBe(-1)
	})

	it('reaches back a full week when the weekday fell too recently', () => {
		const today = new Date().getDay()
		expect(daysBackTo(today, 2)).toBe(7)
		expect(daysBackTo((today + 4) % 7, 2)).toBe(3)
	})
})

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@tanstack/react-start', () => ({
	createServerFn: () => {
		let validator: ((input: unknown) => unknown) | undefined
		const api = {
			validator(fn: (input: unknown) => unknown) {
				validator = fn
				return api
			},
			handler(fn: (context: { data: unknown }) => unknown) {
				return (options?: { data?: unknown }) =>
					fn({ data: validator ? validator(options?.data) : options?.data })
			},
		}
		return api
	},
}))

const { requireMailbox } = vi.hoisted(() => ({ requireMailbox: vi.fn() }))
vi.mock('#server/mailbox-boundary', () => ({ requireMailbox: () => requireMailbox() }))

const { getInvitationFileTime } = await import('./invitation-file-time.js')

const ICS = [
	'BEGIN:VCALENDAR',
	'METHOD:REQUEST',
	'BEGIN:VEVENT',
	'UID:review@ownmail.dev',
	'DTSTART:20261022T130000Z',
	'DTEND:20261022T134500Z',
	'SUMMARY:Design review',
	'END:VEVENT',
	'END:VCALENDAR',
].join('\r\n')

const invite = { id: 'att-1', filename: 'invite.ics', content_type: 'text/calendar' }

function mailbox(
	attachments: Array<Record<string, unknown>> | undefined,
	response: Response | (() => Promise<Response>) = new Response(ICS),
) {
	return {
		getMessage: vi.fn(async () => ({ data: { id: 'msg-1', attachments } })),
		downloadAttachment: vi.fn(typeof response === 'function' ? response : async () => response),
	}
}

const call = () => getInvitationFileTime({ data: { messageId: 'msg-1', attachmentId: 'att-1' } })

describe('getInvitationFileTime', () => {
	beforeEach(() => {
		requireMailbox.mockReset()
	})

	it('reads the start and end the invitation file proposes', async () => {
		const box = mailbox([invite])
		requireMailbox.mockResolvedValue({ mailbox: box })
		await expect(call()).resolves.toEqual({
			start: Date.UTC(2026, 9, 22, 13) / 1000,
			end: Date.UTC(2026, 9, 22, 13, 45) / 1000,
		})
		expect(box.downloadAttachment).toHaveBeenCalledWith('att-1', 'msg-1')
	})

	it('answers null for a missing, non-calendar or oversized attachment', async () => {
		for (const attachments of [
			undefined,
			[],
			[{ ...invite, content_type: 'application/pdf', filename: 'a.pdf' }],
			[{ ...invite, size: 600_000 }],
		]) {
			requireMailbox.mockResolvedValue({ mailbox: mailbox(attachments) })
			await expect(call()).resolves.toBeNull()
		}
	})

	it('answers null for a failed, empty, oversized, undecodable or unparseable download', async () => {
		const responses = [
			new Response('nope', { status: 404 }),
			new Response(''),
			new Response('x'.repeat(600_000)),
			new Response(new Uint8Array([0xff, 0xfe, 0xfd])),
			new Response('not a calendar'),
			new Response(ICS.replace('DTEND:20261022T134500Z\r\n', '')),
		]
		for (const response of responses) {
			requireMailbox.mockResolvedValue({ mailbox: mailbox([{ ...invite, size: 10 }], response) })
			await expect(call()).resolves.toBeNull()
		}
	})

	it('answers null when the provider throws', async () => {
		requireMailbox.mockResolvedValue({
			mailbox: mailbox([invite], () => Promise.reject(new Error('provider down'))),
		})
		await expect(call()).resolves.toBeNull()
	})

	it('rejects malformed references before reaching the mailbox', async () => {
		expect(() => getInvitationFileTime({ data: { messageId: '', attachmentId: 'att-1' } })).toThrow()
		expect(requireMailbox).not.toHaveBeenCalled()
	})
})

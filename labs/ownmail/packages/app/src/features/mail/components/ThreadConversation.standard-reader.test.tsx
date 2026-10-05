// @vitest-environment jsdom

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { USER_PREFERENCES_STORAGE_KEY } from '#app/preferences/user-preferences'
import type { MailMessage, MailThread } from '../state/mail-queries'
import { THREAD_TOOLBAR_ACTIONS_ID, ThreadConversation } from './ThreadConversation'

/**
 * The Conversation view is optional. The standard reader is the default, and
 * people who never turn the view on must not see their mail rendered any
 * differently. The golden files were recorded from the reader before the
 * Conversation view existed, so any change to them is a regression in the
 * default experience, not a snapshot to refresh. Never run `vitest -u` over
 * this file.
 *
 * They were re-recorded once, deliberately, when this work was replayed onto
 * the stack: from the stack top (account-partitioned state, dea6033) plus the
 * prose-detection fix that precedes this change (replies with quoted history
 * keep the 72ch measure). Nothing of the Conversation view was present.
 *
 * The context menus (a later change) make each message header row a Radix
 * context-menu trigger. Radix adds exactly one attribute to that existing
 * element, `data-state="closed"`, and no element, class or text. That
 * attribute is left out of the comparison, the same way the view switch is;
 * everything else about the header row is still compared.
 */

const { originalColorSendersMock } = vi.hoisted(() => ({ originalColorSendersMock: vi.fn() }))
vi.mock('../lib/image-sender-trust', async (importOriginal) => ({
	...(await importOriginal<typeof import('../lib/image-sender-trust')>()),
	originalColorSenders: originalColorSendersMock,
}))

beforeEach(() => {
	originalColorSendersMock.mockResolvedValue([])
	// Timestamps are formatted in the viewer's locale and zone; pin them so the
	// golden file is the same on every machine.
	vi.spyOn(Date.prototype, 'toLocaleString').mockReturnValue('Mon, Sep 28, 9:12 AM')
})

afterEach(() => {
	cleanup()
	vi.restoreAllMocks()
	localStorage.clear()
	document.body.innerHTML = ''
})

const thread: MailThread = {
	id: 'thread-1',
	subject: 'Offsite agenda draft',
	starred: false,
	folders: ['inbox'],
}

const messages: MailMessage[] = [
	{
		id: 'm1',
		from: [{ name: 'Ines Carvalho', email: 'ines@example.com' }],
		to: [{ name: 'Sam Reader', email: 'sam@example.com' }, { email: 'tomas@example.com' }],
		date: 1_790_586_720,
		body: 'Here is the first draft of the offsite agenda.\n\nThursday afternoon is still open.',
		attachments: [
			{ id: 'a1', filename: 'offsite-agenda-v1.pdf', size: 86_016, content_type: 'application/pdf' },
		],
	},
	{
		id: 'm2',
		from: [{ name: 'Tomas Reyes', email: 'tomas@example.com' }],
		to: [{ email: 'ines@example.com' }],
		cc: [{ email: 'sam@example.com' }],
		date: 1_790_588_400,
		body: '<div>Could we use Thursday afternoon for the <b>planning session</b>?</div><div class="gmail_quote">On Mon, Ines wrote:<blockquote>Here is the first draft.</blockquote></div>',
	},
	{
		id: 'm3',
		from: [{ email: 'sam@example.com' }],
		to: [{ email: 'ines@example.com' }, { email: 'tomas@example.com' }],
		date: 1_790_589_720,
		body: 'Both work for me.\n\nOn Mon, Tomas wrote:\n> Could we use Thursday afternoon?',
	},
]

/** The reader's markup, including each email's shadow tree, without the view switch. */
function readerMarkup(root: HTMLElement): string {
	const copy = root.cloneNode(true) as HTMLElement
	for (const added of copy.querySelectorAll('[data-slot="thread-view-switch"]')) added.remove()
	for (const trigger of copy.querySelectorAll('[data-slot="message-header-row"][data-state="closed"]')) {
		trigger.removeAttribute('data-state')
	}
	// Navigation adds only targeting attributes and one unstyled grouping element.
	// Exclude that scaffolding while still comparing every message and reply control.
	for (const target of copy.querySelectorAll('[data-navigation-content]')) {
		target.removeAttribute('data-navigation-content')
	}
	for (const stream of copy.querySelectorAll('[data-slot="thread-message-stream"]')) {
		expect(stream.tagName).toBe('DIV')
		expect(stream.getAttributeNames()).toEqual(['data-slot'])
		stream.replaceWith(...stream.childNodes)
	}
	const emails = [...root.querySelectorAll('ownmail-email')].map(
		(email) => `<!-- shadow ${email.getAttribute('data-message-id')} -->${email.shadowRoot?.innerHTML ?? ''}`,
	)
	return [copy.innerHTML, ...emails].join('\n')
}

describe('standard reader with the Conversation view off', () => {
	it('renders exactly what it rendered before the Conversation view existed', async () => {
		const { container } = render(
			<ThreadConversation thread={thread} messages={messages} mailboxEmail="sam@example.com">
				<p>after the last message</p>
			</ThreadConversation>,
		)
		fireEvent.click(screen.getByRole('button', { name: 'Expand all 3 messages' }))
		await screen.findByTitle('Email content m2')

		await expect(readerMarkup(container)).toMatchFileSnapshot('./__tests__/standard-reader.golden.txt')
	})

	it('renders the same toolbar actions in the pane toolbar slot', async () => {
		const slot = document.createElement('div')
		slot.id = THREAD_TOOLBAR_ACTIONS_ID
		document.body.appendChild(slot)
		vi.stubGlobal('matchMedia', () => ({
			matches: true,
			addEventListener: () => {},
			removeEventListener: () => {},
		}))

		const { container } = render(
			<ThreadConversation thread={thread} messages={messages} mailboxEmail="sam@example.com" />,
		)
		await screen.findByTitle('Email content m3').catch(() => null)

		await expect(`${readerMarkup(slot)}\n${readerMarkup(container)}`).toMatchFileSnapshot(
			'./__tests__/standard-reader-toolbar.golden.txt',
		)
		vi.unstubAllGlobals()
	})

	it('stays on the standard reader when an older build stored an unknown thread view', async () => {
		localStorage.setItem(USER_PREFERENCES_STORAGE_KEY, JSON.stringify({ threadView: 'timeline' }))
		const { container } = render(
			<ThreadConversation thread={thread} messages={messages} mailboxEmail="sam@example.com">
				<p>after the last message</p>
			</ThreadConversation>,
		)
		fireEvent.click(screen.getByRole('button', { name: 'Expand all 3 messages' }))
		await screen.findByTitle('Email content m2')

		// Compared, not recorded: only the first test may write the golden file.
		// React numbers its generated ids across the whole test file, so they are
		// the one thing that differs between the first render and this one.
		const withoutReactIds = (markup: string) => markup.replace(/_r_\w+_/g, '_r_')
		expect(withoutReactIds(readerMarkup(container))).toBe(
			withoutReactIds(
				readFileSync(
					join(dirname(fileURLToPath(import.meta.url)), '__tests__/standard-reader.golden.txt'),
					'utf8',
				),
			),
		)
	})
})

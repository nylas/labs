import { afterEach, describe, expect, it, vi } from 'vitest'
import {
	alwaysForLabel,
	clockTime,
	cutAtWord,
	editedAgo,
	firstNameFromAddress,
	fitPercent,
	hiddenImagesText,
	knownNameFor,
	pendingSendAt,
	recipientAddresses,
	reflowPlainText,
	scheduledLabel,
	senderDomain,
	textKey,
	viewerZone,
} from './edge-states.js'

// Saturday, October 17 2026, 12:00 UTC.
const NOW = Date.UTC(2026, 9, 17, 12, 0) / 1000
const at = (day: number, hour: number, minute = 0) => Date.UTC(2026, 9, day, hour, minute) / 1000

afterEach(() => {
	vi.restoreAllMocks()
})

describe('viewerZone', () => {
	it('is the browser zone, or UTC when Intl cannot tell', () => {
		expect(viewerZone()).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone)
		vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({
			timeZone: '',
		} as Intl.ResolvedDateTimeFormatOptions)
		expect(viewerZone()).toBe('UTC')
	})
})

describe('clockTime', () => {
	it('formats a time in the zone, falling back to UTC for an unknown zone', () => {
		expect(clockTime(at(17, 9), 'UTC')).toBe('9:00 AM')
		expect(clockTime(at(17, 9), 'America/Los_Angeles')).toBe('2:00 AM')
		expect(clockTime(at(17, 9), 'Not/AZone')).toBe('9:00 AM')
	})
})

describe('editedAgo', () => {
	it('counts minutes and hours, then names the day', () => {
		expect(editedAgo(NOW - 30, NOW, 'UTC')).toBe('just now')
		expect(editedAgo(NOW - 12 * 60, NOW, 'UTC')).toBe('12 min ago')
		expect(editedAgo(NOW - 2 * 3600, NOW * 1000, 'UTC')).toBe('2 h ago')
		expect(editedAgo(at(16, 9), NOW, 'UTC')).toBe('yesterday')
		expect(editedAgo(at(13, 9), NOW, 'UTC')).toBe('Tue')
		expect(editedAgo(at(1, 9), NOW, 'UTC')).toBe('Oct 1')
	})
})

describe('scheduledLabel', () => {
	it('says today, the weekday within the week, else the date', () => {
		expect(scheduledLabel(at(17, 15), NOW, 'UTC')).toBe('today 3:00 PM')
		expect(scheduledLabel(at(19, 9), NOW * 1000, 'UTC')).toBe('Mon 9:00 AM')
		expect(scheduledLabel(at(29, 9), NOW, 'UTC')).toBe('Oct 29 9:00 AM')
		expect(scheduledLabel(at(12, 9), NOW, 'Not/AZone')).toBe('Oct 12 9:00 AM')
	})
})

describe('pendingSendAt', () => {
	it('returns a scheduled time only while it is still ahead', () => {
		expect(pendingSendAt({ send_at: NOW + 60 }, NOW)).toBe(NOW + 60)
		expect(pendingSendAt({ send_at: NOW - 60 }, NOW * 1000)).toBeNull()
		expect(pendingSendAt({ send_at: '1' }, NOW)).toBeNull()
		expect(pendingSendAt({ send_at: Number.NaN }, NOW)).toBeNull()
		expect(pendingSendAt({}, NOW)).toBeNull()
	})
})

describe('reflowPlainText', () => {
	it('joins hard-wrapped lines and keeps short lines broken', () => {
		expect(
			reflowPlainText(
				'The release went out at 6 and the rollback plan is in the doc. Ping me\nif staging looks off tonight.\n\nThanks,\nAlan',
			),
		).toEqual([
			{
				kind: 'text',
				text: 'The release went out at 6 and the rollback plan is in the doc. Ping me if staging looks off tonight.',
			},
			{ kind: 'text', text: 'Thanks,\nAlan' },
		])
	})

	it('never joins a list item, a quote or an indented line onto the line before', () => {
		const wrapped = 'Here are the steps we agreed on for the release on Friday:'
		expect(reflowPlainText(`${wrapped}\n- build\n> quoted\n1. first\n  indented`)).toEqual([
			{ kind: 'text', text: `${wrapped}\n- build\n> quoted\n1. first\n  indented` },
		])
	})

	it('keeps a line longer than the wrap width on its own', () => {
		const long = 'x '.repeat(50).trim()
		expect(reflowPlainText(`${long}\nnext line`)).toEqual([{ kind: 'text', text: `${long}\nnext line` }])
	})

	it('keeps indented and fenced blocks as code, without their shared indent', () => {
		expect(reflowPlainText('    git checkout release/3.2\n      git push')).toEqual([
			{ kind: 'code', text: 'git checkout release/3.2\n  git push' },
		])
		expect(reflowPlainText('```\nconst a = 1\n```')).toEqual([{ kind: 'code', text: 'const a = 1' }])
		expect(reflowPlainText('```')).toEqual([{ kind: 'text', text: '```' }])
	})

	it('normalises line endings, drops empty paragraphs and keeps blank-line runs as one break', () => {
		expect(reflowPlainText('one\r\n\r\n\r\n\ntwo\r\n   \n')).toEqual([
			{ kind: 'text', text: 'one' },
			{ kind: 'text', text: 'two' },
		])
	})

	it('splits code-indented lines inside a prose paragraph out as code', () => {
		expect(reflowPlainText('Run this:\n    npm install\n    npm test\nthen done.')).toEqual([
			{ kind: 'text', text: 'Run this:' },
			{ kind: 'code', text: 'npm install\nnpm test' },
			{ kind: 'text', text: 'then done.' },
		])
		expect(reflowPlainText('Last step:\n\tmake deploy')).toEqual([
			{ kind: 'text', text: 'Last step:' },
			{ kind: 'code', text: 'make deploy' },
		])
	})

	it('keeps a list item’s indented continuation as part of the item', () => {
		expect(reflowPlainText('Steps:\n- build it\n      on the release branch\nDone.')).toEqual([
			{ kind: 'text', text: 'Steps:\n- build it\n      on the release branch\nDone.' },
		])
	})

	it('drops whitespace on a wrapped line join', () => {
		const wrapped = 'A sentence that is long enough to have been wrapped by a client'
		expect(reflowPlainText(`${wrapped}   \ncontinues here`)).toEqual([
			{ kind: 'text', text: `${wrapped} continues here` },
		])
	})
})

describe('textKey', () => {
	it('is stable for equal text and distinct by position', () => {
		expect(textKey('Hello', 0)).toBe(textKey('Hello', 0))
		expect(textKey('Hello', 0)).not.toBe(textKey('Hello', 1))
		expect(textKey('Hello', 0)).not.toBe(textKey('Hullo', 0))
	})
})

describe('images and fitting words', () => {
	it('names the sender domain', () => {
		expect(senderDomain('trips@Voyage.com')).toBe('voyage.com')
		expect(senderDomain('no-at-sign')).toBe('')
		expect(senderDomain(undefined)).toBe('')
	})

	it('counts hidden images', () => {
		expect(hiddenImagesText(7, 'voyage.com')).toBe('7 images from voyage.com are hidden')
		expect(hiddenImagesText(1, 'voyage.com')).toBe('1 image from voyage.com is hidden')
		expect(hiddenImagesText(0, 'voyage.com')).toBe('Images from voyage.com are hidden')
		expect(hiddenImagesText(2, '')).toBe('2 images are hidden')
	})

	it('names who to always trust', () => {
		expect(alwaysForLabel('Voyage', 'voyage.com')).toBe('Always for Voyage')
		expect(alwaysForLabel(' ', 'voyage.com')).toBe('Always for voyage.com')
		expect(alwaysForLabel(undefined, '')).toBe('Always for this sender')
	})

	it('rounds the fitted scale to a percent within 0–100', () => {
		expect(fitPercent(0.823)).toBe(82)
		expect(fitPercent(1.4)).toBe(100)
		expect(fitPercent(-1)).toBe(0)
	})
})

describe('cutAtWord', () => {
	it('cuts at a word and drops trailing punctuation', () => {
		expect(
			cutAtWord(
				'Here is v3. I tightened the intro and moved billing to its own section. Please flag anything before Friday.',
				72,
			),
		).toBe('Here is v3. I tightened the intro and moved billing to its own section…')
		expect(cutAtWord('  short   text ', 72)).toBe('short text')
		expect(cutAtWord('x'.repeat(80), 10)).toBe(`${'x'.repeat(10)}…`)
	})
})

describe('recipients', () => {
	it('takes a first name from an address', () => {
		expect(firstNameFromAddress('alan.turing@bletchley.dev')).toBe('Alan')
		expect(firstNameFromAddress(' grace@vercel.com')).toBe('Grace')
		expect(firstNameFromAddress('@x.com')).toBe('')
	})

	it('finds the name a loaded thread knows for an address, the replied message first', () => {
		const threads = [
			undefined,
			{
				messages: [
					{ id: 'm0' },
					{ id: 'm1', from: [{ name: 'A. Turing', email: 'alan@x.com' }] },
					{ id: 'm2', from: [{ email: 'grace@x.com' }], to: [{ name: ' ', email: 'alan@x.com' }] },
					{
						id: 'm3',
						from: [{ name: 'Grace', email: 'grace@x.com' }],
						cc: [{ name: 'Alan Turing', email: 'ALAN@x.com ' }],
					},
				],
			},
		]
		expect(knownNameFor('alan@x.com', threads, 'm3')).toBe('Alan Turing')
		expect(knownNameFor('alan@x.com', threads)).toBe('A. Turing')
		expect(knownNameFor('nobody@x.com', threads, 'm1')).toBeUndefined()
		expect(knownNameFor('alan@x.com', [])).toBeUndefined()
	})

	it('lists distinct addresses from a recipient field', () => {
		expect(recipientAddresses('a@x.com, Grace <g@x.com>; A@x.com,, ')).toEqual(['a@x.com', 'g@x.com'])
	})
})

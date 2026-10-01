// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CALENDAR_RANGE_START, calendarKeys } from '#features/calendar/state/calendar-keys'
import { contactsKeys } from '#features/contacts/state/contacts-state'
import { mailKeys } from '#features/mail/state/mail-queries'
import {
	accountScope,
	observeAccount,
	onAccountChanged,
	resetAccountScope,
	setAccountScope,
	UNKNOWN_ACCOUNT_SCOPE,
} from './account-scope.js'

vi.mock('#server/fns', () => ({}))
vi.mock('#features/calendar/server/calendar-fns', () => ({}))

afterEach(() => resetAccountScope())

describe('account scope', () => {
	it('adopts the first mailbox a response names, normalized', () => {
		expect(accountScope()).toBe(UNKNOWN_ACCOUNT_SCOPE)

		observeAccount('  Ada@OwnMail.com ')

		expect(accountScope()).toBe('ada@ownmail.com')
	})

	it('ignores values that are not a usable mailbox address', () => {
		// The email comes from a response body: it is validated, never trusted.
		for (const email of [undefined, null, 42, '', 'no-at-sign', `${'a'.repeat(320)}@x.com`, 'a@b\r\nc']) {
			observeAccount(email)
			expect(accountScope()).toBe(UNKNOWN_ACCOUNT_SCOPE)
		}
	})

	it('reports a different mailbox instead of silently adopting it', () => {
		const changed = vi.fn()
		const unsubscribe = onAccountChanged(changed)
		observeAccount('ada@ownmail.com')
		observeAccount('ADA@ownmail.com')
		expect(changed).not.toHaveBeenCalled()

		// Another tab switched inbox, or the person signed in again: the tab
		// must not start filing the new inbox's data under the old one's keys.
		observeAccount('grace@ownmail.com')

		expect(changed).toHaveBeenCalledExactlyOnceWith('grace@ownmail.com')
		expect(accountScope()).toBe('ada@ownmail.com')

		unsubscribe()
		observeAccount('grace@ownmail.com')
		expect(changed).toHaveBeenCalledOnce()
	})

	it('can be stated outright once a switch has loaded the next inbox', () => {
		observeAccount('ada@ownmail.com')

		setAccountScope('Grace@OwnMail.com')
		expect(accountScope()).toBe('grace@ownmail.com')

		setAccountScope(undefined)
		expect(accountScope()).toBe(UNKNOWN_ACCOUNT_SCOPE)
	})

	it('roots every query key in the account, so one inbox never reads another’s entries', () => {
		observeAccount('ada@ownmail.com')
		const adaKeys = [
			mailKeys.folders(),
			mailKeys.threadList({ folderId: 'inbox' }),
			mailKeys.threadDetail('t1'),
			calendarKeys.range(1, 2),
			calendarKeys.invitation('m1', 'a1'),
			contactsKeys.list(),
			contactsKeys.detail('c1'),
		]
		for (const key of adaKeys) expect(key[1]).toBe('ada@ownmail.com')

		resetAccountScope()
		observeAccount('grace@ownmail.com')

		// The same folder, range and contact ids are different entries for Grace.
		expect(mailKeys.folders()).not.toEqual(adaKeys[0])
		expect(mailKeys.threadDetail('t1')).toEqual(['mail', 'grace@ownmail.com', 'thread', 't1'])
		expect(calendarKeys.range(1, 2)).toEqual(['calendar', 'grace@ownmail.com', 'range', 1, 2, ''])
		expect(calendarKeys.range(1, 2, ['work'])[CALENDAR_RANGE_START]).toBe(1)
		expect(calendarKeys.ranges()).toEqual(['calendar', 'grace@ownmail.com', 'range'])
		expect(contactsKeys.detail('c1')).toEqual(['contacts', 'grace@ownmail.com', 'detail', 'c1'])
	})
})

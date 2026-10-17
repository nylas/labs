// @vitest-environment jsdom

import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { Person } from '../lib/thread-reading-model.js'
import { Avatar, AvatarStack, avatarHue, avatarInitials } from './Avatar.js'

afterEach(cleanup)

const ALAN: Person = { name: 'Alan Turing', email: 'alan@bletchley.dev', isOwner: false }
const GRACE: Person = { name: 'Grace Hopper', email: 'grace.hopper@vercel.com', isOwner: false }
const ADA: Person = { name: 'Ada Lovelace', email: 'ada@ownmail.com', isOwner: true }
const PM_LEADS: Person = { name: '', email: 'pm-leads@vercel.com', isOwner: false }

describe('avatar identity', () => {
	it('tints a person by their address and the owner green', () => {
		expect(avatarHue(ALAN)).toBe(250)
		expect(avatarHue(ADA)).toBe(158)
	})

	it('takes initials from the name, else the address', () => {
		expect(avatarInitials(ALAN)).toBe('AT')
		expect(avatarInitials(PM_LEADS)).toBe('PM')
		expect(avatarInitials({ name: ' ', email: '@nowhere' })).toBe('?')
	})
})

describe('Avatar', () => {
	it('draws the initials on the person’s tint, hidden from assistive technology', () => {
		const { container } = render(<Avatar person={ALAN} size={32} className="extra" />)
		const avatar = container.querySelector('[data-slot="avatar"]') as HTMLElement
		expect(avatar).toHaveTextContent('AT')
		expect(avatar).toHaveAttribute('aria-hidden', 'true')
		expect(avatar).toHaveAttribute('data-hue', '250')
		expect(avatar.className).toContain('bg-avatar-250')
		expect(avatar.className).toContain('size-8')
		expect(avatar.className).toContain('extra')
		expect(avatar.className).not.toContain('ring-2')
	})

	it('rings an avatar in the page colour when asked', () => {
		const { container } = render(<Avatar person={ADA} size={18} ring />)
		expect((container.firstChild as HTMLElement).className).toContain('ring-2')
	})
})

describe('AvatarStack', () => {
	it('overlaps up to the maximum, 6px at 24 and 5px at 20', () => {
		const { container, rerender } = render(<AvatarStack people={[GRACE, ALAN, ADA]} size={24} max={2} />)
		let avatars = container.querySelectorAll<HTMLElement>('[data-slot="avatar"]')
		expect(avatars).toHaveLength(2)
		expect(avatars[0]?.style.marginInlineStart).toBe('')
		expect(avatars[1]?.style.marginInlineStart).toBe('-6px')
		rerender(<AvatarStack people={[GRACE, ALAN, ADA]} size={20} />)
		avatars = container.querySelectorAll<HTMLElement>('[data-slot="avatar"]')
		expect(avatars).toHaveLength(3)
		expect(avatars[2]?.style.marginInlineStart).toBe('-5px')
	})

	it('always shows at least one person, even without an address', () => {
		const nameless: Person = { name: 'Someone', email: '', isOwner: false }
		const { container } = render(<AvatarStack people={[nameless, ALAN]} size={20} max={0} />)
		expect(container.querySelectorAll('[data-slot="avatar"]')).toHaveLength(1)
	})
})

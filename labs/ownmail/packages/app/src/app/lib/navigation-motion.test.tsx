// @vitest-environment jsdom
import type { AnyRouter, RouterEvents } from '@tanstack/react-router'
import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NavigationMotion } from '#app/components/NavigationMotion'
import { resetAccountScope, setAccountScope } from './account-scope.js'
import { setSwitchingTo } from './account-switch-status.js'
import { navigationMotion, observeNavigationMotion, skipNextNavigationMotion } from './navigation-motion.js'

const context = vi.hoisted(() => ({ router: undefined as unknown }))
vi.mock('@tanstack/react-router', () => ({ useRouter: () => context.router }))

const location = (pathname: string, search = {}) => ({ pathname, search })
const inbox = location('/mail/f/inbox')
const reader = location('/mail/f/inbox/t/one')

describe('navigation relationships', () => {
	it.each([
		[inbox, reader, 'mail-reader', 1],
		[reader, inbox, 'mail-list', -1],
		[reader, location('/mail/f/inbox/t/two'), 'mail-reader', 0],
		[inbox, location('/mail/f/sent'), 'mail-list', 0],
		[inbox, location('/mail/f/label', { baseFolderId: 'sent' }), 'mail-list', 0],
		[inbox, location('/calendar/week'), 'calendar', 0],
		[location('/calendar/week'), location('/calendar/week', { date: '2026-10-06' }), 'calendar', 0],
		[location('/calendar/week'), location('/calendar/month'), 'calendar', 0],
		[inbox, location('/settings'), 'settings', 0],
		[location('/settings'), location('/contacts'), 'contact-list', 0],
		[location('/contacts'), location('/contacts/ada'), 'contact-detail', 1],
		[location('/contacts/ada'), location('/contacts'), 'contact-list', -1],
		[location('/contacts/ada'), location('/contacts/grace'), 'contact-detail', 0],
		[
			location('/mail/search', { q: 'hello' }),
			location('/mail/search', { q: 'hello', threadId: 'one' }),
			'mail-reader',
			1,
		],
		[
			location('/mail/search', { q: 'hello', threadId: 'one' }),
			location('/mail/search', { q: 'hello' }),
			'mail-list',
			-1,
		],
		[
			location('/mail/search', { q: 'hello' }),
			location('/mail/search', { q: 'other', folderId: 'sent' }),
			'mail-list',
			0,
		],
	])('chooses the changing pane and depth for %j → %j', (from, to, region, direction) => {
		expect(navigationMotion(from, to)).toMatchObject({ region, direction })
	})
	it.each([
		[inbox, inbox],
		[reader, reader],
		[location('/settings'), location('/settings', { unrelated: 'value' })],
		[location('/mail/search', { q: 42, threadId: {} }), location('/mail/search')],
		[location('/login'), inbox],
		[inbox, location('/logout')],
	])('leaves hydration, refreshes and non-app destinations alone', (from, to) => {
		expect(navigationMotion(from, to)).toBeUndefined()
	})
})

describe('committed navigation motion', () => {
	let listeners: Map<string, (event: unknown) => void>
	let router: AnyRouter
	let media: EventTarget & { matches: boolean }
	let narrow: boolean
	let surface: HTMLDivElement
	let content: HTMLDivElement
	let animations: { cancel: ReturnType<typeof vi.fn> }[]
	let animate: ReturnType<typeof vi.fn>
	let stop: (() => void) | undefined

	function emit(type: 'onBeforeNavigate' | 'onRendered', from = inbox, to = reader) {
		listeners.get(type)?.({ fromLocation: from, toLocation: to })
	}
	function navigate(from = inbox, to = reader) {
		emit('onBeforeNavigate', from, to)
		emit('onRendered', from, to)
	}

	beforeEach(() => {
		listeners = new Map()
		router = {
			subscribe: (type: keyof RouterEvents, listener: (event: unknown) => void) => {
				listeners.set(type, listener)
				return () => listeners.delete(type)
			},
		} as unknown as AnyRouter
		context.router = router
		media = Object.assign(new EventTarget(), { matches: false })
		narrow = true
		vi.stubGlobal('matchMedia', (query: string) => (query.includes('reduced') ? media : { matches: narrow }))
		surface = document.createElement('div')
		surface.dataset.navigationRegion = 'mail-reader'
		document.body.append(surface)
		animations = []
		animate = vi.fn(() => {
			const animation = { cancel: vi.fn() }
			animations.push(animation)
			return animation
		})
		surface.animate = animate
		content = document.createElement('div')
		content.dataset.navigationContent = ''
		content.animate = animate
		surface.append(content)
	})
	afterEach(() => {
		cleanup()
		stop?.()
		stop = undefined
		surface.remove()
		resetAccountScope()
		setSwitchingTo(null)
		vi.unstubAllGlobals()
	})

	it('subscribes through the component, waits for committed DOM, and cleans up', () => {
		const { unmount } = render(<NavigationMotion />)
		emit('onBeforeNavigate')
		expect(animate).not.toHaveBeenCalled()
		emit('onRendered')
		expect(animate).toHaveBeenNthCalledWith(1, [{ opacity: 0.6 }, { opacity: 1 }], {
			duration: 120,
			easing: 'ease-out',
		})
		expect(animate).toHaveBeenNthCalledWith(2, [{ translate: 'calc(12px * 1) 0' }, { translate: '0 0' }], {
			duration: 220,
			easing: 'ease-out',
		})
		expect(animate.mock.contexts).toEqual([content, surface])
		unmount()
		expect(listeners.size).toBe(0)
		expect(animations.every((animation) => animation.cancel.mock.calls.length === 1)).toBe(true)
	})

	it('uses system tokens, reverses depth, and preserves the existing scroll and focus', () => {
		surface.dataset.navigationRegion = 'mail-list'
		surface.style.cssText =
			'--dur-fast: 100ms; --dur-medium: 200ms; --ease-out: ease; --motion-navigation-distance: 8px'
		surface.tabIndex = 0
		surface.focus()
		surface.scrollTop = 140
		stop = observeNavigationMotion(router)
		navigate(reader, inbox)
		expect(animate.mock.calls[0][1]).toEqual({ duration: 100, easing: 'ease' })
		expect(animate.mock.calls[1]).toEqual([
			[{ translate: 'calc(8px * -1) 0' }, { translate: '0 0' }],
			{ duration: 200, easing: 'ease' },
		])
		expect(surface).toHaveFocus()
		expect(surface.scrollTop).toBe(140)
	})

	it('only fades a desktop detail pane and never animates the surrounding shell', () => {
		narrow = false
		stop = observeNavigationMotion(router)
		navigate()
		expect(animate).toHaveBeenCalledTimes(1)
	})

	it('only fades peer navigation even on mobile', () => {
		stop = observeNavigationMotion(router)
		navigate(reader, location('/mail/f/inbox/t/two'))
		expect(animate).toHaveBeenCalledTimes(1)
		expect(animate.mock.contexts).toEqual([content])
	})

	it.each([false, true])(
		'keeps folder and search reader controls outside the fade (search: %s)',
		(search) => {
			const toolbar = document.createElement('div')
			toolbar.dataset.slot = 'toolbar'
			surface.prepend(toolbar)
			narrow = false
			stop = observeNavigationMotion(router)
			navigate(
				search ? location('/mail/search', { q: 'hello', threadId: 'one' }) : reader,
				search ? location('/mail/search', { q: 'hello', threadId: 'two' }) : location('/mail/f/inbox/t/two'),
			)
			expect(animate.mock.contexts).toEqual([content])
			expect(content.contains(toolbar)).toBe(false)
		},
	)

	it('never falls back to fading the toolbar when pending content is absent or cannot animate', () => {
		stop = observeNavigationMotion(router)
		content.remove()
		navigate(reader, location('/mail/f/inbox/t/two'))
		expect(animate).not.toHaveBeenCalled()
		surface.append(content)
		Object.defineProperty(content, 'animate', { value: undefined })
		navigate(reader, location('/mail/f/inbox/t/two'))
		expect(animate).not.toHaveBeenCalled()
	})

	it.each(['pointerdown', 'touchstart', 'keydown'])('cancels immediately on %s', (type) => {
		stop = observeNavigationMotion(router)
		navigate()
		document.dispatchEvent(new Event(type))
		expect(animations.every((animation) => animation.cancel.mock.calls.length === 1)).toBe(true)
	})

	it('cancels on the next navigation instead of queuing animations', () => {
		stop = observeNavigationMotion(router)
		navigate()
		emit('onBeforeNavigate')
		expect(animations.every((animation) => animation.cancel.mock.calls.length === 1)).toBe(true)
		emit('onRendered')
		expect(animate).toHaveBeenCalledTimes(4)
		// A rendered acknowledgement on its own also clears the previous effects.
		emit('onRendered', reader, reader)
		expect(animations.every((animation) => animation.cancel.mock.calls.length === 1)).toBe(true)
	})

	it('honors reduced motion initially and when enabled during a transition', () => {
		media.matches = true
		stop = observeNavigationMotion(router)
		navigate()
		expect(animate).not.toHaveBeenCalled()
		media.matches = false
		navigate()
		media.matches = true
		media.dispatchEvent(new Event('change'))
		expect(animations.every((animation) => animation.cancel.mock.calls.length === 1)).toBe(true)
	})

	it('does not replay motion after a committed swipe; the next ordinary navigation animates', () => {
		stop = observeNavigationMotion(router)
		skipNextNavigationMotion(router)
		navigate()
		expect(animate).not.toHaveBeenCalled()
		navigate()
		expect(animate).toHaveBeenCalledTimes(2)
	})

	it('never animates across accounts or during the account-switch loader', () => {
		setAccountScope('ada@example.com')
		stop = observeNavigationMotion(router)
		setAccountScope('grace@example.com')
		navigate()
		expect(animate).not.toHaveBeenCalled()
		setSwitchingTo('ada@example.com')
		navigate()
		expect(animate).not.toHaveBeenCalled()
	})

	it('skips initial renders, missing surfaces, and unsupported browser APIs', () => {
		stop = observeNavigationMotion(router)
		listeners.get('onRendered')?.({ toLocation: inbox })
		navigate(inbox, location('/contacts'))
		Object.defineProperty(surface, 'animate', { value: undefined })
		navigate()
		expect(animate).not.toHaveBeenCalled()
		stop?.()
		vi.stubGlobal('matchMedia', undefined)
		expect(observeNavigationMotion(router)).toBeUndefined()
	})
})

import type { AnyRouter, ParsedLocation } from '@tanstack/react-router'
import { accountScope } from './account-scope.js'
import { readSwitchingTo } from './account-switch-status.js'

type Location = Pick<ParsedLocation, 'pathname' | 'search'>
type Destination = { area: string; list: string; detail: string; region: string }

function destination({ pathname, search }: Location): Destination | undefined {
	const parts = pathname.split('/').filter(Boolean)
	const params = search as Record<string, unknown>
	const value = (key: string) => (typeof params[key] === 'string' ? params[key] : '')
	if (parts[0] === 'mail') {
		const detail = parts[1] === 'search' ? value('threadId') : (parts[4] ?? '')
		return {
			area: 'mail',
			list: JSON.stringify([parts[1], parts[2], value('q'), value('folderId'), value('baseFolderId')]),
			detail,
			region: detail ? 'mail-reader' : 'mail-list',
		}
	}
	if (parts[0] === 'contacts') {
		const detail = parts[1] ?? ''
		return { area: 'contacts', list: value('q'), detail, region: detail ? 'contact-detail' : 'contact-list' }
	}
	if (parts[0] === 'calendar')
		return {
			area: 'calendar',
			list: JSON.stringify([pathname, value('date')]),
			detail: '',
			region: 'calendar',
		}
	if (pathname === '/settings') return { area: 'settings', list: '', detail: '', region: 'settings' }
}

/** Spatial cues describe depth only. Peers (including adjacent threads) just fade. */
export function navigationMotion(from: Location, to: Location) {
	const previous = destination(from)
	const next = destination(to)
	if (!previous || !next) return undefined
	const sameList = previous.area === next.area && previous.list === next.list
	if (sameList && previous.detail === next.detail) return undefined
	const direction =
		sameList && !previous.detail && next.detail ? 1 : sameList && previous.detail && !next.detail ? -1 : 0
	return { region: next.region, direction, breakpoint: next.area === 'mail' ? 1280 : 768 }
}

// A committed finger-following gesture already provided the transition.
const gestureReturns = new WeakSet<AnyRouter>()
export function skipNextNavigationMotion(router: AnyRouter) {
	gestureReturns.add(router)
}

/** Animate only newly committed DOM. Never snapshot or retain the outgoing identity. */
export function observeNavigationMotion(router: AnyRouter) {
	if (typeof window.matchMedia !== 'function') return
	const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')
	let animations: Animation[] = []
	let account = accountScope()
	let skip = false
	const cancel = () => {
		for (const animation of animations) animation.cancel()
		animations = []
	}
	const before = router.subscribe('onBeforeNavigate', () => {
		cancel()
		skip = gestureReturns.delete(router)
	})
	const rendered = router.subscribe('onRendered', ({ fromLocation, toLocation }) => {
		cancel()
		const changedAccount = account !== accountScope()
		account = accountScope()
		if (!fromLocation || reduced.matches || skip || changedAccount || readSwitchingTo()) return
		const motion = navigationMotion(fromLocation, toLocation)
		if (!motion) return
		const surface = document.querySelector<HTMLElement>(`[data-navigation-region="${motion.region}"]`)
		if (!surface || typeof surface.animate !== 'function') return
		const tokens = getComputedStyle(surface)
		const fast = Number.parseFloat(tokens.getPropertyValue('--dur-fast')) || 120
		const medium = Number.parseFloat(tokens.getPropertyValue('--dur-medium')) || 220
		const easing = tokens.getPropertyValue('--ease-out').trim() || 'ease-out'
		// The reader's persistent controls must not dim on every thread change.
		// Fade only its content; a pending reader without content needs no fade.
		const contents =
			motion.region === 'mail-reader'
				? surface.querySelectorAll<HTMLElement>('[data-navigation-content]')
				: [surface]
		for (const content of contents) {
			if (typeof content.animate === 'function') {
				animations.push(content.animate([{ opacity: 0.6 }, { opacity: 1 }], { duration: fast, easing }))
			}
		}
		if (motion.direction && window.matchMedia(`(width < ${motion.breakpoint}px)`).matches) {
			const distance = tokens.getPropertyValue('--motion-navigation-distance').trim() || '12px'
			animations.push(
				surface.animate([{ translate: `calc(${distance} * ${motion.direction}) 0` }, { translate: '0 0' }], {
					duration: medium,
					easing,
				}),
			)
		}
	})
	// Interaction always wins over settling motion, including a live preference change.
	reduced.addEventListener('change', cancel)
	document.addEventListener('pointerdown', cancel, true)
	document.addEventListener('touchstart', cancel, { passive: true, capture: true })
	document.addEventListener('keydown', cancel, true)
	return () => {
		cancel()
		before()
		rendered()
		gestureReturns.delete(router)
		reduced.removeEventListener('change', cancel)
		document.removeEventListener('pointerdown', cancel, true)
		document.removeEventListener('touchstart', cancel, true)
		document.removeEventListener('keydown', cancel, true)
	}
}

// @vitest-environment jsdom
import { act, cleanup, render, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { hydrateRoot } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
	browserPreferenceCookie,
	encodePreferenceCookie,
	MAX_PREFERENCE_COOKIE_LENGTH,
	readPreferenceCookie,
	USER_PREFERENCES_COOKIE,
	writePreferenceCookie,
} from './preference-cookie.js'
import {
	defaultUserPreferences,
	readUserPreferences,
	USER_PREFERENCES_STORAGE_KEY,
	UserPreferencesProvider,
	useLocalPreferencesReady,
	userPreferencesTestApi,
	useUserPreferences,
	useUserPreferencesReady,
	writeUserPreferences,
} from './user-preferences.js'

const header = (value: string) => `${USER_PREFERENCES_COOKIE}=${value}`
const saved = () => ({
	...defaultUserPreferences(),
	readingPane: 'horizontal' as const,
	listDensity: 'compact' as const,
	primaryTimezone: 'America/Toronto',
})

beforeEach(() => {
	localStorage.clear()
	userPreferencesTestApi.reset()
})
afterEach(() => {
	cleanup()
	vi.restoreAllMocks()
	vi.unstubAllGlobals()
})

describe('bounded preference cookie', () => {
	it('round-trips presentation choices without sending account names, addresses or calendar IDs', () => {
		const preferences = {
			...saved(),
			displayNameByAccount: { 'ada@example.com': 'Private Name' },
			hiddenCalendarsByAccount: { 'ada@example.com': ['private-calendar'] },
		}
		const encoded = encodePreferenceCookie(preferences)
		expect(encoded.length).toBeLessThan(400)
		expect(encoded.length).toBeLessThan(MAX_PREFERENCE_COOKIE_LENGTH)
		expect(decodeURIComponent(encoded)).not.toMatch(/Private Name|ada@example|private-calendar/)
		expect(readPreferenceCookie(`unrelated=value; ${header(encoded)}; another=value`)).toEqual({
			...saved(),
			displayNameByAccount: {},
			hiddenCalendarsByAccount: {},
		})
	})

	it('rejects malformed, ambiguous, oversized and unsupported cookies', () => {
		const valid = encodePreferenceCookie(saved())
		for (const value of [
			'',
			'other=value',
			header('%zz'),
			header('{'),
			header('null'),
			header('{}'),
			header(encodeURIComponent('[2]')),
			header('x'.repeat(1025)),
			`${header(valid)}; ${header(valid)}`,
		]) {
			expect(readPreferenceCookie(value)).toBeNull()
		}
		const tuple = JSON.parse(decodeURIComponent(valid))
		for (const [index, invalid] of [
			[0, 2],
			[1, 'diagonal'],
			[2, 'tiny'],
			[3, 'timeline'],
			[4, 'unsafe'],
			[5, 'unsafe'],
			[6, 'true'],
			[7, 0],
			[8, 1],
			[9, null],
			[10, 'not/a-zone'],
			[10, 'x'.repeat(101)],
			[11, 'America/Toronto'],
			[12, 'false'],
			[13, 'sometimes'],
		] as const) {
			const tampered = [...tuple]
			tampered[index] = invalid
			expect(readPreferenceCookie(header(encodeURIComponent(JSON.stringify(tampered))))).toBeNull()
		}
	})

	it('writes a host-only year-long cookie synchronously, with Secure on HTTPS', () => {
		const setter = vi.spyOn(document, 'cookie', 'set').mockImplementation(() => {})
		vi.stubGlobal('window', { location: { protocol: 'https:' } })
		writePreferenceCookie(saved())
		expect(setter).toHaveBeenLastCalledWith(
			`${header(encodePreferenceCookie(saved()))}; Path=/; Max-Age=31536000; SameSite=Lax; Secure`,
		)
		vi.stubGlobal('window', { location: { protocol: 'http:' } })
		writePreferenceCookie(saved())
		expect(setter).toHaveBeenLastCalledWith(
			`${header(encodePreferenceCookie(saved()))}; Path=/; Max-Age=31536000; SameSite=Lax`,
		)
	})

	it('tolerates blocked cookie reads', () => {
		vi.spyOn(document, 'cookie', 'get').mockImplementation(() => {
			throw new Error('blocked')
		})
		expect(browserPreferenceCookie()).toBe('')
		expect(() => writePreferenceCookie(saved())).not.toThrow()
		writeUserPreferences(saved())
		expect(readUserPreferences()).toEqual(saved())
		userPreferencesTestApi.reset()
		expect(readUserPreferences()).toEqual(saved())
	})

	it('keeps changes for the visit when both persistence mechanisms are blocked', () => {
		vi.spyOn(document, 'cookie', 'set').mockImplementation(() => {
			throw new Error('blocked')
		})
		vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
			throw new Error('blocked')
		})
		writeUserPreferences(saved())
		expect(readUserPreferences()).toEqual(saved())
	})
})

describe('server and browser preference continuity', () => {
	it('automatically migrates legacy localStorage while retaining account-owned maps locally', () => {
		const legacy = {
			...saved(),
			displayNameByAccount: { 'ada@example.com': 'Ada' },
			hiddenCalendarsByAccount: { 'ada@example.com': ['primary'] },
		}
		localStorage.setItem(USER_PREFERENCES_STORAGE_KEY, JSON.stringify(legacy))
		render(
			<UserPreferencesProvider initialPreferences={null}>
				<span />
			</UserPreferencesProvider>,
		)
		expect(readPreferenceCookie(browserPreferenceCookie())).toEqual(saved())
		expect(readUserPreferences()).toEqual(legacy)
		expect(JSON.parse(localStorage.getItem(USER_PREFERENCES_STORAGE_KEY) ?? 'null')).toEqual(legacy)
	})

	it('lets the cookie win over stale local layout without losing private local maps', () => {
		const local = { ...defaultUserPreferences(), displayNameByAccount: { 'ada@example.com': 'Ada' } }
		localStorage.setItem(USER_PREFERENCES_STORAGE_KEY, JSON.stringify(local))
		writePreferenceCookie(saved())
		render(
			<UserPreferencesProvider initialPreferences={saved()}>
				<span />
			</UserPreferencesProvider>,
		)
		expect(readUserPreferences()).toEqual({ ...saved(), displayNameByAccount: local.displayNameByAccount })
		expect(readPreferenceCookie(browserPreferenceCookie())).toEqual(saved())
	})

	it('isolates server snapshots between requests and keeps account-owned maps gated', () => {
		function Probe() {
			const [preferences] = useUserPreferences()
			return <p>{`${preferences.listDensity}:${useUserPreferencesReady()}:${useLocalPreferencesReady()}`}</p>
		}
		const first = (
			<UserPreferencesProvider initialPreferences={saved()}>
				<Probe />
			</UserPreferencesProvider>
		)
		const second = (
			<UserPreferencesProvider initialPreferences={{ ...saved(), listDensity: 'condensed' }}>
				<Probe />
			</UserPreferencesProvider>
		)
		expect(renderToString(first)).toBe('<p>compact:true:false</p>')
		expect(renderToString(second)).toBe('<p>condensed:true:false</p>')
		expect(
			renderToString(
				<UserPreferencesProvider initialPreferences={null}>
					<Probe />
				</UserPreferencesProvider>,
			),
		).toBe('<p>default:false:false</p>')
		expect(renderToString(first)).toBe('<p>compact:true:false</p>')
	})

	it('hydrates the server-rendered layout without a default render or hydration recovery', async () => {
		localStorage.setItem(USER_PREFERENCES_STORAGE_KEY, JSON.stringify(defaultUserPreferences()))
		writePreferenceCookie(saved())
		const renders: string[] = []
		function Probe() {
			const [preferences] = useUserPreferences()
			renders.push(`${preferences.listDensity}:${preferences.readingPane}:${useUserPreferencesReady()}`)
			return <p data-density={preferences.listDensity}>{preferences.readingPane}</p>
		}
		const tree = (
			<UserPreferencesProvider initialPreferences={saved()}>
				<Probe />
			</UserPreferencesProvider>
		)
		const container = document.createElement('div')
		container.innerHTML = renderToString(tree)
		document.body.append(container)
		const onRecoverableError = vi.fn()
		let root!: ReturnType<typeof hydrateRoot>
		await act(async () => {
			root = hydrateRoot(container, tree, { onRecoverableError })
		})
		expect(new Set(renders)).toEqual(new Set(['compact:horizontal:true']))
		expect(onRecoverableError).not.toHaveBeenCalled()
		expect(container.querySelector('p')).toHaveAttribute('data-density', 'compact')
		act(() => root.unmount())
		container.remove()
	})

	it('updates every subscriber on cross-tab storage and focus signals, then removes listeners', () => {
		const wrapper = ({ children }: { children: ReactNode }) => (
			<UserPreferencesProvider initialPreferences={saved()}>{children}</UserPreferencesProvider>
		)
		const { result, unmount } = renderHook(() => useUserPreferences(), { wrapper })
		act(() => {
			writePreferenceCookie(saved())
			window.dispatchEvent(new StorageEvent('storage', { key: USER_PREFERENCES_STORAGE_KEY }))
		})
		expect(result.current[0].listDensity).toBe('compact')
		act(() => {
			writePreferenceCookie({ ...saved(), listDensity: 'condensed' })
			window.dispatchEvent(new Event('focus'))
		})
		expect(result.current[0].listDensity).toBe('condensed')
		const remove = vi.spyOn(window, 'removeEventListener')
		unmount()
		expect(remove).toHaveBeenCalledWith('focus', expect.any(Function))
	})
})

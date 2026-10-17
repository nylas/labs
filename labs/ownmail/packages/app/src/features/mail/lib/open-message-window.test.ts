// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { messageWindowDocument, openMessageWindow } from './open-message-window.js'

afterEach(() => {
	vi.restoreAllMocks()
	vi.unstubAllGlobals()
	vi.useRealTimers()
})

describe('messageWindowDocument', () => {
	it('wraps the sanitized message in a page that runs and loads nothing on its own', () => {
		const page = messageWindowDocument(
			'<p>Hello</p><script>alert(1)</script><img src="https://t.example/p.gif">',
			{
				title: 'Config <is> "coming" & more',
				allowRemoteImages: false,
			},
		) as string
		expect(page).toContain("default-src 'none'")
		expect(page).toContain('<title>Config &lt;is&gt; &quot;coming&quot; &amp; more</title>')
		expect(page).toContain('<base target="_blank">')
		expect(page).toContain('Hello')
		expect(page).not.toContain('<script>')
		expect(page).not.toContain('t.example')
	})

	it('has nothing to show for a body the sanitizer rejects', () => {
		expect(messageWindowDocument('', { title: 'Empty', allowRemoteImages: true })).toBeNull()
	})
})

describe('openMessageWindow', () => {
	it('opens a short-lived blob URL and revokes it later', () => {
		vi.useFakeTimers()
		const open = vi.fn()
		vi.stubGlobal('open', open)
		const createObjectURL = vi.fn(() => 'blob:message')
		const revokeObjectURL = vi.fn()
		vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL }))

		expect(openMessageWindow('<p>Hello</p>', { title: 'Hello', allowRemoteImages: false })).toBe(true)
		expect(open).toHaveBeenCalledWith('blob:message', '_blank', 'noopener')
		expect(revokeObjectURL).not.toHaveBeenCalled()
		vi.advanceTimersByTime(60_000)
		expect(revokeObjectURL).toHaveBeenCalledWith('blob:message')
	})

	it('opens nothing for an empty body', () => {
		const open = vi.fn()
		vi.stubGlobal('open', open)
		expect(openMessageWindow('', { title: 'Empty', allowRemoteImages: false })).toBe(false)
		expect(open).not.toHaveBeenCalled()
	})
})

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
			'<style>p{color:red}</style><p>Hello</p><script>alert(1)</script><img src="https://t.example/p.gif">',
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

	it('loads shown images from the app’s own proxy, never the sender’s server', () => {
		const proxied = `/email-images/${'a'.repeat(20)}.${'b'.repeat(20)}?mode=automatic&theme=light`
		const page = messageWindowDocument(
			`<style>.card{background-image:url("${proxied}")}.plain{color:red}</style><img class="hero" src="${proxied}" alt="Hero"><img src="https://tracker.example/p.gif"><div style="background-image:url(${proxied})">Card</div>`,
			{ title: 'Designed', allowRemoteImages: true, origin: 'https://mail.example' },
		) as string
		expect(page).toContain(`img-src 'self' https://mail.example data: blob:`)
		expect(page).toContain(`src="https://mail.example${proxied.replace(/&/g, '&amp;')}"`)
		expect(page).toContain(`url(https://mail.example/email-images/`)
		expect(page).toContain(`url("https://mail.example/email-images/`)
		expect(page).not.toContain('tracker.example')
	})

	it('keeps inert links inert: no destinations and nowhere to open them', () => {
		const html = '<p><a href="https://meridian-secure.co/verify">Verify your account</a></p>'
		const page = messageWindowDocument(html, {
			title: 'Meridian',
			allowRemoteImages: false,
			linksDisabled: true,
			origin: 'https://mail.example',
		}) as string
		expect(page).toContain('Verify your account')
		expect(page).not.toContain('href=')
		expect(page).not.toContain('<base')
		const live = messageWindowDocument(html, { title: 'Live', allowRemoteImages: false }) as string
		expect(live).toContain('href="https://meridian-secure.co/verify"')
		expect(live).toContain(`img-src 'self' ${window.location.origin} data: blob:`)
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

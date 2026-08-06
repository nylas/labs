// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { accentVariables, LoginScreen } from './LoginScreen.js'

afterEach(() => {
	cleanup()
	vi.restoreAllMocks()
})

const FOCUS_RING_CLASSES = [
	'focus-visible:outline-none',
	'focus-visible:ring-[3px]',
	'forced-colors:focus-visible:outline-2',
	'forced-colors:focus-visible:outline-offset-2',
	'forced-colors:focus-visible:outline-solid',
]

function renderScreen(props: Partial<Parameters<typeof LoginScreen>[0]> = {}) {
	return render(<LoginScreen signInAction="/auth/signin" host="mail.faberonlabs.com" {...props} />)
}

describe('LoginScreen', () => {
	it('makes the deployment’s own domain the subject of the screen', () => {
		renderScreen()

		expect(screen.getByRole('heading', { name: 'mail.faberonlabs.com' })).toHaveClass('font-mono')
	})

	it('posts credentials to this app’s server rather than sending the visitor anywhere', () => {
		const { container } = renderScreen()

		const form = container.querySelector('form') as HTMLFormElement
		expect(form).toHaveAttribute('method', 'post')
		expect(form).toHaveAttribute('action', '/auth/signin')
		// The redirect-era promises went out with the redirect itself.
		expect(screen.queryByText(/redirected to your identity provider/i)).not.toBeInTheDocument()
		expect(screen.queryByText(/through your provider/i)).not.toBeInTheDocument()
	})

	it('names the outcome on the primary action, in the same words while it is in flight', async () => {
		const user = userEvent.setup()
		const { container } = renderScreen()
		const form = container.querySelector('form') as HTMLFormElement
		form.addEventListener('submit', (event) => event.preventDefault())

		expect(screen.getByRole('button', { name: 'Open mail' })).toBeInTheDocument()
		await user.type(screen.getByLabelText('Email'), 'ada@ownmail.com')
		await user.type(screen.getByLabelText('App password'), 'app-password-1234')
		await user.click(screen.getByRole('button', { name: 'Open mail' }))

		expect(screen.getByRole('button', { name: /opening mail/i })).toBeInTheDocument()
	})

	/**
	 * Password managers key off these tokens. On a mail app people sign back into
	 * constantly, losing autofill is a real usability regression, so pin them.
	 */
	it('names the credential fields so password managers can fill and save them', () => {
		renderScreen({ suggestedEmail: 'ada@ownmail.com' })

		const email = screen.getByLabelText('Email')
		expect(email).toHaveAttribute('autocomplete', 'username')
		expect(email).toHaveAttribute('type', 'email')
		expect(email).toHaveAttribute('inputmode', 'email')
		expect(email).toHaveValue('ada@ownmail.com')
		expect(screen.getByLabelText('App password')).toHaveAttribute('autocomplete', 'current-password')
	})

	it('keeps every control touch-sized with focus rings that survive forced-colors mode', () => {
		renderScreen()

		for (const control of [
			screen.getByLabelText('Email'),
			screen.getByLabelText('App password'),
			screen.getByRole('button', { name: /show app password/i }),
			screen.getByRole('button', { name: 'Open mail' }),
		]) {
			expect(control.className).toMatch(/min-h-11|h-11/)
			expect(control).toHaveClass(...FOCUS_RING_CLASSES)
		}
	})

	it('uses at least 16px input text so mobile browsers do not zoom on focus', () => {
		renderScreen()

		expect(screen.getByLabelText('Email')).toHaveClass('text-base')
		expect(screen.getByLabelText('App password')).toHaveClass('text-base')
	})

	it('reveals and re-hides the app password in place, since these are pasted or hand-typed', async () => {
		const user = userEvent.setup()
		renderScreen()
		const password = screen.getByLabelText('App password')

		expect(password).toHaveAttribute('type', 'password')
		await user.click(screen.getByRole('button', { name: /show app password/i }))

		expect(password).toHaveAttribute('type', 'text')
		expect(screen.getByRole('button', { name: /hide app password/i })).toHaveAttribute('aria-pressed', 'true')

		await user.click(screen.getByRole('button', { name: /hide app password/i }))
		expect(password).toHaveAttribute('type', 'password')
	})

	it('blocks a second submit of the same credentials while the first is in flight', async () => {
		const user = userEvent.setup()
		const { container } = renderScreen()
		const form = container.querySelector('form') as HTMLFormElement
		const submitted = vi.fn((event: SubmitEvent) => event.preventDefault())
		form.addEventListener('submit', submitted)

		await user.type(screen.getByLabelText('Email'), 'ada@ownmail.com')
		await user.type(screen.getByLabelText('App password'), 'app-password-1234')
		await user.click(screen.getByRole('button', { name: 'Open mail' }))

		const pending = screen.getByRole('button', { name: /opening mail/i })
		expect(pending).toBeDisabled()
		expect(pending).toHaveAttribute('aria-busy', 'true')

		await user.click(pending)
		expect(submitted).toHaveBeenCalledTimes(1)
	})

	/**
	 * The security requirement, rendered: an unknown mailbox and a wrong password
	 * must be indistinguishable on screen, so there is only one such message.
	 */
	it('announces one credential failure message, tied to both fields, without layout shift', () => {
		const { container } = renderScreen({ error: 'invalid' })

		const alert = screen.getByRole('alert')
		expect(alert).toHaveTextContent('Check your email and app password and try again.')
		expect(alert.textContent).not.toMatch(/account|exists|unknown|sorry/i)
		expect(screen.getByLabelText('Email')).toHaveAttribute('aria-describedby', 'signin-error')
		expect(screen.getByLabelText('App password')).toHaveAttribute('aria-describedby', 'signin-error')
		expect(container.querySelector('.min-h-16')).toBeInTheDocument()
	})

	/**
	 * Zero layout shift depends on the slot being the same box in both renders —
	 * only its contents change. Measured in a real browser at 1280px and 390px:
	 * the email field's top does not move between the clean and failed states.
	 */
	it('reserves an identical message slot whether or not a failure is showing', () => {
		const clean = renderScreen().container.querySelector('form')?.firstElementChild
		cleanup()
		const failed = renderScreen({ error: 'invalid' }).container.querySelector('form')?.firstElementChild

		expect(clean?.className).toBe(failed?.className)
		expect(clean?.className).toContain('min-h-16')
		expect(clean?.children).toHaveLength(0)
		expect(failed?.children).toHaveLength(1)
	})

	it('moves focus to the field the visitor has to correct', () => {
		renderScreen({ error: 'invalid' })

		expect(screen.getByLabelText('Email')).toHaveFocus()
	})

	it('tells a locked-out visitor how long to wait without hinting at the address', () => {
		renderScreen({ error: 'rate-limit' })

		const alert = screen.getByRole('alert')
		expect(alert).toHaveTextContent('Too many attempts. Wait a few minutes and try again.')
		// The lockout window depends on the deployment's limiter, so the copy
		// must not promise a specific duration it cannot keep.
		expect(alert.textContent).not.toMatch(/\d+ minutes/)
		expect(alert.textContent).not.toMatch(/@|account|mailbox|exists/i)
	})

	it('reframes the same form for adding a second mailbox instead of greeting the visitor', () => {
		renderScreen({ addingMailbox: true })

		expect(screen.getByText('Add another mailbox to this session.')).toBeInTheDocument()
		expect(screen.queryByText(/welcome/i)).not.toBeInTheDocument()
	})

	it.each([
		{ label: 'a short domain', host: 'mail.ada.dev', expected: 'text-3xl' },
		{ label: 'a medium domain', host: 'mail.faberon-labs-eu.example', expected: 'text-2xl' },
		{ label: 'a very long domain', host: `mail.${'a'.repeat(40)}.example.com`, expected: 'text-xl' },
	])('keeps $label readable instead of letting it overflow', ({ host, expected }) => {
		renderScreen({ host })

		const heading = screen.getByRole('heading')
		expect(heading).toHaveClass('[overflow-wrap:anywhere]')
		expect(heading.firstElementChild).toHaveClass(expected)
	})

	/**
	 * The derived hue is unpredictable, so it gets the page's only colour. A
	 * tinted or branded button would pair it with a second unplanned hue at every
	 * install; a neutral surface also guarantees the contrast a derived hue can't.
	 */
	it('keeps the primary action neutral so the derived accent is the only colour', () => {
		renderScreen()

		const submit = screen.getByRole('button', { name: 'Open mail' })
		expect(submit).toHaveClass('bg-foreground', 'text-background')
		expect(submit.className).not.toContain('bg-primary')
		// The focus ring may carry the accent; the surface must not.
		expect(submit.className).not.toMatch(/bg-\[[^\]]*signin-accent/)
	})
})

describe('accentVariables', () => {
	it('gives each deployment a stable hue derived from its own domain', () => {
		expect(accentVariables('mail.faberonlabs.com')).toEqual(accentVariables('mail.faberonlabs.com'))
		expect(accentVariables('mail.faberonlabs.com')).not.toEqual(accentVariables('mail.ada.dev'))
	})

	it('holds lightness and chroma fixed per theme so a derived hue can never wash out', () => {
		for (const host of ['mail.ada.dev', 'inbox.example.org', 'm.xn--80ak6aa92e.com']) {
			const accent = accentVariables(host)
			expect(accent['--signin-accent']).toMatch(/^oklch\(0\.55 0\.14 \d{1,3}\)$/)
			expect(accent['--signin-accent-dark']).toMatch(/^oklch\(0\.78 0\.13 \d{1,3}\)$/)
		}
	})
})

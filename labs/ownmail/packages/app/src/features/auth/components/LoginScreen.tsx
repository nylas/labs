import { Loader2 } from 'lucide-react'
import type { CSSProperties } from 'react'
import { useEffect, useRef, useState } from 'react'
import { Button } from '#shared/components/ui/button'

/**
 * OwnMail's own credential screen.
 *
 * Design thesis: the deployment's own domain is the hero. It is the one thing
 * true of this install and no other, and it is what the product promises — your
 * mailbox, on your address, on your infrastructure. Everything else on the
 * screen stays quiet so the lockup and the two fields carry it.
 *
 * The accent hue is derived from that domain, so every install has its own
 * identity with no configuration. Because a derived hue cannot be contrast-
 * checked ahead of time, it is used only for the rule and the focus ring —
 * never as the sole carrier of text contrast, and never on the primary button,
 * which keeps the audited `--primary` token.
 *
 * Security: the form is a plain server-side POST; the app password never
 * reaches a query string, a hosted third-party page, or client-side storage.
 * There is exactly one credential-failure message, because UAS collapses
 * unknown mailbox, wrong password, and blocked grant into one indistinguishable
 * response and this screen must not undo that. The lockout message is separate
 * only because waiting is actionable; it is driven purely by attempt counts and
 * so says nothing about the address.
 */
export type SignInError = 'invalid' | 'rate-limit'

const FOCUS_RING =
	'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[color:var(--signin-accent)] dark:focus-visible:ring-[color:var(--signin-accent-dark)] forced-colors:focus-visible:outline-2 forced-colors:focus-visible:outline-offset-2 forced-colors:focus-visible:outline-solid'
const FIELD = `min-h-11 w-full rounded-lg border border-border bg-card px-3 text-base text-foreground transition-colors focus-visible:border-transparent ${FOCUS_RING}`

/**
 * Scoped to this screen only — the global `--primary` token is untouched. The
 * derived hue is unpredictable by construction, so pairing it with the green
 * primary rolls the dice on a two-colour clash at every install. A neutral
 * surface makes the accent the single point of colour on the page and, as
 * near-black on white (and near-white on black), carries an unimpeachable
 * contrast ratio that no derived hue could guarantee.
 */
const ERROR_SLOT = 'min-h-16 sm:min-h-11'
const SUBMIT_SURFACE = 'bg-foreground text-background hover:bg-foreground/90 hover:brightness-100'

const ERROR_MESSAGE: Record<SignInError, string> = {
	invalid: 'Check your email and app password and try again.',
	// No fixed duration: the lockout window depends on which limiter the
	// deployment runs on, and copy must not promise one it cannot keep.
	'rate-limit': 'Too many attempts. Wait a few minutes and try again.',
}

export function LoginScreen({
	signInAction,
	host,
	error = null,
	addingMailbox = false,
	suggestedEmail = '',
}: {
	signInAction: string
	host: string
	error?: SignInError | null
	addingMailbox?: boolean
	suggestedEmail?: string
}) {
	const [submitting, setSubmitting] = useState(false)
	const [revealPassword, setRevealPassword] = useState(false)
	const emailRef = useRef<HTMLInputElement>(null)

	// Put the caret where the correction has to happen; the alert announces itself.
	useEffect(() => {
		if (error) emailRef.current?.focus()
	}, [error])

	return (
		<main
			className="flex min-h-screen w-full items-center bg-background px-6 py-12"
			style={accentVariables(host) as CSSProperties}
		>
			<div className="mx-auto w-full max-w-[28rem]">
				<div className="sign-in-lockup">
					<h1 className="font-mono font-medium tracking-tight text-foreground [overflow-wrap:anywhere]">
						<span className={hostSizeClass(host)}>{host}</span>
					</h1>
					<div
						aria-hidden
						className="mt-4 h-[3px] w-28 rounded-full bg-[var(--signin-accent)] dark:bg-[var(--signin-accent-dark)]"
					/>
				</div>

				{addingMailbox ? (
					<p className="mt-6 text-sm text-muted-foreground">Add another mailbox to this session.</p>
				) : null}

				<form method="post" action={signInAction} onSubmit={() => setSubmitting(true)} className="mt-3">
					{/*
					 * Reserved slot: the fields must sit in exactly the same place with
					 * and without a message. Sized to the message itself — two lines on
					 * narrow screens, one from `sm` up — so the empty state reads as
					 * spacing between the lockup and the form rather than a hole.
					 */}
					<div className={ERROR_SLOT}>
						{error ? (
							<p
								id="signin-error"
								role="alert"
								className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-foreground"
							>
								{ERROR_MESSAGE[error]}
							</p>
						) : null}
					</div>

					<label className="block text-sm font-medium text-foreground" htmlFor="signin-email">
						Email
					</label>
					<input
						ref={emailRef}
						id="signin-email"
						name="email"
						type="email"
						inputMode="email"
						autoComplete="username"
						autoCapitalize="none"
						autoCorrect="off"
						spellCheck={false}
						defaultValue={suggestedEmail}
						maxLength={320}
						required
						aria-invalid={error ? true : undefined}
						aria-describedby={error ? 'signin-error' : undefined}
						className={`mt-1.5 ${FIELD}`}
					/>

					<div className="mt-5 flex items-center justify-between gap-3">
						<label className="block text-sm font-medium text-foreground" htmlFor="signin-password">
							App password
						</label>
						<button
							type="button"
							onClick={() => setRevealPassword((shown) => !shown)}
							aria-pressed={revealPassword}
							aria-controls="signin-password"
							aria-label={revealPassword ? 'Hide app password' : 'Show app password'}
							className={`-my-2 -mr-2 flex min-h-11 items-center rounded-lg px-2 text-sm text-muted-foreground transition-colors hover:text-foreground ${FOCUS_RING}`}
						>
							{revealPassword ? 'Hide' : 'Show'}
						</button>
					</div>
					<input
						id="signin-password"
						name="app_password"
						type={revealPassword ? 'text' : 'password'}
						autoComplete="current-password"
						autoCapitalize="none"
						autoCorrect="off"
						spellCheck={false}
						maxLength={512}
						required
						aria-invalid={error ? true : undefined}
						aria-describedby={error ? 'signin-error' : undefined}
						className={`mt-1.5 ${FIELD}`}
					/>

					<Button
						type="submit"
						disabled={submitting}
						aria-busy={submitting || undefined}
						className={`mt-8 h-auto min-h-11 w-full rounded-lg px-4 py-3 font-semibold ${SUBMIT_SURFACE} ${FOCUS_RING}`}
					>
						{submitting ? (
							<>
								<Loader2 className="h-4 w-4 animate-spin" aria-hidden />
								Opening mail…
							</>
						) : (
							'Open mail'
						)}
					</Button>
				</form>

				<p className="mt-8 text-xs text-muted-foreground">Your server · your data</p>
			</div>
		</main>
	)
}

/** Long domains stay on one or two comfortable lines instead of overflowing. */
function hostSizeClass(host: string): string {
	if (host.length > 34) return 'text-xl sm:text-2xl'
	if (host.length > 24) return 'text-2xl sm:text-3xl'
	return 'text-3xl sm:text-4xl'
}

/**
 * Derives a stable hue from the deployment's host, holding lightness and chroma
 * fixed so the result stays inside a predictable band in both themes. Same
 * domain, same colour, every visit — with no per-install configuration.
 */
export function accentVariables(host: string): Record<string, string> {
	let hash = 0
	for (const character of host) hash = (hash * 31 + character.charCodeAt(0)) % 360
	return {
		'--signin-accent': `oklch(0.55 0.14 ${hash})`,
		'--signin-accent-dark': `oklch(0.78 0.13 ${hash})`,
	}
}

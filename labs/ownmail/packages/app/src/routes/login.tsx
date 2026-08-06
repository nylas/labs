import { createFileRoute, redirect } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { MAIL_HOME_PATH, SIGN_IN_PATH } from '#app/config/route-paths'
import { LoginScreen, type SignInError } from '#features/auth/components/LoginScreen'
import { platform, usingDevMocks } from '#server/platform'
import { getSession, hasReferenceDevSessionCookie } from '#server/session'
import { siteNameFromEnv } from '#server/site-config'

const loginState = createServerFn({ method: 'GET' }).handler(async () => {
	const request = getRequest()
	const { env } = await platform()
	const url = requestUrl(request)
	const search = url?.searchParams ?? new URLSearchParams()
	const view = {
		signInAction: SIGN_IN_PATH,
		// The deployment's own address is the screen's subject; the configured
		// site name only stands in when the request carries no usable host.
		host: url?.host || siteNameFromEnv(env),
		error: signInError(search.get('error')),
		addingMailbox: search.get('add') === '1',
	}
	if (await usingDevMocks()) {
		return { ...view, authenticated: hasReferenceDevSessionCookie(request), suggestedEmail: '' }
	}
	const session = await getSession(request)
	return {
		...view,
		authenticated: Boolean(session),
		// Only ever the deployment's own configured inbox, and never while adding another.
		suggestedEmail: session ? '' : (env.INBOX_EMAIL?.trim() ?? ''),
	}
})

export const Route = createFileRoute('/login')({
	// Credential screens must not be stored by browsers or shared caches.
	headers: () => ({ 'Cache-Control': 'no-store' }),
	loader: async () => {
		const state = await loginState()
		// An authenticated visitor still needs this form to add another mailbox.
		if (state.authenticated && !state.addingMailbox) throw redirect({ to: MAIL_HOME_PATH })
		return state
	},
	component: Login,
})

/**
 * Only the two states the sign-in route can produce are rendered; anything else
 * in the URL is treated as no error at all, so a crafted link cannot put
 * arbitrary copy on the credential screen.
 */
function requestUrl(request: Request): URL | null {
	try {
		return new URL(request.url)
	} catch {
		return null
	}
}

function signInError(value: string | null): SignInError | null {
	if (value === '1') return 'invalid'
	if (value === 'rate') return 'rate-limit'
	return null
}

function Login() {
	const { signInAction, host, error, addingMailbox, suggestedEmail } = Route.useLoaderData()
	return (
		<LoginScreen
			signInAction={signInAction}
			host={host}
			error={error}
			addingMailbox={addingMailbox}
			suggestedEmail={suggestedEmail}
		/>
	)
}

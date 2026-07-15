import { createFileRoute, redirect } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { LoginScreen } from '../components/LoginScreen.js'
import { AUTH_PATH, MAIL_HOME_PATH } from '../components/route-paths.js'
import { platform, usingDevMocks } from '../server/platform.js'
import { getSession, hasReferenceDevSessionCookie } from '../server/session.js'
import { siteNameFromEnv } from '../server/site-config.js'

const loginState = createServerFn({ method: 'GET' }).handler(async () => {
	const request = getRequest()
	const { env } = await platform()
	if (await usingDevMocks()) {
		return {
			authenticated: hasReferenceDevSessionCookie(request),
			signInHref: AUTH_PATH,
			siteName: siteNameFromEnv(env),
		}
	}
	const session = await getSession(request)
	return { authenticated: Boolean(session), signInHref: '/auth', siteName: siteNameFromEnv(env) }
})

export const Route = createFileRoute('/login')({
	loader: async () => {
		const state = await loginState()
		if (state.authenticated) throw redirect({ to: MAIL_HOME_PATH })
		return state
	},
	component: Login,
})

function Login() {
	const { signInHref, siteName } = Route.useLoaderData()
	return <LoginScreen signInHref={signInHref} siteName={siteName} />
}

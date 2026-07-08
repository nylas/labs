import { createFileRoute, redirect } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { LoginScreen } from '../components/LoginScreen.js'
import { MAIL_HOME_PATH } from '../components/route-paths.js'
import { usingDevMocks } from '../server/platform.js'
import { getSession } from '../server/session.js'

const loginState = createServerFn({ method: 'GET' }).handler(async () => {
	if (await usingDevMocks()) return { authenticated: false, signInHref: MAIL_HOME_PATH }
	const session = await getSession(getRequest())
	return { authenticated: Boolean(session), signInHref: '/auth' }
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
	const { signInHref } = Route.useLoaderData()
	return <LoginScreen signInHref={signInHref} />
}

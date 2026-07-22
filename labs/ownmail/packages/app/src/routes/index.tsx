import { createFileRoute, redirect } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { DEFAULT_MAIL_FOLDER_ID, LOGIN_PATH } from '#app/config/route-paths'
import { usingDevMocks } from '#server/platform'
import { getSession } from '#server/session'

const homeState = createServerFn({ method: 'GET' }).handler(async () => {
	if (await usingDevMocks()) {
		return { authenticated: true }
	}
	const session = await getSession(getRequest())
	return { authenticated: Boolean(session) }
})

// The root path has no view of its own: send signed-in visitors straight to the
// canonical inbox route so there is a single mail list/thread implementation.
export const Route = createFileRoute('/')({
	beforeLoad: async () => {
		const state = await homeState()
		if (!state.authenticated) throw redirect({ to: LOGIN_PATH })
		// Replace (not push) so Back skips the transient root entry instead of
		// re-triggering this redirect and trapping the user on the inbox.
		throw redirect({ to: '/mail/f/$folderId', params: { folderId: DEFAULT_MAIL_FOLDER_ID }, replace: true })
	},
})

import { createFileRoute, redirect } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { DEFAULT_MAIL_FOLDER_ID, LOGIN_PATH } from '#app/config/route-paths'
import { usingDevMocks } from '#server/platform'
import { getSession } from '#server/session'

const mailIndexState = createServerFn({ method: 'GET' }).handler(async () => {
	if (await usingDevMocks()) return { authenticated: true }
	return { authenticated: Boolean(await getSession(getRequest())) }
})

export const Route = createFileRoute('/mail/')({
	beforeLoad: async () => {
		const state = await mailIndexState()
		if (!state.authenticated) throw redirect({ to: LOGIN_PATH })
		// Replace (not push) so Back skips the transient /mail entry instead of
		// re-triggering this redirect and trapping the user on the inbox.
		throw redirect({ to: '/mail/f/$folderId', params: { folderId: DEFAULT_MAIL_FOLDER_ID }, replace: true })
	},
})

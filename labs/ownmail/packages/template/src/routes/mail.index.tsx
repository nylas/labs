import { createFileRoute, redirect } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { DEFAULT_MAIL_FOLDER_ID, LOGIN_PATH } from '../components/route-paths.js'
import { usingDevMocks } from '../server/platform.js'
import { getSession } from '../server/session.js'

const mailIndexState = createServerFn({ method: 'GET' }).handler(async () => {
	if (await usingDevMocks()) return { authenticated: true }
	return { authenticated: Boolean(await getSession(getRequest())) }
})

export const Route = createFileRoute('/mail/')({
	beforeLoad: async () => {
		const state = await mailIndexState()
		if (!state.authenticated) throw redirect({ to: LOGIN_PATH })
		throw redirect({ to: '/mail/f/$folderId', params: { folderId: DEFAULT_MAIL_FOLDER_ID } })
	},
})

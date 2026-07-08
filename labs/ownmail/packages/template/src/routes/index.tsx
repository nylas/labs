import { createFileRoute, redirect } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { DEFAULT_MAIL_FOLDER_ID, LOGIN_PATH } from '../components/route-paths.js'
import { resetDevMocksForServerRender } from '../server/dev-mock-reset.js'
import { getMailboxInfo } from '../server/fns.js'
import { usingDevMocks } from '../server/platform.js'
import { getSession } from '../server/session.js'
import { loadMailFolderData, MailFolderRouteScreen } from './mail.f.$folderId.js'
import { MailRouteScreen } from './mail.js'

const homeState = createServerFn({ method: 'GET' }).handler(async () => {
	if (await usingDevMocks()) {
		return { authenticated: true }
	}
	const session = await getSession(getRequest())
	return { authenticated: Boolean(session) }
})

export const Route = createFileRoute('/')({
	loader: async () => {
		if (typeof document === 'undefined') await resetDevMocksForServerRender()
		const state = await homeState()
		if (!state.authenticated) throw redirect({ to: LOGIN_PATH })
		const [info, folderData] = await Promise.all([
			getMailboxInfo(),
			loadMailFolderData(DEFAULT_MAIL_FOLDER_ID),
		])
		return { ...state, authenticated: true as const, info, folderData }
	},
	component: Home,
})

function Home() {
	const data = Route.useLoaderData()
	return (
		<MailRouteScreen
			info={data.info}
			folders={data.folderData.folders}
			defaultFolderId={DEFAULT_MAIL_FOLDER_ID}
		>
			<MailFolderRouteScreen {...data.folderData} folderId={DEFAULT_MAIL_FOLDER_ID} />
		</MailRouteScreen>
	)
}

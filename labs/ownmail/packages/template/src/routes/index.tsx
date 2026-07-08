import { createFileRoute } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { LoginScreen } from '../components/LoginScreen.js'
import { DEFAULT_MAIL_FOLDER_ID, MAIL_HOME_PATH } from '../components/route-paths.js'
import { getMailboxInfo } from '../server/fns.js'
import { usingDevMocks } from '../server/platform.js'
import { getSession } from '../server/session.js'
import { loadMailFolderData, MailFolderRouteScreen } from './mail.f.$folderId.js'
import { MailRouteScreen } from './mail.js'

const homeState = createServerFn({ method: 'GET' }).handler(async () => {
	if (await usingDevMocks()) {
		return { authenticated: true, signInHref: MAIL_HOME_PATH }
	}
	const session = await getSession(getRequest())
	return { authenticated: Boolean(session), signInHref: session ? MAIL_HOME_PATH : '/auth' }
})

export const Route = createFileRoute('/')({
	loader: async () => {
		const state = await homeState()
		if (!state.authenticated) return { ...state, authenticated: false as const }
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
	if (!data.authenticated) return <LoginScreen signInHref={data.signInHref} />
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

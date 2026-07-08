import { createFileRoute, redirect } from '@tanstack/react-router'
import { DEFAULT_MAIL_FOLDER_ID } from '../components/route-paths.js'

export const Route = createFileRoute('/mail/')({
	beforeLoad: () => {
		throw redirect({ to: '/mail/f/$folderId', params: { folderId: DEFAULT_MAIL_FOLDER_ID } })
	},
})

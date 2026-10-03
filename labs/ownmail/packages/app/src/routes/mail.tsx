import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { ensureMailboxInfo, mailboxInfoQueryOptions } from '#app/query/mailbox-info'
import { latestDraftSummary, sidebarFolderCount } from '#features/mail/lib/mail-ui-model'
import { draftsQueryOptions, foldersQueryOptions } from '#features/mail/state/mail-queries'
import { getFolders, listDrafts } from '#server/fns'
import { seededData } from '#shared/lib/seeded-data'
import { MailRouteScreen } from './-mail-screen'

export const Route = createFileRoute('/mail')({
	loader: async ({ context }) => {
		// The mailbox comes first: the folder key is partitioned by account.
		const info = await ensureMailboxInfo(context.queryClient)
		const folders = await context.queryClient.ensureQueryData(foldersQueryOptions(() => getFolders()))
		return { info, folders }
	},
	staleTime: Number.POSITIVE_INFINITY,
	component: MailLayout,
})

function MailLayout() {
	const { info: initialInfo, folders: initialFolders } = Route.useLoaderData()
	const infoQuery = useQuery({
		...mailboxInfoQueryOptions(),
		initialData: initialInfo,
		initialDataUpdatedAt: 0,
	})
	const foldersQuery = useQuery({
		...foldersQueryOptions(() => getFolders()),
		initialData: initialFolders,
	})
	const folders = seededData(foldersQuery.data, initialFolders)
	// Only ask for drafts when the Drafts folder says there are some.
	const draftsQuery = useQuery({
		...draftsQueryOptions(() => listDrafts()),
		enabled: sidebarFolderCount(folders, 'drafts') > 0,
	})
	return (
		<MailRouteScreen
			info={seededData(infoQuery.data, initialInfo)}
			folders={folders}
			latestDraft={latestDraftSummary(draftsQuery.data)}
		/>
	)
}

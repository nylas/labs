import { useQuery } from '@tanstack/react-query'
import { Await, createFileRoute } from '@tanstack/react-router'
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
		const pending = context.queryClient.ensureQueryData(foldersQueryOptions(() => getFolders()))
		const folders = typeof window === 'undefined' ? pending : await pending
		return { info, folders }
	},
	staleTime: Number.POSITIVE_INFINITY,
	component: MailLayout,
})

function MailLayout() {
	const data = Route.useLoaderData()
	if (data.folders instanceof Promise)
		return (
			<Await
				promise={data.folders}
				fallback={
					<MailRouteScreen info={data.info} folders={[]}>
						<p role="status" className="p-6 text-sm text-muted-foreground">
							Loading your mailbox…
						</p>
					</MailRouteScreen>
				}
			>
				{(folders) => <LoadedMailLayout initialInfo={data.info} initialFolders={folders} />}
			</Await>
		)
	return <LoadedMailLayout initialInfo={data.info} initialFolders={data.folders} />
}

function LoadedMailLayout({
	initialInfo,
	initialFolders,
}: {
	initialInfo: Awaited<ReturnType<typeof ensureMailboxInfo>>
	initialFolders: Awaited<ReturnType<typeof getFolders>>
}) {
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

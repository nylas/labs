import { useRouterState } from '@tanstack/react-router'
import { useUserPreferences } from '#app/preferences/user-preferences'
import { ThreadListSkeleton } from '#features/mail/components/ThreadListSkeleton'
import { mailFolderTitle } from '#features/mail/lib/mail-ui-model'
import { readingPaneLayout } from '#features/mail/lib/reading-pane'
import type { MailFolder } from '#features/mail/state/mail-queries'
import { Toolbar } from '#shared/components/ui/toolbar'

/** A folder's title over skeleton rows: the pending view, and the first server
 * render, where the reading-pane preference that shapes the list is unknown. */
export function MailFolderPlaceholder({ folderId, folders }: { folderId: string; folders?: MailFolder[] }) {
	const [{ readingPane, listDensity }] = useUserPreferences()
	const threadOpen = useRouterState({ select: (state) => state.location.pathname.includes('/t/') })
	const layout = readingPaneLayout(readingPane, threadOpen)
	return (
		<div data-testid="folder-pending" aria-busy="true" className={layout.container}>
			<section className={layout.list} data-density={listDensity}>
				<Toolbar pinned className="justify-between px-4">
					<h1 className="font-display text-base font-semibold capitalize">
						{mailFolderTitle(folderId, folders)}
					</h1>
				</Toolbar>
				<ThreadListSkeleton />
			</section>
			<section className={layout.reader} />
		</div>
	)
}

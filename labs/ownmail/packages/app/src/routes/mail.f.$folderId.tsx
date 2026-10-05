import { type QueryClient, useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query'
import { Await, createFileRoute } from '@tanstack/react-router'
import { useCallback, useEffect, useMemo } from 'react'
import { ensureMailboxInfo } from '#app/query/mailbox-info'
import { useCompose } from '#features/mail/components/ComposeProvider'
import { useDeleteDraftMutation, useUpdateThreadMutation } from '#features/mail/state/mail-mutations'
import {
	draftsQueryOptions,
	foldersQueryOptions,
	type MailDraft,
	type MailFolder,
	type MailThread,
	type MailThreadPage,
	mailKeys,
	threadListQueryOptions,
} from '#features/mail/state/mail-queries'
import {
	composeKindForResponse,
	type ThreadResponseKind,
	threadResponseSearch,
} from '#features/mail/state/thread-response'
import { getFolders, getThreads, listDrafts } from '#server/fns'
import { seededData } from '#shared/lib/seeded-data'
import { MailFolderPlaceholder } from './-mail-folder-placeholder'
import { dedupeThreads, MailFolderRouteScreen, type ThreadUpdateInput } from './-mail-folder-screen'

export const Route = createFileRoute('/mail/f/$folderId')({
	validateSearch: (search): { baseFolderId?: string } => ({
		...(typeof search.baseFolderId === 'string' ? { baseFolderId: search.baseFolderId } : {}),
	}),
	loader: async ({ context, params }) => {
		// Authenticate before streaming any mailbox content. Client transitions retain
		// their established pending semantics; only initial SSR defers the slow data.
		await ensureMailboxInfo(context.queryClient)
		const data = loadMailFolderData(params.folderId, context.queryClient)
		return typeof window === 'undefined' ? { deferred: data } : await data
	},
	component: FolderView,
	pendingComponent: FolderPending,
})

export async function loadMailFolderData(folderId: string, queryClient: QueryClient) {
	// The mailbox comes first: every key below is partitioned by account.
	await ensureMailboxInfo(queryClient)
	const foldersPromise = queryClient.ensureQueryData(foldersQueryOptions(() => getFolders()))
	// Start both requests after account resolution; observe both rejections immediately.
	if (folderId === 'drafts') {
		const [folders, drafts] = await Promise.all([
			foldersPromise,
			queryClient.ensureQueryData(draftsQueryOptions(() => listDrafts())),
		])
		return {
			threads: [] as MailThread[],
			drafts,
			folders,
			nextCursor: undefined as string | undefined,
		}
	}
	const filters = folderId === 'starred' ? { starred: true } : { folderId }
	const [folders, result] = await Promise.all([
		foldersPromise,
		queryClient.ensureInfiniteQueryData(
			threadListQueryOptions(filters, (input) => getThreads({ data: input })),
		),
	])
	const firstPage = result.pages.at(0) as MailThreadPage
	return {
		threads: firstPage.threads,
		nextCursor: firstPage.nextCursor,
		drafts: [] as MailDraft[],
		folders,
	}
}

/** Shown while another folder loads. It names the destination folder, which is
 * already known, and never keeps the previous folder's rows, title or badge. */
function FolderPending() {
	const { folderId } = Route.useParams()
	const queryClient = useQueryClient()
	return (
		<MailFolderPlaceholder
			folderId={folderId}
			folders={queryClient.getQueryData<MailFolder[]>(mailKeys.folders())}
		/>
	)
}

function FolderView() {
	const data = Route.useLoaderData()
	if ('deferred' in data)
		return (
			<Await promise={data.deferred} fallback={<FolderPending />}>
				{(loaderData) => <LoadedFolderView loaderData={loaderData} />}
			</Await>
		)
	return <LoadedFolderView loaderData={data} />
}

function LoadedFolderView({ loaderData }: { loaderData: Awaited<ReturnType<typeof loadMailFolderData>> }) {
	const { folderId } = Route.useParams()
	const { baseFolderId } = Route.useSearch()
	const updateThread = useUpdateThreadMutation()
	const deleteDraft = useDeleteDraftMutation()
	const queryClient = useQueryClient()
	const { openCompose } = useCompose()
	const folderQuery = useQuery({
		...foldersQueryOptions(
			/* v8 ignore next -- @preserve production query wiring is covered through the isolated route screen and query-option tests */
			() => getFolders(),
		),
		initialData: loaderData.folders,
	})
	const draftsQuery = useQuery({
		...draftsQueryOptions(
			/* v8 ignore next -- @preserve production query wiring is covered through the isolated route screen and query-option tests */
			() => listDrafts(),
		),
		initialData: loaderData.drafts,
		enabled: folderId === 'drafts',
	})
	const threadListOptions = useMemo(
		() =>
			threadListQueryOptions(folderId === 'starred' ? { starred: true } : { folderId }, (input) =>
				getThreads({ data: input }),
			),
		[folderId],
	)
	const seedThreadList = {
		pages: [
			{
				threads: loaderData.threads,
				...(loaderData.nextCursor ? { nextCursor: loaderData.nextCursor } : {}),
			},
		],
		pageParams: [undefined],
	}
	const threadsQuery = useInfiniteQuery({
		...threadListOptions,
		initialData: seedThreadList,
		enabled: folderId !== 'drafts',
	})
	const threadPages = seededData(threadsQuery.data, seedThreadList).pages
	useEffect(
		() => () => {
			void queryClient
				.cancelQueries({ queryKey: threadListOptions.queryKey, exact: true }, { revert: true, silent: true })
				.catch(
					/* v8 ignore next -- @preserve cancellation is a best-effort lifecycle cleanup with no user-facing failure */
					() => {},
				)
		},
		[queryClient, threadListOptions.queryKey],
	)
	const threads = dedupeThreads(threadPages.flatMap((page) => page.threads))
	const nextCursor = threadPages.at(-1)?.nextCursor

	async function loadMoreThreads() {
		try {
			await threadsQuery.fetchNextPage({ cancelRefetch: false })
		} catch {
			// The route screen renders static retry guidance; never expose provider details.
		}
	}

	// Stable callbacks let memoized rows skip re-rendering when only the cursor
	// or the open thread changes; `mutateAsync` is stable for a mutation's lifetime.
	const { mutateAsync: updateThreadAsync } = updateThread
	const { mutateAsync: deleteDraftAsync } = deleteDraft
	const onUpdateThread = useCallback(
		(input: ThreadUpdateInput) => updateThreadAsync(input).then(() => undefined),
		[updateThreadAsync],
	)
	const onDiscardDraft = useCallback(
		(draftId: string) => deleteDraftAsync(draftId).then(() => undefined),
		[deleteDraftAsync],
	)
	const onRespondToThread = useCallback(
		async ({ threadId, kind }: { threadId: string; kind: ThreadResponseKind }) => {
			// The reader's own path: the thread's last message, in the composer.
			const response = await threadResponseSearch(queryClient, threadId, kind)
			await openCompose({ kind: composeKindForResponse(kind), threadId, ...response })
		},
		[openCompose, queryClient],
	)

	async function refreshThreads() {
		const activeListRefresh =
			folderId === 'drafts'
				? draftsQuery.refetch({ throwOnError: true })
				: threadsQuery.refetch({ throwOnError: true })
		await Promise.all([activeListRefresh, folderQuery.refetch({ throwOnError: true })])
	}

	return (
		<MailFolderRouteScreen
			threads={threads}
			drafts={seededData(draftsQuery.data, loaderData.drafts)}
			folders={seededData(folderQuery.data, loaderData.folders) as Awaited<ReturnType<typeof getFolders>>}
			folderId={folderId}
			baseFolderId={baseFolderId}
			nextCursor={nextCursor}
			loadingMore={threadsQuery.isFetchingNextPage}
			loadMoreError={threadsQuery.isFetchNextPageError}
			onLoadMore={loadMoreThreads}
			onRefresh={refreshThreads}
			onUpdateThread={onUpdateThread}
			onDiscardDraft={onDiscardDraft}
			onRespondToThread={onRespondToThread}
		/>
	)
}

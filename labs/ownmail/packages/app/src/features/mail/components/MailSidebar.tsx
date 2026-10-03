import type { Folder } from '@nylas-labs/cli-kit/v3'
import { Link, useNavigate } from '@tanstack/react-router'
import {
	Archive,
	FileText,
	FolderOpen,
	Inbox,
	type LucideIcon,
	Pencil,
	Send,
	Settings2,
	Star,
	Trash2,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { ManagedResourceAction } from '#shared/components/ResourceManagerDialog'
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuSeparator,
	ContextMenuTrigger,
} from '#shared/components/ui/context-menu'
import { PRIMARY_ACTION_CLASS, PrimaryActionContent } from '#shared/components/ui/primary-action'
import { cn } from '#shared/lib/utils'
import {
	labelBaseFolderId,
	labelDotClass,
	labelToggleFolderId,
	MAIL_FOLDERS,
	sidebarFolderCount,
} from '../lib/mail-ui-model.js'
import { useCompose } from './ComposeProvider.js'
import { FolderManagerDialog } from './FolderManagerDialog.js'

const FOLDER_ICONS: Record<string, LucideIcon> = {
	inbox: Inbox,
	starred: Star,
	sent: Send,
	drafts: FileText,
	archive: Archive,
	trash: Trash2,
}

export function MailSidebar({
	folders,
	currentFolderId,
	baseFolderId,
	onNavigate,
	onFolderDeleted,
	latestDraft,
	className,
	mobile = false,
}: {
	folders: Folder[]
	/** The most recent saved draft, offered as "Resume" under Compose. */
	latestDraft?: { id: string; subject: string }
	currentFolderId?: string
	baseFolderId?: string
	onNavigate?: () => void
	onFolderDeleted?: (folderId: string) => void
	className?: string
	mobile?: boolean
}) {
	const labels = folders.filter(isCustomFolder)
	const navigate = useNavigate()
	const { openCompose } = useCompose()
	// null: closed. The label menu opens the manager on that label's own form.
	const [folderManager, setFolderManager] = useState<{ initialAction?: ManagedResourceAction } | null>(null)

	return (
		<aside
			className={cn(
				'flex w-full flex-col',
				mobile && 'pb-[max(1rem,env(safe-area-inset-bottom))]',
				className,
			)}
		>
			{/* design.md "Spacing" clause 7: one inset column, no separator under the create action. */}
			<div className="flex shrink-0 flex-col p-hairline">
				<button
					type="button"
					onClick={() => {
						onNavigate?.()
						void openCompose({ kind: 'new' })
					}}
					aria-keyshortcuts="C"
					className={cn(PRIMARY_ACTION_CLASS, mobile && 'min-h-12')}
				>
					<PrimaryActionContent icon={Pencil} label="Compose" shortcut="C" />
				</button>
				{latestDraft ? (
					<button
						type="button"
						onClick={() => {
							onNavigate?.()
							void openCompose({ kind: 'draft', draftId: latestDraft.id })
						}}
						className={cn(
							'press touch-target mt-control flex min-w-0 items-center gap-control rounded-md px-cluster text-xs text-muted-foreground hover:bg-muted hover:text-foreground',
							mobile ? 'min-h-12' : 'h-8',
						)}
					>
						<span className="shrink-0">Resume</span>{' '}
						<span className="min-w-0 truncate font-medium text-foreground">
							{latestDraft.subject || '(no subject)'}
						</span>
					</button>
				) : null}
			</div>

			<nav className="flex flex-col px-hairline" aria-label="Mail folders">
				{MAIL_FOLDERS.map((folder) => {
					/* v8 ignore next -- every MAIL_FOLDERS id has a FOLDER_ICONS entry; the ?? Inbox fallback is unreachable defensive code -- @preserve */
					const Icon = FOLDER_ICONS[folder.id] ?? Inbox
					const count = sidebarFolderCount(folders, folder.id)
					const active = currentFolderId === folder.id
					return (
						<Link
							key={folder.id}
							to="/mail/f/$folderId"
							params={{ folderId: folder.id }}
							onClick={onNavigate}
							aria-current={active ? 'page' : undefined}
							className={cn(
								'touch-target relative flex items-center gap-3 whitespace-nowrap text-sm transition-[background-color,color,transform] duration-[var(--dur-fast)] ease-[var(--ease-out)] press',
								'rounded-md px-cluster',
								mobile ? 'min-h-12' : 'h-9',
								active ? 'nav-item-active' : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
							)}
						>
							<Icon className="h-4 w-4 shrink-0" />
							<span className="flex-1 text-left">{folder.label}</span>
							{count > 0 ? <FolderCount count={count} active={active} /> : null}
						</Link>
					)
				})}
			</nav>

			<div className="mt-cluster border-t border-border px-hairline pt-hairline">
				<div className="flex items-center justify-between pb-control pl-cluster">
					<p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">Labels</p>
					<button
						type="button"
						onClick={() => setFolderManager({})}
						aria-label="Manage folders"
						className={cn(
							'touch-target-square flex items-center justify-center rounded-md text-muted-foreground transition-[background-color,color,transform] duration-[var(--dur-fast)] ease-[var(--ease-out)] hover:bg-muted hover:text-foreground press focus-visible:ring-[3px] focus-visible:ring-ring',
							mobile ? 'size-11' : 'size-9 max-md:size-11 [@media(any-pointer:coarse)]:size-11',
						)}
					>
						<Settings2 className="h-4 w-4" />
					</button>
				</div>
				{labels.length > 0 ? (
					<div className="flex flex-col">
						{labels.map((label, index) => {
							const active = currentFolderId === label.id
							const nextFolderId = labelToggleFolderId(currentFolderId, label.id, baseFolderId)
							const nextBaseFolderId = active ? undefined : labelBaseFolderId(currentFolderId, baseFolderId)
							const labelSearch = nextBaseFolderId ? { baseFolderId: nextBaseFolderId } : {}
							const labelName = label.name || label.id
							return (
								// The menu holds what the folder manager can do with this label.
								<ContextMenu key={label.id}>
									<ContextMenuTrigger asChild>
										<Link
											to="/mail/f/$folderId"
											params={{ folderId: nextFolderId }}
											search={labelSearch}
											onClick={onNavigate}
											aria-current={active ? 'page' : undefined}
											className={cn(
												'touch-target relative flex items-center gap-3 whitespace-nowrap text-sm transition-[background-color,color,transform] duration-[var(--dur-fast)] ease-[var(--ease-out)] press',
												'rounded-md px-cluster',
												mobile ? 'min-h-12' : 'h-9',
												active
													? 'nav-item-active'
													: 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
											)}
										>
											<span className={cn('h-2 w-2 shrink-0 rounded-full', labelDotClass(label.id, index))} />
											<span className="min-w-0 flex-1 truncate text-left">{labelName}</span>
										</Link>
									</ContextMenuTrigger>
									<ContextMenuContent aria-label={`Actions for ${labelName}`}>
										<ContextMenuItem
											disabled={active}
											onSelect={() => {
												onNavigate?.()
												navigate({
													to: '/mail/f/$folderId',
													params: { folderId: nextFolderId },
													search: labelSearch,
												})
											}}
										>
											<FolderOpen aria-hidden="true" />
											Open
										</ContextMenuItem>
										<ContextMenuSeparator />
										<ContextMenuItem
											onSelect={() => setFolderManager({ initialAction: { kind: 'edit', id: label.id } })}
										>
											<Pencil aria-hidden="true" />
											Rename…
										</ContextMenuItem>
										<ContextMenuItem
											variant="destructive"
											onSelect={() => setFolderManager({ initialAction: { kind: 'delete', id: label.id } })}
										>
											<Trash2 aria-hidden="true" />
											Delete…
										</ContextMenuItem>
									</ContextMenuContent>
								</ContextMenu>
							)
						})}
					</div>
				) : (
					<p className="px-cluster py-2 text-xs text-muted-foreground">No labels yet.</p>
				)}
			</div>
			{folderManager ? (
				<FolderManagerDialog
					folders={folders}
					initialAction={folderManager.initialAction}
					onClose={() => setFolderManager(null)}
					onDeleted={onFolderDeleted}
				/>
			) : null}
		</aside>
	)
}

/** A folder count; a change while it is on screen drops the new number in (design.md "Motion" clause 7). */
function FolderCount({ count, active }: { count: number; active: boolean }) {
	const previous = useRef(count)
	const changed = previous.current !== count
	useEffect(() => {
		previous.current = count
	}, [count])
	return (
		<span className={cn('text-xs tabular-nums', active ? 'text-foreground' : 'text-muted-foreground')}>
			<span key={count} className={changed ? 'count-tick' : undefined}>
				{count}
			</span>
		</span>
	)
}

function isCustomFolder(folder: Folder): boolean {
	return !folder.system_folder && !MAIL_FOLDERS.some((standard) => standard.id === folder.id)
}

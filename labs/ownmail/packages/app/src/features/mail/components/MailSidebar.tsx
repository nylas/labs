import type { Folder } from '@nylas-labs/cli-kit/v3'
import { Link } from '@tanstack/react-router'
import {
	Archive,
	FileText,
	Inbox,
	type LucideIcon,
	Pencil,
	Send,
	Settings2,
	Star,
	Trash2,
} from 'lucide-react'
import { useState } from 'react'
import { cn } from '#shared/lib/utils'
import {
	labelBaseFolderId,
	labelDotClass,
	labelToggleFolderId,
	MAIL_FOLDERS,
	sidebarFolderCount,
} from '../lib/mail-ui-model.js'
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
	composeSearch,
	currentFolderId,
	baseFolderId,
	onNavigate,
	onFolderDeleted,
	className,
	mobile = false,
}: {
	folders: Folder[]
	composeSearch: { folderId?: string; threadId?: string }
	currentFolderId?: string
	baseFolderId?: string
	onNavigate?: () => void
	onFolderDeleted?: (folderId: string) => void
	className?: string
	mobile?: boolean
}) {
	const labels = folders.filter(isCustomFolder)
	const [managingFolders, setManagingFolders] = useState(false)

	return (
		<aside
			className={cn(
				'flex w-full flex-col',
				mobile && 'pb-[max(1rem,env(safe-area-inset-bottom))]',
				className,
			)}
		>
			<div className={cn('flex shrink-0 items-center border-b border-border px-3', mobile ? 'h-16' : 'h-14')}>
				<Link
					to="/mail/compose"
					search={composeSearch}
					onClick={onNavigate}
					className={cn(
						'flex w-full items-center justify-center gap-2 border border-border text-sm font-medium transition-[background-color,color,transform] duration-[var(--dur-fast)] ease-[var(--ease-out)]',
						mobile
							? 'min-h-12 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 active:translate-y-px'
							: 'h-9 bg-background text-foreground hover:bg-muted',
					)}
				>
					<Pencil className="h-3.5 w-3.5" strokeWidth={2} />
					Compose
				</Link>
			</div>

			<nav className={cn('flex flex-col', mobile ? 'gap-0.5 px-2 py-2' : 'py-1')} aria-label="Mail folders">
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
							className={cn(
								'relative flex items-center gap-3 whitespace-nowrap text-sm transition-[background-color,color,transform] duration-[var(--dur-fast)] ease-[var(--ease-out)] active:translate-y-px',
								mobile ? 'min-h-12 rounded-lg px-3' : 'h-9 px-4',
								active
									? cn('nav-item-active', mobile && 'mobile-nav-item-active')
									: 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
							)}
						>
							<Icon className="h-4 w-4 shrink-0" />
							<span className="flex-1 text-left">{folder.label}</span>
							{count > 0 ? (
								<span
									className={cn('text-xs tabular-nums', active ? 'text-foreground' : 'text-muted-foreground')}
								>
									{count}
								</span>
							) : null}
						</Link>
					)
				})}
			</nav>

			<div className="border-t border-border pt-2">
				<div className={cn('flex items-center justify-between pb-1', mobile ? 'px-3' : 'px-4')}>
					<p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">Labels</p>
					<button
						type="button"
						onClick={() => setManagingFolders(true)}
						aria-label="Manage folders"
						className={cn(
							'flex items-center justify-center rounded-md text-muted-foreground transition-[background-color,color,transform] duration-[var(--dur-fast)] ease-[var(--ease-out)] hover:bg-muted hover:text-foreground active:translate-y-px focus-visible:ring-[3px] focus-visible:ring-ring',
							mobile ? 'h-11 w-11' : 'h-8 w-8',
						)}
					>
						<Settings2 className="h-4 w-4" />
					</button>
				</div>
				{labels.length > 0 ? (
					<div className={cn('flex flex-col', mobile && 'gap-0.5 px-2')}>
						{labels.map((label, index) => {
							const active = currentFolderId === label.id
							const nextFolderId = labelToggleFolderId(currentFolderId, label.id, baseFolderId)
							const nextBaseFolderId = active ? undefined : labelBaseFolderId(currentFolderId, baseFolderId)
							return (
								<Link
									key={label.id}
									to="/mail/f/$folderId"
									params={{ folderId: nextFolderId }}
									search={nextBaseFolderId ? { baseFolderId: nextBaseFolderId } : {}}
									onClick={onNavigate}
									className={cn(
										'relative flex items-center gap-3 whitespace-nowrap text-sm transition-[background-color,color,transform] duration-[var(--dur-fast)] ease-[var(--ease-out)] active:translate-y-px',
										mobile ? 'min-h-12 rounded-lg px-3' : 'h-9 px-4',
										active
											? cn('nav-item-active', mobile && 'mobile-nav-item-active')
											: 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
									)}
								>
									<span className={cn('h-2 w-2 shrink-0 rounded-full', labelDotClass(label.id, index))} />
									<span className="min-w-0 flex-1 truncate text-left">{label.name || label.id}</span>
								</Link>
							)
						})}
					</div>
				) : (
					<p className={cn('py-2 text-xs text-muted-foreground', mobile ? 'px-3' : 'px-4')}>No labels yet.</p>
				)}
			</div>
			{managingFolders ? (
				<FolderManagerDialog
					folders={folders}
					onClose={() => setManagingFolders(false)}
					onDeleted={onFolderDeleted}
				/>
			) : null}
		</aside>
	)
}

function isCustomFolder(folder: Folder): boolean {
	return !folder.system_folder && !MAIL_FOLDERS.some((standard) => standard.id === folder.id)
}

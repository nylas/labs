import type { Folder } from '@nylas-labs/cli-kit/v3'
import { Link } from '@tanstack/react-router'
import { Archive, FileText, Inbox, type LucideIcon, Pencil, Send, Star, Trash2 } from 'lucide-react'
import {
	cn,
	labelBaseFolderId,
	labelDotClass,
	labelToggleFolderId,
	MAIL_FOLDERS,
	sidebarFolderCount,
} from './ui-model.js'

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
	className,
}: {
	folders: Folder[]
	composeSearch: { folderId?: string; threadId?: string }
	currentFolderId?: string
	baseFolderId?: string
	onNavigate?: () => void
	className?: string
}) {
	const labels = folders.filter(isCustomFolder)

	return (
		<aside className={cn('flex w-full flex-col', className)}>
			<div className="flex h-14 shrink-0 items-center border-b border-border px-3">
				<Link
					to="/mail/compose"
					search={composeSearch}
					onClick={onNavigate}
					className="flex h-9 w-full items-center justify-center gap-2 border border-border bg-background text-sm font-medium text-foreground transition-colors hover:bg-muted"
				>
					<Pencil className="h-3.5 w-3.5" strokeWidth={2} />
					Compose
				</Link>
			</div>

			<nav className="flex flex-col py-1" aria-label="Mail folders">
				{MAIL_FOLDERS.map((folder) => {
					/* v8 ignore next -- every MAIL_FOLDERS id has a FOLDER_ICONS entry; the ?? Inbox fallback is unreachable defensive code */
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
								'relative flex h-9 items-center gap-3 px-4 text-sm transition-colors',
								active ? 'nav-item-active' : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
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

			{labels.length > 0 ? (
				<div className="border-t border-border pt-2">
					<p className="px-4 pb-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
						Labels
					</p>
					<div className="flex flex-col">
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
										'relative flex h-9 items-center gap-3 px-4 text-sm transition-colors',
										active
											? 'nav-item-active'
											: 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
									)}
								>
									<span className={cn('h-2 w-2 shrink-0 rounded-full', labelDotClass(label.id, index))} />
									<span className="min-w-0 flex-1 truncate text-left">{label.name || label.id}</span>
								</Link>
							)
						})}
					</div>
				</div>
			) : null}
		</aside>
	)
}

function isCustomFolder(folder: Folder): boolean {
	return !folder.system_folder && !MAIL_FOLDERS.some((standard) => standard.id === folder.id)
}

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
	composeMask,
	composeSearch,
	folderMask,
	currentFolderId,
	baseFolderId,
	onNavigate,
	className,
}: {
	folders: Folder[]
	composeMask?: { to: '/' }
	composeSearch: { folderId?: string; threadId?: string }
	folderMask?: { to: '/' }
	currentFolderId?: string
	baseFolderId?: string
	onNavigate?: () => void
	className?: string
}) {
	const labels = folders.filter(isCustomFolder)

	return (
		<aside className={cn('flex w-full flex-col gap-4 px-3 py-4', className)}>
			<Link
				to="/mail/compose"
				search={composeSearch}
				{...(composeMask ? { mask: composeMask } : {})}
				onClick={onNavigate}
				className="flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm transition-all hover:brightness-105 active:scale-[0.98]"
			>
				<Pencil className="h-4 w-4" strokeWidth={2.5} />
				Compose
			</Link>

			<nav className="flex flex-col gap-0.5" aria-label="Mail folders">
				{MAIL_FOLDERS.map((folder) => {
					const Icon = FOLDER_ICONS[folder.id] ?? Inbox
					const count = sidebarFolderCount(folders, folder.id)
					const active = currentFolderId === folder.id
					return (
						<Link
							key={folder.id}
							to="/mail/f/$folderId"
							params={{ folderId: folder.id }}
							{...(folderMask ? { mask: folderMask } : {})}
							onClick={onNavigate}
							className={cn(
								'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
								active
									? 'bg-accent font-semibold text-accent-foreground'
									: 'text-foreground/80 hover:bg-muted',
							)}
						>
							<Icon className="h-4 w-4 shrink-0" />
							<span className="flex-1 text-left">{folder.label}</span>
							{count > 0 ? (
								<span
									className={cn('text-xs tabular-nums', active ? 'font-semibold' : 'text-muted-foreground')}
								>
									{count}
								</span>
							) : null}
						</Link>
					)
				})}
			</nav>

			{labels.length > 0 ? (
				<div>
					<p className="px-3 pb-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
						Labels
					</p>
					<div className="flex flex-col gap-0.5">
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
									{...(folderMask ? { mask: folderMask } : {})}
									onClick={onNavigate}
									className={cn(
										'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
										active
											? 'bg-accent font-semibold text-accent-foreground'
											: 'text-foreground/80 hover:bg-muted',
									)}
								>
									<span className={cn('h-2.5 w-2.5 rounded-full', labelDotClass(label.id, index))} />
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

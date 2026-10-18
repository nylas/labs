import { Paperclip } from 'lucide-react'
import type { ReactNode } from 'react'
import { labelBadgeClass } from '#shared/lib/color-tone'
import { cn } from '#shared/lib/utils'
import type { Person } from '../lib/thread-reading-model.js'
import { AvatarStack } from './Avatar.js'
import { ThreadColumn } from './ThreadColumn.js'

type Label = { id: string; name: string; tone: Parameters<typeof labelBadgeClass>[0] }

/**
 * The thread's first lines: the subject (or the first line of the first
 * message, said to be a stand-in), then who is on it, how long it is, over
 * what span, and how many files it carries. The files count opens the files
 * shelf. `actions` holds the display controls where no toolbar takes them.
 */
export function ThreadReaderHeader({
	subject,
	isStandIn,
	people,
	names,
	more,
	messageCount,
	span,
	fileCount,
	filesOpen,
	filesShelfId,
	onToggleFiles,
	labels,
	actions,
}: {
	subject: string
	isStandIn: boolean
	/** The avatar stack: the people named, the owner last. */
	people: Person[]
	names: string
	more: number
	messageCount: number
	span: string
	fileCount: number
	filesOpen: boolean
	filesShelfId: string
	onToggleFiles: () => void
	labels: Label[]
	actions?: ReactNode
}) {
	return (
		<header data-slot="thread-summary" className="reader-header">
			<ThreadColumn>
				<div className="flex min-w-0 items-start justify-between gap-x-2">
					<div data-navigation-content="" className="reader-title-block">
						<h1 className="reader-title">{subject}</h1>
						{isStandIn ? (
							<p data-slot="subject-stand-in" className="reader-title-caption">
								No subject. Showing the first line instead.
							</p>
						) : null}
					</div>
					{actions}
				</div>
				<div data-slot="thread-meta" className="reader-meta">
					{people.length > 0 ? <AvatarStack people={people} size={24} max={4} /> : null}
					{names ? (
						<span data-slot="thread-participants">
							<span className="font-medium text-foreground">{names}</span>
							{more > 0 ? ` +${more}` : null}
						</span>
					) : null}
					<Dot />
					<span className="font-data tabular-nums">
						{messageCount} {messageCount === 1 ? 'message' : 'messages'}
					</span>
					{span ? (
						<>
							<Dot />
							<span data-slot="thread-span" className="font-data tabular-nums">
								{span}
							</span>
						</>
					) : null}
					{fileCount > 0 ? (
						<>
							<Dot />
							<button
								type="button"
								data-slot="thread-files-toggle"
								aria-expanded={filesOpen}
								aria-controls={filesOpen ? filesShelfId : undefined}
								onClick={onToggleFiles}
								className="reader-meta-files"
							>
								<Paperclip aria-hidden="true" className="size-3.5" />
								<span className="font-data tabular-nums">
									{fileCount} {fileCount === 1 ? 'file' : 'files'}
								</span>
							</button>
						</>
					) : null}
				</div>
				{labels.length > 0 ? (
					<div className="reader-labels">
						{labels.map((label) => (
							<span key={label.id} className={cn('text-xs', labelBadgeClass(label.tone))}>
								{label.name}
							</span>
						))}
					</div>
				) : null}
			</ThreadColumn>
		</header>
	)
}

function Dot() {
	return <span aria-hidden="true">·</span>
}

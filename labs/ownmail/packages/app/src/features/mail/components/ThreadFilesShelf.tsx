import { Download } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { useGlassPanelProps } from '#shared/components/ui/glass'
import { cn } from '#shared/lib/utils'
import { personName, shortDayLabel, type ThreadFile, versionToken } from '../lib/thread-reading-model.js'
import { formatSize } from './AttachmentLink.js'

/** Raster images get a thumbnail from the attachment itself when they are this small or smaller. */
const THUMBNAIL_MAX_BYTES = 5 * 1024 * 1024
const THUMBNAIL_TYPES = new Set([
	'image/png',
	'image/jpeg',
	'image/jpg',
	'image/gif',
	'image/webp',
	'image/avif',
])
/** Browsers drop downloads that start together; one at a time, this far apart, they all land. */
const DOWNLOAD_GAP_MS = 400

type FileKind = 'pdf' | 'sheet' | 'doc' | 'slides' | 'image' | 'other'

const EXTENSION_KIND: Record<string, FileKind> = {
	pdf: 'pdf',
	xls: 'sheet',
	xlsx: 'sheet',
	csv: 'sheet',
	numbers: 'sheet',
	ods: 'sheet',
	doc: 'doc',
	docx: 'doc',
	rtf: 'doc',
	odt: 'doc',
	pages: 'doc',
	txt: 'doc',
	md: 'doc',
	ppt: 'slides',
	pptx: 'slides',
	key: 'slides',
	odp: 'slides',
}

const KIND_LABEL: Record<Exclude<FileKind, 'image' | 'other'>, string> = {
	pdf: 'PDF',
	sheet: 'XLS',
	doc: 'DOC',
	slides: 'PPT',
}

const KIND_TILE: Record<Exclude<FileKind, 'image'>, string> = {
	pdf: 'bg-file-pdf text-file-pdf-foreground',
	sheet: 'bg-file-sheet text-file-sheet-foreground',
	doc: 'bg-file-doc text-file-doc-foreground',
	slides: 'bg-amber-soft text-amber-soft-foreground',
	other: 'bg-muted text-muted-foreground',
}

const extensionOf = (filename: string): string => {
	const dot = filename.lastIndexOf('.')
	return dot > 0 ? filename.slice(dot + 1).toLowerCase() : ''
}

/** What a file is, from its type and then its extension. */
export function fileKind(file: Pick<ThreadFile, 'filename' | 'contentType'>): FileKind {
	const type = file.contentType.toLowerCase()
	if (type.startsWith('image/')) return 'image'
	if (type === 'application/pdf') return 'pdf'
	if (type.includes('spreadsheet') || type.includes('excel') || type === 'text/csv') return 'sheet'
	if (type.includes('presentation') || type.includes('powerpoint')) return 'slides'
	if (type.includes('wordprocessing') || type === 'application/msword') return 'doc'
	return EXTENSION_KIND[extensionOf(file.filename)] ?? 'other'
}

/** The download address of a file: the same attachment route the reader's chips use. */
export function threadFileUrl(file: Pick<ThreadFile, 'attachmentId' | 'messageId'>): string {
	return `/attachments/${encodeURIComponent(file.attachmentId)}?message_id=${encodeURIComponent(file.messageId)}`
}

/**
 * "Download all": each file in turn through the attachment route, newest
 * version of each family only, spaced so the browser keeps every one.
 */
export async function downloadThreadFiles(
	files: ThreadFile[],
	{ gapMs = DOWNLOAD_GAP_MS }: { gapMs?: number } = {},
): Promise<void> {
	for (const [index, file] of files.entries()) {
		if (index > 0) await new Promise((resolve) => setTimeout(resolve, gapMs))
		const link = document.createElement('a')
		link.href = threadFileUrl(file)
		link.download = file.filename
		link.rel = 'noopener'
		link.style.display = 'none'
		document.body.appendChild(link)
		link.click()
		link.remove()
	}
}

/** "v1–v3" for the earlier versions of a file, or "2 earlier versions" when they carry no version mark. */
export function earlierVersionsLabel(file: ThreadFile): string | null {
	const versions = file.olderVersions
	if (versions.length === 0) return null
	const oldest = versions.at(-1) as ThreadFile
	const newest = versions[0] as ThreadFile
	const from = versionToken(oldest.filename)
	const to = versionToken(newest.filename)
	if (from === oldest.filename || to === newest.filename) {
		return versions.length === 1 ? '1 earlier version' : `${versions.length} earlier versions`
	}
	return versions.length === 1 ? to : `${from}–${to}`
}

/** "today", "Tue" or "Oct 3"; nothing when the provider gave no date. */
const dayOf = (file: ThreadFile, now: number, tz: string): string =>
	file.date > 0 ? shortDayLabel(file.date, now, tz) : ''

/** "Grace", or "You" for the reader's own file. */
const senderLabel = (file: ThreadFile): string => (file.from.isOwner ? 'You' : personName(file.from, 'first'))

const shownThumbnail = (file: ThreadFile): boolean =>
	THUMBNAIL_TYPES.has(file.contentType.toLowerCase()) && file.size > 0 && file.size <= THUMBNAIL_MAX_BYTES

function FileTypeTile({ file }: { file: ThreadFile }) {
	const kind = fileKind(file)
	const [failed, setFailed] = useState(false)
	if (kind === 'image') {
		return (
			<span aria-hidden="true" className="size-10 shrink-0 overflow-hidden rounded-sm bg-file-image">
				{shownThumbnail(file) && !failed ? (
					<img
						src={threadFileUrl(file)}
						alt=""
						loading="lazy"
						decoding="async"
						referrerPolicy="no-referrer"
						onError={() => setFailed(true)}
						className="size-full object-cover"
					/>
				) : null}
			</span>
		)
	}
	const label =
		kind === 'other' ? extensionOf(file.filename).slice(0, 4).toUpperCase() || 'FILE' : KIND_LABEL[kind]
	return (
		<span
			aria-hidden="true"
			className={cn(
				'inline-flex h-10 w-8 shrink-0 items-center justify-center rounded-sm font-data text-[9px] font-bold',
				KIND_TILE[kind],
			)}
		>
			{label}
		</span>
	)
}

function EarlierVersions({
	file,
	label,
	now,
	tz,
	onOpenFile,
}: {
	file: ThreadFile
	label: string
	now: number
	tz: string
	onOpenFile(f: ThreadFile): void
}) {
	const [open, setOpen] = useState(false)
	const rootRef = useRef<HTMLSpanElement>(null)
	const triggerRef = useRef<HTMLButtonElement>(null)
	const panelId = useId()
	const panel = useGlassPanelProps()

	useEffect(() => {
		if (!open) return
		rootRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()
		const closeOutside = (event: PointerEvent | FocusEvent) => {
			if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false)
		}
		const closeOnEscape = (event: KeyboardEvent) => {
			if (event.key !== 'Escape') return
			event.preventDefault()
			event.stopPropagation()
			setOpen(false)
			triggerRef.current?.focus()
		}
		document.addEventListener('pointerdown', closeOutside)
		document.addEventListener('focusin', closeOutside)
		document.addEventListener('keydown', closeOnEscape, true)
		return () => {
			document.removeEventListener('pointerdown', closeOutside)
			document.removeEventListener('focusin', closeOutside)
			document.removeEventListener('keydown', closeOnEscape, true)
		}
	}, [open])

	return (
		<span ref={rootRef}>
			<button
				ref={triggerRef}
				type="button"
				aria-haspopup="menu"
				aria-expanded={open}
				aria-controls={open ? panelId : undefined}
				aria-label={`Earlier versions of ${file.filename}: ${label}`}
				onClick={() => setOpen((value) => !value)}
				className="relative z-10 rounded-sm text-cta-icon hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
			>
				{label}
			</button>
			{open ? (
				<div
					id={panelId}
					role="menu"
					aria-label={`Earlier versions of ${file.filename}`}
					{...panel}
					className={cn(
						panel.className,
						'absolute top-full left-0 z-30 mt-control flex w-64 max-w-full flex-col p-control font-sans whitespace-normal',
					)}
				>
					{file.olderVersions.map((version) => (
						<button
							key={`${version.messageId}|${version.attachmentId}`}
							type="button"
							role="menuitem"
							onClick={() => {
								setOpen(false)
								onOpenFile(version)
							}}
							className="flex min-h-8 w-full min-w-0 flex-col items-start rounded-md px-cluster py-control text-left hover:bg-muted focus-visible:bg-muted focus-visible:outline-none [@media(any-pointer:coarse)]:min-h-11"
						>
							<span className="w-full truncate text-[13px] font-semibold text-foreground">
								{version.filename}
							</span>
							<span className="font-data text-xs text-muted-foreground tabular-nums">
								{[senderLabel(version), dayOf(version, now, tz), version.size ? formatSize(version.size) : '']
									.filter(Boolean)
									.join(' · ')}
							</span>
						</button>
					))}
				</div>
			) : null}
		</span>
	)
}

/**
 * "Files in this thread" (board 04): every file once, the newest version of a
 * family first with its earlier versions behind a "v1–v3" menu, as tiles in two
 * columns. Inline images and signature logos are not files (the reading model
 * leaves them out) and the footnote says so. Opening a tile goes to the
 * message it came with; "Download all" is the caller's
 * (`downloadThreadFiles` does it through the attachment route).
 */
export function ThreadFilesShelf({
	files,
	onDownloadAll,
	onOpenFile,
}: {
	files: ThreadFile[]
	onDownloadAll(): void
	onOpenFile(f: ThreadFile): void
}) {
	const headingId = useId()
	const [{ now, tz }] = useState(() => ({
		now: Date.now(),
		tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
	}))
	if (files.length === 0) return null
	const folded = files.reduce((total, file) => total + file.olderVersions.length, 0)

	return (
		<section
			aria-labelledby={headingId}
			data-slot="thread-files-shelf"
			className="flex flex-col gap-hairline rounded-[0.75rem] border border-border bg-card p-5 text-card-foreground"
		>
			<div className="flex flex-wrap items-baseline gap-cluster">
				<h2 id={headingId} className="m-0 min-w-0 flex-1 text-base font-semibold">
					Files in this thread
				</h2>
				<span className="font-data text-xs text-muted-foreground tabular-nums">
					{files.length === 1 ? '1 file' : `${files.length} files`}
					{folded > 0 ? ` · ${folded === 1 ? '1 version folded' : `${folded} versions folded`}` : ''}
				</span>
				<button
					type="button"
					onClick={onDownloadAll}
					className="inline-flex h-7 items-center gap-control self-center rounded-md px-hairline text-xs font-medium text-foreground/70 transition-[background-color,color,transform] duration-[var(--dur-fast)] ease-[var(--ease-out)] hover:bg-muted hover:text-foreground press focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-3.5"
				>
					<Download aria-hidden="true" />
					Download all
				</button>
			</div>

			<ul className="m-0 grid list-none grid-cols-1 gap-cluster p-0 sm:grid-cols-2">
				{files.map((file) => {
					const versions = earlierVersionsLabel(file)
					const meta = [
						senderLabel(file),
						dayOf(file, now, tz),
						fileKind(file) === 'image' && file.size ? formatSize(file.size) : '',
					].filter(Boolean)
					return (
						<li
							key={`${file.messageId}|${file.attachmentId}`}
							className="relative flex min-w-0 items-center gap-hairline rounded-md border border-border p-hairline transition-colors duration-[var(--dur-fast)] hover:bg-muted/60 has-[>button:focus-visible]:ring-2 has-[>button:focus-visible]:ring-ring"
						>
							<FileTypeTile file={file} />
							<div className="min-w-0 flex-1">
								<div className="truncate text-[13px] font-semibold">{file.filename}</div>
								<div className="truncate font-data text-xs text-muted-foreground tabular-nums">
									{meta.join(' · ')}
									{versions ? (
										<>
											{' · '}
											<EarlierVersions
												file={file}
												label={versions}
												now={now}
												tz={tz}
												onOpenFile={onOpenFile}
											/>
										</>
									) : null}
								</div>
							</div>
							<button
								type="button"
								aria-label={`Open ${file.filename}, from ${senderLabel(file)}`}
								onClick={() => onOpenFile(file)}
								className="absolute inset-0 rounded-md focus-visible:outline-none"
							/>
						</li>
					)
				})}
			</ul>

			<p className="m-0 text-xs text-muted-foreground">
				Inline images and signature logos are not counted as files.
			</p>
		</section>
	)
}

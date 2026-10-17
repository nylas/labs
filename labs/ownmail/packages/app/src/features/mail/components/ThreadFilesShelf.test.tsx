// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ThreadFile } from '../lib/thread-reading-model.js'
import {
	downloadThreadFiles,
	earlierVersionsLabel,
	fileKind,
	ThreadFilesShelf,
	threadFileUrl,
} from './ThreadFilesShelf.js'

afterEach(() => {
	cleanup()
	vi.useRealTimers()
	vi.restoreAllMocks()
})

const DAY = 86_400
const now = () => Math.floor(Date.now() / 1000)
const GRACE = { name: 'Grace Hopper', email: 'grace@vercel.com', isOwner: false }
const ALAN = { name: 'Alan Turing', email: 'alan@bletchley.dev', isOwner: false }
const KATHERINE = { name: 'Katherine Johnson', email: 'katherine@vercel.com', isOwner: false }
const ADA = { name: 'Ada Lovelace', email: 'ada@ownmail.com', isOwner: true }

function file(filename: string, extra: Partial<ThreadFile> = {}): ThreadFile {
	return {
		attachmentId: `att-${filename}`,
		messageId: `msg-${filename}`,
		filename,
		size: 2_100_000,
		contentType: 'application/pdf',
		from: GRACE,
		date: now(),
		olderVersions: [],
		...extra,
	}
}

/** Board 04's shelf: the roadmap with three earlier versions, a sheet, an image and a document. */
function boardFiles(): ThreadFile[] {
	const v = (n: number, daysAgo: number) => file(`Q3-roadmap-v${n}.pdf`, { date: now() - daysAgo * DAY })
	return [
		file('Q3-roadmap-v4.pdf', {
			olderVersions: [v(3, 2), v(2, 9), v(1, 17)],
			versionOf: 'Q3-roadmap-v3.pdf',
		}),
		file('onboarding-funnel.xlsx', {
			contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
			from: KATHERINE,
			date: now() - 3 * DAY,
		}),
		file('sync-flow.png', { contentType: 'image/png', size: 1_468_006, from: ALAN, date: now() - 12 * DAY }),
		file('planning-notes.docx', {
			contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
			from: ADA,
			date: now() - 15 * DAY,
		}),
	]
}

function renderShelf(files = boardFiles()) {
	const onDownloadAll = vi.fn()
	const onOpenFile = vi.fn()
	render(
		<div>
			<ThreadFilesShelf files={files} onDownloadAll={onDownloadAll} onOpenFile={onOpenFile} />
			<button type="button">Outside</button>
		</div>,
	)
	return { onDownloadAll, onOpenFile }
}

describe('fileKind', () => {
	it('reads the content type first, then the extension', () => {
		const kind = (filename: string, contentType = '') => fileKind({ filename, contentType })
		expect(kind('a.bin', 'image/png')).toBe('image')
		expect(kind('a.bin', 'application/pdf')).toBe('pdf')
		expect(kind('a.bin', 'application/vnd.ms-excel')).toBe('sheet')
		expect(kind('a.bin', 'text/csv')).toBe('sheet')
		expect(kind('a.bin', 'application/vnd.openxmlformats-officedocument.presentationml.presentation')).toBe(
			'slides',
		)
		expect(kind('a.bin', 'application/msword')).toBe('doc')
		expect(kind('notes.PAGES')).toBe('doc')
		expect(kind('deck.key')).toBe('slides')
		expect(kind('budget.numbers', 'application/octet-stream')).toBe('sheet')
		expect(kind('archive.zip', 'application/zip')).toBe('other')
		expect(kind('README')).toBe('other')
	})
})

describe('threadFileUrl', () => {
	it('uses the attachment route the reader chips use, encoded', () => {
		expect(threadFileUrl({ attachmentId: 'a/b', messageId: 'm 1' })).toBe(
			'/attachments/a%2Fb?message_id=m%201',
		)
	})
})

describe('earlierVersionsLabel', () => {
	it('names the versions a file replaces', () => {
		expect(earlierVersionsLabel(file('a.pdf'))).toBeNull()
		expect(earlierVersionsLabel(file('Q3-v4.pdf', { olderVersions: [file('Q3-v3.pdf')] }))).toBe('v3')
		expect(
			earlierVersionsLabel(file('Q3-v4.pdf', { olderVersions: [file('Q3-v3.pdf'), file('Q3-v1.pdf')] })),
		).toBe('v1–v3')
		expect(earlierVersionsLabel(file('brief-final.pdf', { olderVersions: [file('brief.pdf')] }))).toBe(
			'1 earlier version',
		)
		expect(
			earlierVersionsLabel(
				file('brief (2).pdf', { olderVersions: [file('brief (1).pdf'), file('brief.pdf')] }),
			),
		).toBe('2 earlier versions')
	})
})

describe('downloadThreadFiles', () => {
	it('downloads each file in turn through the attachment route, spaced apart', async () => {
		vi.useFakeTimers()
		const clicked: Array<{ href: string; download: string; attached: boolean }> = []
		vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
			clicked.push({
				href: this.getAttribute('href') ?? '',
				download: this.download,
				attached: this.isConnected,
			})
		})
		const done = downloadThreadFiles([file('a.pdf'), file('b.pdf')], { gapMs: 50 })
		expect(clicked).toHaveLength(1)
		await vi.advanceTimersByTimeAsync(50)
		await done
		expect(clicked).toEqual([
			{ href: '/attachments/att-a.pdf?message_id=msg-a.pdf', download: 'a.pdf', attached: true },
			{ href: '/attachments/att-b.pdf?message_id=msg-b.pdf', download: 'b.pdf', attached: true },
		])
		// Nothing is left behind in the page.
		expect(document.querySelectorAll('a[download]')).toHaveLength(0)
	})

	it('waits between downloads by default', async () => {
		vi.useFakeTimers()
		const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
		const done = downloadThreadFiles([file('a.pdf'), file('b.pdf')])
		await vi.advanceTimersByTimeAsync(399)
		expect(click).toHaveBeenCalledTimes(1)
		await vi.advanceTimersByTimeAsync(1)
		await done
		expect(click).toHaveBeenCalledTimes(2)
	})
})

describe('ThreadFilesShelf', () => {
	it('lays out board 04: heading, counts, Download all, a tile per file and the footnote', () => {
		renderShelf()
		expect(screen.getByRole('heading', { level: 2, name: 'Files in this thread' })).toBeInTheDocument()
		expect(screen.getByText('4 files · 3 versions folded')).toHaveClass('font-data')
		expect(screen.getByRole('button', { name: 'Download all' })).toBeInTheDocument()
		expect(
			screen.getByText('Inline images and signature logos are not counted as files.'),
		).toBeInTheDocument()

		const tiles = screen.getAllByRole('listitem')
		expect(tiles.map((tile) => tile.textContent)).toEqual([
			'PDFQ3-roadmap-v4.pdfGrace · today · v1–v3',
			'XLSonboarding-funnel.xlsxKatherine · ' +
				new Intl.DateTimeFormat('en-US', { weekday: 'short' }).format((now() - 3 * DAY) * 1000),
			`sync-flow.pngAlan · ${new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format((now() - 12 * DAY) * 1000)} · 1.4 MB`,
			`DOCplanning-notes.docxYou · ${new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format((now() - 15 * DAY) * 1000)}`,
		])
		expect(within(tiles[0] as HTMLElement).getByText('PDF')).toHaveClass(
			'bg-file-pdf',
			'text-file-pdf-foreground',
		)
		expect(within(tiles[1] as HTMLElement).getByText('XLS')).toHaveClass('bg-file-sheet')
		expect(within(tiles[3] as HTMLElement).getByText('DOC')).toHaveClass('bg-file-doc')
	})

	it('shows a small raster image as its own thumbnail and falls back to the tile when it fails', () => {
		renderShelf([file('sketch.png', { contentType: 'image/png', size: 512 * 1024 })])
		const image = document.querySelector('img') as HTMLImageElement
		expect(image).toHaveAttribute('src', '/attachments/att-sketch.png?message_id=msg-sketch.png')
		expect(image).toHaveAttribute('loading', 'lazy')
		expect(image).toHaveAttribute('alt', '')
		expect(image).toHaveAttribute('referrerpolicy', 'no-referrer')
		fireEvent.error(image)
		expect(document.querySelector('img')).toBeNull()
	})

	it('keeps large, vector and unsized images as plain tiles', () => {
		renderShelf([
			file('huge.jpg', { contentType: 'image/jpeg', size: 6 * 1024 * 1024 }),
			// The board's 1.4 MB diagram: over the thumbnail limit, so it keeps its tile.
			file('sync-flow.png', { contentType: 'image/png', size: 1_468_006 }),
			file('logo.svg', { contentType: 'image/svg+xml', size: 2_000 }),
			file('unknown.png', { contentType: 'image/png', size: 0 }),
		])
		expect(document.querySelector('img')).toBeNull()
		expect(screen.getByText('4 files')).toBeInTheDocument()
	})

	it('labels other files by extension, slides on the amber ground', () => {
		renderShelf([
			file('archive.zip', { contentType: 'application/zip' }),
			file('LICENSE', { contentType: '' }),
			file('deck.pptx', { contentType: '' }),
		])
		expect(screen.getByText('ZIP')).toHaveClass('bg-muted')
		expect(screen.getByText('FILE')).toBeInTheDocument()
		expect(screen.getByText('PPT')).toHaveClass('bg-amber-soft')
	})

	it('says one file and one folded version in the singular, and drops a zero count', async () => {
		renderShelf([file('brief-v2.pdf', { olderVersions: [file('brief-v1.pdf', { date: 0, size: 0 })] })])
		expect(screen.getByText('1 file · 1 version folded')).toBeInTheDocument()
		await userEvent.click(screen.getByRole('button', { name: 'Earlier versions of brief-v2.pdf: v1' }))
		// No date and no size from the provider: the line says only who sent it.
		expect(screen.getByRole('menuitem').lastChild).toHaveTextContent(/^Grace$/)
		cleanup()
		renderShelf([file('brief.pdf')])
		expect(screen.getByText('1 file')).toBeInTheDocument()
	})

	it('renders nothing when the thread has no files', () => {
		const { container } = render(<ThreadFilesShelf files={[]} onDownloadAll={vi.fn()} onOpenFile={vi.fn()} />)
		expect(container).toBeEmptyDOMElement()
	})

	it('downloads all and opens a file from its tile', async () => {
		const { onDownloadAll, onOpenFile } = renderShelf()
		await userEvent.click(screen.getByRole('button', { name: 'Download all' }))
		expect(onDownloadAll).toHaveBeenCalledOnce()
		await userEvent.click(screen.getByRole('button', { name: 'Open onboarding-funnel.xlsx, from Katherine' }))
		expect(onOpenFile).toHaveBeenCalledWith(expect.objectContaining({ filename: 'onboarding-funnel.xlsx' }))
	})

	it('lists earlier versions in a menu and opens the one chosen', async () => {
		const { onOpenFile } = renderShelf()
		const trigger = screen.getByRole('button', { name: 'Earlier versions of Q3-roadmap-v4.pdf: v1–v3' })
		expect(trigger).toHaveAttribute('aria-expanded', 'false')
		await userEvent.click(trigger)
		const menu = screen.getByRole('menu', { name: 'Earlier versions of Q3-roadmap-v4.pdf' })
		expect(menu).toHaveClass('glass-panel')
		expect(trigger).toHaveAttribute('aria-controls', menu.id)
		const items = within(menu).getAllByRole('menuitem')
		expect(items.map((item) => item.firstChild?.textContent)).toEqual([
			'Q3-roadmap-v3.pdf',
			'Q3-roadmap-v2.pdf',
			'Q3-roadmap-v1.pdf',
		])
		expect(items[0]).toHaveFocus()
		expect(items[0]?.lastChild?.textContent).toMatch(/^Grace · \w{3} · 2\.0 MB$/)

		await userEvent.click(items[1] as HTMLElement)
		expect(onOpenFile).toHaveBeenCalledWith(expect.objectContaining({ filename: 'Q3-roadmap-v2.pdf' }))
		expect(screen.queryByRole('menu')).toBeNull()
	})

	it('closes the versions menu with Escape, returning focus, or by leaving it', async () => {
		renderShelf()
		const trigger = screen.getByRole('button', { name: /^Earlier versions of/ })
		await userEvent.click(trigger)
		fireEvent.keyDown(document, { key: 'Enter' })
		expect(screen.getByRole('menu')).toBeInTheDocument()
		fireEvent.keyDown(document, { key: 'Escape' })
		expect(screen.queryByRole('menu')).toBeNull()
		expect(trigger).toHaveFocus()

		await userEvent.click(trigger)
		fireEvent.pointerDown(screen.getByRole('menuitem', { name: /Q3-roadmap-v3/ }))
		expect(screen.getByRole('menu')).toBeInTheDocument()
		await userEvent.click(screen.getByRole('button', { name: 'Outside' }))
		expect(screen.queryByRole('menu')).toBeNull()

		await userEvent.click(trigger)
		await userEvent.click(trigger)
		expect(screen.queryByRole('menu')).toBeNull()
	})
})

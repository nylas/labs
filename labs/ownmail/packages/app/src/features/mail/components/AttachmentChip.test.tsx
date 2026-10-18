// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { AttachmentChip, fileKind } from './AttachmentChip.js'

afterEach(cleanup)

describe('AttachmentChip', () => {
	it('shows the type tile, name, detail line and a download link', () => {
		render(
			<AttachmentChip
				messageId="msg/13"
				attachment={{
					id: 'att 4',
					filename: 'Q3-roadmap-v4.pdf',
					content_type: 'application/pdf',
					size: 2_202_009,
				}}
				detail="2.1 MB · replaces v3 from Tue"
			/>,
		)
		expect(screen.getByText('PDF')).toHaveClass('bg-file-pdf', 'text-file-pdf-foreground')
		expect(screen.getByText('Q3-roadmap-v4.pdf')).toBeInTheDocument()
		expect(screen.getByText('2.1 MB · replaces v3 from Tue')).toHaveClass('font-data')
		const link = screen.getByRole('link', { name: 'Download Q3-roadmap-v4.pdf' })
		expect(link).toHaveAttribute('href', '/attachments/att%204?message_id=msg%2F13')
		expect(link).toHaveAttribute('download', 'Q3-roadmap-v4.pdf')
	})

	it('falls back to the size, then to no detail, and names an unnamed file', () => {
		const view = render(
			<AttachmentChip messageId="m" attachment={{ id: 'a', filename: 'notes.txt', size: 2048 }} />,
		)
		expect(screen.getByText('2 KB')).toBeInTheDocument()
		view.rerender(<AttachmentChip messageId="m" attachment={{ id: 'a' }} />)
		expect(screen.getByText('attachment')).toBeInTheDocument()
		expect(screen.getByRole('link', { name: 'Download attachment' })).not.toHaveAttribute('download')
		expect(screen.getByText('FILE')).toHaveClass('bg-muted')
	})
})

describe('AttachmentChip compact', () => {
	it('is the quiet 28px paperclip chip under an empty body, the whole chip the download', () => {
		render(
			<AttachmentChip
				compact
				messageId="m/1"
				attachment={{ id: 'a 1', filename: 'contract-signed.pdf', size: 2048 }}
			/>,
		)
		const chip = screen.getByRole('link', { name: 'contract-signed.pdf' })
		expect(chip).toHaveClass('h-7', 'rounded-md', 'border', 'text-[13px]')
		expect(chip).toHaveAttribute('href', '/attachments/a%201?message_id=m%2F1')
		expect(chip).toHaveAttribute('download', 'contract-signed.pdf')
		expect(chip).toHaveAttribute('title', 'Download contract-signed.pdf (2 KB)')
		expect(screen.queryByText('PDF')).toBeNull()
		// The paperclip draws in the chip's own text colour, as the filename does.
		expect(chip.querySelector('svg')).not.toHaveClass('text-muted-foreground')
	})

	it('names an unnamed, sizeless file', () => {
		render(<AttachmentChip compact messageId="m" attachment={{ id: 'a' }} />)
		expect(screen.getByRole('link', { name: 'attachment' })).toHaveAttribute('title', 'Download attachment')
	})
})

describe('fileKind', () => {
	it('colours PDF, sheet, document and image tiles and labels other files by extension', () => {
		expect(fileKind({ filename: 'a.PDF' }).label).toBe('PDF')
		expect(fileKind({ filename: 'funnel.xlsx' })).toEqual({
			label: 'XLS',
			tile: 'bg-file-sheet text-file-sheet-foreground',
		})
		expect(
			fileKind({
				filename: 'x',
				content_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
			}).label,
		).toBe('XLS')
		expect(fileKind({ filename: 'planning-notes.docx' })).toEqual({
			label: 'DOC',
			tile: 'bg-file-doc text-file-doc-foreground',
		})
		expect(fileKind({ filename: 'sync-flow.png' })).toEqual({
			label: 'PNG',
			tile: 'bg-file-image text-file-doc-foreground',
		})
		expect(fileKind({ filename: 'photo', content_type: 'image/jpeg; name=photo' }).label).toBe('IMG')
		expect(fileKind({ filename: 'archive.zip' })).toEqual({
			label: 'ZIP',
			tile: 'bg-muted text-muted-foreground',
		})
		expect(fileKind({})).toEqual({ label: 'FILE', tile: 'bg-muted text-muted-foreground' })
	})
})

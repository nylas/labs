// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { AttachmentLink, formatSize } from './AttachmentLink.js'

afterEach(cleanup)

describe('AttachmentLink', () => {
	it('names the file, its size and whose message it came with', () => {
		render(
			<AttachmentLink
				attachment={{ id: 'a#1', filename: 'plan.pdf', size: 2048 }}
				messageId="m=1"
				attribution="Grace Hopper"
			/>,
		)
		const link = screen.getByRole('link', { name: 'plan.pdf, 2 KB, attached to message from Grace Hopper' })
		expect(link).toHaveAttribute('href', '/attachments/a%231?message_id=m%3D1')
		expect(link).toHaveAttribute('download', 'plan.pdf')
	})

	it('says "attachment" for a file without a name, and no size when it has none', () => {
		render(<AttachmentLink attachment={{ id: 'a2' }} messageId="m2" attribution="Alan" />)
		expect(
			screen.getByRole('link', { name: 'attachment, attached to message from Alan' }),
		).toBeInTheDocument()
	})

	it('formats sizes in bytes, kilobytes and megabytes', () => {
		expect(formatSize(500)).toBe('500 B')
		expect(formatSize(2048)).toBe('2 KB')
		expect(formatSize(3 * 1024 * 1024)).toBe('3.0 MB')
	})
})

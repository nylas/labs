// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FitToWidthBar } from './FitToWidthBar.js'
import { ImagesHiddenBar } from './ImagesHiddenBar.js'

afterEach(cleanup)

describe('ImagesHiddenBar', () => {
	it('counts the hidden images by sender and offers this message or always', async () => {
		const onShow = vi.fn()
		const onAlways = vi.fn()
		render(
			<ImagesHiddenBar
				count={7}
				domain="voyage.com"
				senderName="Voyage"
				onShow={onShow}
				onAlways={onAlways}
			/>,
		)
		expect(screen.getByText('7 images from voyage.com are hidden')).toBeInTheDocument()
		await userEvent.click(screen.getByRole('button', { name: 'Show' }))
		await userEvent.click(screen.getByRole('button', { name: 'Always for Voyage' }))
		expect(onShow).toHaveBeenCalledOnce()
		expect(onAlways).toHaveBeenCalledOnce()
	})

	it('offers only this message when the sender cannot be remembered', () => {
		render(<ImagesHiddenBar count={1} domain="" onShow={() => {}} />)
		expect(screen.getByText('1 image is hidden')).toBeInTheDocument()
		expect(screen.getAllByRole('button')).toHaveLength(1)
	})
})

describe('FitToWidthBar', () => {
	it('says the layout was fitted, at what scale, and offers actual size and a window', async () => {
		const onToggleActualSize = vi.fn()
		const onOpenWindow = vi.fn()
		const view = render(
			<FitToWidthBar
				scale={0.82}
				actualSize={false}
				onToggleActualSize={onToggleActualSize}
				onOpenWindow={onOpenWindow}
			/>,
		)
		expect(screen.getByText(/Fitted to width/)).toHaveTextContent('Fitted to width (82%)')
		expect(screen.getByText('(82%)')).toHaveClass('font-data')
		await userEvent.click(screen.getByRole('button', { name: 'Actual size' }))
		await userEvent.click(screen.getByRole('button', { name: 'Open in window' }))
		expect(onToggleActualSize).toHaveBeenCalledOnce()
		expect(onOpenWindow).toHaveBeenCalledOnce()

		view.rerender(
			<FitToWidthBar
				scale={0.82}
				actualSize
				onToggleActualSize={onToggleActualSize}
				onOpenWindow={onOpenWindow}
			/>,
		)
		expect(screen.getByText('Actual size')).toBeInTheDocument()
		expect(screen.getByRole('button', { name: 'Fit to width' })).toBeInTheDocument()
	})
})

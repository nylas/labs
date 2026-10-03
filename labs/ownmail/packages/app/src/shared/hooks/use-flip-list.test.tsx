// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { useRef } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FLIP_DURATION_MS, FLIP_EASING, useFlipList } from './use-flip-list.js'

afterEach(() => {
	cleanup()
	vi.unstubAllGlobals()
})

// jsdom does no layout: each row reports its index * 80 as its offsetTop.
function List({ ids, withContainer = true }: { ids: string[]; withContainer?: boolean }) {
	const ref = useRef<HTMLDivElement>(null)
	useFlipList(ref, ids.join(' '))
	if (!withContainer) return null
	return (
		<div ref={ref}>
			{ids.map((id, index) => (
				<div
					key={id}
					data-flip-id={id}
					ref={(element) => {
						if (element)
							Object.defineProperty(element, 'offsetTop', { configurable: true, value: index * 80 })
					}}
				/>
			))}
		</div>
	)
}

function stubMotion(reduce: boolean) {
	vi.stubGlobal('matchMedia', (query: string) => ({ matches: reduce && query.includes('reduce') }))
}

describe('useFlipList', () => {
	it('slides the rows below a removed one up from where they were, by transform only', () => {
		stubMotion(false)
		const animate = vi.fn()
		HTMLElement.prototype.animate = animate
		const view = render(<List ids={['a', 'b', 'c']} />)
		expect(animate).not.toHaveBeenCalled()

		view.rerender(<List ids={['a', 'c']} />)
		// "a" did not move; "c" moved up one row (80px) and slides from there.
		expect(animate).toHaveBeenCalledTimes(1)
		expect(animate).toHaveBeenCalledWith([{ transform: 'translateY(80px)' }, { transform: 'none' }], {
			duration: FLIP_DURATION_MS,
			easing: FLIP_EASING,
		})
	})

	it('moves nothing when reduced motion is requested', () => {
		stubMotion(true)
		const animate = vi.fn()
		HTMLElement.prototype.animate = animate
		const view = render(<List ids={['a', 'b']} />)
		view.rerender(<List ids={['b']} />)
		expect(animate).not.toHaveBeenCalled()
	})

	it('degrades to no motion where the browser has no animation API or matchMedia', () => {
		vi.stubGlobal('matchMedia', undefined)
		;(HTMLElement.prototype as any).animate = undefined
		const view = render(<List ids={['a', 'b']} />)
		expect(() => view.rerender(<List ids={['b']} />)).not.toThrow()
	})

	it('waits for its container', () => {
		expect(() => render(<List ids={['a']} withContainer={false} />)).not.toThrow()
	})
})

// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
	headingNodes,
	LONG_MESSAGE_WORDS,
	LongMessageFrame,
	readSavedOffset,
	scrollParent,
} from './LongMessageFrame.js'

const LONG = Array.from({ length: LONG_MESSAGE_WORDS + 400 }, (_, index) => `word${index}`).join(' ')
const HEADINGS = ['Scope', 'Payment', 'Liability']

type Rect = { top: number; height: number; bottom?: number }
const rects = new Map<Element, Rect>()
let resize: (() => void) | undefined

function rectOf(element: Element, rect: Rect) {
	rects.set(element, rect)
}

beforeEach(() => {
	vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
		const rect = rects.get(this) ?? { top: 0, height: 0 }
		const bottom = rect.bottom ?? rect.top + rect.height
		return {
			top: rect.top,
			bottom,
			height: rect.height,
			left: 0,
			right: 0,
			width: 0,
			x: 0,
			y: rect.top,
		} as DOMRect
	})
	vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
		callback(0)
		return 1
	})
	vi.stubGlobal('cancelAnimationFrame', () => {})
	vi.stubGlobal(
		'ResizeObserver',
		class {
			constructor(callback: () => void) {
				resize = callback
			}
			observe() {}
			disconnect() {}
		},
	)
	Element.prototype.scrollIntoView = vi.fn()
	sessionStorage.clear()
})

afterEach(() => {
	cleanup()
	rects.clear()
	resize = undefined
	vi.restoreAllMocks()
	vi.unstubAllGlobals()
})

function Body() {
	return (
		<div>
			<h2>Scope</h2>
			<p>Words.</p>
			<h3>Payment</h3>
			<div data-testid="host" />
		</div>
	)
}

describe('LongMessageFrame', () => {
	it('passes a message under 1,500 words through unchanged', () => {
		const { container } = render(
			<LongMessageFrame messageId="short" text="A short note." headings={HEADINGS}>
				<p>A short note.</p>
			</LongMessageFrame>,
		)
		expect(container.innerHTML).toBe('<p>A short note.</p>')
	})

	it('shows reading time, progress and the outline, and follows the scroll inside its pane', async () => {
		render(
			<div data-testid="pane" style={{ overflowY: 'auto' }}>
				<LongMessageFrame messageId="msa" text={LONG} headings={HEADINGS}>
					<Body />
				</LongMessageFrame>
			</div>,
		)
		// The third heading lives inside a rendered email's shadow root.
		const host = screen.getByTestId('host')
		const shadow = host.attachShadow({ mode: 'open' })
		shadow.innerHTML = '<h2>Liability</h2>'

		expect(screen.getByText('8 min read · 0%')).toBeInTheDocument()
		expect(screen.getAllByRole('button', { name: '1 Scope' })).toHaveLength(2)
		expect(screen.getByRole('navigation', { name: 'Outline' })).toBeInTheDocument()

		const pane = screen.getByTestId('pane')
		const frame = document.querySelector('[data-slot="long-message"]') as Element
		rectOf(pane, { top: 100, height: 500 })
		rectOf(frame, { top: -300, height: 2000 })
		rectOf(screen.getByRole('heading', { name: 'Scope' }), { top: -200, height: 20 })
		rectOf(screen.getByRole('heading', { name: 'Payment' }), { top: 150, height: 20 })
		rectOf(shadow.querySelector('h2') as Element, { top: 900, height: 20 })
		act(() => {
			pane.dispatchEvent(new Event('scroll'))
		})

		expect(screen.getByRole('progressbar', { name: 'Read so far' })).toHaveAttribute('aria-valuenow', '45')
		expect(screen.getByText('8 min read · 45%')).toBeInTheDocument()
		for (const current of screen.getAllByRole('button', { name: '2 Payment' })) {
			expect(current).toHaveAttribute('aria-current', 'location')
		}
		expect(sessionStorage.getItem('ownmail:reading-position:msa')).toBe('400')

		await userEvent.click(screen.getAllByRole('button', { name: '3 Liability' })[0] as HTMLElement)
		expect(shadow.querySelector('h2')?.scrollIntoView).toHaveBeenCalledWith({
			block: 'start',
			behavior: 'smooth',
		})
	})

	it('returns to where the reader stopped once the message is tall enough', () => {
		sessionStorage.setItem('ownmail:reading-position:msa', '400')
		render(
			<div data-testid="pane" style={{ overflowY: 'scroll' }}>
				<LongMessageFrame messageId="msa" text={LONG} headings={HEADINGS}>
					<Body />
				</LongMessageFrame>
			</div>,
		)
		const pane = screen.getByTestId('pane')
		let scrollTop = 0
		Object.defineProperty(pane, 'scrollTop', {
			get: () => scrollTop,
			set: (value: number) => {
				scrollTop = value
			},
		})
		const frame = document.querySelector('[data-slot="long-message"]') as Element
		rectOf(pane, { top: 100, height: 500 })
		rectOf(frame, { top: 150, height: 2000 })
		act(() => resize?.())
		expect(scrollTop).toBe(450)
		// Restored once; later resizes only measure.
		act(() => resize?.())
		expect(scrollTop).toBe(450)
	})

	it('follows the page itself when no pane scrolls, and keeps going when storage is unavailable', () => {
		vi.spyOn(Storage.prototype, 'getItem').mockReturnValue('250')
		vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
			throw new Error('blocked')
		})
		const scrollBy = vi.fn()
		vi.stubGlobal('scrollBy', scrollBy)
		render(
			<LongMessageFrame messageId="page" text={LONG} headings={[]}>
				<p>Words.</p>
			</LongMessageFrame>,
		)
		const frame = document.querySelector('[data-slot="long-message"]') as Element
		rectOf(frame, { top: 50, height: 3000 })
		act(() => resize?.())
		expect(scrollBy).toHaveBeenCalledWith(0, 300)
		act(() => {
			window.dispatchEvent(new Event('scroll'))
		})
		expect(screen.queryByRole('navigation')).toBeNull()
		expect(screen.queryByText('Outline')).toBeNull()
	})

	it('keeps the saved position until the message is tall enough to return to it', () => {
		sessionStorage.setItem('ownmail:reading-position:tall', '5000')
		render(
			<LongMessageFrame messageId="tall" text={LONG} headings={HEADINGS}>
				<Body />
			</LongMessageFrame>,
		)
		rectOf(document.querySelector('[data-slot="long-message"]') as Element, { top: 0, height: 2000 })
		act(() => {
			window.dispatchEvent(new Event('scroll'))
		})
		expect(sessionStorage.getItem('ownmail:reading-position:tall')).toBe('5000')
	})

	it('restores nothing for a message read from the top', () => {
		const scrollBy = vi.fn()
		vi.stubGlobal('scrollBy', scrollBy)
		render(
			<LongMessageFrame messageId="fresh" text={LONG} headings={['Missing']}>
				<p>Words.</p>
			</LongMessageFrame>,
		)
		act(() => resize?.())
		expect(scrollBy).not.toHaveBeenCalled()
	})
})

describe('readSavedOffset', () => {
	it('reads a saved position, ignoring junk and blocked storage', () => {
		sessionStorage.setItem('ownmail:reading-position:a', 'junk')
		expect(readSavedOffset('a')).toBe(0)
		vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
			throw new Error('blocked')
		})
		expect(readSavedOffset('a')).toBe(0)
	})
})

describe('scrollParent and headingNodes', () => {
	it('find the scrolling ancestor and match headings by their words', () => {
		const pane = document.createElement('div')
		pane.style.overflowY = 'auto'
		const inner = document.createElement('div')
		inner.innerHTML = '<h1> Notices </h1>'
		pane.append(inner)
		document.body.append(pane)
		expect(scrollParent(inner.firstElementChild as Element)).toBe(pane)
		expect(scrollParent(pane)).toBeNull()
		expect(headingNodes(inner, ['notices', 'Other'])).toEqual([inner.firstElementChild, null])
		pane.remove()
	})
})

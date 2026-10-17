// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import {
	BLOCKED_IMAGE,
	blockedImageCount,
	declaredImageSize,
	EDGE_STYLE_ATTRIBUTE,
	edgeShadowStyle,
	HELD_IMAGE_ATTRIBUTE,
	HELD_PLACEHOLDER_ATTRIBUTE,
	heldImageBox,
	holdBlockedImages,
	installEdgeState,
} from './held-images.js'

function image(attributes: string): HTMLImageElement {
	const holder = document.createElement('div')
	holder.innerHTML = `<img ${attributes}>`
	return holder.firstElementChild as HTMLImageElement
}

function emailRoot(html: string): HTMLElement {
	const root = document.createElement('div')
	root.innerHTML = `<div class="email-root">${html}</div>`
	return root
}

describe('declared sizes', () => {
	it('reads pixels from attributes first, then the inline style, and nothing relative', () => {
		expect(declaredImageSize(image('width="400" height="100"'))).toEqual({ width: 400, height: 100 })
		expect(declaredImageSize(image('style="width:600px;height:auto"'))).toEqual({ width: 600, height: null })
		expect(declaredImageSize(image('width="100%" style="height: 80px"'))).toEqual({ width: null, height: 80 })
		expect(declaredImageSize(image('width="0"'))).toEqual({ width: null, height: null })
	})

	it('keeps both sides as a ratio, a lone width as a band, and a lone height as it is', () => {
		expect(heldImageBox(image('width="400" height="100"'))).toEqual({
			width: '400px',
			height: 'auto',
			'aspect-ratio': '400 / 100',
		})
		expect(heldImageBox(image('width="600" style="width:600px;height:auto"'))).toEqual({
			width: '600px',
			height: '54px',
		})
		expect(heldImageBox(image('height="90"'))).toEqual({
			width: 'auto',
			'min-width': '120px',
			height: '90px',
		})
		expect(heldImageBox(image('alt="Logo"'))).toEqual({ width: 'auto', 'min-width': '120px', height: '54px' })
	})
})

describe('held images', () => {
	it('counts blocked images a reader would have seen, never tracking pixels', () => {
		const root = emailRoot(
			'<img alt="a"><img width="600" height="200"><img width="1" height="1"><img width="1"><img src="/email-images/x.y">',
		)
		expect(blockedImageCount(root)).toBe(3)
		expect(blockedImageCount(null)).toBe(0)
	})

	it('puts one labelled, sized placeholder after each held image, once', () => {
		const root = emailRoot(
			'<img alt="Lisbon skyline" width="400" height="100"><img width="600" height="200"><img alt=" "><img width="1" height="1" alt="pixel"><img src="/email-images/x.y" alt="loaded">',
		)
		expect(holdBlockedImages(root)).toBe(2)
		expect(holdBlockedImages(root)).toBe(0)
		const placeholders = [...root.querySelectorAll<HTMLElement>(`[${HELD_PLACEHOLDER_ATTRIBUTE}]`)]
		expect(placeholders).toHaveLength(2)
		const [labelled, bare] = placeholders as [HTMLElement, HTMLElement]
		expect(labelled.previousElementSibling).toHaveAttribute(HELD_IMAGE_ATTRIBUTE)
		expect(labelled).toHaveAttribute('role', 'img')
		expect(labelled).toHaveAttribute('aria-label', 'Lisbon skyline')
		expect(labelled).toHaveTextContent('Lisbon skyline')
		expect(labelled.style.getPropertyValue('width')).toBe('400px')
		expect(labelled.style.getPropertyPriority('aspect-ratio')).toBe('important')
		expect(bare).toHaveAttribute('aria-hidden', 'true')
		expect(bare).toHaveTextContent('')
		expect(root.querySelectorAll(`${BLOCKED_IMAGE}[${HELD_IMAGE_ATTRIBUTE}]`)).toHaveLength(2)
	})

	it('hides held images behind striped placeholders, and quiets links only when asked', () => {
		// A failed image is hidden and named in its declared space the same way.
		expect(edgeShadowStyle(false)).toContain(
			`img:is([${HELD_IMAGE_ATTRIBUTE}],[data-ownmail-image-failed]){display:none!important;}`,
		)
		expect(edgeShadowStyle(false)).toContain(
			`:is([${HELD_PLACEHOLDER_ATTRIBUTE}],[data-ownmail-image-fallback]){display:inline-flex!important;`,
		)
		expect(edgeShadowStyle(false)).toContain('repeating-linear-gradient(135deg')
		expect(edgeShadowStyle(false)).not.toContain('cursor:default')
		expect(edgeShadowStyle(true)).toContain(':host .email-root a{cursor:default!important;')
	})
})

describe('installEdgeState', () => {
	it('installs one sheet, holds the current document and every document after it, until cleaned up', async () => {
		const host = document.createElement('div')
		const shadow = host.attachShadow({ mode: 'open' })
		const root = document.createElement('div')
		root.className = 'email-root'
		root.innerHTML = '<img alt="First">'
		shadow.appendChild(root)

		const cleanup = installEdgeState(shadow, true)
		expect(shadow.querySelectorAll(`style[${EDGE_STYLE_ATTRIBUTE}]`)).toHaveLength(1)
		expect(shadow.querySelector(`[${HELD_PLACEHOLDER_ATTRIBUTE}]`)).toHaveTextContent('First')

		const next = document.createElement('div')
		next.innerHTML = '<img alt="Second">'
		root.replaceChildren(next)
		await Promise.resolve()
		expect(shadow.querySelector(`[${HELD_PLACEHOLDER_ATTRIBUTE}]`)).toHaveTextContent('Second')

		cleanup()
		const again = installEdgeState(shadow, false)
		expect(shadow.querySelectorAll(`style[${EDGE_STYLE_ATTRIBUTE}]`)).toHaveLength(1)
		expect(shadow.querySelector(`style[${EDGE_STYLE_ATTRIBUTE}]`)?.textContent).not.toContain(
			'cursor:default',
		)
		again()
		root.replaceChildren(Object.assign(document.createElement('img'), { alt: 'Third' }))
		await Promise.resolve()
		expect(shadow.querySelector(`[${HELD_PLACEHOLDER_ATTRIBUTE}]`)).toBeNull()
	})
})

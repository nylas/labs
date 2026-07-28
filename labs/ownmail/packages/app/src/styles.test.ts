import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const stylesPath = fileURLToPath(new URL('./styles.css', import.meta.url))
const styles = readFileSync(stylesPath, 'utf8')

describe('touch editing styles', () => {
	it('keeps every editable surface at 16px on touch-first devices to prevent iOS focus zoom', () => {
		expect(styles).toMatch(
			/@media \(hover: none\) and \(pointer: coarse\)\s*\{\s*input,\s*textarea,\s*select,\s*\[contenteditable\]:not\(\[contenteditable="false"\]\),\s*\.app-input\s*\{\s*font-size: 1rem;/,
		)
	})

	it('keeps inline code inside the compose editor at 16px on touch-first devices', () => {
		const touchCodeRule =
			/@media \(hover: none\) and \(pointer: coarse\)\s*\{\s*\.markdown-editor code\s*\{\s*font-size: 1rem;/
		expect(styles).toMatch(touchCodeRule)
		// The override must appear after the base .markdown-editor code rule so
		// it wins the cascade at equal specificity.
		expect(styles.search(touchCodeRule)).toBeGreaterThan(styles.indexOf('.markdown-editor code {'))
	})
})

describe('navigation progress styles', () => {
	it('keeps pending navigation visible without motion when reduced motion is requested', () => {
		expect(styles).toMatch(
			/@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.navigation-progress-bar\s*\{\s*width: 100%;\s*animation: none;/,
		)
	})
})

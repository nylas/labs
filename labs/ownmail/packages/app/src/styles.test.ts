import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const stylesPath = fileURLToPath(new URL('./styles.css', import.meta.url))
const styles = readFileSync(stylesPath, 'utf8')

describe('touch editing styles', () => {
	it('keeps every editable surface at 16px on touch-first devices to prevent iOS focus zoom', () => {
		expect(styles).toMatch(
			/@media \(hover: none\) and \(pointer: coarse\)\s*\{\s*input,\s*textarea,\s*select,\s*\[contenteditable="true"\],\s*\.app-input\s*\{\s*font-size: 1rem;/,
		)
	})
})

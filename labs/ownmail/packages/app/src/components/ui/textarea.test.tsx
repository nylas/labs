// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Textarea } from './textarea.js'

afterEach(cleanup)

describe('Textarea', () => {
	it('renders a textarea carrying the data-slot and merged classes', () => {
		render(<Textarea placeholder="Notes" className="min-h-40" />)
		const textarea = screen.getByPlaceholderText('Notes')
		expect(textarea.tagName).toBe('TEXTAREA')
		expect(textarea).toHaveAttribute('data-slot', 'textarea')
		expect(textarea.className).toContain('min-h-40')
	})
})

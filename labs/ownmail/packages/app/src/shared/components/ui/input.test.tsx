// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Input } from './input.js'

afterEach(cleanup)

describe('Input', () => {
	it('renders an input carrying the data-slot, type, and merged classes', () => {
		render(<Input type="email" placeholder="you@example.com" className="mt-2" />)
		const input = screen.getByPlaceholderText('you@example.com')
		expect(input).toHaveAttribute('data-slot', 'input')
		expect(input).toHaveAttribute('type', 'email')
		expect(input.className).toContain('mt-2')
		expect(input.className).toContain('text-base')
		expect(input.className).toContain('sm:text-sm')
	})
})

// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Button, buttonVariants } from './button.js'

afterEach(cleanup)

describe('Button', () => {
	it('renders a native button with the default variant and merges extra classes', () => {
		render(<Button className="w-full">Save</Button>)
		const button = screen.getByRole('button', { name: 'Save' })
		expect(button).toHaveAttribute('data-slot', 'button')
		expect(button.className).toContain('w-full')
		expect(button.className).toContain('bg-primary')
		expect(button.className).toContain('touch-target')
		expect(button.className).not.toContain('transition-all')
	})

	it('applies the requested variant and size', () => {
		render(
			<Button variant="outline" size="sm">
				Edit
			</Button>,
		)
		const button = screen.getByRole('button', { name: 'Edit' })
		expect(button.className).toContain('border')
		expect(button.className).toContain('h-8')
		expect(button.className).toContain('max-md:min-h-11')
	})

	it('uses property-specific motion and touch-safe mobile sizing', () => {
		render(<Button>Save</Button>)
		const button = screen.getByRole('button', { name: 'Save' })
		expect(button).toHaveClass(
			'transition-[background-color,border-color,color,filter,opacity,transform]',
			'max-md:min-h-11',
			'max-md:min-w-11',
		)
		expect(button).not.toHaveClass('transition-all')
	})

	it('renders as its child element when asChild is set (button-styled link)', () => {
		render(
			<Button asChild>
				<a href="/x">Compose</a>
			</Button>,
		)
		const link = screen.getByRole('link', { name: 'Compose' })
		expect(link).toHaveAttribute('data-slot', 'button')
		expect(link).toHaveAttribute('href', '/x')
		expect(screen.queryByRole('button')).toBeNull()
	})

	it('exposes buttonVariants for styling non-button elements', () => {
		expect(buttonVariants({ variant: 'ghost' })).toContain('hover:bg-muted')
	})
})

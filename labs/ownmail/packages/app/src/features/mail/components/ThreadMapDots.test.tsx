// @vitest-environment jsdom

import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MapEntry } from '../lib/thread-reading-model'
import { dotHue, ThreadMapDots } from './ThreadMapDots'

afterEach(() => {
	cleanup()
	vi.unstubAllGlobals()
	vi.restoreAllMocks()
})

const entry = (messageId: string, email: string, isOwner = false): MapEntry => ({
	messageId,
	from: { name: email.split('@')[0] as string, email, isOwner },
	date: 0,
	chips: [],
	unread: false,
})

describe('ThreadMapDots', () => {
	it('tints the owner green and everyone else by the hash of their address', () => {
		expect(dotHue({ name: 'Ada', email: 'ada@ownmail.com', isOwner: true })).toBe(158)
		expect(dotHue({ name: 'Katherine', email: 'katherine.johnson@vercel.com', isOwner: false })).toBe(32)
	})

	it('puts the first dot in the tab order when no message is in focus, and needs no resize watch to fit', () => {
		vi.stubGlobal('ResizeObserver', undefined)
		vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(600)
		render(
			<div style={{ overflowY: 'auto' }}>
				<ThreadMapDots
					entries={[entry('a', 'grace@example.com'), entry('b', 'ada@ownmail.com', true)]}
					stoppedBeforeIndex={null}
					dateLabel={() => ''}
					onSelect={() => {}}
					onOpenPanel={() => {}}
				/>
			</div>,
		)
		const map = screen.getByRole('complementary', { name: 'Thread map' })
		expect((map.querySelector('.reader-map-track') as HTMLElement).style.maxHeight).toBe('600px')
		const dots = within(map).getAllByRole('button', { name: /^(?:grace|You)$/ })
		expect(dots.map((dot) => dot.tabIndex)).toEqual([0, -1])
		expect(dots[1]).toHaveAttribute('data-hue', '158')
	})

	it('titles each dot with the first name and day the board shows', () => {
		render(
			<ThreadMapDots
				entries={[
					{
						...entry('a', 'grace@example.com'),
						from: { name: 'Grace Hopper', email: 'grace@example.com', isOwner: false },
						date: 1,
					},
					entry('b', 'ada@ownmail.com', true),
				]}
				stoppedBeforeIndex={null}
				dateLabel={() => 'Sep 28'}
				onSelect={() => {}}
				onOpenPanel={() => {}}
			/>,
		)
		const dots = screen.getAllByRole('button', { name: /Grace Hopper|You/ })
		expect(dots[0]).toHaveAccessibleName('Grace Hopper, Sep 28')
		expect(dots[0]).toHaveAttribute('title', 'Grace, Sep 28')
		expect(dots[1]).toHaveAttribute('title', 'You')
	})
})

// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useIdentityState } from './use-identity-state.js'

describe('useIdentityState', () => {
	it('starts another identity from its own initial value on the first render, with no stale frame', () => {
		const seen: string[] = []
		const { result, rerender } = renderHook(
			({ contact }) => {
				const state = useIdentityState([contact], () => `closed:${contact}`)
				seen.push(state[0])
				return state
			},
			{ initialProps: { contact: 'ada' } },
		)
		act(() => result.current[1]('confirming-delete:ada'))
		expect(result.current[0]).toBe('confirming-delete:ada')
		const rendersForAda = seen.length

		rerender({ contact: 'grace' })

		// An effect-based reset would have rendered Ada's confirmation for Grace once.
		expect(new Set(seen.slice(rendersForAda))).toEqual(new Set(['closed:grace']))
	})

	it('keeps the value while the identity is unchanged and supports functional updates', () => {
		const { result, rerender } = renderHook(({ page }) => useIdentityState(['inbox', page], () => 0), {
			initialProps: { page: 1 },
		})
		act(() => result.current[1]((count) => count + 1))
		act(() => result.current[1]((count) => count + 1))
		rerender({ page: 1 })
		expect(result.current[0]).toBe(2)

		// A longer or shorter identity is a different identity.
		const other = renderHook(({ parts }) => useIdentityState(parts, () => 'fresh'), {
			initialProps: { parts: ['a'] as unknown[] },
		})
		act(() => other.result.current[1]('edited'))
		other.rerender({ parts: ['a', 'b'] })
		expect(other.result.current[0]).toBe('fresh')
	})

	it('drops an update that arrives for an identity no longer on screen', () => {
		const { result, rerender } = renderHook(
			({ folder }) => useIdentityState([folder], () => [] as string[]),
			{
				initialProps: { folder: 'inbox' },
			},
		)
		const appendToInbox = result.current[1]

		rerender({ folder: 'sent' })
		// A page requested for Inbox answers after the person opened Sent.
		act(() => appendToInbox((rows) => [...rows, 'inbox-row']))

		expect(result.current[0]).toEqual([])
		// Sent's own updates start from Sent's state, not from Inbox's late rows.
		act(() => result.current[1]((rows) => [...rows, 'sent-row']))
		expect(result.current[0]).toEqual(['sent-row'])
	})
})

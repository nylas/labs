// @vitest-environment jsdom

import { cleanup, renderHook } from '@testing-library/react'
import { renderToString } from 'react-dom/server'
import { afterEach, expect, it } from 'vitest'
import { MOBILE_BOTTOM_BAR_THREAD_ACTIONS_ID } from '#app/components/MobileTabBar'
import { useMobileThreadActionsTarget } from './ThreadResponseActions.js'

afterEach(() => {
	cleanup()
	document.getElementById(MOBILE_BOTTOM_BAR_THREAD_ACTIONS_ID)?.remove()
})

function Probe() {
	return <span>{useMobileThreadActionsTarget() ? 'slot' : 'none'}</span>
}

it('finds no slot when the mobile bar is not showing thread actions', () => {
	expect(renderHook(() => useMobileThreadActionsTarget()).result.current).toBeNull()
})

it('does not access the client toolbar during server rendering', () => {
	expect(renderToString(<Probe />)).toBe('<span>none</span>')
})

it('finds the mobile bar thread slot once mounted', () => {
	const slot = document.createElement('div')
	slot.id = MOBILE_BOTTOM_BAR_THREAD_ACTIONS_ID
	document.body.append(slot)
	expect(renderHook(() => useMobileThreadActionsTarget()).result.current).toBe(slot)
})

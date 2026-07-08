import { createServerFn } from '@tanstack/react-start'
import { resetDevMocks } from './dev-mocks.js'
import { usingDevMocks } from './platform.js'

export const resetDevMocksForServerRender = createServerFn({ method: 'GET' }).handler(async () => {
	if (await usingDevMocks()) resetDevMocks()
	return { ok: true }
})

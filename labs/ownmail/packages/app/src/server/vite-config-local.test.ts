import { fileURLToPath } from 'node:url'
import { loadConfigFromFile, type UserConfig } from 'vite'
import { describe, expect, it } from 'vitest'

const configFile = fileURLToPath(new URL('../../vite.config.local.ts', import.meta.url))

async function loadLocalConfig(command: 'serve' | 'build'): Promise<UserConfig> {
	const result = await loadConfigFromFile(
		{ command, mode: command === 'serve' ? 'development' : 'production' },
		configFile,
	)
	if (!result) throw new Error('Could not load the local Vite config.')
	return result.config
}

describe('local Vite config', () => {
	it('lets Node load dependencies normally during development SSR', async () => {
		const config = await loadLocalConfig('serve')

		expect(config.ssr?.external).toEqual(['cloudflare:workers'])
		expect(config.ssr).not.toHaveProperty('noExternal')
	})

	it('keeps dependencies bundled for the distributable Node build', async () => {
		const config = await loadLocalConfig('build')

		expect(config.ssr).toMatchObject({
			external: ['cloudflare:workers'],
			noExternal: true,
		})
	})
})

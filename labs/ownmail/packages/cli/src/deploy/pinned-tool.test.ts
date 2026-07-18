import { afterEach, describe, expect, it, vi } from 'vitest'

const control = vi.hoisted(() => ({
	packages: new Map<string, { version?: string; bin?: string | Record<string, string> }>(),
	resolveError: false,
}))

vi.mock('node:module', () => ({
	createRequire: () =>
		Object.assign(
			(id: string) => {
				const value = control.packages.get(id)
				if (!value) throw new Error('missing package')
				return value
			},
			{
				resolve: (id: string) => {
					if (control.resolveError) throw new Error('missing package')
					return `/deps/${id}`
				},
			},
		),
}))

import { pinnedToolInvocation } from './pinned-tool.js'

afterEach(() => {
	control.packages.clear()
	control.resolveError = false
	vi.restoreAllMocks()
})

describe('pinnedToolInvocation', () => {
	it('uses an exact locally installed tool with an object bin map', () => {
		control.packages.set('vercel/package.json', {
			version: '56.2.1',
			bin: { vercel: './dist/index.js' },
		})
		expect(pinnedToolInvocation('vercel')).toEqual({
			command: process.execPath,
			args: ['/deps/vercel/dist/index.js'],
			downloaded: false,
		})
	})

	it('supports a package with a string bin', () => {
		control.packages.set('netlify-cli/package.json', {
			version: '26.2.0',
			bin: './bin/run.js',
		})
		expect(pinnedToolInvocation('netlify')).toMatchObject({
			command: process.execPath,
			args: ['/deps/netlify-cli/bin/run.js'],
			downloaded: false,
		})
	})

	it.each([
		['wrong version', { version: '1.0.0', bin: { wrangler: './bin/wrangler.js' } }],
		['missing binary', { version: '4.107.0', bin: {} }],
		['escaping binary', { version: '4.107.0', bin: { wrangler: '../../outside.js' } }],
		['package-root binary', { version: '4.107.0', bin: { wrangler: '.' } }],
	] as const)('downloads the pinned tool for a %s local package', (_name, pkg) => {
		control.packages.set('wrangler/package.json', pkg)
		expect(pinnedToolInvocation('wrangler')).toEqual({
			command: 'npm',
			args: ['exec', '--yes', '--package=wrangler@4.107.0', '--', 'wrangler'],
			downloaded: true,
		})
	})

	it('uses npm.cmd on Windows when the package cannot be resolved', () => {
		control.resolveError = true
		vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
		expect(pinnedToolInvocation('wrangler')).toMatchObject({ command: 'npm.cmd', downloaded: true })
	})
})

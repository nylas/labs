import { createRequire } from 'node:module'
import { dirname, relative, resolve } from 'node:path'

const require = createRequire(import.meta.url)

export type PinnedTool = 'wrangler' | 'vercel' | 'netlify'

type ToolSpec = {
	packageName: string
	version: string
	command: string
}

const TOOL_SPECS: Record<PinnedTool, ToolSpec> = {
	wrangler: { packageName: 'wrangler', version: '4.114.0', command: 'wrangler' },
	vercel: { packageName: 'vercel', version: '56.5.0', command: 'vercel' },
	netlify: { packageName: 'netlify-cli', version: '26.2.0', command: 'netlify' },
}

export type ToolInvocation = { command: string; args: string[]; downloaded: boolean }

/**
 * Prefer a repository/local install for development. Published OwnMail omits
 * provider CLIs, so npm acquires only the exact helper selected by the user.
 */
export function pinnedToolInvocation(tool: PinnedTool): ToolInvocation {
	const spec = TOOL_SPECS[tool]
	try {
		const packagePath = require.resolve(`${spec.packageName}/package.json`)
		const pkg = require(`${spec.packageName}/package.json`) as {
			version?: string
			bin?: string | Record<string, string>
		}
		if (pkg.version !== spec.version) throw new Error('unexpected tool version')
		const relativeBin = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.[spec.command]
		if (!relativeBin) throw new Error('missing tool binary')
		const packageRoot = dirname(packagePath)
		const bin = resolve(packageRoot, relativeBin)
		const fromRoot = relative(packageRoot, bin)
		if (fromRoot.startsWith('..') || fromRoot === '') throw new Error('invalid tool binary')
		return { command: process.execPath, args: [bin], downloaded: false }
	} catch {
		return {
			command: process.platform === 'win32' ? 'npm.cmd' : 'npm',
			args: ['exec', '--yes', `--package=${spec.packageName}@${spec.version}`, '--', spec.command],
			downloaded: true,
		}
	}
}

import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const appRoot = resolve(packageRoot, '..', 'app')
const targetRoot = join(packageRoot, 'dist', 'template')
const entries = [
	'dist',
	'dist-vercel',
	'.vercel/output',
	'src',
	'public',
	'scripts',
	'components.json',
	'template.json',
	'vite.config.ts',
	'vite.config.vercel.ts',
	'tsconfig.json',
]
const sourceRoot = join(appRoot, 'src')

function includeProductionSource(source) {
	const sourcePath = relative(sourceRoot, source).split(sep).join('/')
	if (!sourcePath) return true
	return !(
		/(?:^|\/)(?:__tests__|real-email-fixtures)(?:\/|$)/.test(sourcePath) ||
		/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(sourcePath) ||
		/\.fixture\./.test(sourcePath)
	)
}

for (const entry of entries) {
	if (!existsSync(join(appRoot, entry))) {
		throw new Error(`OwnMail app build artifact is missing: ${entry}`)
	}
}

rmSync(targetRoot, { recursive: true, force: true })
mkdirSync(targetRoot, { recursive: true, mode: 0o755 })
for (const entry of entries) {
	cpSync(join(appRoot, entry), join(targetRoot, entry), {
		recursive: true,
		filter: entry === 'src' ? includeProductionSource : undefined,
	})
}

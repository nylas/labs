import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
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
	'template.json',
	'vite.config.ts',
	'vite.config.vercel.ts',
	'tsconfig.json',
]

for (const entry of entries) {
	if (!existsSync(join(appRoot, entry))) {
		throw new Error(`OwnMail app build artifact is missing: ${entry}`)
	}
}

rmSync(targetRoot, { recursive: true, force: true })
mkdirSync(targetRoot, { recursive: true, mode: 0o755 })
for (const entry of entries) {
	cpSync(join(appRoot, entry), join(targetRoot, entry), { recursive: true })
}

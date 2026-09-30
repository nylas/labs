import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs'
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

// Every build emits the same browser client. Ship it once, in the Cloudflare
// build, and let the CLI restore the Node copies when it materializes a target
// (see copyClient in src/deploy/materialize.ts). A copy that differs in any way
// is kept, so a future build divergence costs size rather than correctness.
const CLOUDFLARE_ONLY_CLIENT_FILES = new Set(['.assetsignore'])
const sharedClient = join(targetRoot, 'dist', 'client')

function clientFiles(root) {
	return readdirSync(root, { recursive: true, withFileTypes: true })
		.filter((entry) => entry.isFile())
		.map((entry) => relative(root, join(entry.parentPath, entry.name)).split(sep).join('/'))
		.filter((path) => !CLOUDFLARE_ONLY_CLIENT_FILES.has(path))
		.sort()
}

function sameClient(copy) {
	const expected = clientFiles(sharedClient)
	const actual = clientFiles(copy)
	return (
		expected.length === actual.length &&
		expected.every(
			(path, index) =>
				path === actual[index] &&
				readFileSync(join(sharedClient, path)).equals(readFileSync(join(copy, path))),
		)
	)
}

for (const copy of [
	join(targetRoot, 'dist-vercel', 'client'),
	join(targetRoot, '.vercel', 'output', 'static'),
]) {
	if (sameClient(copy)) {
		rmSync(copy, { recursive: true, force: true })
	} else {
		console.warn(`Keeping ${relative(targetRoot, copy)}: it differs from dist/client.`)
	}
}

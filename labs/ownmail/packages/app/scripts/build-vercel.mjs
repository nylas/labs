/**
 * Assembles a Vercel Build Output API v3 directory from the dist-vercel
 * vite build (`pnpm build:vercel` runs both). Deploy with:
 *   vercel deploy --prebuilt
 */
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(root, '.vercel', 'output')

rmSync(out, { recursive: true, force: true })
mkdirSync(join(out, 'static'), { recursive: true })
mkdirSync(join(out, 'functions', 'ssr.func'), { recursive: true })

// Static assets served from the CDN before the function runs.
cpSync(join(root, 'dist-vercel', 'client'), join(out, 'static'), { recursive: true })

// SSR function: the vite server bundle + a Node adapter entry.
cpSync(join(root, 'dist-vercel', 'server'), join(out, 'functions', 'ssr.func', 'server'), {
	recursive: true,
})
cpSync(join(root, 'scripts', 'node-adapter.mjs'), join(out, 'functions', 'ssr.func', 'node-adapter.mjs'))
writeFileSync(
	join(out, 'functions', 'ssr.func', 'index.mjs'),
	`import server from './server/server.js'
import { createNodeHandler } from './node-adapter.mjs'
export default createNodeHandler(server)
`,
)
writeFileSync(
	join(out, 'functions', 'ssr.func', '.vc-config.json'),
	`${JSON.stringify({ runtime: 'nodejs22.x', handler: 'index.mjs', launcherType: 'Nodejs' }, null, 2)}\n`,
)
writeFileSync(
	join(out, 'functions', 'ssr.func', 'package.json'),
	`${JSON.stringify({ type: 'module' }, null, 2)}\n`,
)

writeFileSync(
	join(out, 'config.json'),
	`${JSON.stringify(
		{
			version: 3,
			routes: [{ handle: 'filesystem' }, { src: '/(.*)', dest: '/ssr' }],
		},
		null,
		2,
	)}\n`,
)

console.log(`Vercel build output ready: ${out}`)
console.log('Deploy with: vercel deploy --prebuilt')

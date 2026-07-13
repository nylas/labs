/**
 * Local verification server for the Vercel (Node) build:
 *   pnpm build:vercel && node scripts/serve-node.mjs
 * Exercises the stateless-session platform path (no KV).
 */
import { createServer } from 'node:http'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createNodeHandler } from './node-adapter.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const { default: server } = await import(pathToFileURL(join(root, 'dist-vercel', 'server', 'server.js')).href)

const port = Number(process.env.PORT ?? 3100)
createServer(createNodeHandler(server)).listen(port, () => {
	console.log(`node target listening on http://localhost:${port}`)
})

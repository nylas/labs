/**
 * Local verification server for the Vercel (Node) build:
 *   pnpm build:vercel && node scripts/serve-node.mjs
 * Exercises the stateless-session platform path (no KV).
 */
import { createReadStream, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { dirname, extname, join, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createNodeHandler } from './node-adapter.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const { default: server } = await import(pathToFileURL(join(root, 'dist-vercel', 'server', 'server.js')).href)

const port = Number(process.env.PORT ?? 3100)
if (!Number.isInteger(port) || port < 1024 || port > 65_535) {
	throw new Error('PORT must be an integer between 1024 and 65535.')
}
const host = process.env.HOST ?? '127.0.0.1'
if (!['127.0.0.1', '::1', 'localhost'].includes(host)) {
	throw new Error('Local OwnMail may only bind to a loopback host.')
}

const clientRoot = resolve(root, 'dist-vercel', 'client')
const nodeHandler = createNodeHandler(server)
const contentTypes = {
	'.css': 'text/css; charset=utf-8',
	'.gif': 'image/gif',
	'.html': 'text/html; charset=utf-8',
	'.ico': 'image/x-icon',
	'.jpeg': 'image/jpeg',
	'.jpg': 'image/jpeg',
	'.js': 'text/javascript; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
	'.png': 'image/png',
	'.svg': 'image/svg+xml',
	'.webp': 'image/webp',
	'.woff': 'font/woff',
	'.woff2': 'font/woff2',
}

createServer((req, res) => {
	if ((req.method === 'GET' || req.method === 'HEAD') && serveStatic(req, res)) return
	void nodeHandler(req, res)
}).listen(port, host, () => {
	console.log(`OwnMail is running at http://localhost:${port}`)
})

function serveStatic(req, res) {
	let pathname
	try {
		pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname)
	} catch {
		res.writeHead(400).end('Bad request')
		return true
	}
	const candidate = resolve(clientRoot, `.${pathname}`)
	if (candidate !== clientRoot && !candidate.startsWith(`${clientRoot}${sep}`)) {
		res.writeHead(400).end('Bad request')
		return true
	}
	let stat
	try {
		stat = statSync(candidate)
	} catch {
		return false
	}
	if (!stat.isFile()) return false
	res.statusCode = 200
	res.setHeader('content-length', String(stat.size))
	res.setHeader('content-type', contentTypes[extname(candidate).toLowerCase()] ?? 'application/octet-stream')
	res.setHeader('x-content-type-options', 'nosniff')
	if (req.method === 'HEAD') res.end()
	else createReadStream(candidate).pipe(res)
	return true
}

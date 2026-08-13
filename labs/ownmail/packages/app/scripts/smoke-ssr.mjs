import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const appRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const host = '127.0.0.1'
const port = await availablePort(host)
const origin = `http://${host}:${port}`
const output = []
const server = spawn(process.execPath, ['scripts/serve-node.mjs'], {
	cwd: appRoot,
	env: {
		...process.env,
		APP_NAME: 'ownmail-ssr-smoke',
		HOST: host,
		INBOX_EMAIL: 'ada@ownmail.test',
		NODE_ENV: 'development',
		NYLAS_API_KEY: 'smoke-test-key',
		NYLAS_CLIENT_ID: 'smoke-test-client',
		NYLAS_REGION: 'us',
		OWNMAIL_DEV_MOCKS: '1',
		PORT: String(port),
		SESSION_SECRET: 'ownmail-ssr-smoke-session-secret',
		TEMPLATE_VERSION: '0.0.0-smoke',
	},
	stdio: ['ignore', 'pipe', 'pipe'],
})

server.stdout.on('data', (chunk) => output.push(chunk.toString()))
server.stderr.on('data', (chunk) => output.push(chunk.toString()))

try {
	await waitForServer(`${origin}/healthz`)
	const response = await fetch(`${origin}/mail/f/inbox`, {
		headers: { Cookie: 'ownmail_session=authenticated' },
		redirect: 'manual',
		signal: AbortSignal.timeout(10_000),
	})
	const body = await response.text()
	if (response.status !== 200 || !/^\s*<!doctype html>/i.test(body)) {
		throw new Error(
			`Authenticated mailbox SSR returned ${response.status} ${response.statusText || ''} with ${body.length} bytes.`,
		)
	}
	console.log('OwnMail authenticated mailbox SSR smoke test passed.')
} catch (error) {
	const logs = output.join('').trim()
	if (logs) process.stderr.write(`${logs}\n`)
	throw error
} finally {
	server.kill('SIGTERM')
	await Promise.race([
		new Promise((resolve) => server.once('exit', resolve)),
		new Promise((resolve) => setTimeout(resolve, 5_000)),
	])
	if (server.exitCode === null) server.kill('SIGKILL')
}

async function availablePort(hostname) {
	const probe = createServer()
	await new Promise((resolve, reject) => {
		probe.once('error', reject)
		probe.listen(0, hostname, resolve)
	})
	const address = probe.address()
	if (!address || typeof address === 'string') throw new Error('Could not allocate an SSR smoke-test port.')
	await new Promise((resolve, reject) => probe.close((error) => (error ? reject(error) : resolve())))
	return address.port
}

async function waitForServer(url) {
	const deadline = Date.now() + 30_000
	while (Date.now() < deadline) {
		if (server.exitCode !== null) throw new Error(`OwnMail SSR server exited with code ${server.exitCode}.`)
		try {
			const response = await fetch(url, { signal: AbortSignal.timeout(1_000) })
			if (response.ok) return
		} catch {
			// The built server may still be starting; retry until the bounded deadline.
		}
		await new Promise((resolve) => setTimeout(resolve, 100))
	}
	throw new Error('Timed out waiting for the OwnMail SSR server.')
}

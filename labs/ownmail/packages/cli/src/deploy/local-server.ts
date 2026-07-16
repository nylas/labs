import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { join } from 'node:path'
import { checkAppHealth } from './app-health.js'

export async function findLocalPort(preferred = 3000): Promise<number> {
	const start = validPort(preferred) ? preferred : 3000
	for (let port = start; port <= Math.min(65_535, start + 100); port++) {
		if (await portAvailable(port)) return port
	}
	throw new Error(
		`No available loopback port was found between ${start} and ${Math.min(65_535, start + 100)}.`,
	)
}

export async function startLocalServer(input: {
	dir: string
	port: number
	environment: Record<string, string>
}): Promise<string> {
	if (!validPort(input.port)) throw new Error('Local server port must be between 1024 and 65535.')
	for (const [name, value] of Object.entries(input.environment)) {
		if (!/^[A-Z][A-Z0-9_]{0,63}$/.test(name) || !value || value.length > 16_384 || /[\r\n\0]/.test(value)) {
			throw new Error('Local server environment is invalid.')
		}
	}
	const url = `http://localhost:${input.port}`
	let startFailed = false
	const child = spawn(process.execPath, [join(input.dir, 'scripts', 'serve-node.mjs')], {
		cwd: input.dir,
		env: {
			...process.env,
			...input.environment,
			HOST: '127.0.0.1',
			PORT: String(input.port),
		},
		stdio: 'inherit',
	})
	child.once('error', () => {
		startFailed = true
	})
	child.once('exit', () => {
		startFailed = true
	})
	const healthy = await checkAppHealth(url, { attempts: 20, delayMs: 250, timeoutMs: 1000 })
	if (!healthy || startFailed) {
		if (child.exitCode === null) child.kill('SIGTERM')
		throw new Error(
			'OwnMail could not start the local web server. Check that the selected port is available, then retry.',
		)
	}
	return url
}

function validPort(port: number): boolean {
	return Number.isInteger(port) && port >= 1024 && port <= 65_535
}

function portAvailable(port: number): Promise<boolean> {
	return new Promise((resolve) => {
		const server = createServer()
		server.unref()
		server.once('error', () => resolve(false))
		server.listen(port, '127.0.0.1', () => {
			server.close(() => resolve(true))
		})
	})
}

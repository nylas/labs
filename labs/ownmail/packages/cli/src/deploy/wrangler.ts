import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

function wranglerBin(): string {
	// Resolve the wrangler dependency's bin script so `npx ownmail` needs no
	// globally installed wrangler.
	const pkgPath = require.resolve('wrangler/package.json')
	const pkg = require('wrangler/package.json') as { bin: Record<string, string> }
	const rel = pkg.bin.wrangler ?? './bin/wrangler.js'
	return new URL(rel, `file://${pkgPath}`).pathname
}

export type WranglerResult = { code: number; stdout: string; stderr: string }

/**
 * Runs a wrangler command. `interactive` inherits stdio (browser OAuth login);
 * otherwise output is captured. `stdin` feeds `wrangler secret put`.
 */
export async function runWrangler(
	args: string[],
	opts: { cwd?: string; interactive?: boolean; stdin?: string; env?: Record<string, string> } = {},
): Promise<WranglerResult> {
	return new Promise((resolve, reject) => {
		const child = spawn(process.execPath, [wranglerBin(), ...args], {
			cwd: opts.cwd ?? process.cwd(),
			env: { ...process.env, ...opts.env },
			stdio: opts.interactive ? 'inherit' : ['pipe', 'pipe', 'pipe'],
		})
		let stdout = ''
		let stderr = ''
		child.stdout?.on('data', (d: Buffer) => {
			stdout += d.toString()
		})
		child.stderr?.on('data', (d: Buffer) => {
			stderr += d.toString()
		})
		if (opts.stdin !== undefined && child.stdin) {
			child.stdin.write(opts.stdin)
			child.stdin.end()
		}
		child.on('error', reject)
		child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }))
	})
}

export async function wranglerLoggedIn(): Promise<boolean> {
	const res = await runWrangler(['whoami'])
	return res.code === 0 && !/not authenticated|please run.*login/i.test(res.stdout + res.stderr)
}

export function cloudflareApiTokenConfigured(): boolean {
	return Boolean(process.env.CLOUDFLARE_API_TOKEN?.trim())
}

export async function wranglerLogin(opts: { openBrowser?: boolean } = {}): Promise<void> {
	const res = await runWrangler(['login', `--browser=${opts.openBrowser ? 'true' : 'false'}`], {
		interactive: true,
	})
	if (res.code !== 0) throw new Error('Cloudflare login failed — re-run ownmail to try again.')
}

/** Creates (or finds) a KV namespace and returns its id. */
export async function ensureKvNamespace(title: string): Promise<string> {
	const list = await runWrangler(['kv', 'namespace', 'list'])
	if (list.code === 0) {
		try {
			const namespaces = JSON.parse(list.stdout) as { id: string; title: string }[]
			const found = namespaces.find((n) => n.title === title || n.title.endsWith(`-${title}`))
			if (found) return found.id
		} catch {
			// fall through to create
		}
	}
	const created = await runWrangler(['kv', 'namespace', 'create', title])
	if (created.code !== 0) {
		throw new Error(`Failed to create KV namespace: ${created.stderr || created.stdout}`)
	}
	const match = (created.stdout + created.stderr).match(/id\s*[:=]\s*"?([0-9a-f]{32})"?/i)
	if (match?.[1]) return match[1]
	// Fallback: list again
	const relist = await runWrangler(['kv', 'namespace', 'list'])
	const namespaces = JSON.parse(relist.stdout) as { id: string; title: string }[]
	const found = namespaces.find((n) => n.title === title || n.title.endsWith(`-${title}`))
	if (!found) throw new Error('KV namespace created but id could not be determined')
	return found.id
}

export async function putSecret(workerName: string, name: string, value: string): Promise<void> {
	const res = await runWrangler(['secret', 'put', name, '--name', workerName], { stdin: value })
	if (res.code !== 0) {
		throw new Error(`Failed to set secret ${name}: ${res.stderr || res.stdout}`)
	}
}

/** Deploys the materialized config and returns the workers.dev URL. */
export async function deploy(configPath: string): Promise<string> {
	const res = await runWrangler(['deploy', '-c', configPath])
	if (res.code !== 0) {
		throw new Error(`wrangler deploy failed:\n${res.stderr || res.stdout}`)
	}
	const match = res.stdout.match(/https:\/\/[\w.-]+\.workers\.dev/)
	if (!match) throw new Error(`Deploy succeeded but no workers.dev URL found in output:\n${res.stdout}`)
	return match[0]
}

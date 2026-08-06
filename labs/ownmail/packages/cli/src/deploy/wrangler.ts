import { spawn } from 'node:child_process'
import { pinnedToolInvocation } from './pinned-tool.js'

export type WranglerResult = { code: number; stdout: string; stderr: string }

/**
 * A failure that happened before Wrangler could issue a Cloudflare mutation.
 * Callers may safely undo local work while preserving the recovery guidance.
 */
export class CloudflareNoChangeError extends Error {
	constructor(message: string) {
		super(message)
		this.name = 'CloudflareNoChangeError'
	}
}

const TOKEN_PERMISSIONS =
	'Account: Workers Scripts Edit, Workers KV Storage Edit, Account Settings Read; User: User Details Read, Memberships Read'

/**
 * Cloudflare can return detailed CLI output that is useful for debugging, but
 * it can also include account and request details. Keep that output out of the
 * CLI's user-facing errors and turn known failure classes into safe next steps.
 */
export function cloudflareFailure(
	action: string,
	result: WranglerResult,
	opts: { mayHaveChanged?: boolean } = {},
): Error {
	const output = `${result.stdout}\n${result.stderr}`.toLowerCase()
	const retry = opts.mayHaveChanged
		? 'The result may be unknown, so do not create a second project. Retry the same OwnMail command once; it safely resumes the recorded project.'
		: 'No local project state was changed. Fix this, then retry the same OwnMail command.'

	if (
		/not authenticated|\bauth(?:entication)?(?:\s+(?:failed|expired))?|api token|unauthorized|forbidden|\b401\b|\b403\b|permission|access denied/.test(
			output,
		)
	) {
		return new Error(
			`Cloudflare could not ${action} because the current credentials were rejected or lack permission. Retry this OwnMail command and connect with Wrangler OAuth, or replace \`CLOUDFLARE_API_TOKEN\` with a token that has ${TOKEN_PERMISSIONS}. ${retry}`,
		)
	}
	if (/quota|limit exceeded|too many requests|\b429\b/.test(output)) {
		return new Error(
			`Cloudflare could not ${action} because the account reached a service limit. Check Cloudflare account limits, wait before retrying, then retry this OwnMail command. ${retry}`,
		)
	}
	if (/timeout|timed out|network|econn|enotfound|temporar|\b5\d\d\b/.test(output)) {
		return new Error(
			`Cloudflare could not ${action} because its service or network connection was unavailable. Check your connection and Cloudflare status, then retry this OwnMail command. ${retry}`,
		)
	}
	if (/already exists|conflict|\b409\b/.test(output)) {
		return new Error(
			`Cloudflare could not ${action} because a resource conflicts with this setup. Check the Cloudflare Workers dashboard for this project's recorded resources, then retry this OwnMail command; it reuses recorded state. ${retry}`,
		)
	}
	return new Error(
		`Cloudflare could not ${action}. Check your Cloudflare account, then retry this OwnMail command. ${retry}`,
	)
}

function wranglerUnavailable(): CloudflareNoChangeError {
	return new CloudflareNoChangeError(
		'OwnMail could not download or start its pinned Cloudflare deployment helper. Check that npm can reach the registry, then retry the same OwnMail command. No Cloudflare changes were made.',
	)
}

/**
 * Runs a wrangler command. `interactive` inherits stdio (browser OAuth login);
 * otherwise output is captured. `stdin` feeds `wrangler secret put`.
 */
export async function runWrangler(
	args: string[],
	opts: { cwd?: string; interactive?: boolean; stdin?: string; env?: Record<string, string> } = {},
): Promise<WranglerResult> {
	return new Promise((resolve, reject) => {
		const invocation = pinnedToolInvocation('wrangler')
		const child = spawn(invocation.command, [...invocation.args, ...args], {
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
		child.on('error', () => reject(wranglerUnavailable()))
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
	if (res.code !== 0) {
		if (!(res.stdout + res.stderr).trim()) {
			throw new Error(
				'Cloudflare sign-in did not complete. Re-run `npx ownmail`, choose Wrangler OAuth, and finish the browser flow. No Cloudflare resources were changed.',
			)
		}
		throw cloudflareFailure('sign in', res)
	}
}

/** Creates (or finds) a KV namespace and returns its id. */
export async function ensureKvNamespace(title: string): Promise<string> {
	const list = await runWrangler(['kv', 'namespace', 'list'])
	if (list.code !== 0) throw cloudflareFailure('inspect session storage', list)

	let namespaces: { id: string; title: string }[]
	try {
		namespaces = JSON.parse(list.stdout) as { id: string; title: string }[]
	} catch {
		throw new Error(
			'Cloudflare returned an unreadable session-storage inventory. OwnMail did not create anything. Update OwnMail and re-run `npx ownmail`; if this continues, inspect Cloudflare with `npx wrangler kv namespace list`.',
		)
	}
	const found = namespaces.find((n) => n.title === title || n.title.endsWith(`-${title}`))
	if (found) return found.id

	const created = await runWrangler(['kv', 'namespace', 'create', title])
	if (created.code !== 0) {
		throw cloudflareFailure('create session storage', created)
	}
	const match = (created.stdout + created.stderr).match(/id\s*[:=]\s*"?([0-9a-f]{32})"?/i)
	if (match?.[1]) return match[1]
	// Fallback: list again
	const relist = await runWrangler(['kv', 'namespace', 'list'])
	if (relist.code !== 0)
		throw cloudflareFailure('confirm the new session storage', relist, { mayHaveChanged: true })
	try {
		const relisted = JSON.parse(relist.stdout) as { id: string; title: string }[]
		const foundAfterCreate = relisted.find((n) => n.title === title || n.title.endsWith(`-${title}`))
		if (foundAfterCreate) return foundAfterCreate.id
	} catch {
		// The recovery message below is the same for a missing or unreadable listing.
	}
	throw new Error(
		`Cloudflare may have created session storage named "${title}", but OwnMail could not confirm its ID. Do not start a new project. Run \`npx wrangler kv namespace list\` to find it, then re-run \`npx ownmail\`; it will safely resume.`,
	)
}

/**
 * Reports whether a worker already holds a secret with this name. Cloudflare
 * only ever returns secret names, so an existing value can be kept in place
 * without OwnMail ever reading or storing it.
 */
export async function workerHasSecret(workerName: string, name: string): Promise<boolean> {
	const res = await runWrangler(['secret', 'list', '--name', workerName])
	if (res.code !== 0) throw cloudflareFailure('inspect deployment secrets', res)

	let secrets: { name: string }[]
	try {
		secrets = JSON.parse(res.stdout) as { name: string }[]
	} catch {
		throw new Error(
			`Cloudflare returned an unreadable deployment secret inventory for "${workerName}". OwnMail changed no secrets. Update OwnMail and retry the same OwnMail command; if this continues, inspect Cloudflare with \`npx wrangler secret list --name ${workerName}\`.`,
		)
	}
	return secrets.some((secret) => secret.name === name)
}

export async function putSecret(workerName: string, name: string, value: string): Promise<void> {
	const res = await runWrangler(['secret', 'put', name, '--name', workerName], { stdin: value })
	if (res.code !== 0) {
		throw cloudflareFailure('store deployment secrets', res, { mayHaveChanged: true })
	}
}

/** Deploys the materialized config and returns the workers.dev URL. */
export async function deploy(configPath: string): Promise<string> {
	const res = await runWrangler(['deploy', '-c', configPath])
	if (res.code !== 0) {
		throw cloudflareFailure('deploy the mailbox app', res, { mayHaveChanged: true })
	}
	const match = res.stdout.match(/https:\/\/[\w.-]+\.workers\.dev/)
	if (!match) {
		throw new Error(
			'Cloudflare may have deployed the mailbox app, but OwnMail could not confirm its workers.dev URL. Do not create a second project. Retry the same OwnMail command once to safely resume, or check the Cloudflare Workers dashboard for the deployed worker.',
		)
	}
	return match[0]
}

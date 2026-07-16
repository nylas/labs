import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
const MAX_OUTPUT_BYTES = 1_000_000

type Provider = 'vercel' | 'netlify'
type CliResult = { code: number; stdout: string; stderr: string }
type RuntimeEnvironment = Record<string, string>

export type VercelProject = { projectId: string; orgId: string }
export type NetlifySite = { siteId: string }

export async function ensureVercelProject(
	dir: string,
	projectName: string,
	existing?: VercelProject,
): Promise<VercelProject> {
	if (existing) {
		writeVercelProject(dir, existing)
		return existing
	}
	await ensureProviderLogin('vercel')
	const linked = await runProviderCli('vercel', [
		'link',
		'--yes',
		'--project',
		projectName,
		'--cwd',
		dir,
		'--no-color',
	])
	if (linked.code !== 0) throw providerFailure('vercel', 'link the project', linked, true)
	let raw: unknown
	try {
		raw = JSON.parse(readFileSync(join(dir, '.vercel', 'project.json'), 'utf8')) as unknown
	} catch {
		throw new Error(
			'Vercel may have linked the project, but OwnMail could not verify its project identifiers. Re-run this command to reconcile the same project.',
		)
	}
	const project = parseVercelProject(raw)
	if (!project) {
		throw new Error(
			'Vercel returned invalid project identifiers. Re-run this command; OwnMail will not deploy to an unverified project.',
		)
	}
	return project
}

export async function setVercelEnvironment(
	dir: string,
	environment: RuntimeEnvironment,
	secretNames: ReadonlySet<string>,
): Promise<void> {
	for (const [name, value] of Object.entries(environment)) {
		validateEnvironmentEntry(name, value)
		const result = await runProviderCli(
			'vercel',
			[
				'env',
				'add',
				name,
				'production',
				'--force',
				...(secretNames.has(name) ? ['--sensitive'] : []),
				'--cwd',
				dir,
				'--no-color',
			],
			{ stdin: `${value}\n` },
		)
		if (result.code !== 0) throw providerFailure('vercel', 'store deployment settings', result, true)
	}
}

export async function deployVercel(dir: string): Promise<string> {
	const result = await runProviderCli('vercel', [
		'deploy',
		'--prebuilt',
		'--prod',
		'--yes',
		'--cwd',
		dir,
		'--no-color',
	])
	if (result.code !== 0) throw providerFailure('vercel', 'deploy the mailbox app', result, true)
	return requireProviderUrl(result.stdout, 'vercel.app', 'Vercel')
}

export async function ensureNetlifySite(
	dir: string,
	siteName: string,
	existingSiteId?: string,
): Promise<NetlifySite> {
	if (existingSiteId) return { siteId: requireUuid(existingSiteId, 'Netlify site ID') }
	await ensureProviderLogin('netlify')
	const created = await runProviderCli('netlify', ['sites:create', '--name', siteName, '--json'], {
		cwd: dir,
	})
	if (created.code !== 0) throw providerFailure('netlify', 'create the project', created, true)
	const raw = parseJsonOutput(created.stdout)
	const siteId = isRecord(raw) ? (raw.id ?? raw.site_id) : undefined
	if (typeof siteId !== 'string') {
		throw new Error(
			'Netlify may have created the project, but OwnMail could not verify its site ID. Re-run this command to reconcile the same project.',
		)
	}
	return { siteId: requireUuid(siteId, 'Netlify site ID') }
}

export async function setNetlifyEnvironment(
	dir: string,
	siteId: string,
	environment: RuntimeEnvironment,
	secretNames: ReadonlySet<string> = new Set(),
): Promise<void> {
	const lines: string[] = []
	for (const [name, value] of Object.entries(environment)) {
		validateEnvironmentEntry(name, value)
		lines.push(`${name}=${value}`)
	}
	const path = join(dir, `.ownmail-env-${randomBytes(12).toString('hex')}`)
	writeFileSync(path, `${lines.join('\n')}\n`, { mode: 0o600, flag: 'wx' })
	try {
		const result = await runProviderCli(
			'netlify',
			['env:import', path, '--site', requireUuid(siteId, 'Netlify site ID')],
			{ cwd: dir },
		)
		if (result.code !== 0) throw providerFailure('netlify', 'store deployment settings', result, true)
		for (const name of secretNames) {
			if (!(name in environment)) continue
			const protectedResult = await runProviderCli(
				'netlify',
				['env:set', name, '--secret', '--site', requireUuid(siteId, 'Netlify site ID')],
				{ cwd: dir },
			)
			if (protectedResult.code !== 0) {
				throw providerFailure('netlify', 'protect deployment secrets', protectedResult, true)
			}
		}
	} finally {
		try {
			writeFileSync(path, '', { mode: 0o600 })
		} finally {
			rmSync(path, { force: true })
		}
	}
}

export async function deployNetlify(dir: string, siteId: string): Promise<string> {
	const result = await runProviderCli(
		'netlify',
		[
			'deploy',
			'--prod',
			'--no-build',
			'--dir',
			'dist/client',
			'--functions',
			'netlify/functions',
			'--site',
			requireUuid(siteId, 'Netlify site ID'),
			'--json',
		],
		{ cwd: dir },
	)
	if (result.code !== 0) throw providerFailure('netlify', 'deploy the mailbox app', result, true)
	const raw = parseJsonOutput(result.stdout)
	const candidate = isRecord(raw) ? (raw.ssl_url ?? raw.url ?? raw.deploy_url) : undefined
	if (typeof candidate !== 'string') {
		throw new Error(
			'Netlify may have deployed the mailbox app, but OwnMail could not verify its URL. Re-run this command to reconcile the same project.',
		)
	}
	return requireProviderUrl(candidate, 'netlify.app', 'Netlify')
}

function writeVercelProject(dir: string, project: VercelProject): void {
	const parsed = parseVercelProject(project)
	if (!parsed) throw new Error('Recorded Vercel project identifiers are invalid; refusing to deploy.')
	const target = join(dir, '.vercel')
	mkdirSync(target, { recursive: true, mode: 0o700 })
	writeFileSync(join(target, 'project.json'), `${JSON.stringify(parsed)}\n`, { mode: 0o600 })
}

async function ensureProviderLogin(provider: Provider): Promise<void> {
	const checkArgs = provider === 'vercel' ? ['whoami', '--no-color'] : ['sites:list', '--json']
	const checked = await runProviderCli(provider, checkArgs)
	if (checked.code === 0) return
	const login = await runProviderCli(provider, ['login'], { interactive: true })
	if (login.code !== 0) throw providerFailure(provider, 'sign in', login, false)
}

function runProviderCli(
	provider: Provider,
	args: string[],
	opts: { cwd?: string; stdin?: string; interactive?: boolean } = {},
): Promise<CliResult> {
	return new Promise((resolve, reject) => {
		let bin: string
		try {
			bin = providerBin(provider)
		} catch {
			reject(
				new Error(
					`OwnMail could not start its bundled ${providerName(provider)} deployment helper. Reinstall or update OwnMail, then retry; no provider change was made.`,
				),
			)
			return
		}
		const child = spawn(process.execPath, [bin, ...args], {
			cwd: opts.cwd ?? process.cwd(),
			env: process.env,
			stdio: opts.interactive ? 'inherit' : ['pipe', 'pipe', 'pipe'],
		})
		let stdout = ''
		let stderr = ''
		const append = (current: string, chunk: Buffer) =>
			`${current}${chunk.toString()}`.slice(-MAX_OUTPUT_BYTES)
		child.stdout?.on('data', (chunk: Buffer) => {
			stdout = append(stdout, chunk)
		})
		child.stderr?.on('data', (chunk: Buffer) => {
			stderr = append(stderr, chunk)
		})
		if (opts.stdin !== undefined && child.stdin) child.stdin.end(opts.stdin)
		child.on('error', () => reject(new Error(`${providerName(provider)} deployment helper failed to start.`)))
		child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }))
	})
}

function providerBin(provider: Provider): string {
	const packageName = provider === 'vercel' ? 'vercel' : 'netlify-cli'
	const command = provider
	const packagePath = require.resolve(`${packageName}/package.json`)
	const pkg = require(`${packageName}/package.json`) as { bin: string | Record<string, string> }
	const relative = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin[command]
	if (!relative) throw new Error('missing binary')
	return fileURLToPath(new URL(relative, pathToFileURL(packagePath)))
}

function providerFailure(
	provider: Provider,
	action: string,
	result: CliResult,
	mayHaveChanged: boolean,
): Error {
	const output = `${result.stdout}\n${result.stderr}`.toLowerCase()
	const retry = mayHaveChanged
		? 'The remote result may be incomplete; retry this same OwnMail command so it can reconcile the recorded project.'
		: 'No deployment change was made.'
	if (/not authenticated|unauthorized|forbidden|log in|login|\b401\b|\b403\b|permission/.test(output)) {
		return new Error(
			`${providerName(provider)} could not ${action} because authentication or permission was rejected. Sign in with the provider CLI, then retry. ${retry}`,
		)
	}
	if (/already exists|conflict|\b409\b/.test(output)) {
		return new Error(
			`${providerName(provider)} could not ${action} because that project name already exists. Choose or remove the conflicting project in ${providerName(provider)}, then retry. ${retry}`,
		)
	}
	if (/quota|limit|too many requests|\b429\b/.test(output)) {
		return new Error(
			`${providerName(provider)} could not ${action} because the account reached a service limit. Check provider limits, then retry. ${retry}`,
		)
	}
	return new Error(
		`${providerName(provider)} could not ${action}. Check the provider dashboard, then retry. ${retry}`,
	)
}

function validateEnvironmentEntry(name: string, value: string): void {
	if (!/^[A-Z][A-Z0-9_]{0,63}$/.test(name)) throw new Error('Invalid deployment setting name.')
	if (!value || value.length > 16_384 || /[\r\n\0]/.test(value)) {
		throw new Error(`Deployment setting ${name} has an invalid value.`)
	}
}

function parseVercelProject(value: unknown): VercelProject | null {
	if (!isRecord(value)) return null
	const projectId = value.projectId
	const orgId = value.orgId
	if (!validProviderId(projectId) || !validProviderId(orgId)) return null
	return { projectId, orgId }
}

function validProviderId(value: unknown): value is string {
	return typeof value === 'string' && /^[A-Za-z0-9_-]{2,128}$/.test(value)
}

function requireUuid(value: string, label: string): string {
	if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
		throw new Error(`${label} is invalid; refusing to deploy.`)
	}
	return value
}

function requireProviderUrl(value: string, hostnameSuffix: string, provider: string): string {
	try {
		const url = new URL(value.trim())
		if (url.protocol !== 'https:' || !url.hostname.endsWith(`.${hostnameSuffix}`)) throw new Error('invalid')
		url.hash = ''
		url.search = ''
		return url.toString().replace(/\/$/, '')
	} catch {
		throw new Error(`${provider} returned an invalid deployment URL; refusing to record it.`)
	}
}

function parseJsonOutput(output: string): unknown {
	try {
		return JSON.parse(output) as unknown
	} catch {
		const start = output.indexOf('{')
		const end = output.lastIndexOf('}')
		if (start < 0 || end <= start) return null
		try {
			return JSON.parse(output.slice(start, end + 1)) as unknown
		} catch {
			return null
		}
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function providerName(provider: Provider): string {
	return provider === 'vercel' ? 'Vercel' : 'Netlify'
}

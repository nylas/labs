import * as p from '@clack/prompts'
import { NylasV3Client } from '@nylas-labs/cli-kit'
import { wranglerLoggedIn } from '../deploy/wrangler.js'
import { apiBaseUrl } from '../nylas-env.js'
import { createContext, requireDashboard, requireGateway, tokens } from '../steps/context.js'
import { pickExistingProject } from './shared.js'

type CheckResult = { name: string; ok: boolean; detail: string; fixed?: boolean }

/** Re-checks every external dependency of a project and fixes what it can. */
export async function runDoctor(opts: { name?: string }): Promise<void> {
	p.intro('ownmail doctor')
	const project = await pickExistingProject(opts.name)
	const ctx = await createContext(project)
	const results: CheckResult[] = []

	// 1. Dashboard session
	let sessionOk = false
	if (ctx.auth) {
		try {
			await requireDashboard(ctx).currentSession(tokens(ctx))
			sessionOk = true
		} catch {
			// falls through
		}
	}
	results.push({
		name: 'Nylas session',
		ok: sessionOk,
		detail: sessionOk ? 'valid' : 'expired — run `npx ownmail login`',
	})

	// 2. API access (mint a probe client from a fresh key if session works)
	let v3: NylasV3Client | null = ctx.v3
	if (!v3 && sessionOk && project.applicationId) {
		try {
			const key = await requireGateway(ctx).createApiKey(tokens(ctx), project.region, project.applicationId, {
				name: `ownmail doctor ${Date.now()}`,
			})
			v3 = new NylasV3Client(key.apiKey, project.region, fetch, apiBaseUrl(project.region))
		} catch {
			// reported below
		}
	}

	// 3. Domain verification
	if (project.domainId && sessionOk) {
		try {
			const domain = await requireDashboard(ctx).getInboxDomain(tokens(ctx), project.domainId, project.region)
			const ok = domain.verifiedOwnership && domain.verifiedMx
			results.push({
				name: `Domain ${domain.domainAddress}`,
				ok,
				detail: ok
					? 'verified'
					: `unverified checks: ${[
							!domain.verifiedOwnership && 'ownership',
							!domain.verifiedMx && 'mx',
							!domain.verifiedSpf && 'spf',
							!domain.verifiedDkim && 'dkim',
						]
							.filter(Boolean)
							.join(', ')} — run \`npx ownmail\` to resume verification`,
			})
		} catch {
			results.push({ name: 'Domain', ok: false, detail: 'could not fetch domain state' })
		}
	}

	// 4. Grant exists
	if (v3 && project.grantId) {
		try {
			const grants = await v3.listGrants({ limit: 200 })
			const found = grants.data.find((g) => g.id === project.grantId)
			results.push({
				name: `Inbox ${project.inboxEmail ?? ''}`,
				ok: Boolean(found),
				detail: found ? `grant ${found.grant_status ?? 'valid'}` : 'grant missing — was it deleted?',
			})
		} catch (err) {
			results.push({ name: 'Inbox', ok: false, detail: `API error: ${(err as Error).message}` })
		}
	}

	// 5. Redirect URIs (auto-fix)
	if (v3 && project.workersDevUrl) {
		const wanted = [`${project.workersDevUrl}/auth/callback`, 'http://localhost:3000/auth/callback']
		if (project.appDomain) wanted.push(`https://${project.appDomain}/auth/callback`)
		try {
			const existing = await v3.listRedirectUris()
			const have = new Set(existing.data.map((r) => r.url))
			const missing = wanted.filter((u) => !have.has(u))
			if (missing.length > 0) await v3.ensureRedirectUris(wanted)
			results.push({
				name: 'Login redirect URIs',
				ok: true,
				detail: missing.length > 0 ? `re-registered: ${missing.join(', ')}` : 'registered',
				fixed: missing.length > 0,
			})
		} catch (err) {
			results.push({ name: 'Login redirect URIs', ok: false, detail: (err as Error).message })
		}
	}

	// 6. Cloudflare + worker health
	results.push({
		name: 'Cloudflare login',
		ok: await wranglerLoggedIn(),
		detail: (await wranglerLoggedIn()) ? 'authenticated' : 'run any ownmail deploy command to log in',
	})
	if (project.workersDevUrl) {
		let healthy = false
		let detail = 'unreachable'
		try {
			const res = await fetch(`${project.workersDevUrl}/healthz`)
			healthy = res.ok
			if (res.ok) {
				const body = (await res.json()) as { templateVersion?: string }
				detail = `live (template ${body.templateVersion ?? '?'})`
			} else {
				detail = `HTTP ${res.status}`
			}
		} catch {
			// unreachable
		}
		results.push({ name: `App ${project.workersDevUrl}`, ok: healthy, detail })
	}

	for (const r of results) {
		const icon = r.ok ? (r.fixed ? '🔧' : '✅') : '❌'
		p.log.message(`${icon} ${r.name}: ${r.detail}`)
	}
	const failing = results.filter((r) => !r.ok)
	p.outro(failing.length === 0 ? 'All checks passed.' : `${failing.length} check(s) need attention.`)
	if (failing.length > 0) process.exitCode = 1
}

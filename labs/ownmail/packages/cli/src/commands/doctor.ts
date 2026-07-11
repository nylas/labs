import * as p from '@clack/prompts'
import { NylasV3Client } from '@nylas-labs/cli-kit'
import { setupRealtimeWebhook } from '../deploy/webhook.js'
import { wranglerLoggedIn } from '../deploy/wrangler.js'
import { apiBaseUrl } from '../nylas-env.js'
import type { ProjectState } from '../state/schema.js'
import { listProjectStateIssues } from '../state/store.js'
import { createContext, requireDashboard, requireGateway, tokens } from '../steps/context.js'
import { activeAppUrl, redirectCallbackUrls } from './project-summary.js'
import { pickExistingProject } from './shared.js'

type CheckResult = {
	name: string
	status: 'pass' | 'fail' | 'skip'
	detail: string
	fixed?: boolean
}

/** Re-checks every external dependency of a project; repairs only with --fix. */
export async function runDoctor(opts: { name?: string; fix?: boolean }): Promise<void> {
	p.intro('ownmail doctor')
	const stateIssues = listProjectStateIssues(opts.name)
	let project: ProjectState
	try {
		project = await pickExistingProject(opts.name)
	} catch (err) {
		if (stateIssues.length === 0) throw err
		reportResults([
			{
				name: 'Local project state',
				status: 'fail',
				detail: formatStateIssues(stateIssues),
			},
		])
		return
	}
	const ctx = await createContext(project)
	const results: CheckResult[] = []
	if (stateIssues.length > 0) {
		results.push({
			name: 'Local project state',
			status: 'fail',
			detail: formatStateIssues(stateIssues),
		})
	}

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
		status: sessionOk ? 'pass' : 'fail',
		detail: sessionOk ? 'valid' : 'expired — run `npx ownmail login`',
	})

	// 2. API access. Plain doctor is read-only, so it only uses an existing client.
	let v3: NylasV3Client | null = ctx.v3
	let probeKeyId: string | undefined
	if (!v3 && sessionOk && project.applicationId) {
		if (opts.fix) {
			try {
				const key = await requireGateway(ctx).createApiKey(
					tokens(ctx),
					project.region,
					project.applicationId,
					{
						name: `ownmail doctor ${new Date().toISOString()}`,
						expiresIn: 3600,
					},
				)
				probeKeyId = key.id
				v3 = new NylasV3Client(key.apiKey, project.region, fetch, apiBaseUrl(project.region))
				results.push({
					name: 'Temporary API access',
					status: 'pass',
					detail: 'created for this repair run',
				})
			} catch {
				results.push({
					name: 'Temporary API access',
					status: 'fail',
					detail: 'could not create a temporary API key; API checks and repairs were skipped',
				})
			}
		} else {
			results.push({
				name: 'Nylas API checks',
				status: 'skip',
				detail:
					'read-only mode cannot create a temporary API key; run `npx ownmail doctor --fix` to allow API checks and repairs',
			})
		}
	}

	try {
		// 3. Domain verification
		if (project.domainId && sessionOk) {
			try {
				const domain = await requireDashboard(ctx).getInboxDomain(
					tokens(ctx),
					project.domainId,
					project.region,
				)
				const ok = domain.verifiedOwnership && domain.verifiedMx
				results.push({
					name: `Domain ${domain.domainAddress}`,
					status: ok ? 'pass' : 'fail',
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
				results.push({ name: 'Domain', status: 'fail', detail: 'could not fetch domain state' })
			}
		}

		// 4. Grant exists
		if (project.grantId) {
			if (v3) {
				try {
					const grants = await v3.listGrants({ limit: 200 })
					const found = grants.data.find((g) => g.id === project.grantId)
					results.push({
						name: `Inbox ${project.inboxEmail ?? ''}`,
						status: found ? 'pass' : 'fail',
						detail: found ? `grant ${found.grant_status ?? 'valid'}` : 'grant missing — was it deleted?',
					})
				} catch (err) {
					results.push({ name: 'Inbox', status: 'fail', detail: `API error: ${(err as Error).message}` })
				}
			} else {
				results.push({
					name: `Inbox ${project.inboxEmail ?? ''}`,
					status: 'skip',
					detail: 'requires Nylas API access; run `npx ownmail doctor --fix` to check it',
				})
			}
		}

		// 5. Redirect URIs. Missing URIs are repaired only in --fix mode.
		const wanted = redirectCallbackUrls(project)
		if (wanted.length > 1) {
			if (v3) {
				try {
					const existing = await v3.listRedirectUris()
					const have = new Set(existing.data.map((r) => r.url))
					const missing = wanted.filter((u) => !have.has(u))
					if (missing.length > 0 && opts.fix) {
						await v3.ensureRedirectUris(wanted)
					}
					results.push({
						name: 'Login redirect URIs',
						status: missing.length === 0 || opts.fix ? 'pass' : 'fail',
						detail:
							missing.length === 0
								? 'registered'
								: opts.fix
									? `registered missing callbacks: ${missing.join(', ')}`
									: `missing callbacks: ${missing.join(', ')} — run \`npx ownmail doctor --fix\``,
						...(missing.length > 0 && opts.fix ? { fixed: true } : {}),
					})
				} catch (err) {
					results.push({ name: 'Login redirect URIs', status: 'fail', detail: (err as Error).message })
				}
			} else {
				results.push({
					name: 'Login redirect URIs',
					status: 'skip',
					detail: 'requires Nylas API access; run `npx ownmail doctor --fix` to check and repair them',
				})
			}
		}

		// 6. Hosting + app health
		if (needsCloudflareLogin(project)) {
			const cloudflareOk = await wranglerLoggedIn()
			results.push({
				name: 'Cloudflare login',
				status: cloudflareOk ? 'pass' : 'fail',
				detail: cloudflareOk ? 'authenticated' : 'run any ownmail deploy command to log in',
			})
		}
		const url = activeAppUrl(project)
		let appHealthy = false
		if (url) {
			let detail = 'unreachable'
			try {
				const res = await fetch(`${url}/healthz`)
				appHealthy = res.ok
				if (res.ok) {
					const body = (await res.json()) as { templateVersion?: string }
					detail = `live (template ${body.templateVersion ?? '?'})`
				} else {
					detail = `HTTP ${res.status}`
				}
			} catch {
				// unreachable
			}
			results.push({ name: `App ${url}`, status: appHealthy ? 'pass' : 'fail', detail })
		} else if (project.completedSteps.includes('deploy')) {
			results.push({
				name: 'App URL',
				status: 'fail',
				detail: 'missing from local state — run `npx ownmail` to repair deployment state',
			})
		}

		if (opts.fix) {
			if (project.hostingProvider === 'manual') {
				results.push(formatWebhookRepairResult({ status: 'skipped', reason: 'manual-hosting' }))
			} else if (!v3) {
				results.push({
					name: 'Instant updates',
					status: 'skip',
					detail: 'requires Nylas API access; rerun `npx ownmail doctor --fix` after API access is available',
				})
			} else {
				const webhook = await setupRealtimeWebhook(project, v3, { attempts: 1, delayMs: 0 })
				results.push(formatWebhookRepairResult(webhook))
			}
		}
	} finally {
		if (probeKeyId && project.applicationId) {
			try {
				await requireGateway(ctx).revokeApiKey(tokens(ctx), project.region, project.applicationId, probeKeyId)
				results.push({ name: 'Temporary API key', status: 'pass', detail: 'revoked' })
			} catch (err) {
				results.push({
					name: 'Temporary API key',
					status: 'fail',
					detail: `could not revoke temporary key: ${(err as Error).message}`,
				})
			}
		}
	}

	reportResults(results)
}

function reportResults(results: CheckResult[]): void {
	for (const r of results) {
		const icon = r.status === 'pass' ? (r.fixed ? '🔧' : '✅') : r.status === 'skip' ? '⚠️' : '❌'
		p.log.message(`${icon} ${r.name}: ${r.detail}`)
	}
	const failing = results.filter((r) => r.status === 'fail')
	const skipped = results.filter((r) => r.status === 'skip')
	p.outro(outroMessage(failing.length, skipped.length))
	if (failing.length > 0) process.exitCode = 1
}

function outroMessage(failing: number, skipped: number): string {
	if (failing === 0 && skipped === 0) return 'All checks passed.'
	if (failing === 0) return `All completed checks passed. ${skipped} check(s) skipped.`
	if (skipped === 0) return `${failing} check(s) need attention.`
	return `${failing} check(s) need attention. ${skipped} check(s) skipped.`
}

function formatWebhookRepairResult(result: Awaited<ReturnType<typeof setupRealtimeWebhook>>): CheckResult {
	if (result.status === 'registered') {
		return {
			name: 'Instant updates',
			status: 'pass',
			detail: 'registered realtime webhook',
			fixed: true,
		}
	}
	if (result.status === 'skipped' && result.reason === 'missing-app-url') {
		return {
			name: 'Instant updates',
			status: 'fail',
			detail: 'missing public HTTPS app URL',
		}
	}
	if (result.status === 'skipped' && result.reason === 'unhealthy-app') {
		return {
			name: 'Instant updates',
			status: 'skip',
			detail: 'skipped until the app URL is healthy',
		}
	}
	if (result.status === 'skipped' && result.reason === 'manual-hosting') {
		return {
			name: 'Instant updates',
			status: 'skip',
			detail: 'manual hosting uses polling unless you configure webhooks yourself',
		}
	}
	return {
		name: 'Instant updates',
		status: 'fail',
		detail: 'could not register realtime webhook; the app will continue with polling',
	}
}

function needsCloudflareLogin(project: ProjectState): boolean {
	if (project.ejected || project.hostingProvider === 'manual') return false
	return (
		project.hostingProvider === 'cloudflare' ||
		Boolean(project.workerName || project.workersDevUrl || project.appDomain)
	)
}

function formatStateIssues(issues: ReturnType<typeof listProjectStateIssues>): string {
	const labels = issues.map((issue) => issue.file).join(', ')
	return `malformed local state file(s): ${labels}. Move the file aside or fix the JSON, then rerun doctor.`
}

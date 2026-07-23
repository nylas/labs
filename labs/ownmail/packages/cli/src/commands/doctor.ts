import * as p from '@clack/prompts'
import { type GatewayApiKey, NylasV3Client } from '@nylas-labs/cli-kit'
import { setupRealtimeWebhook } from '../deploy/webhook.js'
import { putSecret, wranglerLoggedIn } from '../deploy/wrangler.js'
import { apiBaseUrl } from '../nylas-env.js'
import type { ProjectState } from '../state/schema.js'
import { listProjectStateIssues, saveProject } from '../state/store.js'
import { createContext, requireDashboard, requireGateway, tokens } from '../steps/context.js'
import { OWNMAIL_USER_AGENT } from '../usage-attribution.js'
import { activeAppUrl, redirectCallbackUrls } from './project-summary.js'
import { formatCommandError, pickExistingProject, supportReference } from './shared.js'

type CheckResult = {
	name: string
	status: 'pass' | 'fail' | 'skip'
	detail: string
	fixed?: boolean
}

type ApiKeyIssue = {
	/** The key ID that was previously installed on the app, if any. */
	oldKeyId?: string
	detail: string
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
	let sessionError: unknown
	if (ctx.auth) {
		try {
			await requireDashboard(ctx).currentSession(tokens(ctx))
			sessionOk = true
		} catch (err) {
			sessionError = err
		}
	}
	results.push({
		name: 'Nylas session',
		status: sessionOk ? 'pass' : 'fail',
		detail: sessionOk ? 'valid' : withSupportReference('expired — run `npx ownmail login`', sessionError),
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
				v3 = new NylasV3Client(
					key.apiKey,
					project.region,
					fetch,
					apiBaseUrl(project.region),
					OWNMAIL_USER_AGENT,
				)
				results.push({
					name: 'Temporary API access',
					status: 'pass',
					detail: 'created for this repair run',
				})
			} catch (err) {
				results.push({
					name: 'Temporary API access',
					status: 'fail',
					detail: withSupportReference(
						'could not create a temporary API key; API checks and repairs were skipped — run `npx ownmail login`, then retry',
						err,
					),
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

	// 3. Deployed API-key status. This is deliberately a dashboard query rather
	// than an API request: an invalid key cannot authenticate an API request.
	// Defer any repair until after Cloudflare auth is confirmed, so we never mint
	// a replacement that cannot be installed on the Worker.
	let apiKeyIssue: ApiKeyIssue | null = null
	if (sessionOk && project.applicationId) {
		if (!project.apiKeyId) {
			apiKeyIssue = { detail: 'not tracked locally' }
		} else {
			try {
				const apiKeys = await requireGateway(ctx).listApiKeys(
					tokens(ctx),
					project.region,
					project.applicationId,
				)
				const key = apiKeys.find((candidate) => candidate.id === project.apiKeyId)
				apiKeyIssue = apiKeyIssueFor(key, project.apiKeyId)
			} catch (err) {
				results.push({
					name: 'Nylas API key',
					status: 'fail',
					detail: withSupportReference(
						'could not check key status — run `npx ownmail login`, then retry',
						err,
					),
				})
			}
		}
		if (!apiKeyIssue) {
			results.push({ name: 'Nylas API key', status: 'pass', detail: 'active' })
		} else if (!opts.fix) {
			results.push({
				name: 'Nylas API key',
				status: 'fail',
				detail: `${apiKeyIssue.detail} — run \`npx ownmail doctor --fix\` to rotate it`,
			})
		}
	}

	try {
		// 4. Domain verification
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
			} catch (err) {
				results.push({
					name: 'Domain',
					status: 'fail',
					detail: withSupportReference(
						'could not fetch domain state — run `npx ownmail login`, then retry',
						err,
					),
				})
			}
		}

		// 5. Grant exists
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
					results.push({ name: 'Inbox', status: 'fail', detail: formatCommandError(err) })
				}
			} else {
				results.push({
					name: `Inbox ${project.inboxEmail ?? ''}`,
					status: 'skip',
					detail: 'requires Nylas API access; run `npx ownmail doctor --fix` to check it',
				})
			}
		}

		// 6. Redirect URIs. Missing URIs are repaired only in --fix mode.
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
					results.push({
						name: 'Login redirect URIs',
						status: 'fail',
						detail: formatCommandError(err),
					})
				}
			} else {
				results.push({
					name: 'Login redirect URIs',
					status: 'skip',
					detail: 'requires Nylas API access; run `npx ownmail doctor --fix` to check and repair them',
				})
			}
		}

		// 7. Hosting + app health
		const cloudflareLoginRequired = needsCloudflareLogin(project)
		let cloudflareOk = !cloudflareLoginRequired
		if (cloudflareLoginRequired) {
			cloudflareOk = await wranglerLoggedIn()
			results.push({
				name: 'Cloudflare login',
				status: cloudflareOk ? 'pass' : 'fail',
				detail: cloudflareOk ? 'authenticated' : 'run any ownmail deploy command to log in',
			})
		}
		if (apiKeyIssue && opts.fix) {
			results.push(await repairApiKey(project, ctx, cloudflareOk, apiKeyIssue))
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
			} else if (
				project.hostingProvider &&
				project.hostingProvider !== 'cloudflare' &&
				project.hostingProvider !== 'vercel'
			) {
				results.push(formatWebhookRepairResult({ status: 'skipped', reason: 'non-cloudflare-hosting' }))
			} else if (!cloudflareOk) {
				results.push({
					name: 'Instant updates',
					status: 'skip',
					detail: 'requires Cloudflare authentication before the webhook secret can be stored',
				})
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
					detail: `Could not revoke the temporary key.\n\n${formatCommandError(err)}`,
				})
			}
		}
	}

	reportResults(results)
}

function apiKeyIssueFor(key: GatewayApiKey | undefined, keyId: string): ApiKeyIssue | null {
	if (!key) return { oldKeyId: keyId, detail: 'not found in Nylas' }
	if (isExpired(key)) return { oldKeyId: keyId, detail: 'expired' }
	if (key.status.trim().toLowerCase() !== 'active') {
		return { oldKeyId: keyId, detail: key.status.trim() ? key.status.trim().toLowerCase() : 'inactive' }
	}
	return null
}

function isExpired(key: GatewayApiKey): boolean {
	if (typeof key.expiresAt !== 'number' || !Number.isFinite(key.expiresAt)) return false
	// Dashboard APIs may serialize epoch timestamps in seconds or milliseconds.
	const expiresAtMs = key.expiresAt < 1_000_000_000_000 ? key.expiresAt * 1_000 : key.expiresAt
	return expiresAtMs <= Date.now()
}

async function repairApiKey(
	project: ProjectState,
	ctx: Awaited<ReturnType<typeof createContext>>,
	cloudflareOk: boolean,
	issue: ApiKeyIssue,
): Promise<CheckResult> {
	const applicationId = project.applicationId
	/* v8 ignore start -- repairApiKey is only invoked after runDoctor verifies applicationId. */
	if (!applicationId) {
		return {
			name: 'Nylas API key',
			status: 'fail',
			detail: `${issue.detail} — missing Nylas application; rerun ownmail setup`,
		}
	}
	/* v8 ignore stop */
	if (project.hostingProvider && project.hostingProvider !== 'cloudflare') {
		return {
			name: 'Nylas API key',
			status: 'fail',
			detail: `${issue.detail} — create a replacement API key and update NYLAS_API_KEY in your hosting provider`,
		}
	}
	if (!project.workerName) {
		return {
			name: 'Nylas API key',
			status: 'fail',
			detail: `${issue.detail} — missing Cloudflare Worker name; rerun ownmail setup`,
		}
	}
	if (!cloudflareOk) {
		return {
			name: 'Nylas API key',
			status: 'fail',
			detail: `${issue.detail} — authenticate Cloudflare, then rerun \`npx ownmail doctor --fix\``,
		}
	}
	let created: GatewayApiKey & { apiKey: string }
	try {
		created = await requireGateway(ctx).createApiKey(tokens(ctx), project.region, applicationId, {
			name: `ownmail ${project.slug} (doctor repair ${new Date().toISOString().slice(0, 10)})`,
		})
	} catch (err) {
		return {
			name: 'Nylas API key',
			status: 'fail',
			detail: withSupportReference(
				`${issue.detail} — could not create a replacement key; try \`npx ownmail login\``,
				err,
			),
		}
	}

	try {
		await putSecret(project.workerName, 'NYLAS_API_KEY', created.apiKey)
	} catch {
		// The replacement was never installed, so revoke it instead of leaving an
		// untracked active credential behind. The previously installed key remains.
		try {
			await requireGateway(ctx).revokeApiKey(tokens(ctx), project.region, applicationId, created.id)
		} catch (revokeError) {
			// The operator gets the generic repair failure below; never print secrets.
			const reference = supportReference(revokeError)
			if (reference) {
				return {
					name: 'Nylas API key',
					status: 'fail',
					detail: `${issue.detail} — could not store a replacement in Cloudflare, and the unused Nylas key could not be revoked\n\n${reference}`,
				}
			}
		}
		return {
			name: 'Nylas API key',
			status: 'fail',
			detail: `${issue.detail} — could not store a replacement in Cloudflare`,
		}
	}

	project.apiKeyId = created.id
	saveProject(project)
	if (issue.oldKeyId && issue.oldKeyId !== created.id) {
		try {
			await requireGateway(ctx).revokeApiKey(tokens(ctx), project.region, applicationId, issue.oldKeyId)
		} catch (err) {
			return {
				name: 'Nylas API key',
				status: 'fail',
				detail: withSupportReference(
					'replacement installed, but the previous key still needs to be revoked in Nylas',
					err,
				),
			}
		}
	}
	return {
		name: 'Nylas API key',
		status: 'pass',
		detail: 'rotated and stored in Cloudflare',
		fixed: true,
	}
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
	if (result.status === 'skipped' && result.reason === 'non-cloudflare-hosting') {
		return {
			name: 'Instant updates',
			status: 'skip',
			detail: 'this hosting mode uses polling; automatic webhook setup is available on Cloudflare and Vercel',
		}
	}
	return {
		name: 'Instant updates',
		status: 'fail',
		detail: `could not register realtime webhook; the app will continue with polling${result.status === 'failed' && result.requestId ? `\n\nRequest ID: ${result.requestId}. Include this ID if you contact Nylas Support.` : ''}`,
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

function withSupportReference(message: string, err: unknown): string {
	const reference = supportReference(err)
	return reference ? `${message}\n\n${reference}` : message
}

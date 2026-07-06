import * as p from '@clack/prompts'
import { listProjects, loadProject, newProject, saveProject } from '../state/store.js'
import { createContext, type StepContext } from '../steps/context.js'
import {
	stepCfAuth,
	stepCfResources,
	stepDeploy,
	stepRedirectUris,
	stepVerify,
	stepWebhook,
} from '../steps/deploy.js'
import {
	CancelledError,
	stepApiKey,
	stepApp,
	stepConnector,
	stepDashboardAuth,
	stepDomain,
	stepGrant,
	stepOrg,
} from '../steps/provision.js'

type Step = { id: string; run: (ctx: StepContext) => Promise<void> }

/**
 * The step machine. Every step is lookup-first/idempotent; a re-run resumes
 * wherever the previous run stopped. Note redirect-uris runs after deploy —
 * the workers.dev URL only exists once the first deploy lands.
 */
const STEPS: Step[] = [
	{ id: 'dashboard-auth', run: stepDashboardAuth },
	{ id: 'org', run: stepOrg },
	{ id: 'app', run: stepApp },
	{ id: 'api-key', run: stepApiKey },
	{ id: 'connector', run: stepConnector },
	{ id: 'domain', run: stepDomain },
	{ id: 'grant', run: stepGrant },
	{ id: 'cf-auth', run: stepCfAuth },
	{ id: 'cf-resources', run: stepCfResources },
	{ id: 'deploy', run: stepDeploy },
	{ id: 'webhook', run: stepWebhook },
	{ id: 'redirect-uris', run: stepRedirectUris },
	{ id: 'verify', run: stepVerify },
]

export async function runCreate(opts: { name?: string; region?: 'us' | 'eu' }): Promise<void> {
	p.intro('ownmail — your inbox, your domain, no per-seat fees')

	const project = await resolveProject(opts)
	const ctx = await createContext(project)

	for (const step of STEPS) {
		try {
			await step.run(ctx)
		} catch (err) {
			if (err instanceof CancelledError) {
				p.cancel('Paused. Re-run `npx ownmail` any time — you’ll pick up right here.')
				process.exitCode = 1
				return
			}
			p.log.error(err instanceof Error ? err.message : String(err))
			p.cancel(
				'Something went wrong. Fix the issue above and re-run `npx ownmail` — completed steps are skipped.',
			)
			process.exitCode = 1
			return
		}
	}
	p.outro('Enjoy your inbox — powered by Nylas.')
}

async function resolveProject(opts: { name?: string; region?: 'us' | 'eu' }) {
	if (opts.name) {
		return loadProject(opts.name) ?? newProject(opts.name, opts.region ?? 'us')
	}
	const existing = listProjects().filter((proj) => !proj.ejected)
	if (existing.length === 1) return existing[0]!
	if (existing.length > 1) {
		const picked = await p.select({
			message: 'Which project?',
			options: [
				...existing.map((proj) => ({
					value: proj.slug,
					label: proj.inboxEmail ? `${proj.slug} (${proj.inboxEmail})` : proj.slug,
				})),
				{ value: '__new__', label: 'Start a new one' },
			],
		})
		if (p.isCancel(picked)) throw new CancelledError()
		if (picked !== '__new__') return loadProject(picked)!
	}

	const name = await p.text({
		message: 'Name your project (used for your app URL)',
		placeholder: 'acme',
		validate: (v) =>
			/^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])?$/.test(v ?? '')
				? undefined
				: 'Lowercase letters, digits, hyphens (3–40 chars)',
	})
	if (p.isCancel(name)) throw new CancelledError()
	const project = newProject(name, opts.region ?? 'us')
	saveProject(project)
	return project
}

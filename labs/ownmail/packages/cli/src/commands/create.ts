import * as p from '@clack/prompts'
import { defaultProjectRegion, ownmailNylasEnvironment } from '../nylas-env.js'
import type { ProjectState } from '../state/schema.js'
import { listProjects, loadProject, newProject, saveProject } from '../state/store.js'
import { createContext, type StepContext } from '../steps/context.js'
import {
	stepCfAuth,
	stepCfResources,
	stepDeploy,
	stepHostingProvider,
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
	{ id: 'hosting', run: stepHostingProvider },
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
	const requestedRegion = opts.region ? defaultProjectRegion(opts.region) : undefined
	const newProjectRegion = requestedRegion ?? defaultProjectRegion('us')
	if (opts.name) {
		const loaded = loadProject(opts.name)
		if (loaded) return normalizeProjectRegion(loaded, requestedRegion)
		return newProject(opts.name, newProjectRegion)
	}
	const existing = listProjects().filter((proj) => !proj.ejected)
	if (existing.length === 1 && existing[0]) return normalizeProjectRegion(existing[0], requestedRegion)
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
		if (picked !== '__new__') {
			const project = loadProject(picked)
			if (!project) throw new Error(`No project named "${picked}".`)
			return normalizeProjectRegion(project, requestedRegion)
		}
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
	const project = newProject(name, newProjectRegion)
	saveProject(project)
	return project
}

function normalizeProjectRegion(
	project: ProjectState,
	requestedRegion?: ProjectState['region'],
): ProjectState {
	const region = requestedRegion ?? stagingDefaultRegionRepair(project) ?? project.region
	if (project.region === region) return project
	if (project.applicationId || project.domainId || project.grantId) {
		throw new Error(
			`"${project.slug}" was started in ${project.region}, but this run is targeting ${region}. Re-run with --region ${project.region} or start a new project name.`,
		)
	}
	project.region = region
	saveProject(project)
	p.log.info(`Using ${region.toUpperCase()} for ${ownmailNylasEnvironment()} dashboard resources.`)
	return project
}

function stagingDefaultRegionRepair(project: ProjectState): ProjectState['region'] | undefined {
	if (ownmailNylasEnvironment() !== 'staging') return undefined
	if (project.region !== 'eu') return undefined
	if (project.applicationId || project.domainId || project.grantId) return undefined
	const onlyAuthAndOrg = project.completedSteps.every((step) => step === 'dashboard-auth' || step === 'org')
	return onlyAuthAndOrg ? 'us' : undefined
}

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
	stepDomainPlan,
	stepGrant,
	stepOrg,
} from '../steps/provision.js'

type Step = {
	id: ProjectState['completedSteps'][number]
	run: (ctx: StepContext) => Promise<void>
}

type SetupPhase = { name: string; steps: Step[] }

type TerminalDimensions = {
	columns?: number
	rows?: number
}

const COMPACT_TERMINAL_COLUMNS = 72
const COMPACT_TERMINAL_ROWS = 24

/**
 * The step machine. Every step is lookup-first/idempotent; a re-run resumes
 * wherever the previous run stopped. Note redirect-uris runs after deploy —
 * the workers.dev URL only exists once the first deploy lands.
 */
const SETUP_PHASES: SetupPhase[] = [
	{
		name: 'Connect your Nylas account',
		steps: [
			{ id: 'dashboard-auth', run: stepDashboardAuth },
			{ id: 'org', run: stepOrg },
		],
	},
	{
		name: 'Review your setup plan',
		steps: [
			{ id: 'hosting', run: stepHostingProvider },
			{ id: 'cf-auth', run: stepCfAuth },
			{ id: 'domain-plan', run: stepDomainPlan },
			{ id: 'plan-confirmed', run: stepConfirmPlan },
		],
	},
	{
		name: 'Create your email address and inbox',
		steps: [
			{ id: 'app', run: stepApp },
			{ id: 'api-key', run: stepApiKey },
			{ id: 'connector', run: stepConnector },
			{ id: 'domain', run: stepDomain },
			{ id: 'grant', run: stepGrant },
		],
	},
	{
		name: 'Deploy your mailbox app',
		steps: [
			{ id: 'cf-resources', run: stepCfResources },
			{ id: 'deploy', run: stepDeploy },
			{ id: 'webhook', run: stepWebhook },
			{ id: 'redirect-uris', run: stepRedirectUris },
		],
	},
	{
		name: 'Verify your app',
		steps: [{ id: 'verify', run: stepVerify }],
	},
]

export async function runCreate(opts: { name?: string; region?: 'us' | 'eu' }): Promise<void> {
	showSetupHeader()

	const project = await resolveProject(opts)
	showResumePoint(project)
	const ctx = await createContext(project)

	for (const [phaseIndex, phase] of SETUP_PHASES.entries()) {
		p.log.step(`[${phaseIndex + 1}/${SETUP_PHASES.length}] ${phase.name}`)
		for (const step of phase.steps) {
			try {
				await step.run(ctx)
			} catch (err) {
				if (err instanceof CancelledError) {
					p.cancel('Paused. Re-run `npx ownmail` any time — you’ll pick up right here.')
					process.exitCode = 1
					return
				}
				throw err
			}
		}
	}
	p.outro('Enjoy your inbox — powered by Nylas.')
}

export function showSetupHeader(dimensions: TerminalDimensions = process.stdout): void {
	// Keep the Clack title short: it is rendered inside a bordered line.
	p.intro('ownmail')
	if (isCompactTerminal(dimensions)) {
		p.log.info('Your inbox. Your domain. We’ll guide you through setup.')
		return
	}
	p.note(
		[
			'Create a Nylas inbox and deploy a private mailbox + calendar app.',
			'You’ll connect Nylas and choose hosting; we’ll guide each step.',
			'Free nylas.email addresses need no DNS changes.',
			'Save the inbox password when prompted — it’s shown once.',
		].join('\n'),
		'Your inbox. Your domain.',
	)
}

function isCompactTerminal({ columns, rows }: TerminalDimensions): boolean {
	const width = validTerminalDimension(columns) ?? 80
	const height = validTerminalDimension(rows) ?? 24
	return width < COMPACT_TERMINAL_COLUMNS || height < COMPACT_TERMINAL_ROWS
}

function validTerminalDimension(value: number | undefined): number | undefined {
	if (typeof value !== 'number') return undefined
	return Number.isSafeInteger(value) && value > 0 ? value : undefined
}

async function stepConfirmPlan(ctx: StepContext): Promise<void> {
	if (ctx.project.completedSteps.includes('plan-confirmed')) return
	if (ctx.project.applicationId || ctx.project.grantId) {
		markPlanConfirmed(ctx.project)
		return
	}
	const hosting = hostingLabel(ctx.project.hostingProvider)
	const emailDomain = ctx.project.domainAddress ?? ctx.project.plannedDomainAddress
	if (!emailDomain || !ctx.project.hostingProvider) {
		throw new Error(
			'Setup plan is incomplete — re-run ownmail to choose an email domain and hosting provider.',
		)
	}
	p.note(
		[
			`Project:      ${ctx.project.slug}`,
			`Region:       ${ctx.project.region.toUpperCase()}`,
			`Email domain: ${emailDomain}`,
			`Hosting:      ${hosting}`,
			'',
			'Continuing creates the Nylas app, API key, email domain, and inbox shown above.',
		].join('\n'),
		'Ready to create',
	)
	const confirmed = await p.confirm({ message: 'Create these OwnMail resources?', initialValue: true })
	if (p.isCancel(confirmed) || !confirmed) throw new CancelledError()
	markPlanConfirmed(ctx.project)
}

function hostingLabel(provider: ProjectState['hostingProvider']): string {
	switch (provider) {
		case 'cloudflare':
			return 'Cloudflare Workers'
		case 'vercel':
			return 'Vercel'
		case 'netlify':
			return 'Netlify'
		case 'local':
			return 'Local web server'
		case 'manual':
			return 'Manual upload'
		default:
			return 'Not selected'
	}
}

function markPlanConfirmed(project: ProjectState): void {
	project.completedSteps.push('plan-confirmed')
	saveProject(project)
}

function showResumePoint(project: ProjectState): void {
	const activePhase = SETUP_PHASES.find((phase) =>
		phase.steps.some((step) => !project.completedSteps.includes(step.id)),
	)
	if (!activePhase) {
		p.log.info(`Checking completed project “${project.slug}” across ${SETUP_PHASES.length} setup phases.`)
		return
	}
	const activePhaseIndex = SETUP_PHASES.indexOf(activePhase)
	const verb = project.completedSteps.length === 0 ? 'Starting' : 'Resuming'
	p.log.info(
		`${verb} “${project.slug}” at [${activePhaseIndex + 1}/${SETUP_PHASES.length}] ${activePhase.name}. Completed work is checked and reused.`,
	)
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
	if (existing.length > 0) {
		const picked = await p.select({
			message: 'Project name',
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

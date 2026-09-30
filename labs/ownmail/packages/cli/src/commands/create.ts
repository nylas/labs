import * as p from '@clack/prompts'
import { defaultProjectRegion, ownmailNylasEnvironment } from '../nylas-env.js'
import type { ProjectState } from '../state/schema.js'
import { normalizeSiteName } from '../state/site-name.js'
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
import { stepRecover } from '../steps/recover.js'
import { adoptDeployment, type Deployment, findDeployedApp, findDeployments } from '../steps/resume.js'
import { stepSiteName } from '../steps/site-name.js'
import { LOGIN_PROJECT_SLUG } from './misc.js'

type Step = {
	/** `recover` is tracked by `adoptedFromAccount`, not `completedSteps`. */
	id: ProjectState['completedSteps'][number] | 'recover'
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
			{ id: 'recover', run: stepRecover },
		],
	},
	{
		name: 'Review your setup plan',
		steps: [
			{ id: 'hosting', run: stepHostingProvider },
			{ id: 'cf-auth', run: stepCfAuth },
			{ id: 'domain-plan', run: stepDomainPlan },
			{ id: 'site-name', run: stepSiteName },
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

export async function runCreate(opts: {
	name?: string
	region?: 'us' | 'eu'
	siteName?: string
}): Promise<void> {
	showSetupHeader()

	const { project, connected } = await resolveProject(opts)
	applyRequestedSiteName(project, opts.siteName)
	showResumePoint(project)
	const ctx = connected ?? (await createContext(project))

	for (const [phaseIndex, phase] of SETUP_PHASES.entries()) {
		p.log.step(`[${phaseIndex + 1}/${SETUP_PHASES.length}] ${phase.name}`)
		for (const step of phase.steps) {
			// Already done while finding the project; running them again would re-prompt.
			if (connected && CONNECT_STEPS.some((id) => id === step.id)) continue
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
		p.log.info('Create your email address and launch your mail app. We’ll guide each step.')
		return
	}
	p.note(
		[
			'Create an email address and launch a ready-to-use app for mail, calendar, and contacts.',
			'Choose your email domain, then run the app in your cloud account or locally.',
			'Nylas hosts the mailbox service through Agent Accounts.',
			'Nylas-provided trial addresses need no DNS changes.',
			'Save the inbox password when prompted — it’s shown once.',
		].join('\n'),
		'Launch an inbox on your domain—with one guided command.',
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
	const siteName = ctx.project.siteName
	if (!emailDomain || !ctx.project.hostingProvider || !siteName) {
		throw new Error(
			'Setup plan is incomplete — re-run ownmail to choose an email domain, app name, and hosting provider.',
		)
	}
	p.note(
		[
			`Project:      ${ctx.project.slug}`,
			`App name:     ${siteName}`,
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

function applyRequestedSiteName(project: ProjectState, requested: string | undefined): void {
	if (requested === undefined) return
	const siteName = normalizeSiteName(requested)
	if (project.completedSteps.includes('deploy') && siteName !== project.siteName) {
		throw new Error(
			`This app is already deployed. Rename it with \`npx ownmail app name <app-name> --name ${project.slug}\`.`,
		)
	}
	project.siteName = siteName
	saveProject(project)
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

function isStepDone(project: ProjectState, id: Step['id']): boolean {
	return id === 'recover' ? !project.adoptedFromAccount : project.completedSteps.includes(id)
}

function showResumePoint(project: ProjectState): void {
	const activePhase = SETUP_PHASES.find((phase) => phase.steps.some((step) => !isStepDone(project, step.id)))
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

type ResolvedProject = {
	project: ProjectState
	/** Set when the account was connected to look for the project; the run reuses this session. */
	connected?: StepContext
}

const CONNECT_STEPS: ProjectState['completedSteps'] = ['dashboard-auth', 'org']
const NEW_PROJECT = '__new__'
const DEPLOYED_PROJECT = '__deployed__'

async function resolveProject(opts: { name?: string; region?: 'us' | 'eu' }): Promise<ResolvedProject> {
	const requestedRegion = opts.region ? defaultProjectRegion(opts.region) : undefined
	const newProjectRegion = requestedRegion ?? defaultProjectRegion('us')
	if (opts.name) {
		const loaded = loadProject(opts.name)
		if (loaded) return { project: normalizeProjectRegion(loaded, requestedRegion) }
		return { project: newNamedProject(opts.name, newProjectRegion) }
	}
	const existing = listProjects().filter((proj) => !proj.ejected)
	const picked = await p.select({
		message: existing.length > 0 ? 'Project name' : 'Set up OwnMail',
		options: [
			...existing.map((proj) => ({
				value: proj.slug,
				label: proj.inboxEmail ? `${proj.slug} (${proj.inboxEmail})` : proj.slug,
			})),
			{ value: NEW_PROJECT, label: 'Start a new one' },
			{
				value: DEPLOYED_PROJECT,
				label: 'Resume an app deployed from another computer',
				hint: 'Cloudflare, Vercel, or Netlify',
			},
		],
	})
	if (p.isCancel(picked)) throw new CancelledError()
	if (picked === DEPLOYED_PROJECT) {
		const localSlugs = new Set(listProjects().map((proj) => proj.slug))
		return resumeDeployedProject(newProjectRegion, localSlugs)
	}
	if (picked !== NEW_PROJECT) {
		const project = loadProject(picked)
		if (!project) throw new Error(`No project named "${picked}".`)
		return { project: normalizeProjectRegion(project, requestedRegion) }
	}
	const name = await promptProjectName()
	const local = loadProject(name)
	if (local) return { project: normalizeProjectRegion(local, requestedRegion) }
	return { project: newNamedProject(name, newProjectRegion) }
}

function newNamedProject(slug: string, region: ProjectState['region']): ProjectState {
	const project = newProject(slug, region)
	saveProject(project)
	return project
}

/**
 * Adopts an app deployed from another computer: the hosting account shows the
 * deployment, and the Nylas organization's deployment keys identify its app.
 */
async function resumeDeployedProject(
	region: ProjectState['region'],
	localSlugs: Set<string>,
): Promise<ResolvedProject> {
	const provider = await p.select({
		message: 'Where is the app deployed?',
		options: [
			{ value: 'cloudflare' as const, label: 'Cloudflare Workers' },
			{ value: 'vercel' as const, label: 'Vercel' },
			{ value: 'netlify' as const, label: 'Netlify' },
		],
	})
	if (p.isCancel(provider)) throw new CancelledError()
	const found = (await findDeployments(provider)).filter((deployment) => !localSlugs.has(deployment.slug))
	if (found.length === 0) {
		throw new Error(
			'No OwnMail app was found on the hosting account you are signed in to. Sign in to the account that hosts the app, then re-run `npx ownmail`. Apps run locally or uploaded manually cannot be resumed; start a new project instead.',
		)
	}
	const pickedUrl = await p.select({
		message: 'Which app do you want to manage from this computer?',
		options: found.map((deployment) => ({
			value: deployment.url,
			label: deployment.slug,
			hint: deployment.url,
		})),
	})
	if (p.isCancel(pickedUrl)) throw new CancelledError()
	const deployment = found.find((candidate) => candidate.url === pickedUrl) as Deployment

	const ctx = await createContext(newProject(LOGIN_PROJECT_SLUG, region))
	await stepDashboardAuth(ctx)
	await stepOrg(ctx)
	const app = await findDeployedApp(ctx, deployment.slug)

	const project = newProject(deployment.slug, app.region)
	project.orgPublicId = ctx.project.orgPublicId
	project.applicationId = app.applicationId
	project.completedSteps.push(...CONNECT_STEPS, 'app')
	adoptDeployment(project, deployment)
	saveProject(project)
	ctx.project = project
	return { project, connected: ctx }
}

async function promptProjectName(): Promise<string> {
	const name = await p.text({
		message: 'Name your project (used for your app URL)',
		placeholder: 'acme',
		validate: (v) =>
			/^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])?$/.test(v ?? '')
				? undefined
				: 'Lowercase letters, digits, hyphens (3–40 chars)',
	})
	if (p.isCancel(name)) throw new CancelledError()
	return name
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

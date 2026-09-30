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
	type AccountProject,
	CancelledError,
	listAccountProjects,
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

type ConnectedAccount = { ctx: StepContext; projects: AccountProject[] }

const CONNECT_STEPS: ProjectState['completedSteps'] = ['dashboard-auth', 'org']
const NEW_PROJECT = '__new__'
const ACCOUNT_PROJECTS = '__account__'

async function resolveProject(opts: { name?: string; region?: 'us' | 'eu' }): Promise<ResolvedProject> {
	const requestedRegion = opts.region ? defaultProjectRegion(opts.region) : undefined
	const newProjectRegion = requestedRegion ?? defaultProjectRegion('us')
	if (opts.name) {
		const loaded = loadProject(opts.name)
		if (loaded) return { project: normalizeProjectRegion(loaded, requestedRegion) }
		// Not on this computer — it may have been set up on another one.
		const account = await connectAccount(newProjectRegion)
		return projectFromAccount(account, opts.name, newProjectRegion)
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
				{ value: ACCOUNT_PROJECTS, label: 'Resume a project from your Nylas account' },
				{ value: NEW_PROJECT, label: 'Start a new one' },
			],
		})
		if (p.isCancel(picked)) throw new CancelledError()
		if (picked === ACCOUNT_PROJECTS) {
			const localSlugs = new Set(listProjects().map((proj) => proj.slug))
			return pickAccountProject(await connectAccount(newProjectRegion), newProjectRegion, localSlugs)
		}
		if (picked !== NEW_PROJECT) {
			const project = loadProject(picked)
			if (!project) throw new Error(`No project named "${picked}".`)
			return { project: normalizeProjectRegion(project, requestedRegion) }
		}
		const name = await promptProjectName()
		const local = loadProject(name)
		if (local) return { project: normalizeProjectRegion(local, requestedRegion) }
		return projectFromAccount(await connectAccount(newProjectRegion), name, newProjectRegion)
	}

	// Nothing on this computer: log in first so projects set up elsewhere can be resumed.
	return pickAccountProject(await connectAccount(newProjectRegion), newProjectRegion, new Set())
}

async function connectAccount(region: ProjectState['region']): Promise<ConnectedAccount> {
	const ctx = await createContext(newProject(LOGIN_PROJECT_SLUG, region))
	await stepDashboardAuth(ctx)
	await stepOrg(ctx)
	return { ctx, projects: await listAccountProjects(ctx) }
}

async function pickAccountProject(
	account: ConnectedAccount,
	region: ProjectState['region'],
	localSlugs: Set<string>,
): Promise<ResolvedProject> {
	const resumable = account.projects.filter((found) => !localSlugs.has(found.slug))
	if (resumable.length > 0) {
		const picked = await p.select({
			message: 'Resume a project from your Nylas account, or start a new one',
			options: [
				...resumable.map((found) => ({
					value: found.applicationId,
					label: found.slug,
					hint: accountProjectHint(found, resumable),
				})),
				{ value: NEW_PROJECT, label: 'Start a new one' },
			],
		})
		if (p.isCancel(picked)) throw new CancelledError()
		const found = resumable.find((candidate) => candidate.applicationId === picked)
		if (found) return projectFromAccount(account, found.slug, region, found)
	} else if (localSlugs.size > 0) {
		p.log.info('No other OwnMail projects were found on this Nylas account.')
	}
	const name = await promptProjectName()
	const local = loadProject(name)
	if (local) return { project: local }
	return projectFromAccount(account, name, region)
}

/** Adopt the account's project with this name, or start a new one on the connected session. */
async function projectFromAccount(
	account: ConnectedAccount,
	slug: string,
	region: ProjectState['region'],
	chosen?: AccountProject,
): Promise<ResolvedProject> {
	const found = chosen ?? (await chooseAccountProject(account.projects, slug))
	const project = newProject(slug, found?.region ?? region)
	project.orgPublicId = account.ctx.project.orgPublicId
	project.completedSteps.push(...CONNECT_STEPS)
	if (found) {
		project.applicationId = found.applicationId
		project.adoptedFromAccount = true
		project.completedSteps.push('app')
	}
	saveProject(project)
	account.ctx.project = project
	return { project, connected: account.ctx }
}

/** Several apps can carry the same tag; adopting the wrong one would rotate another app's keys. */
async function chooseAccountProject(
	projects: AccountProject[],
	slug: string,
): Promise<AccountProject | undefined> {
	const matches = projects.filter((candidate) => candidate.slug === slug)
	if (matches.length <= 1) return matches[0]
	const picked = await p.select({
		message: `Several apps on your Nylas account are tagged “${slug}”. Which one is this project?`,
		options: matches.map((found) => ({
			value: found.applicationId,
			label: `${found.slug} (${found.region.toUpperCase()})`,
			hint: found.applicationId,
		})),
	})
	if (p.isCancel(picked)) throw new CancelledError()
	return matches.find((candidate) => candidate.applicationId === picked)
}

function accountProjectHint(found: AccountProject, all: AccountProject[]): string {
	const region = found.region.toUpperCase()
	const duplicated = all.some((other) => other !== found && other.slug === found.slug)
	return duplicated ? `${region} · ${found.applicationId}` : region
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

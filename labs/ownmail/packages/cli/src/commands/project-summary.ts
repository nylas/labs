import type { ProjectState, StepId } from '../state/schema.js'

type SetupPhase = { label: string; steps: StepId[] }

const SETUP_PHASES: SetupPhase[] = [
	{ label: 'Connect your Nylas account', steps: ['dashboard-auth', 'org'] },
	{ label: 'Create your email address and inbox', steps: ['app', 'api-key', 'connector', 'domain', 'grant'] },
	{ label: 'Choose and connect hosting', steps: ['hosting', 'cf-auth'] },
	{ label: 'Deploy your mailbox app', steps: ['cf-resources', 'deploy', 'webhook', 'redirect-uris'] },
	{ label: 'Verify your app', steps: ['verify'] },
]

export type ProjectStatusSummary = {
	slug: string
	region: ProjectState['region']
	stage: string
	health: string
	nextCommand: string
	hosting: string
	appUrl: string | null
	domain: string | null
	domainVerified: boolean
	inbox: string | null
	templateVersion: string | null
	ejected: boolean
}

export function activeAppUrl(project: ProjectState): string | undefined {
	if (project.appDomain) return `https://${project.appDomain}`
	return project.manualAppUrl ?? project.workersDevUrl
}

export function redirectCallbackUrls(project: ProjectState): string[] {
	const urls = new Set(['http://localhost:3000/auth/callback'])
	if (project.hostingProvider !== 'manual' && project.workersDevUrl) {
		urls.add(`${project.workersDevUrl}/auth/callback`)
	}
	if (project.manualAppUrl) {
		urls.add(`${project.manualAppUrl}/auth/callback`)
	}
	if (project.appDomain) {
		urls.add(`https://${project.appDomain}/auth/callback`)
	}
	return [...urls]
}

export function projectStatusSummary(project: ProjectState): ProjectStatusSummary {
	const appUrl = activeAppUrl(project)
	const stage = projectStage(project, appUrl)
	return {
		slug: project.slug,
		region: project.region,
		stage: stage.stage,
		health: stage.health,
		nextCommand: stage.nextCommand,
		hosting: hostingLabel(project),
		appUrl: appUrl ?? null,
		domain: project.domainAddress ?? null,
		domainVerified: project.domainVerified === true,
		inbox: project.inboxEmail ?? null,
		templateVersion: project.templateVersion ?? null,
		ejected: project.ejected,
	}
}

function hostingLabel(project: ProjectState): string {
	if (project.ejected) return 'Ejected source'
	if (project.hostingProvider === 'manual') return 'Manual upload'
	if (project.hostingProvider === 'cloudflare' || project.workerName || project.workersDevUrl || project.appDomain) {
		return 'Cloudflare Workers'
	}
	return 'Not selected'
}

function projectStage(
	project: ProjectState,
	appUrl: string | undefined,
): { stage: string; health: string; nextCommand: string } {
	if (project.ejected) {
		return {
			stage: 'Ejected',
			health: appUrl
				? 'Source exported; OwnMail no longer deploys updates.'
				: 'Source exported; app URL is not recorded.',
			nextCommand: 'wrangler deploy',
		}
	}

	const pendingPhase = SETUP_PHASES.find((phase) =>
		phase.steps.some((step) => !project.completedSteps.includes(step)),
	)
	if (!pendingPhase) {
		if (!appUrl) {
			return {
				stage: 'Needs app URL',
				health: 'Setup state is complete, but no app URL is recorded.',
				nextCommand: 'npx ownmail',
			}
		}
		return {
			stage: 'Live',
			health: 'Setup complete.',
			nextCommand: 'npx ownmail update',
		}
	}

	if (project.completedSteps.length === 0) {
		return {
			stage: 'Not started',
			health: 'Setup has not started.',
			nextCommand: 'npx ownmail',
		}
	}

	return {
		stage: `Paused: ${pendingPhase.label}`,
		health: `Resume setup to finish ${pendingPhase.label.toLowerCase()}.`,
		nextCommand: 'npx ownmail',
	}
}

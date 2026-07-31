import { projectAppUrl, projectCustomAppUrls } from '../deploy/webhook.js'
import type { ProjectState, StepId } from '../state/schema.js'
import { configuredSiteName } from '../state/site-name.js'

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
	appName: string
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
	primaryAppDomain: string | null
	additionalAppDomains: string[]
	appDomainStatus: 'none' | 'ready' | 'setup-pending'
	pendingAppDomain: { domain: string; primary: boolean } | null
}

export function activeAppUrl(project: ProjectState): string | undefined {
	return projectAppUrl(project)
}

export function redirectCallbackUrls(project: ProjectState): string[] {
	const urls = new Set(['http://localhost:3000/auth/callback'])
	if ((project.hostingProvider === 'cloudflare' || !project.hostingProvider) && project.workersDevUrl) {
		urls.add(`${project.workersDevUrl}/auth/callback`)
	}
	if (project.manualAppUrl) {
		urls.add(`${project.manualAppUrl}/auth/callback`)
	}
	if (project.providerAppUrl) {
		urls.add(`${project.providerAppUrl}/auth/callback`)
	}
	if (project.localAppUrl) {
		urls.add(`${project.localAppUrl}/auth/callback`)
	}
	for (const appUrl of projectCustomAppUrls(project)) {
		urls.add(`${appUrl}/auth/callback`)
	}
	return [...urls]
}

export function projectStatusSummary(project: ProjectState): ProjectStatusSummary {
	const appUrl = activeAppUrl(project)
	const stage = projectStage(project, appUrl)
	return {
		slug: project.slug,
		appName: configuredSiteName(project),
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
		primaryAppDomain: project.appDomain ?? null,
		additionalAppDomains: projectCustomAppUrls(project)
			.map((url) => new URL(url).hostname)
			.filter((domain) => domain !== project.appDomain && domain !== project.pendingAppDomain?.domain),
		appDomainStatus: project.pendingAppDomain
			? 'setup-pending'
			: projectCustomAppUrls(project).length > 0
				? 'ready'
				: 'none',
		pendingAppDomain: project.pendingAppDomain ?? null,
	}
}

function hostingLabel(project: ProjectState): string {
	if (project.ejected) return 'Ejected source'
	if (project.hostingProvider === 'manual') return 'Manual upload'
	if (project.hostingProvider === 'vercel') return 'Vercel'
	if (project.hostingProvider === 'netlify') return 'Netlify'
	if (project.hostingProvider === 'local') return 'Local web server'
	if (
		project.hostingProvider === 'cloudflare' ||
		project.workerName ||
		project.workersDevUrl ||
		project.appDomain
	) {
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

	if (project.pendingAppDomain) {
		const { domain, primary } = project.pendingAppDomain
		return {
			stage: 'Custom domain setup pending',
			health: `https://${domain} is attached, but ${
				primary ? 'primary-domain activation' : 'additional-domain setup'
			} is incomplete.`,
			nextCommand: `npx ownmail app domain ${domain} --name ${project.slug} --${
				primary ? 'primary' : 'secondary'
			}`,
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
			nextCommand: 'npx ownmail app update',
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

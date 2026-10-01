import * as p from '@clack/prompts'
import { listNetlifySites, listVercelProjects } from '../deploy/provider-cli.js'
import { listCloudflareWorkers } from '../deploy/wrangler.js'
import type { ProjectState } from '../state/schema.js'
import { isUserProjectSlug } from '../state/store.js'
import { requireGateway, type StepContext, tokens } from './context.js'
import { ensureCloudflareAuth } from './deploy.js'
import { CancelledError, listSandboxApplications, type SandboxApplication } from './provision.js'
import { isDeploymentKeyName } from './recover.js'

export type HostedProvider = 'cloudflare' | 'vercel' | 'netlify'

type ProviderResource =
	| { provider: 'cloudflare'; workerName: string }
	| { provider: 'vercel'; vercelProjectId: string; vercelOrgId: string }
	| { provider: 'netlify'; netlifySiteId: string }

/** A live OwnMail app found on the user's hosting account. */
export type Deployment = ProviderResource & { slug: string; url: string }

/** Setup names every Worker, Vercel project, and Netlify site it creates `…-ownmail…`. */
const RESOURCE_NAME_MARKER = '-ownmail'
const PROBE_TIMEOUT_MS = 5000

/**
 * OwnMail apps deployed on the signed-in hosting account. Only a resource whose
 * `/healthz` reports an OwnMail project slug is returned, so an unrelated
 * project that happens to share the name marker is never offered.
 */
export async function findDeployments(provider: HostedProvider): Promise<Deployment[]> {
	const resources = await listResources(provider)
	const probed = await Promise.all(
		resources.map(async ({ url, resource }) => {
			const slug = await fetchLiveSlug(url)
			return slug ? { ...resource, slug, url } : undefined
		}),
	)
	return probed.filter((deployment): deployment is Deployment => Boolean(deployment))
}

async function listResources(
	provider: HostedProvider,
): Promise<{ url: string; resource: ProviderResource }[]> {
	switch (provider) {
		case 'cloudflare': {
			await ensureCloudflareAuth()
			const workers = await listCloudflareWorkers(RESOURCE_NAME_MARKER)
			return workers.map((worker) => ({ url: worker.url, resource: { provider, workerName: worker.name } }))
		}
		case 'vercel': {
			const projects = await listVercelProjects(RESOURCE_NAME_MARKER)
			return projects.map((project) => ({
				url: project.url,
				resource: { provider, vercelProjectId: project.projectId, vercelOrgId: project.orgId },
			}))
		}
		case 'netlify': {
			const sites = await listNetlifySites(RESOURCE_NAME_MARKER)
			return sites.map((site) => ({ url: site.url, resource: { provider, netlifySiteId: site.siteId } }))
		}
	}
}

async function fetchLiveSlug(url: string): Promise<string | undefined> {
	try {
		const res = await fetch(`${url}/healthz`, {
			redirect: 'error',
			signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
		})
		if (!res.ok) return undefined
		const body = (await res.json()) as { app?: unknown } | null
		return typeof body?.app === 'string' && isUserProjectSlug(body.app) ? body.app : undefined
	} catch {
		return undefined
	}
}

/**
 * The Nylas app a deployment runs on. Sandbox apps cannot be renamed, so they
 * carry no project tag; the deployment keys setup names `ownmail <slug> …`
 * identify the app instead. Only apps in the signed-in organization are
 * considered, so a deployment can never be linked to someone else's app.
 */
export async function findDeployedApp(ctx: StepContext, slug: string): Promise<SandboxApplication> {
	const gateway = requireGateway(ctx)
	const orgPublicId = ctx.project.orgPublicId
	if (!orgPublicId) throw new Error('Organization unavailable — rerun ownmail setup')
	const matches: SandboxApplication[] = []
	for (const app of await listSandboxApplications(ctx, gateway, orgPublicId)) {
		const keys = await gateway.listApiKeys(await tokens(ctx), app.region, app.applicationId)
		const deployed = keys.some(
			(key) => key.status.trim().toLowerCase() === 'active' && isDeploymentKeyName(key.name, slug),
		)
		if (deployed) matches.push(app)
	}
	if (matches.length === 0) {
		throw new Error(
			`No Nylas app in this organization has an active OwnMail key for “${slug}”. Log in to the Nylas organization that owns this app, then re-run \`npx ownmail\`.`,
		)
	}
	if (matches.length === 1) return matches[0] as SandboxApplication
	const picked = await p.select({
		message: `Several Nylas apps have OwnMail keys for “${slug}”. Which one does this app run on?`,
		options: matches.map((app) => ({
			value: app.applicationId,
			label: app.applicationId,
			hint: app.region.toUpperCase(),
		})),
	})
	if (p.isCancel(picked)) throw new CancelledError()
	return matches.find((app) => app.applicationId === picked) as SandboxApplication
}

/** Record the deployment so recovery rebuilds around it and the redeploy must land on its URL. */
export function adoptDeployment(project: ProjectState, deployment: Deployment): void {
	project.adoptedFromAccount = true
	project.hostingProvider = deployment.provider
	project.recoveredAppUrl = deployment.url
	switch (deployment.provider) {
		case 'cloudflare':
			project.workerName = deployment.workerName
			project.workersDevUrl = deployment.url
			break
		case 'vercel':
			project.vercelProjectId = deployment.vercelProjectId
			project.vercelOrgId = deployment.vercelOrgId
			project.providerAppUrl = deployment.url
			break
		case 'netlify':
			project.netlifySiteId = deployment.netlifySiteId
			project.providerAppUrl = deployment.url
			break
	}
}

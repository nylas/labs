import * as p from '@clack/prompts'
import { NylasV3Client } from '@nylas-labs/cli-kit'
import { runWrangler } from '../deploy/wrangler.js'
import { apiBaseUrl } from '../nylas-env.js'
import { clearAuth, newProject, saveProject } from '../state/store.js'
import { createContext, requireGateway, tokens } from '../steps/context.js'
import { stepDashboardAuth } from '../steps/provision.js'
import { pickExistingProject } from './shared.js'

/** Force a fresh dashboard login. */
export async function runLogin(): Promise<void> {
	p.intro('ownmail login')
	clearAuth()
	const ctx = await createContext(newProject('__login__', 'us'))
	ctx.auth = null
	await stepDashboardAuth(ctx)
	p.outro('Logged in.')
}

/** List agent-account inboxes on the project's application. */
export async function runGrants(opts: { name?: string }): Promise<void> {
	p.intro('ownmail grants')
	const project = await pickExistingProject(opts.name)
	const ctx = await createContext(project)
	if (!ctx.auth || !project.applicationId) {
		throw new Error('Not logged in or app missing — run `npx ownmail` first.')
	}
	const key = await requireGateway(ctx).createApiKey(tokens(ctx), project.region, project.applicationId, {
		name: `ownmail grants ${Date.now()}`,
	})
	const v3 = new NylasV3Client(key.apiKey, project.region, fetch, apiBaseUrl(project.region))
	const grants = await v3.listGrants({ limit: 200 })
	const agents = grants.data.filter((g) => g.provider === 'nylas')
	if (agents.length === 0) {
		p.log.info('No inboxes on this app yet.')
	} else {
		for (const g of agents) {
			const marker = g.id === project.grantId ? ' ← this app' : ''
			p.log.message(`${g.email}  (${g.grant_status ?? 'valid'}, ${g.id})${marker}`)
		}
		p.log.info(`${agents.length}/5 sandbox inboxes used.`)
	}
	p.outro('Done.')
}

/** Tear down the Cloudflare side of a project (Nylas resources are kept). */
export async function runDestroy(opts: { name?: string }): Promise<void> {
	p.intro('ownmail destroy')
	const project = await pickExistingProject(opts.name)

	p.log.warn(
		[
			`This deletes the deployed app for "${project.slug}":`,
			project.workerName ? `  - Cloudflare worker ${project.workerName}` : null,
			project.kvNamespaceId ? `  - KV namespace (all sessions)` : null,
			'',
			`Your inbox (${project.inboxEmail ?? '—'}), domain, and mail are NOT touched.`,
			'Delete those from the Nylas dashboard if you want them gone too.',
		]
			.filter((line): line is string => line !== null)
			.join('\n'),
	)
	const typed = await p.text({ message: `Type the project name ("${project.slug}") to confirm` })
	if (p.isCancel(typed) || typed !== project.slug) {
		p.cancel('Destroy cancelled — nothing was deleted.')
		return
	}

	if (project.workerName) {
		const res = await runWrangler(['delete', '--name', project.workerName, '--force'])
		if (res.code !== 0 && !/not found|does not exist/i.test(res.stderr + res.stdout)) {
			throw new Error(`Failed to delete worker: ${res.stderr || res.stdout}`)
		}
		p.log.step(`Worker ${project.workerName} deleted.`)
	}
	if (project.kvNamespaceId) {
		const res = await runWrangler(['kv', 'namespace', 'delete', '--namespace-id', project.kvNamespaceId])
		if (res.code !== 0 && !/not found/i.test(res.stderr + res.stdout)) {
			p.log.warn(`Could not delete KV namespace: ${res.stderr || res.stdout}`)
		} else {
			p.log.step('Session storage deleted.')
		}
	}

	// Reset deploy state but keep Nylas resource ids so re-create reuses them.
	delete project.workersDevUrl
	delete project.workerName
	delete project.kvNamespaceId
	project.completedSteps = project.completedSteps.filter(
		(s) => !['cf-auth', 'cf-resources', 'deploy', 'redirect-uris', 'verify'].includes(s),
	)
	saveProject(project)
	p.outro('Destroyed. Run `npx ownmail` to redeploy any time.')
}

import * as p from '@clack/prompts'
import { NylasV3Client } from '@nylas-labs/cli-kit'
import { runWrangler } from '../deploy/wrangler.js'
import { apiBaseUrl } from '../nylas-env.js'
import { clearPendingSecrets, pendingSecretLabels } from '../state/pending-secrets.js'
import type { ProjectState } from '../state/schema.js'
import { clearAuth, deleteProject, newProject, saveProject } from '../state/store.js'
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

/** Scrub one-time plaintexts retained only to resume an unfinished setup. */
export async function runCleanupSecrets(opts: { name?: string }): Promise<void> {
	p.intro('ownmail cleanup-secrets')
	const project = await pickExistingProject(opts.name)
	const labels = pendingSecretLabels(project)
	if (labels.length === 0) {
		p.log.info('No pending setup secrets are stored for this project.')
		p.outro('Nothing to clean up.')
		return
	}

	p.log.warn(
		[
			`This only clears pending setup secrets for "${project.slug}":`,
			...labels.map((label) => `  - ${label}`),
			'',
			'It does NOT delete your Nylas app, API keys, inbox, domain, mail, Cloudflare worker, or sessions.',
			'After cleanup, unfinished setup may need to mint a fresh API key or reset the inbox password.',
		].join('\n'),
	)
	const typed = await p.text({ message: `Type the project name ("${project.slug}") to confirm` })
	if (p.isCancel(typed) || typed !== project.slug) {
		p.cancel('Cleanup cancelled — pending setup secrets were kept.')
		return
	}

	clearPendingSecrets(project)
	saveProject(project)
	p.outro('Pending setup secrets cleared from local state/keyring. Remote resources and mail were untouched.')
}

/** Delete the local project record, optionally deleting the hosted Cloudflare app first. */
export async function runDeleteProject(opts: { name?: string; hosted?: boolean }): Promise<void> {
	p.intro('ownmail delete')
	const project = await pickExistingProject(opts.name)
	const deleteHosted = opts.hosted === true

	p.log.warn(
		[
			`This deletes the local OwnMail project "${project.slug}":`,
			'  - local project state file',
			'  - pending setup secrets from local state/keyring',
			'',
			deleteHosted
				? 'Because --hosted was passed, OwnMail will also delete recorded Cloudflare hosted resources:'
				: 'Remote hosted app content will be kept. Cancel and re-run with --hosted if you want OwnMail to delete recorded Cloudflare resources now.',
			deleteHosted && project.workerName ? `  - Cloudflare worker ${project.workerName}` : null,
			deleteHosted && project.kvNamespaceId ? '  - Cloudflare KV namespace (all sessions)' : null,
			deleteHosted && !project.workerName && !project.kvNamespaceId
				? '  - no Cloudflare worker or KV namespace is recorded for this project'
				: null,
			project.hostingProvider === 'manual'
				? 'Manual hosting content is outside OwnMail state; delete it at that provider if needed.'
				: null,
			'',
			`Your inbox (${project.inboxEmail ?? '—'}), domain, mail, and Nylas resources are NOT touched.`,
		]
			.filter((line): line is string => line !== null)
			.join('\n'),
	)
	const typed = await p.text({ message: `Type the project name ("${project.slug}") to confirm` })
	if (p.isCancel(typed) || typed !== project.slug) {
		p.cancel('Delete cancelled — project state was kept.')
		return
	}

	if (deleteHosted) {
		await deleteHostedContent(project, { strictKv: true })
	}
	clearPendingSecrets(project)
	const removed = deleteProject(project.slug)
	if (!removed) {
		p.log.warn(`Local project state for "${project.slug}" was already gone.`)
	}
	p.outro(
		deleteHosted
			? 'Project deleted locally. Recorded Cloudflare hosted resources were deleted first.'
			: 'Project deleted locally. Remote hosted content and Nylas resources were left untouched.',
	)
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

	await deleteHostedContent(project)

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

async function deleteHostedContent(project: ProjectState, opts: { strictKv?: boolean } = {}): Promise<void> {
	let hadRecordedResource = false
	if (project.workerName) {
		hadRecordedResource = true
		const res = await runWrangler(['delete', '--name', project.workerName, '--force'])
		if (res.code !== 0 && !/not found|does not exist/i.test(res.stderr + res.stdout)) {
			throw new Error(`Failed to delete worker: ${res.stderr || res.stdout}`)
		}
		p.log.step(`Worker ${project.workerName} deleted.`)
	}
	if (project.kvNamespaceId) {
		hadRecordedResource = true
		const res = await runWrangler(['kv', 'namespace', 'delete', '--namespace-id', project.kvNamespaceId])
		if (res.code !== 0 && !/not found/i.test(res.stderr + res.stdout)) {
			const message = `Could not delete KV namespace: ${res.stderr || res.stdout}`
			if (opts.strictKv) throw new Error(message)
			p.log.warn(message)
		} else {
			p.log.step('Session storage deleted.')
		}
	}
	if (!hadRecordedResource) {
		p.log.info('No Cloudflare hosted resources are recorded for this project.')
	}
}

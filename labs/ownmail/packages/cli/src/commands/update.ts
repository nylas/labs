import { rmSync } from 'node:fs'
import { join } from 'node:path'
import * as p from '@clack/prompts'
import { checkAppHealth } from '../deploy/app-health.js'
import { findLocalPort, startLocalServer } from '../deploy/local-server.js'
import {
	loadManifest,
	materialize,
	materializeLocal,
	materializeNetlify,
	materializeVercel,
} from '../deploy/materialize.js'
import { deployNetlify, deployVercel, ensureVercelProject } from '../deploy/provider-cli.js'
import { deploy } from '../deploy/wrangler.js'
import { deployedApiBaseUrl } from '../nylas-env.js'
import { readPendingSecret } from '../state/pending-secrets.js'
import { configDir, saveProject } from '../state/store.js'
import { ensureCloudflareAuth } from '../steps/deploy.js'
import { pickExistingProject } from './shared.js'

/**
 * Config-preserving redeploy. `npx ownmail update` (via npx) always runs the
 * latest published CLI, which bundles the matching template — versions move in
 * lockstep (changesets fixed group), so "update the CLI" == "update the
 * template". User config survives because it lives only in project state and
 * Cloudflare vars/secrets, never in template code.
 */
export async function runUpdate(opts: { name?: string }): Promise<void> {
	p.intro('ownmail update')
	const project = await pickExistingProject(opts.name)

	if (project.ejected) {
		throw new Error(
			`"${project.slug}" is ejected — you own its source now. Update it with \`wrangler deploy\` from your project directory.`,
		)
	}
	const provider = project.hostingProvider ?? (project.workerName ? 'cloudflare' : 'manual')
	if (provider === 'manual') {
		if (!project.manualDeployDir) {
			throw new Error(`"${project.slug}" has not exported a manual deploy bundle yet. Run \`npx ownmail\`.`)
		}
		p.log.info(
			[
				'Manual-hosted projects are updated by exporting a fresh bundle.',
				`Existing export: ${project.manualDeployDir}`,
				'Run `npx ownmail` to regenerate the bundle, then upload it to your hosting provider.',
			].join('\n'),
		)
		p.outro('No Cloudflare deployment was changed.')
		return
	}
	if (provider === 'vercel' || provider === 'netlify') {
		await updateNodeProvider(project, provider)
		return
	}
	if (provider === 'local') {
		await updateLocalProject(project)
		return
	}

	if (!project.workersDevUrl || !project.workerName || !project.kvNamespaceId) {
		throw new Error(`"${project.slug}" hasn’t finished its first deploy. Run \`npx ownmail\` to complete it.`)
	}
	const applicationId = requireNylasClientId(project.applicationId)

	const manifest = loadManifest()
	if (project.templateVersion === manifest.templateVersion) {
		p.log.info(`Already on template ${manifest.templateVersion} — redeploying anyway (config refresh).`)
	} else {
		const relevant = manifest.migrations.filter((m) => m.version > (project.templateVersion ?? '0.0.0'))
		if (relevant.length > 0) {
			p.note(
				relevant.map((m) => `${m.version}: ${m.notes}`).join('\n'),
				`What changed since ${project.templateVersion}`,
			)
		}
		p.log.step(`Updating template ${project.templateVersion} → ${manifest.templateVersion}`)
	}

	await ensureCloudflareAuth()

	const runtimeApiBaseUrl = deployedApiBaseUrl(project.region)
	const spinner = p.spinner()
	spinner.start('Redeploying…')
	const { configPath } = materialize({
		slug: project.slug,
		workerName: project.workerName,
		kvNamespaceId: project.kvNamespaceId,
		...(project.appDomain ? { appDomain: project.appDomain } : {}),
		vars: {
			NYLAS_CLIENT_ID: applicationId,
			NYLAS_REGION: project.region,
			...(runtimeApiBaseUrl ? { NYLAS_API_BASE_URL: runtimeApiBaseUrl } : {}),
			APP_NAME: project.slug,
			INBOX_EMAIL: project.inboxEmail ?? '',
			TEMPLATE_VERSION: manifest.templateVersion,
		},
	})
	try {
		const url = await deploy(configPath)
		project.workersDevUrl = url
		project.templateVersion = manifest.templateVersion
		saveProject(project)
		spinner.stop(`Updated: ${url} (template ${manifest.templateVersion})`)
	} catch (err) {
		spinner.stop('Cloudflare update needs attention; retry `npx ownmail update` when ready.')
		throw err
	}
	p.outro('Secrets and sessions were untouched.')
}

async function updateNodeProvider(
	project: Awaited<ReturnType<typeof pickExistingProject>>,
	provider: 'vercel' | 'netlify',
): Promise<void> {
	const manifest = loadManifest()
	const materialized =
		provider === 'vercel' ? materializeVercel(project.slug) : materializeNetlify(project.slug)
	const spinner = p.spinner()
	spinner.start(`Redeploying to ${provider === 'vercel' ? 'Vercel' : 'Netlify'}…`)
	try {
		let url: string
		if (provider === 'vercel') {
			if (!project.vercelProjectId || !project.vercelOrgId) {
				throw new Error(
					`"${project.slug}" is missing its recorded Vercel project. Run \`npx ownmail\` to repair it.`,
				)
			}
			await ensureVercelProject(materialized.dir, `${project.slug}-ownmail`, {
				projectId: project.vercelProjectId,
				orgId: project.vercelOrgId,
			})
			url = await deployVercel(materialized.dir)
		} else {
			if (!project.netlifySiteId) {
				throw new Error(
					`"${project.slug}" is missing its recorded Netlify site. Run \`npx ownmail\` to repair it.`,
				)
			}
			url = await deployNetlify(materialized.dir, project.netlifySiteId)
		}
		project.providerAppUrl = url
		project.templateVersion = manifest.templateVersion
		saveProject(project)
		spinner.stop(`Updated: ${url} (template ${manifest.templateVersion})`)
	} catch (error) {
		spinner.stop(`${provider === 'vercel' ? 'Vercel' : 'Netlify'} update needs attention; retry when ready.`)
		throw error
	} finally {
		rmSync(materialized.dir, { recursive: true, force: true })
	}
	p.outro('Deployment settings and sessions were untouched.')
}

async function updateLocalProject(project: Awaited<ReturnType<typeof pickExistingProject>>): Promise<void> {
	if (
		project.localAppUrl &&
		(await checkAppHealth(project.localAppUrl, { attempts: 1, delayMs: 0, timeoutMs: 1000 }))
	) {
		throw new Error(
			`The local server for "${project.slug}" is still running. Stop it with Ctrl+C in its terminal, then retry \`npx ownmail update\`.`,
		)
	}
	const apiKey = readPendingSecret(project, 'apiKey')
	const sessionSecret = readPendingSecret(project, 'sessionSecret')
	if (!apiKey || !sessionSecret) {
		throw new Error(
			'Local runtime secrets are unavailable from the OS credential store. Re-run `npx ownmail` to repair the local deployment.',
		)
	}
	const applicationId = requireNylasClientId(project.applicationId)
	if (!project.inboxEmail?.trim()) throw new Error('Inbox email is missing; re-run `npx ownmail`.')
	const manifest = loadManifest()
	const port = await findLocalPort(project.localPort ?? 3000)
	const targetDir = project.localDeployDir ?? join(configDir(), 'runtimes', project.slug)
	const { dir } = materializeLocal(targetDir)
	const runtimeApiBaseUrl = deployedApiBaseUrl(project.region)
	const url = await startLocalServer({
		dir,
		port,
		environment: {
			NYLAS_API_KEY: apiKey,
			SESSION_SECRET: sessionSecret,
			NYLAS_CLIENT_ID: applicationId,
			NYLAS_REGION: project.region,
			...(runtimeApiBaseUrl ? { NYLAS_API_BASE_URL: runtimeApiBaseUrl } : {}),
			APP_NAME: project.slug,
			INBOX_EMAIL: project.inboxEmail,
			TEMPLATE_VERSION: manifest.templateVersion,
		},
	})
	project.localAppUrl = url
	project.localPort = port
	project.localDeployDir = dir
	project.templateVersion = manifest.templateVersion
	saveProject(project)
	p.outro(`Updated local server: ${url}. Keep this terminal open; press Ctrl+C to stop it.`)
}

function requireNylasClientId(value: string | undefined): string {
	if (!value?.trim()) {
		throw new Error(
			'Nylas application client ID is missing. Re-run `npx ownmail` to finish app setup before updating.',
		)
	}
	return value.trim()
}

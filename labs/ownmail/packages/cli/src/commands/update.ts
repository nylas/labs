import * as p from '@clack/prompts'
import { loadManifest, materialize } from '../deploy/materialize.js'
import { deploy } from '../deploy/wrangler.js'
import { deployedApiBaseUrl } from '../nylas-env.js'
import { saveProject } from '../state/store.js'
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

function requireNylasClientId(value: string | undefined): string {
	if (!value?.trim()) {
		throw new Error(
			'Nylas application client ID is missing. Re-run `npx ownmail` to finish app setup before updating.',
		)
	}
	return value.trim()
}

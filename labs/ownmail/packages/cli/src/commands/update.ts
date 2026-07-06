import * as p from '@clack/prompts'
import { loadManifest, materialize } from '../deploy/materialize.js'
import { deploy, wranglerLoggedIn, wranglerLogin } from '../deploy/wrangler.js'
import { saveProject } from '../state/store.js'
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
	if (!project.workersDevUrl || !project.workerName || !project.kvNamespaceId) {
		throw new Error(`"${project.slug}" hasn’t finished its first deploy. Run \`npx ownmail\` to complete it.`)
	}

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

	if (!(await wranglerLoggedIn())) await wranglerLogin()

	const spinner = p.spinner()
	spinner.start('Redeploying…')
	const { configPath } = materialize({
		slug: project.slug,
		workerName: project.workerName,
		kvNamespaceId: project.kvNamespaceId,
		...(project.appDomain ? { appDomain: project.appDomain } : {}),
		vars: {
			NYLAS_CLIENT_ID: project.applicationId ?? '',
			NYLAS_REGION: project.region,
			APP_NAME: project.slug,
			INBOX_EMAIL: project.inboxEmail ?? '',
			TEMPLATE_VERSION: manifest.templateVersion,
		},
	})
	const url = await deploy(configPath)
	project.workersDevUrl = url
	project.templateVersion = manifest.templateVersion
	saveProject(project)
	spinner.stop(`Updated: ${url} (template ${manifest.templateVersion})`)
	p.outro('Secrets and sessions were untouched.')
}

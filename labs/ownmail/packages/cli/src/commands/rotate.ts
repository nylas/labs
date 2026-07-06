import * as p from '@clack/prompts'
import { GatewayError } from '@nylas-labs/cli-kit'
import { putSecret } from '../deploy/wrangler.js'
import { saveProject } from '../state/store.js'
import { createContext, requireGateway, tokens } from '../steps/context.js'
import { pickExistingProject } from './shared.js'

/**
 * Rotates the deployed NYLAS_API_KEY: mint new → put on worker → revoke old.
 * Order matters — the worker never sees a gap, and the old key dies last.
 */
export async function runRotateKey(opts: { name?: string }): Promise<void> {
	p.intro('ownmail rotate-key')
	const project = await pickExistingProject(opts.name)
	if (!project.workerName || !project.applicationId) {
		throw new Error('This project hasn’t deployed yet — run `npx ownmail` first.')
	}
	const ctx = await createContext(project)
	if (!ctx.auth) throw new Error('Not logged in — run `npx ownmail login` first.')
	const gateway = requireGateway(ctx)

	const spinner = p.spinner()
	spinner.start('Minting a fresh API key…')
	const created = await gateway.createApiKey(tokens(ctx), project.region, project.applicationId, {
		name: `ownmail ${project.slug} (rotated ${new Date().toISOString().slice(0, 10)})`,
	})
	spinner.stop('New key minted.')

	spinner.start('Swapping the key on your app…')
	await putSecret(project.workerName, 'NYLAS_API_KEY', created.apiKey)
	spinner.stop('App now uses the new key.')

	const oldKeyId = project.apiKeyId
	project.apiKeyId = created.id
	saveProject(project)

	if (oldKeyId && oldKeyId !== created.id) {
		try {
			await gateway.revokeApiKey(tokens(ctx), project.region, project.applicationId, oldKeyId)
			p.log.step('Old key revoked.')
		} catch (err) {
			const detail = err instanceof GatewayError ? err.message : String(err)
			p.log.warn(`Could not revoke the old key (${detail}). Revoke it in the Nylas dashboard.`)
		}
	}
	p.outro('Rotation complete. Sessions and mail were untouched.')
}

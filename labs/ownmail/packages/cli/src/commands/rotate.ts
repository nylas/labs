import * as p from '@clack/prompts'
import { GatewayError } from '@nylas-labs/cli-kit'
import { DEPLOYMENT_API_KEY_LIFETIME_DAYS } from '../api-key-lifecycle.js'
import { CloudflareNoChangeError, putSecret } from '../deploy/wrangler.js'
import { clearPendingSecret, storePendingSecret } from '../state/pending-secrets.js'
import { saveProject } from '../state/store.js'
import { createContext, requireGateway, tokens } from '../steps/context.js'
import { pickExistingProject, supportReference } from './shared.js'

/**
 * Rotates the deployed NYLAS_API_KEY: mint new → put on worker → revoke old.
 * Order matters — the worker never sees a gap, and the old key dies last.
 */
export async function runRotateKey(opts: { name?: string }): Promise<void> {
	p.intro('ownmail auth rotate-key')
	const project = await pickExistingProject(opts.name)
	if (!project.workerName || !project.applicationId) {
		throw new Error('This project hasn’t deployed yet — run `npx ownmail` first.')
	}
	const ctx = await createContext(project)
	if (!ctx.auth) throw new Error('Not logged in — run `npx ownmail auth login` first.')
	const gateway = requireGateway(ctx)
	const pendingRotation = project.pendingApiKeyRotation
	if (pendingRotation) {
		if (pendingRotation.replacementKeyId !== project.apiKeyId) {
			throw new Error(
				'OwnMail found inconsistent API-key rotation state. Run `npx ownmail project doctor` before rotating again.',
			)
		}
		try {
			await gateway.revokeApiKey(
				tokens(ctx),
				project.region,
				project.applicationId,
				pendingRotation.previousKeyId,
			)
			delete project.pendingApiKeyRotation
			saveProject(project)
			p.log.step('Previously pending old key revoked.')
		} catch (err) {
			const reference = err instanceof GatewayError ? supportReference(err) : undefined
			throw new Error(
				`OwnMail could not revoke the previously pending old key. Retry before rotating again.${reference ? `\n\n${reference}` : ''}`,
			)
		}
	}

	const spinner = p.spinner()
	spinner.start('Minting a fresh API key…')
	const created = await gateway.createApiKey(tokens(ctx), project.region, project.applicationId, {
		name: `ownmail ${project.slug} (rotated ${new Date().toISOString().slice(0, 10)})`,
		expiresIn: DEPLOYMENT_API_KEY_LIFETIME_DAYS,
	})
	spinner.stop('New key minted.')

	spinner.start('Swapping the key on your app…')
	try {
		await putSecret(project.workerName, 'NYLAS_API_KEY', created.apiKey)
		spinner.stop('App now uses the new key.')
	} catch (err) {
		spinner.stop('The key swap could not be confirmed.')
		if (err instanceof CloudflareNoChangeError) {
			try {
				await gateway.revokeApiKey(tokens(ctx), project.region, project.applicationId, created.id)
			} catch (revokeError) {
				const reference = revokeError instanceof GatewayError ? supportReference(revokeError) : undefined
				p.log.warn(
					`Cloudflare made no changes, but OwnMail could not revoke the unused new Nylas key. Revoke that key in the Nylas dashboard before retrying.${reference ? `\n\n${reference}` : ''}`,
				)
			}
			throw err
		}
		throw new Error(
			'OwnMail could not confirm the Cloudflare key swap. The new Nylas key was left active because Cloudflare may already be using it. Do not retry immediately: check your Cloudflare Worker and the Nylas dashboard to identify the key in use, then revoke only the unused key before retrying `npx ownmail auth rotate-key`.',
		)
	}

	const oldKeyId = project.apiKeyId
	project.apiKeyId = created.id
	try {
		storePendingSecret(project, 'apiKey', created.apiKey, { allowLocalFallback: false })
	} catch {
		clearPendingSecret(project, 'apiKey')
		p.log.warn(
			'The rotated key is active, but OwnMail could not retain it in the OS credential store. A later setup resume will need to rotate it again.',
		)
	}
	if (oldKeyId && oldKeyId !== created.id) {
		project.pendingApiKeyRotation = {
			previousKeyId: oldKeyId,
			replacementKeyId: created.id,
		}
	} else {
		delete project.pendingApiKeyRotation
	}
	saveProject(project)

	if (oldKeyId && oldKeyId !== created.id) {
		try {
			await gateway.revokeApiKey(tokens(ctx), project.region, project.applicationId, oldKeyId)
			delete project.pendingApiKeyRotation
			saveProject(project)
			p.log.step('Old key revoked.')
		} catch (err) {
			const reference = err instanceof GatewayError ? supportReference(err) : undefined
			p.log.warn(
				`Could not revoke the old key. Revoke it in the Nylas dashboard.${reference ? `\n\n${reference}` : ''}`,
			)
		}
	}
	p.outro('Rotation complete. Sessions and mail were untouched.')
}

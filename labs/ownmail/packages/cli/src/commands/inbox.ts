import * as p from '@clack/prompts'
import { NylasV3Client } from '@nylas-labs/cli-kit'
import { createContext, requireGateway, tokens } from '../steps/context.js'
import { CancelledError } from '../steps/provision.js'
import { generateAppPassword, validateAppPassword } from '../util/password.js'
import { pickExistingProject } from './shared.js'

const SANDBOX_GRANT_CAP = 5

/**
 * Adds another inbox (agent account) on the project's domain — e.g. a
 * hello@ next to contact@. Each inbox logs into the same deployed app with
 * its own email + password.
 */
export async function runInboxAdd(opts: { name?: string }): Promise<void> {
	p.intro('ownmail inbox add')
	const project = await pickExistingProject(opts.name)
	if (!project.domainAddress || !project.applicationId) {
		throw new Error('This project has no domain yet — run `npx ownmail` first.')
	}
	const ctx = await createContext(project)
	if (!ctx.auth) throw new Error('Not logged in — run `npx ownmail login` first.')

	const key = await requireGateway(ctx).createApiKey(tokens(ctx), project.region, project.applicationId, {
		name: `ownmail inbox-add ${Date.now()}`,
	})
	const v3 = new NylasV3Client(key.apiKey, project.region)

	const existing = await v3.listGrants({ limit: 200 })
	const agents = existing.data.filter((g) => g.provider === 'nylas')
	if (agents.length >= SANDBOX_GRANT_CAP) {
		throw new Error(
			`This sandbox app already has ${agents.length}/${SANDBOX_GRANT_CAP} inboxes. Delete one first (Nylas dashboard) or upgrade the app.`,
		)
	}
	p.log.info(
		`Existing inboxes (${agents.length}/${SANDBOX_GRANT_CAP}): ${agents.map((g) => g.email).join(', ') || 'none'}`,
	)

	const localPart = await p.text({
		message: `New address on @${project.domainAddress}`,
		placeholder: 'hello',
		validate: (v) =>
			/^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/i.test(v ?? '')
				? undefined
				: 'Letters, digits, dots, hyphens, underscores',
	})
	if (p.isCancel(localPart)) throw new CancelledError()
	const email = `${localPart}@${project.domainAddress}`
	if (agents.some((g) => g.email === email)) throw new Error(`${email} already exists.`)

	const generate = await p.confirm({ message: 'Generate a strong password?', initialValue: true })
	if (p.isCancel(generate)) throw new CancelledError()
	let appPassword: string
	if (generate) {
		appPassword = generateAppPassword()
	} else {
		const typed = await p.password({
			message: 'Inbox password (18–40 chars, upper+lower+digit)',
			validate: (v) => validateAppPassword(v ?? ''),
		})
		if (p.isCancel(typed)) throw new CancelledError()
		appPassword = typed
	}

	const spinner = p.spinner()
	spinner.start(`Creating ${email}…`)
	await v3.createAgentAccount({ email, appPassword, name: localPart })
	spinner.stop(`${email} is live.`)

	p.note(
		`Email:    ${email}\nPassword: ${appPassword}\n\nShown ONCE — save it now. Log into your app at\n${project.workersDevUrl ?? 'your app URL'} with these credentials.`,
		'New inbox',
	)
	p.outro('Done.')
}

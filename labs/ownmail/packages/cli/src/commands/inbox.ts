import * as p from '@clack/prompts'
import { type Grant, NylasV3Client } from '@nylas-labs/cli-kit'
import { TEMPORARY_API_KEY_LIFETIME_DAYS } from '../api-key-lifecycle.js'
import { apiBaseUrl } from '../nylas-env.js'
import { createContext, requireGateway, tokens } from '../steps/context.js'
import { CancelledError } from '../steps/provision.js'
import { OWNMAIL_USER_AGENT } from '../usage-attribution.js'
import { generateAppPassword, validateAppPassword } from '../util/password.js'
import { activeAppUrl } from './project-summary.js'
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
	if (!ctx.auth) throw new Error('Not logged in — run `npx ownmail auth login` first.')

	const key = await requireGateway(ctx).createApiKey(tokens(ctx), project.region, project.applicationId, {
		name: `ownmail inbox-add ${Date.now()}`,
		expiresIn: TEMPORARY_API_KEY_LIFETIME_DAYS,
	})
	const v3 = new NylasV3Client(
		key.apiKey,
		project.region,
		fetch,
		apiBaseUrl(project.region),
		OWNMAIL_USER_AGENT,
	)

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

	const appPassword = await promptForAppPassword('Generate a strong password?', localPart)

	const spinner = p.spinner()
	spinner.start(`Creating ${email}…`)
	await v3.createAgentAccount({ email, appPassword, name: localPart })
	spinner.stop(`${email} is live.`)

	p.note(
		`Email:    ${email}\nPassword: ${appPassword}\n\nShown ONCE — save it now. Log into your app at\n${activeAppUrl(project) ?? 'your app URL'} with these credentials.`,
		'New inbox',
	)
	p.outro('Done.')
}

/** Rotates an Agent Account password without recreating the mailbox or deleting mail. */
export async function runInboxResetPassword(opts: { name?: string; email?: string }): Promise<void> {
	p.intro('ownmail inbox reset-password')
	const project = await pickExistingProject(opts.name)
	if (!project.applicationId) {
		throw new Error('This project has no Nylas application yet — run `npx ownmail` first.')
	}
	const ctx = await createContext(project)
	if (!ctx.auth) throw new Error('Not logged in — run `npx ownmail auth login` first.')

	const key = await requireGateway(ctx).createApiKey(tokens(ctx), project.region, project.applicationId, {
		name: `ownmail password-reset ${Date.now()}`,
		expiresIn: TEMPORARY_API_KEY_LIFETIME_DAYS,
	})
	const v3 = new NylasV3Client(
		key.apiKey,
		project.region,
		fetch,
		apiBaseUrl(project.region),
		OWNMAIL_USER_AGENT,
	)
	const grants = await v3.listGrants({ limit: 200 })
	const agents = grants.data.filter((g) => g.provider === 'nylas')
	const grant = await pickGrantForPasswordReset(agents, project.grantId, opts.email)
	const email = grant.email ?? opts.email ?? project.inboxEmail ?? grant.id
	const grantEmail = grant.email ?? opts.email
	const hasPassword = grant.settings?.has_app_password

	if (!grantEmail) {
		throw new Error(`Grant ${grant.id} has no email address. Pick the inbox by email and retry.`)
	}

	if (hasPassword === true) {
		p.log.warn(`This will replace the password for ${email}. The old password will stop working.`)
	} else if (hasPassword === false) {
		p.log.info(`${email} does not have an app password yet. This will set one.`)
	} else {
		p.log.warn(
			`This will set a new password for ${email}. If one exists, the old password will stop working.`,
		)
	}
	const confirmed = await p.confirm({
		message: hasPassword === false ? 'Set this inbox password?' : 'Reset this inbox password?',
		initialValue: true,
	})
	if (p.isCancel(confirmed)) throw new CancelledError()
	if (!confirmed) {
		p.cancel('Password reset cancelled.')
		return
	}

	const appPassword = await promptForAppPassword('Generate a new strong password?', grantEmail)
	const spinner = p.spinner()
	spinner.start(`Resetting password for ${email}…`)
	await v3.updateGrant(grant.id, { settings: { email: grantEmail, app_password: appPassword } })
	spinner.stop(`Password reset for ${email}.`)

	p.note(
		`Email:    ${email}\nPassword: ${appPassword}\n\nShown ONCE — save it now. Use it to log into your mailbox app and IMAP/SMTP clients.`,
		'New password',
	)
	p.outro('Done.')
}

async function promptForAppPassword(message: string, mailboxName: string): Promise<string> {
	const generate = await p.confirm({ message, initialValue: true })
	if (p.isCancel(generate)) throw new CancelledError()
	if (generate) return generateAppPassword(mailboxName)
	const typed = await p.password({
		message: 'Inbox password (18-40 chars, upper+lower+digit+symbol, no spaces)',
		validate: (v) => validateAppPassword(v ?? '', mailboxName),
	})
	if (p.isCancel(typed)) throw new CancelledError()
	return typed
}

async function pickGrantForPasswordReset(
	agents: Grant[],
	projectGrantId: string | undefined,
	email: string | undefined,
): Promise<Grant> {
	if (agents.length === 0) {
		throw new Error('This app has no Nylas inboxes yet.')
	}
	if (email) {
		const found = agents.find((g) => g.email?.toLowerCase() === email.toLowerCase())
		if (!found) throw new Error(`No inbox named ${email} exists on this app.`)
		return found
	}
	const primary = projectGrantId ? agents.find((g) => g.id === projectGrantId) : undefined
	if (primary) return primary
	const onlyGrant = agents[0]
	if (agents.length === 1 && onlyGrant) return onlyGrant
	const picked = await p.select({
		message: 'Which inbox password should be reset?',
		options: agents.map((g) => ({
			value: g.id,
			label: g.email ?? g.id,
			hint: grantHint(g),
		})),
	})
	if (p.isCancel(picked)) throw new CancelledError()
	const grant = agents.find((g) => g.id === picked)
	if (!grant) throw new Error('Selected inbox no longer exists.')
	return grant
}

function grantHint(grant: Grant): string {
	const status = grant.grant_status ?? 'valid'
	if (grant.settings?.has_app_password === true) return `${status}, password set`
	if (grant.settings?.has_app_password === false) return `${status}, no password`
	return status
}

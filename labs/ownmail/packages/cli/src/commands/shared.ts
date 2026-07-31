import * as p from '@clack/prompts'
import { DashboardAccountError, GatewayError, NylasApiError } from '@nylas-labs/cli-kit'
import type { ProjectState } from '../state/schema.js'
import { listProjects, loadProject } from '../state/store.js'
import { CancelledError } from '../steps/provision.js'

const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const SAFE_ACTION_PATTERN =
	/\b(?:check|choose|delete|fix|inspect|log in|pick|re-?run|refus(?:e|ing)|remove|retry|run|sign in|stop|unlock|update|upgrade|view)\b|`npx\b/i
const SAFE_MESSAGE_PREFIX_PATTERN =
	/^(?:"[^"\r\n]{1,80}"|Cloudflare|Could not resolve your organization|Dashboard client|Deployment setting|Domain unavailable|Ejected projects|Email domain|Email\/password|Enter a domain|Gateway client|Grant [A-Za-z0-9_-]{1,128}|Inbox email|Invalid deployment|Local runtime|MFA verification|Netlify|No inbox|No project|No projects|Not logged|Nylas API client|Nylas application|Organization unavailable|OwnMail|Pending Nylas|Project names|Recorded Vercel|Selected inbox|Selected Vercel|Setup plan|The bundled|The command|The local server|The selected project|This app|This project|This sandbox|Vercel)/i
// biome-ignore lint/suspicious/noControlCharactersInRegex: this allow-list boundary intentionally rejects terminal and Unicode formatting controls.
const UNSAFE_CONTROL_PATTERN = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]|\p{Cf}/u

/** Resolves an existing project by name or picker; never creates one. */
export async function pickExistingProject(name?: string): Promise<ProjectState> {
	if (name) {
		const project = loadProject(name)
		if (!project) {
			throw new Error(`No project named "${name}". Run \`npx ownmail project status\` to list projects.`)
		}
		return project
	}
	const projects = listProjects()
	if (projects.length === 0) {
		throw new Error('No projects yet. Run `npx ownmail` first.')
	}
	if (projects.length === 1) {
		const [project] = projects
		if (project) return project
		throw new Error('Could not load the project. Run `npx ownmail project status` and retry.')
	}
	const picked = await p.select({
		message: 'Which project?',
		options: projects.map((proj) => ({
			value: proj.slug,
			label: proj.inboxEmail ? `${proj.slug} (${proj.inboxEmail})` : proj.slug,
		})),
	})
	if (p.isCancel(picked)) throw new CancelledError()
	const project = loadProject(picked)
	if (!project) {
		throw new Error('The selected project no longer exists. Run `npx ownmail project status` and retry.')
	}
	return project
}

export function runTopLevel(fn: () => Promise<void>): Promise<void> {
	return fn().catch((err) => {
		if (err instanceof CancelledError) {
			p.cancel('Cancelled.')
		} else {
			p.log.error(formatCommandError(err))
		}
		process.exitCode = 1
	})
}

/** Formats every command failure without exposing raw upstream bodies, stack traces, or secrets. */
export function formatCommandError(err: unknown): string {
	if (err instanceof NylasApiError) {
		return formatServiceError('The Nylas API', err.status, err.type, err)
	}
	if (err instanceof DashboardAccountError) {
		if (err.status >= 200 && err.status < 300) {
			return withSupportReference(
				'The Nylas dashboard returned an invalid response.\n\nHow to fix: Update OwnMail, then retry the command. If it continues, contact Nylas Support.',
				err,
			)
		}
		return formatServiceError('The Nylas dashboard', err.status, dashboardErrorCode(err.body), err)
	}
	if (err instanceof GatewayError) {
		const code = err.errors
			.map((error) => error.extensions?.code)
			.find((value): value is string => typeof value === 'string')
		return formatServiceError('The Nylas dashboard', err.status, code, err)
	}

	const message = err instanceof Error ? err.message : ''
	if (isSafeActionableMessage(message)) {
		return withSupportReference(message, err)
	}
	if (
		message === 'This project hasn’t deployed yet — run `npx ownmail` first.' ||
		message === 'Enter a domain like mail.your-company.com'
	) {
		return withSupportReference(message, err)
	}
	if (/\b(invalid session|not logged in|unauthorized|forbidden)\b/i.test(message)) {
		return withSupportReference(
			'Your Nylas session is invalid or has expired.\n\nHow to fix: Run `npx ownmail auth login`, then retry your command.',
			err,
		)
	}
	if (/\bno project(?:s)?\b|no Nylas application|no domain yet/i.test(message)) {
		return withSupportReference(
			'Your local OwnMail project is incomplete or unavailable.\n\nHow to fix: Run `npx ownmail project status` to find your project, or run `npx ownmail` to create or resume one.',
			err,
		)
	}
	if (/\b(timed out|network|fetch failed|econn(?:refused|reset)?|enotfound)\b/i.test(message)) {
		return withSupportReference(
			'OwnMail could not reach a required service.\n\nHow to fix: Check your internet connection and the provider status page, then retry the command.',
			err,
		)
	}
	return withSupportReference(
		'The command could not be completed safely.\n\nHow to fix: Run `npx ownmail project doctor` to identify the failed dependency, then retry. If the problem continues, run `npx ownmail auth login` to refresh your session.',
		err,
	)
}

/** Safe suffix for warnings that already provide operation-specific recovery guidance. */
export function supportReference(err: unknown): string | undefined {
	const requestId = requestIdFromError(err)
	return requestId ? `Request ID: ${requestId}. Include this ID if you contact Nylas Support.` : undefined
}

function formatServiceError(
	service: string,
	status: number | undefined,
	code: string | undefined,
	err: unknown,
): string {
	const safeCode = safeErrorCode(code)
	const detail = [typeof status === 'number' ? `HTTP ${status}` : undefined, safeCode]
		.filter((value): value is string => Boolean(value))
		.join(', ')
	const suffix = detail ? ` (${detail})` : ''
	let message: string
	if (safeCode === 'SAML_NOT_CONFIGURED') {
		message = `Enterprise SAML is not configured for this work email${suffix}.\n\nHow to fix: Check the address, then ask your organization administrator to confirm the domain’s Nylas SAML configuration.`
	} else if (typeof status === 'number' && status >= 200 && status < 300) {
		message = `${service} returned an invalid response${suffix}.\n\nHow to fix: Update OwnMail, then retry the command. If it continues, contact Nylas Support.`
	} else if (
		status === 401 ||
		status === 403 ||
		/(?:auth|forbidden|invalid.?session|unauthorized)/i.test(safeCode)
	) {
		message = `${service} rejected the current credentials${suffix}.\n\nHow to fix: Run \`npx ownmail auth login\`, then retry the command.`
	} else if (status === 404) {
		message = `${service} could not find a resource recorded by this project${suffix}.\n\nHow to fix: Run \`npx ownmail project doctor --fix\` to reconcile local and remote state, then retry.`
	} else if (status === 409 || /conflict|already.?exists/i.test(safeCode)) {
		message = `${service} reported a resource conflict${suffix}.\n\nHow to fix: Run \`npx ownmail project doctor\` to identify the conflicting resource, then retry the same command so OwnMail can resume safely.`
	} else if (status === 429 || /rate|limit|quota/i.test(safeCode)) {
		message = `${service} is rate limiting the request${suffix}.\n\nHow to fix: Wait a few minutes, then retry the same command.`
	} else if (typeof status === 'number' && status >= 500) {
		message = `${service} is temporarily unavailable${suffix}.\n\nHow to fix: Check the Nylas status page, wait briefly, then retry the command.`
	} else if (status === 400 || status === 422) {
		message = `${service} rejected the request${suffix}.\n\nHow to fix: Run \`npx ownmail project doctor\` to check the project state and command inputs, then retry.`
	} else {
		message = `${service} could not complete the request${suffix}.\n\nHow to fix: Run \`npx ownmail project doctor\`, then retry. If the session check fails, run \`npx ownmail auth login\`.`
	}
	return withSupportReference(message, err)
}

function dashboardErrorCode(value: unknown): string | undefined {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
	const error = 'error' in value ? value.error : undefined
	if (typeof error !== 'object' || error === null || Array.isArray(error)) return undefined
	const code = 'code' in error ? error.code : undefined
	return typeof code === 'string' ? code : undefined
}

function isSafeActionableMessage(message: string): boolean {
	return (
		message.length > 0 &&
		message.length <= 1_500 &&
		!UNSAFE_CONTROL_PATTERN.test(message) &&
		SAFE_MESSAGE_PREFIX_PATTERN.test(message) &&
		SAFE_ACTION_PATTERN.test(message)
	)
}

function safeErrorCode(value: string | undefined): string {
	return value && /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(value) ? value : ''
}

function requestIdFromError(err: unknown, seen = new Set<object>()): string | undefined {
	if (typeof err !== 'object' || err === null || seen.has(err)) return undefined
	seen.add(err)
	const value = 'requestId' in err ? err.requestId : undefined
	if (typeof value === 'string' && REQUEST_ID_PATTERN.test(value)) return value
	const cause = 'cause' in err ? err.cause : undefined
	return requestIdFromError(cause, seen)
}

function withSupportReference(message: string, err: unknown): string {
	const reference = supportReference(err)
	return reference ? `${message}\n\n${reference}` : message
}

import * as p from '@clack/prompts'
import type { ProjectState } from '../state/schema.js'
import { listProjects, loadProject } from '../state/store.js'
import { CancelledError } from '../steps/provision.js'

/** Resolves an existing project by name or picker; never creates one. */
export async function pickExistingProject(name?: string): Promise<ProjectState> {
	if (name) {
		const project = loadProject(name)
		if (!project) throw new Error(`No project named "${name}". Run \`npx ownmail status\` to list projects.`)
		return project
	}
	const projects = listProjects()
	if (projects.length === 0) {
		throw new Error('No projects yet. Run `npx ownmail` first.')
	}
	if (projects.length === 1) return projects[0]!
	const picked = await p.select({
		message: 'Which project?',
		options: projects.map((proj) => ({
			value: proj.slug,
			label: proj.inboxEmail ? `${proj.slug} (${proj.inboxEmail})` : proj.slug,
		})),
	})
	if (p.isCancel(picked)) throw new CancelledError()
	return loadProject(picked)!
}

export function runTopLevel(fn: () => Promise<void>): Promise<void> {
	return fn().catch((err) => {
		if (err instanceof CancelledError) {
			p.cancel('Cancelled.')
		} else {
			p.log.error(formatTopLevelError(err))
		}
		process.exitCode = 1
	})
}

function formatTopLevelError(err: unknown): string {
	const message = err instanceof Error ? err.message : ''
	if (
		/^(?:Cloudflare (?:could not|may have)|OwnMail could not) /i.test(message) ||
		/\bHow to fix:/i.test(message)
	) {
		return message
	}
	if (
		message === 'This project hasn’t deployed yet — run `npx ownmail` first.' ||
		message === 'Enter a domain like mail.your-company.com'
	) {
		return message
	}
	if (/\b(invalid session|not logged in|unauthorized|forbidden)\b/i.test(message)) {
		return 'Your Nylas session is invalid or has expired.\n\nHow to fix: Run `npx ownmail login`, then retry your command.'
	}
	if (/\bno project(?:s)?\b|no Nylas application|no domain yet/i.test(message)) {
		return 'Your local OwnMail project is incomplete or unavailable.\n\nHow to fix: Run `npx ownmail status` to find your project, or run `npx ownmail` to create or resume one.'
	}
	if (/\b(timed out|network|fetch failed|econn|enotfound)\b/i.test(message)) {
		return 'OwnMail could not reach a required service.\n\nHow to fix: Check your internet connection, then retry the command.'
	}
	return 'The command could not be completed.\n\nHow to fix: Run `npx ownmail doctor`, then retry. If the problem continues, run `npx ownmail login` to refresh your session.'
}

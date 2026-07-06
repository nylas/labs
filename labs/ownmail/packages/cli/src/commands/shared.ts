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
			p.log.error(err instanceof Error ? err.message : String(err))
		}
		process.exitCode = 1
	})
}

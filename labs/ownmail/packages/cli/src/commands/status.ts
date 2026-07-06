import * as p from '@clack/prompts'
import { listProjects } from '../state/store.js'

export async function runStatus(): Promise<void> {
	const projects = listProjects()
	if (projects.length === 0) {
		p.log.info('No projects yet. Run `npx ownmail` to create your first inbox.')
		return
	}
	for (const project of projects) {
		const lines = [
			`region:   ${project.region}`,
			`domain:   ${project.domainAddress ?? '—'}${project.domainVerified ? ' (verified)' : ''}`,
			`inbox:    ${project.inboxEmail ?? '—'}`,
			`app URL:  ${project.workersDevUrl ?? 'not deployed yet'}`,
			`template: ${project.templateVersion ?? '—'}${project.ejected ? ' (ejected)' : ''}`,
			`steps:    ${project.completedSteps.join(' → ') || 'none'}`,
		]
		p.note(lines.join('\n'), project.slug)
	}
}

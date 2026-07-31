import * as p from '@clack/prompts'
import { listProjects } from '../state/store.js'
import { projectStatusSummary } from './project-summary.js'

export async function runStatus(opts: { json?: boolean } = {}): Promise<void> {
	const projects = listProjects()
	const summaries = projects.map(projectStatusSummary)

	if (opts.json) {
		console.log(JSON.stringify({ projects: summaries }, null, 2))
		return
	}

	if (projects.length === 0) {
		p.log.info('No projects yet. Run `npx ownmail` to create your first inbox.')
		return
	}
	for (const summary of summaries) {
		const lines = [
			`app name: ${summary.appName}`,
			`stage:    ${summary.stage}`,
			`health:   ${summary.health}`,
			`region:   ${summary.region}`,
			`hosting:  ${summary.hosting}`,
			`email domain:       ${summary.domain ?? '—'}${summary.domainVerified ? ' (verified)' : ''}`,
			`inbox:    ${summary.inbox ?? '—'}`,
			`app URL:            ${summary.appUrl ?? 'not deployed yet'}`,
			`primary app domain: ${summary.primaryAppDomain ?? '—'} (${summary.appDomainStatus})`,
			`additional domains: ${summary.additionalAppDomains.join(', ') || '—'}`,
			`pending app domain: ${
				summary.pendingAppDomain
					? `${summary.pendingAppDomain.domain} (--${
							summary.pendingAppDomain.primary ? 'primary' : 'secondary'
						})`
					: '—'
			}`,
			`template: ${summary.templateVersion ?? '—'}${summary.ejected ? ' (ejected)' : ''}`,
			`next:     ${summary.nextCommand}`,
		]
		p.note(lines.join('\n'), summary.slug)
	}
}

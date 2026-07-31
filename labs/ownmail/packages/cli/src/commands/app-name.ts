import * as p from '@clack/prompts'
import { acquireProjectLock } from '../state/project-lock.js'
import {
	configuredSiteName,
	inferSiteName,
	normalizeSiteName,
	siteNameValidationError,
} from '../state/site-name.js'
import { saveProject } from '../state/store.js'
import { CancelledError } from '../steps/provision.js'
import { pickExistingProject } from './shared.js'
import { redeployProject } from './update.js'

type AppNameOptions = {
	name?: string
	siteName?: string
}

export async function runAppName(opts: AppNameOptions): Promise<void> {
	p.intro('ownmail app name')
	const project = await pickExistingProject(opts.name)
	if (project.ejected) {
		throw new Error(
			`"${project.slug}" is ejected. Set OWNMAIL_SITE_NAME in the exported app's deployment configuration.`,
		)
	}

	const current = configuredSiteName(project)
	const suggested = inferSiteName(project.domainAddress ?? project.plannedDomainAddress ?? project.slug)
	let requested = opts.siteName
	if (requested === undefined && !process.stdin.isTTY) {
		p.note(
			[
				`Current:   ${current}`,
				...(project.siteName ? [] : [`Suggested: ${suggested}`]),
				'',
				`Change it: ownmail app name "${suggested}" --name ${project.slug}`,
			].join('\n'),
			project.slug,
		)
		return
	}
	if (requested === undefined) {
		const entered = await p.text({
			message: 'Name shown in your app',
			initialValue: project.siteName ?? suggested,
			placeholder: suggested,
			validate: siteNameValidationError,
		})
		if (p.isCancel(entered)) throw new CancelledError()
		requested = entered
	}
	const siteName = normalizeSiteName(requested)
	if (siteName === project.siteName) {
		p.outro(`App name is already “${siteName}”.`)
		return
	}

	const releaseLock = acquireProjectLock(project.slug)
	try {
		project.siteName = siteName
		saveProject(project)
		if (!project.completedSteps.includes('deploy')) {
			p.outro(`App name saved as “${siteName}”. It will be used when this project deploys.`)
			return
		}
		try {
			await redeployProject(project)
		} catch (error) {
			p.log.warn(
				`The app name is saved as “${siteName}”, but deployment did not finish. Retry \`ownmail app update --name ${project.slug}\`.`,
			)
			throw error
		}
	} finally {
		releaseLock()
	}
}

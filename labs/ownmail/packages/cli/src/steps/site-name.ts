import * as p from '@clack/prompts'
import { inferSiteName, normalizeSiteName, siteNameValidationError } from '../state/site-name.js'
import { markStep, saveProject } from '../state/store.js'
import type { StepContext } from './context.js'
import { CancelledError } from './provision.js'

export async function stepSiteName(ctx: StepContext): Promise<void> {
	if (ctx.project.siteName || ctx.project.completedSteps.includes('deploy')) {
		markStep(ctx.project, 'site-name')
		return
	}
	const domain = ctx.project.domainAddress ?? ctx.project.plannedDomainAddress
	if (!domain) throw new Error('Choose an email domain before naming the app.')
	const inferred = inferSiteName(domain)
	const entered = await p.text({
		message: 'Name shown in your app',
		initialValue: inferred,
		placeholder: inferred,
		validate: siteNameValidationError,
	})
	if (p.isCancel(entered)) throw new CancelledError()
	ctx.project.siteName = normalizeSiteName(entered)
	saveProject(ctx.project)
	markStep(ctx.project, 'site-name')
}

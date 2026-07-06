import { randomBytes } from 'node:crypto'
import * as p from '@clack/prompts'
import { loadManifest, materialize } from '../deploy/materialize.js'
import { deploy, ensureKvNamespace, putSecret, wranglerLoggedIn, wranglerLogin } from '../deploy/wrangler.js'
import { markStep, saveProject } from '../state/store.js'
import { requireV3, type StepContext } from './context.js'

/** 07 — Cloudflare browser OAuth via wrangler (no token pasting). */
export async function stepCfAuth(_ctx: StepContext): Promise<void> {
	if (await wranglerLoggedIn()) {
		markStep(_ctx.project, 'cf-auth')
		return
	}
	p.log.step('Connecting your Cloudflare account (free tier is fine) — your browser will open.')
	await wranglerLogin()
	markStep(_ctx.project, 'cf-auth')
}

/** 08 — KV namespace + worker name. */
export async function stepCfResources(ctx: StepContext): Promise<void> {
	if (!ctx.project.kvNamespaceId) {
		const spinner = p.spinner()
		spinner.start('Creating session storage…')
		ctx.project.kvNamespaceId = await ensureKvNamespace(`ownmail-${ctx.project.slug}-sessions`)
		spinner.stop('Session storage ready.')
	}
	if (!ctx.project.workerName) {
		const sub = ctx.project.domainAddress?.split('.')[0] ?? ctx.project.slug
		ctx.project.workerName = `${sub}-ownmail`
	}
	saveProject(ctx.project)
	markStep(ctx.project, 'cf-resources')
}

/** 10 — Materialize the template, deploy, then set secrets. */
export async function stepDeploy(ctx: StepContext): Promise<void> {
	const manifest = loadManifest()
	const spinner = p.spinner()
	spinner.start('Deploying your mailbox app to Cloudflare…')

	const { configPath } = materialize({
		slug: ctx.project.slug,
		workerName: ctx.project.workerName!,
		kvNamespaceId: ctx.project.kvNamespaceId!,
		...(ctx.project.appDomain ? { appDomain: ctx.project.appDomain } : {}),
		vars: {
			NYLAS_CLIENT_ID: ctx.project.applicationId!,
			NYLAS_REGION: ctx.project.region,
			APP_NAME: ctx.project.slug,
			INBOX_EMAIL: ctx.project.inboxEmail ?? '',
			TEMPLATE_VERSION: manifest.templateVersion,
		},
	})

	const url = await deploy(configPath)
	ctx.project.workersDevUrl = url
	ctx.project.templateVersion = manifest.templateVersion
	saveProject(ctx.project)
	spinner.stop(`Deployed: ${url}`)

	spinner.start('Locking in secrets…')
	const workerName = ctx.project.workerName!
	if (ctx.project.pendingSecrets.apiKey) {
		await putSecret(workerName, 'NYLAS_API_KEY', ctx.project.pendingSecrets.apiKey)
	}
	await putSecret(workerName, 'SESSION_SECRET', randomBytes(32).toString('base64url'))
	saveProject(ctx.project)
	spinner.stop('Secrets stored in Cloudflare (never on disk).')
	markStep(ctx.project, 'deploy')
}

/** 10b — Register the realtime webhook and store its secret on the worker. */
export async function stepWebhook(ctx: StepContext): Promise<void> {
	const v3 = requireV3(ctx)
	const callbackUrl = `${ctx.project.workersDevUrl}/api/webhooks/nylas`
	try {
		const webhook = await v3.ensureWebhook(callbackUrl, [
			'message.created',
			'message.updated',
			'thread.replied',
		])
		if (webhook.webhook_secret) {
			await putSecret(ctx.project.workerName!, 'NYLAS_WEBHOOK_SECRET', webhook.webhook_secret)
		}
		markStep(ctx.project, 'webhook')
	} catch (err) {
		// Realtime is an enhancement — the app falls back to slow polling.
		p.log.warn(
			`Couldn’t set up instant updates (${err instanceof Error ? err.message : err}). Your app still works; new mail may take a little longer to appear.`,
		)
		markStep(ctx.project, 'webhook')
	}
}

/** 09 — Register redirect URIs for hosted auth. */
export async function stepRedirectUris(ctx: StepContext): Promise<void> {
	const v3 = requireV3(ctx)
	// Worker URL shape is deterministic before first deploy only if we know the
	// account subdomain — so this step runs once after deploy too (doctor re-runs it).
	const urls = ['http://localhost:3000/auth/callback']
	if (ctx.project.workersDevUrl) {
		urls.push(`${ctx.project.workersDevUrl}/auth/callback`)
	}
	if (ctx.project.appDomain) {
		urls.push(`https://${ctx.project.appDomain}/auth/callback`)
	}
	await v3.ensureRedirectUris(urls)
	markStep(ctx.project, 'redirect-uris')
}

/** 11 — Health check + final summary. */
export async function stepVerify(ctx: StepContext): Promise<void> {
	const url = ctx.project.workersDevUrl!
	const spinner = p.spinner()
	spinner.start('Checking your app is alive…')
	let healthy = false
	for (let attempt = 0; attempt < 10; attempt++) {
		try {
			const res = await fetch(`${url}/healthz`)
			if (res.ok) {
				healthy = true
				break
			}
		} catch {
			// Workers propagate in a few seconds
		}
		await new Promise((r) => setTimeout(r, 3000))
	}
	spinner.stop(healthy ? 'Your app is live!' : 'App deployed, but the health check hasn’t passed yet.')
	if (!healthy) {
		p.log.warn(`Give it a minute, then visit ${url}. If it stays down, run: npx ownmail doctor`)
	}

	// One-time plaintexts are no longer needed once everything downstream ran.
	ctx.project.pendingSecrets = {}
	saveProject(ctx.project)

	markStep(ctx.project, 'verify')
	p.note(
		[
			`Your mailbox app:  ${url}`,
			`Your email:        ${ctx.project.inboxEmail}`,
			'',
			'Log in with your inbox email and the password shown earlier.',
			'',
			'Update later:      npx ownmail update',
			'Get the source:    npx ownmail eject',
		].join('\n'),
		'🎉 Done',
	)
}

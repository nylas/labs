import { randomBytes } from 'node:crypto'
import { resolve } from 'node:path'
import * as p from '@clack/prompts'
import { exportManualBundle, loadManifest, materialize } from '../deploy/materialize.js'
import {
	cloudflareApiTokenConfigured,
	deploy,
	ensureKvNamespace,
	putSecret,
	wranglerLoggedIn,
	wranglerLogin,
} from '../deploy/wrangler.js'
import { deployedApiBaseUrl, resourceNameSuffix } from '../nylas-env.js'
import { markStep, saveProject } from '../state/store.js'
import { requireV3, type StepContext } from './context.js'
import { CancelledError } from './provision.js'

export async function stepHostingProvider(ctx: StepContext): Promise<void> {
	if (ctx.project.hostingProvider) {
		markStep(ctx.project, 'hosting')
		return
	}

	const provider = await p.select({
		message: 'Where do you want to host the mailbox app?',
		options: [
			{
				value: 'cloudflare' as const,
				label: 'Cloudflare Workers',
				hint: 'automated deploy',
			},
			{
				value: 'manual' as const,
				label: 'Manual upload',
				hint: 'export files for another provider',
			},
		],
	})
	if (p.isCancel(provider)) throw new CancelledError()
	ctx.project.hostingProvider = provider
	saveProject(ctx.project)
	markStep(ctx.project, 'hosting')
}

/** 07 — Cloudflare auth for wrangler deploys. */
export async function stepCfAuth(_ctx: StepContext): Promise<void> {
	if (_ctx.project.hostingProvider === 'manual') {
		markStep(_ctx.project, 'cf-auth')
		return
	}

	if (await wranglerLoggedIn()) {
		markStep(_ctx.project, 'cf-auth')
		return
	}

	await ensureCloudflareAuth()
	markStep(_ctx.project, 'cf-auth')
}

export async function ensureCloudflareAuth(): Promise<void> {
	if (await wranglerLoggedIn()) return

	p.log.info(
		[
			'Cloudflare is used to deploy the mailbox app and session KV.',
			'For least privilege, use a Cloudflare API token with Account: Workers Scripts Edit, Workers KV Storage Edit, Account Settings Read, plus User: User Details Read and Memberships Read.',
			'If you later add a custom app domain, include Zone: Workers Routes Edit for that zone.',
		].join('\n'),
	)

	if (!cloudflareApiTokenConfigured()) {
		const method = await p.select({
			message: 'Connect Cloudflare with',
			options: [
				{
					value: 'token' as const,
					label: 'API token',
					hint: 'least privilege, pasted once',
				},
				{
					value: 'oauth' as const,
					label: 'Wrangler OAuth link',
					hint: 'broader access, prints URL',
				},
			],
		})
		if (p.isCancel(method)) throw new CancelledError()

		if (method === 'token') {
			const token = await p.password({
				message: 'Cloudflare API token',
				validate: (v) => (v && v.trim().length > 20 ? undefined : 'Paste a valid Cloudflare API token'),
			})
			if (p.isCancel(token)) throw new CancelledError()
			process.env.CLOUDFLARE_API_TOKEN = token.trim()
		} else {
			const shouldOpen = await p.confirm({
				message: 'Open the Wrangler OAuth URL in your browser?',
				initialValue: true,
			})
			if (p.isCancel(shouldOpen)) throw new CancelledError()
			p.log.step(
				shouldOpen
					? 'Connecting your Cloudflare account — Wrangler will open a login URL.'
					: 'Connecting your Cloudflare account — Wrangler will print a login URL.',
			)
			await wranglerLogin({ openBrowser: shouldOpen })
		}
	}

	if (!(await wranglerLoggedIn())) {
		throw new Error('Cloudflare authentication failed. Check the token permissions and re-run ownmail.')
	}
}

/** 08 — KV namespace + worker name. */
export async function stepCfResources(ctx: StepContext): Promise<void> {
	if (ctx.project.hostingProvider === 'manual') {
		markStep(ctx.project, 'cf-resources')
		return
	}

	if (!ctx.project.kvNamespaceId) {
		const spinner = p.spinner()
		spinner.start('Creating session storage…')
		ctx.project.kvNamespaceId = await ensureKvNamespace(
			`ownmail-${ctx.project.slug}-sessions${resourceNameSuffix()}`,
		)
		spinner.stop('Session storage ready.')
	}
	if (!ctx.project.workerName) {
		const sub = ctx.project.domainAddress?.split('.')[0] ?? ctx.project.slug
		ctx.project.workerName = `${sub}-ownmail${resourceNameSuffix()}`
	}
	saveProject(ctx.project)
	markStep(ctx.project, 'cf-resources')
}

/** 10 — Materialize the template, deploy, then set secrets. */
export async function stepDeploy(ctx: StepContext): Promise<void> {
	if (ctx.project.hostingProvider === 'manual') {
		await stepManualDeploy(ctx)
		return
	}

	const manifest = loadManifest()
	const applicationId = requireNylasClientId(ctx.project.applicationId)
	const workerName = requireProjectValue(ctx.project.workerName, 'Cloudflare worker name')
	const kvNamespaceId = requireProjectValue(ctx.project.kvNamespaceId, 'Cloudflare KV namespace')
	const runtimeApiBaseUrl = deployedApiBaseUrl(ctx.project.region)
	const spinner = p.spinner()
	spinner.start('Deploying your mailbox app to Cloudflare…')

	const { configPath } = materialize({
		slug: ctx.project.slug,
		workerName,
		kvNamespaceId,
		...(ctx.project.appDomain ? { appDomain: ctx.project.appDomain } : {}),
		vars: {
			NYLAS_CLIENT_ID: applicationId,
			NYLAS_REGION: ctx.project.region,
			...(runtimeApiBaseUrl ? { NYLAS_API_BASE_URL: runtimeApiBaseUrl } : {}),
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
	if (ctx.project.pendingSecrets.apiKey) {
		await putSecret(workerName, 'NYLAS_API_KEY', ctx.project.pendingSecrets.apiKey)
	}
	await putSecret(workerName, 'SESSION_SECRET', randomBytes(32).toString('base64url'))
	saveProject(ctx.project)
	spinner.stop('Secrets stored in Cloudflare (never on disk).')
	markStep(ctx.project, 'deploy')
}

async function stepManualDeploy(ctx: StepContext): Promise<void> {
	const manifest = loadManifest()
	const applicationId = requireNylasClientId(ctx.project.applicationId)
	const runtimeApiBaseUrl = deployedApiBaseUrl(ctx.project.region)
	const targetDir =
		ctx.project.manualDeployDir ??
		resolve(
			process.cwd(),
			`${ctx.project.slug}-ownmail-manual-${new Date().toISOString().replace(/[:.]/g, '-')}`,
		)

	const exported = exportManualBundle({
		slug: ctx.project.slug,
		region: ctx.project.region,
		...(runtimeApiBaseUrl ? { apiBaseUrl: runtimeApiBaseUrl } : {}),
		applicationId,
		inboxEmail: ctx.project.inboxEmail ?? '',
		templateVersion: manifest.templateVersion,
		targetDir,
		...(ctx.project.pendingSecrets.apiKey ? { apiKey: ctx.project.pendingSecrets.apiKey } : {}),
		sessionSecret: randomBytes(32).toString('base64url'),
	})
	ctx.project.manualDeployDir = exported
	ctx.project.templateVersion = manifest.templateVersion
	saveProject(ctx.project)

	p.note(
		[
			`Export: ${exported}`,
			'',
			'Upload this bundle to your hosting provider.',
			'Set the variables from .env.example; deployment-only secret values are in secrets.env.',
			'Do not commit secrets.env.',
		].join('\n'),
		'Manual Deploy',
	)

	if (!ctx.project.manualAppUrl) {
		const hasUrl = await p.confirm({
			message: 'Do you already have the public HTTPS URL for this deployment?',
			initialValue: false,
		})
		if (p.isCancel(hasUrl)) throw new CancelledError()
		if (!hasUrl) {
			p.cancel('Manual deploy bundle is ready. Re-run ownmail after uploading it to continue setup.')
			throw new CancelledError()
		}
		const url = await p.text({
			message: 'Public app URL',
			placeholder: 'https://mail.example.com',
			validate: validateHttpsUrl,
		})
		if (p.isCancel(url)) throw new CancelledError()
		ctx.project.manualAppUrl = normalizeUrl(url)
		saveProject(ctx.project)
	}

	markStep(ctx.project, 'deploy')
}

/** 10b — Register the realtime webhook and store its secret on the worker. */
export async function stepWebhook(ctx: StepContext): Promise<void> {
	if (ctx.project.hostingProvider === 'manual') {
		p.log.info('Skipping automatic webhook setup for manual hosting; the app will use polling.')
		markStep(ctx.project, 'webhook')
		return
	}

	const v3 = requireV3(ctx)
	const callbackUrl = `${appUrl(ctx)}/api/webhooks/nylas`
	try {
		const webhook = await v3.ensureWebhook(callbackUrl, [
			'message.created',
			'message.updated',
			'thread.replied',
		])
		if (webhook.webhook_secret) {
			const workerName = requireProjectValue(ctx.project.workerName, 'Cloudflare worker name')
			await putSecret(workerName, 'NYLAS_WEBHOOK_SECRET', webhook.webhook_secret)
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
	const urls = new Set(['http://localhost:3000/auth/callback'])
	const url = appUrl(ctx)
	if (url) {
		urls.add(`${url}/auth/callback`)
	}
	if (ctx.project.appDomain) {
		urls.add(`https://${ctx.project.appDomain}/auth/callback`)
	}
	await v3.ensureRedirectUris([...urls])
	markStep(ctx.project, 'redirect-uris')
}

/** 11 — Health check + final summary. */
export async function stepVerify(ctx: StepContext): Promise<void> {
	const url = requireProjectValue(appUrl(ctx), 'App URL')
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

function appUrl(ctx: StepContext): string | undefined {
	if (ctx.project.appDomain) return `https://${ctx.project.appDomain}`
	return ctx.project.manualAppUrl ?? ctx.project.workersDevUrl
}

function validateHttpsUrl(value: string | undefined): string | undefined {
	if (!value) return 'Enter a public HTTPS URL'
	try {
		const url = new URL(value)
		if (url.protocol !== 'https:') return 'Use an HTTPS URL'
		return undefined
	} catch {
		return 'Enter a valid URL'
	}
}

function normalizeUrl(value: string): string {
	const url = new URL(value)
	url.hash = ''
	url.search = ''
	return url.toString().replace(/\/$/, '')
}

function requireNylasClientId(value: string | undefined): string {
	if (!value?.trim()) {
		throw new Error(
			'Nylas application client ID is missing. Re-run `npx ownmail` to finish app setup before deploying.',
		)
	}
	return value.trim()
}

function requireProjectValue(value: string | undefined, label: string): string {
	if (!value?.trim()) {
		throw new Error(`${label} is missing. Re-run \`npx ownmail\` to finish setup before deploying.`)
	}
	return value.trim()
}

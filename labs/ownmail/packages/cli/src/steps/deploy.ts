import { randomBytes } from 'node:crypto'
import { rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import * as p from '@clack/prompts'
import open from 'open'
import { checkAppHealth } from '../deploy/app-health.js'
import { findLocalPort, startLocalServer } from '../deploy/local-server.js'
import {
	exportManualBundle,
	loadManifest,
	materialize,
	materializeLocal,
	materializeNetlify,
	materializeVercel,
} from '../deploy/materialize.js'
import {
	deployNetlify,
	deployVercel,
	ensureNetlifySite,
	ensureVercelProject,
	ensureVercelRealtimeStore,
	listVercelScopes,
	netlifyHasEnvironmentVariable,
	resolveVercelProductionUrl,
	setNetlifyEnvironment,
	setVercelEnvironment,
	vercelHasEnvironmentVariable,
} from '../deploy/provider-cli.js'
import { projectAppUrl, setupRealtimeWebhook } from '../deploy/webhook.js'
import {
	cloudflareApiTokenConfigured,
	deploy,
	ensureKvNamespace,
	putSecret,
	workerHasSecret,
	wranglerLoggedIn,
	wranglerLogin,
} from '../deploy/wrangler.js'
import { deployedApiBaseUrl, resourceNameSuffix } from '../nylas-env.js'
import { projectAppDomains } from '../state/app-domains.js'
import { clearPendingSecret, readPendingSecret, storePendingSecret } from '../state/pending-secrets.js'
import { configuredSiteName } from '../state/site-name.js'
import { configDir, markStep, saveProject } from '../state/store.js'
import { requireGateway, requireV3, type StepContext, tokens } from './context.js'
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
				value: 'vercel' as const,
				label: 'Vercel',
				hint: 'automated Node deploy',
			},
			{
				value: 'netlify' as const,
				label: 'Netlify',
				hint: 'automated functions deploy',
			},
			{
				value: 'local' as const,
				label: 'Run locally',
				hint: 'loopback web server',
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
	if (_ctx.project.hostingProvider && _ctx.project.hostingProvider !== 'cloudflare') {
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

	if (!process.stdin.isTTY) {
		throw new Error(
			'Cloudflare sign-in is required. Run `npx wrangler login` in an interactive terminal or configure `CLOUDFLARE_API_TOKEN`, then retry. No Cloudflare resources were changed.',
		)
	}

	p.log.info(
		[
			'Cloudflare Workers hosts the mailbox app and its session storage.',
			'Recommended: Wrangler OAuth opens a browser so you can sign in without copying credentials.',
			'Advanced: for least privilege, use an API token with Account: Workers Scripts Edit, Workers KV Storage Edit, Account Settings Read; User: User Details Read, Memberships Read. Add Zone: Workers Routes Edit only when using a custom app domain.',
		].join('\n'),
	)

	if (!cloudflareApiTokenConfigured()) {
		const method = await p.select({
			message: 'Connect Cloudflare with',
			options: [
				{
					value: 'oauth' as const,
					label: 'Wrangler OAuth (recommended)',
					hint: 'easiest, sign in with your browser',
				},
				{
					value: 'token' as const,
					label: 'API token (advanced)',
					hint: 'least privilege, pasted once',
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
		const recovery = cloudflareApiTokenConfigured()
			? 'Cloudflare rejected the configured API token or it lacks permission. Replace `CLOUDFLARE_API_TOKEN` with a new token that has Account: Workers Scripts Edit, Workers KV Storage Edit, Account Settings Read; User: User Details Read, Memberships Read. Add Zone: Workers Routes Edit for a custom app domain.'
			: 'Cloudflare sign-in did not complete. Re-run `npx ownmail` and connect with Wrangler OAuth, then finish the browser flow.'
		throw new Error(
			`${recovery} No Cloudflare resources were changed, and setup can safely resume after you reconnect.`,
		)
	}
}

/** 08 — KV namespace + worker name. */
export async function stepCfResources(ctx: StepContext): Promise<void> {
	if (ctx.project.hostingProvider && ctx.project.hostingProvider !== 'cloudflare') {
		markStep(ctx.project, 'cf-resources')
		return
	}

	if (!ctx.project.kvNamespaceId) {
		const spinner = p.spinner()
		spinner.start('Creating session storage…')
		try {
			ctx.project.kvNamespaceId = await ensureKvNamespace(
				`ownmail-${ctx.project.slug}-sessions${resourceNameSuffix()}`,
			)
			spinner.stop('Session storage ready.')
		} catch (err) {
			spinner.stop('Cloudflare session storage needs attention; your project can be resumed.')
			throw err
		}
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
	switch (ctx.project.hostingProvider) {
		case 'manual':
			await stepManualDeploy(ctx)
			return
		case 'vercel':
			await stepVercelDeploy(ctx)
			return
		case 'netlify':
			await stepNetlifyDeploy(ctx)
			return
		case 'local':
			await stepLocalDeploy(ctx)
			return
		case 'cloudflare':
		case undefined:
			break
		default:
			throw new Error('Choose a supported hosting provider before deploying.')
	}

	const manifest = loadManifest()
	const applicationId = requireNylasClientId(ctx.project.applicationId)
	const workerName = requireProjectValue(ctx.project.workerName, 'Cloudflare worker name')
	const kvNamespaceId = requireProjectValue(ctx.project.kvNamespaceId, 'Cloudflare KV namespace')
	const apiKey = requirePendingApiKey(ctx)
	const runtimeApiBaseUrl = deployedApiBaseUrl(ctx.project.region)
	const spinner = p.spinner()
	spinner.start('Deploying your mailbox app to Cloudflare…')

	const { configPath } = materialize({
		slug: ctx.project.slug,
		workerName,
		kvNamespaceId,
		...(ctx.project.appDomain ? { appDomain: ctx.project.appDomain } : {}),
		appDomains: projectAppDomains(ctx.project),
		vars: {
			NYLAS_CLIENT_ID: applicationId,
			NYLAS_REGION: ctx.project.region,
			...(runtimeApiBaseUrl ? { NYLAS_API_BASE_URL: runtimeApiBaseUrl } : {}),
			APP_NAME: ctx.project.slug,
			OWNMAIL_SITE_NAME: configuredSiteName(ctx.project),
			INBOX_EMAIL: ctx.project.inboxEmail ?? '',
			TEMPLATE_VERSION: manifest.templateVersion,
		},
	})

	let url: string
	try {
		url = await deploy(configPath)
		ctx.project.workersDevUrl = url
		ctx.project.templateVersion = manifest.templateVersion
		saveProject(ctx.project)
		spinner.stop(`Deployed: ${url}`)
	} catch (err) {
		spinner.stop('Cloudflare deployment needs attention; your project can be resumed.')
		throw err
	}

	spinner.start('Locking in secrets…')
	try {
		await putSecret(workerName, 'NYLAS_API_KEY', apiKey)
		// Session cookies are HMAC-signed with SESSION_SECRET, so replacing it on a
		// redeploy would invalidate every signed-in user's cookie. Mint one only
		// when the worker has none yet.
		if (!(await workerHasSecret(workerName, 'SESSION_SECRET'))) {
			await putSecret(workerName, 'SESSION_SECRET', newSessionSecret())
		}
		saveProject(ctx.project)
		spinner.stop('Secrets stored in Cloudflare (never on disk).')
	} catch (err) {
		spinner.stop('Cloudflare could not finish secret setup; your project can be resumed.')
		throw err
	}
	await finalizePendingApiKeyRotation(ctx)
	markStep(ctx.project, 'deploy')
}

async function stepVercelDeploy(ctx: StepContext): Promise<void> {
	const manifest = loadManifest()
	const apiKey = requirePendingApiKey(ctx)
	const existingProject =
		ctx.project.vercelProjectId && ctx.project.vercelOrgId
			? { projectId: ctx.project.vercelProjectId, orgId: ctx.project.vercelOrgId }
			: undefined
	const scope = existingProject?.orgId ?? (await selectVercelScope(ctx))
	const { dir } = materializeVercel(ctx.project.slug)
	const spinner = p.spinner()
	spinner.start('Deploying your mailbox app to Vercel…')
	try {
		const linked = await ensureVercelProject(dir, `${ctx.project.slug}-ownmail`, scope, existingProject)
		ctx.project.vercelProjectId = linked.projectId
		ctx.project.vercelOrgId = linked.orgId
		saveProject(ctx.project)
		await ensureVercelRealtimeStore(dir, `${ctx.project.slug}-realtime`, ctx.project.region)
		// Keep the session secret the project already runs on; replacing it would
		// invalidate every signed-in user's HMAC-signed cookie.
		const sessionSecret = (await vercelHasEnvironmentVariable(dir, 'SESSION_SECRET'))
			? null
			: newSessionSecret()
		await setVercelEnvironment(
			dir,
			runtimeEnvironment(ctx, manifest.templateVersion, apiKey, sessionSecret),
			new Set(['NYLAS_API_KEY', 'SESSION_SECRET']),
		)
		const url = await deployVercel(dir, linked.orgId)
		ctx.project.providerAppUrl = url
		ctx.project.templateVersion = manifest.templateVersion
		saveProject(ctx.project)
		spinner.stop(`Deployed: ${url}`)
	} catch (error) {
		spinner.stop('Vercel deployment needs attention; your project can be resumed.')
		throw error
	} finally {
		rmSync(dir, { recursive: true, force: true })
	}
	await finalizePendingApiKeyRotation(ctx)
	markStep(ctx.project, 'deploy')
}

async function selectVercelScope(ctx: StepContext): Promise<string> {
	const scopes = await listVercelScopes()
	const selected = await p.select({
		message: 'Which Vercel account should own this deployment?',
		options: scopes.map((scope) => ({
			value: scope.id,
			label: scope.name === scope.slug ? scope.slug : `${scope.name} (${scope.slug})`,
			...(scope.current ? { hint: 'current account' } : {}),
		})),
		...(ctx.project.vercelOrgId && scopes.some((scope) => scope.id === ctx.project.vercelOrgId)
			? { initialValue: ctx.project.vercelOrgId }
			: {}),
	})
	if (p.isCancel(selected)) throw new CancelledError()
	const scope = scopes.find((candidate) => candidate.id === selected)
	if (!scope) throw new Error('Choose one of the Vercel accounts returned for your signed-in user.')
	ctx.project.vercelOrgId = scope.id
	saveProject(ctx.project)
	return scope.id
}

async function stepNetlifyDeploy(ctx: StepContext): Promise<void> {
	const manifest = loadManifest()
	const apiKey = requirePendingApiKey(ctx)
	const { dir } = materializeNetlify(ctx.project.slug)
	const spinner = p.spinner()
	spinner.start('Deploying your mailbox app to Netlify…')
	try {
		const site = await ensureNetlifySite(dir, `${ctx.project.slug}-ownmail`, ctx.project.netlifySiteId)
		ctx.project.netlifySiteId = site.siteId
		saveProject(ctx.project)
		// Keep the session secret the site already runs on; replacing it would
		// invalidate every signed-in user's HMAC-signed cookie.
		const sessionSecret = (await netlifyHasEnvironmentVariable(dir, site.siteId, 'SESSION_SECRET'))
			? null
			: newSessionSecret()
		await setNetlifyEnvironment(
			dir,
			site.siteId,
			runtimeEnvironment(ctx, manifest.templateVersion, apiKey, sessionSecret),
			new Set(['NYLAS_API_KEY', 'SESSION_SECRET']),
		)
		const url = await deployNetlify(dir, site.siteId)
		ctx.project.providerAppUrl = url
		ctx.project.templateVersion = manifest.templateVersion
		saveProject(ctx.project)
		spinner.stop(`Deployed: ${url}`)
	} catch (error) {
		spinner.stop('Netlify deployment needs attention; your project can be resumed.')
		throw error
	} finally {
		rmSync(dir, { recursive: true, force: true })
	}
	await finalizePendingApiKeyRotation(ctx)
	markStep(ctx.project, 'deploy')
}

async function stepLocalDeploy(ctx: StepContext): Promise<void> {
	const manifest = loadManifest()
	const healthyCurrentServer =
		ctx.project.localAppUrl &&
		ctx.project.templateVersion === manifest.templateVersion &&
		(await checkAppHealth(ctx.project.localAppUrl, { attempts: 1, delayMs: 0, timeoutMs: 1000 }))
	if (healthyCurrentServer && ctx.project.pendingApiKeyRotation) {
		throw new Error(
			`The local server for "${ctx.project.slug}" is still using the previous Nylas API key. Stop it with Ctrl+C in its terminal, then retry \`npx ownmail\` to install the replacement.`,
		)
	}
	if (healthyCurrentServer) {
		p.log.info(`Local web server is already running at ${ctx.project.localAppUrl}.`)
		markStep(ctx.project, 'deploy')
		return
	}

	const apiKey = requirePendingApiKey(ctx)
	storePendingSecret(ctx.project, 'apiKey', apiKey, { allowLocalFallback: false })
	let sessionSecret = readPendingSecret(ctx.project, 'sessionSecret')
	if (!sessionSecret) {
		sessionSecret = newSessionSecret()
		storePendingSecret(ctx.project, 'sessionSecret', sessionSecret, { allowLocalFallback: false })
	}
	saveProject(ctx.project)

	const port = await findLocalPort(ctx.project.localPort ?? 3000)
	const targetDir = join(configDir(), 'runtimes', ctx.project.slug)
	const { dir } = materializeLocal(targetDir)
	const spinner = p.spinner()
	spinner.start('Starting the local mailbox web server…')
	try {
		const url = await startLocalServer({
			dir,
			port,
			environment: runtimeEnvironment(ctx, manifest.templateVersion, apiKey, sessionSecret),
		})
		ctx.project.localAppUrl = url
		ctx.project.localPort = port
		ctx.project.localDeployDir = dir
		ctx.project.templateVersion = manifest.templateVersion
		saveProject(ctx.project)
		spinner.stop(`Running locally: ${url}`)
	} catch (error) {
		spinner.stop('The local web server could not start; your project can be resumed.')
		throw error
	}
	await finalizePendingApiKeyRotation(ctx)
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

	const apiKey = requirePendingApiKey(ctx)
	const exported = exportManualBundle({
		slug: ctx.project.slug,
		siteName: configuredSiteName(ctx.project),
		region: ctx.project.region,
		...(runtimeApiBaseUrl ? { apiBaseUrl: runtimeApiBaseUrl } : {}),
		applicationId,
		inboxEmail: ctx.project.inboxEmail ?? '',
		templateVersion: manifest.templateVersion,
		targetDir,
		apiKey,
		sessionSecret: newSessionSecret(),
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
			'Do not commit secrets.env. OwnMail clears one-time setup secrets after verification.',
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
	if (ctx.project.pendingApiKeyRotation) {
		const uploaded = await p.confirm({
			message: 'Have you uploaded this updated bundle and installed its replacement Nylas API key?',
			initialValue: false,
		})
		if (p.isCancel(uploaded)) throw new CancelledError()
		if (!uploaded) {
			p.cancel('Keep the previous deployment running. Re-run ownmail after uploading the updated bundle.')
			throw new CancelledError()
		}
		await finalizePendingApiKeyRotation(ctx)
	}

	markStep(ctx.project, 'deploy')
}

/** 10b — Register the realtime webhook and store its secret on the worker. */
export async function stepWebhook(ctx: StepContext): Promise<void> {
	if (ctx.project.hostingProvider === 'manual' || ctx.project.hostingProvider === 'local') {
		p.log.info(`${hostingLabel(ctx.project.hostingProvider)} uses polling for new mail.`)
		markStep(ctx.project, 'webhook')
		return
	}

	const v3 = requireV3(ctx)
	const result = await setupRealtimeWebhook(ctx.project, v3)

	if (result.status === 'skipped' && result.reason === 'missing-app-url') {
		p.log.warn(
			'Couldn’t set up instant updates because OwnMail does not have a public HTTPS app URL yet. Your app still works; new mail may take a little longer to appear. Run `npx ownmail project doctor` to inspect project state, then `npx ownmail project doctor --fix` to retry.',
		)
	} else if (result.status === 'skipped' && result.reason === 'unhealthy-app') {
		p.log.warn(
			'Couldn’t set up instant updates because the deployed app is not reachable yet. Your app still works; new mail may take a little longer to appear. Run `npx ownmail project doctor --fix` after the app is healthy to retry.',
		)
	} else if (result.status === 'failed') {
		const recovery =
			result.reason === 'ambiguous-ownmail-destinations'
				? 'OwnMail found more than one eligible destination. In the Nylas Dashboard, remove obsolete “ownmail realtime” webhooks for this project, then run `npx ownmail project doctor --fix`.'
				: result.reason === 'tracked-destination-ownership-mismatch'
					? 'The recorded destination no longer matches this OwnMail project. Run `npx ownmail project doctor` to inspect the project before changing webhooks.'
					: result.reason === 'unrecognized-callback-destination'
						? 'A different webhook already uses this callback URL. Review Webhooks in the Nylas Dashboard, then run `npx ownmail project doctor --fix`.'
						: 'Run `npx ownmail project doctor --fix` to retry.'
		p.log.warn(
			`Couldn’t set up instant updates. Your app still works; new mail may take a little longer to appear. ${recovery}${result.requestId ? `\n\nRequest ID: ${result.requestId}. Include this ID if you contact Nylas Support.` : ''}`,
		)
	}
	if (result.status === 'registered') {
		saveProject(ctx.project)
		markStep(ctx.project, 'webhook')
	}
}

/** 09 — Register redirect URIs for hosted auth. */
export async function stepRedirectUris(ctx: StepContext): Promise<void> {
	const v3 = requireV3(ctx)
	if (ctx.project.hostingProvider === 'vercel' && ctx.project.providerAppUrl && ctx.project.vercelOrgId) {
		ctx.project.providerAppUrl = await resolveVercelProductionUrl(
			ctx.project.providerAppUrl,
			ctx.project.vercelOrgId,
		)
		saveProject(ctx.project)
	}
	// Worker URL shape is deterministic before first deploy only if we know the
	// account subdomain — so this step runs once after deploy too (doctor re-runs it).
	const urls = new Set(['http://localhost:3000/auth/callback'])
	const url = appUrl(ctx)
	if (url) {
		urls.add(`${url}/auth/callback`)
	}
	for (const domain of projectAppDomains(ctx.project)) {
		urls.add(`https://${domain}/auth/callback`)
	}
	await v3.ensureRedirectUris([...urls])
	markStep(ctx.project, 'redirect-uris')
}

/** 11 — Health check + final summary. */
export async function stepVerify(ctx: StepContext): Promise<void> {
	const url = requireProjectValue(appUrl(ctx), 'App URL')
	const spinner = p.spinner()
	spinner.start('Checking your app is alive…')
	const healthy = await checkAppHealth(url)
	spinner.stop(healthy ? 'Your app is live!' : 'App deployed, but the health check hasn’t passed yet.')
	if (!healthy && ctx.project.hostingProvider === 'vercel') {
		throw new Error(
			`Vercel deployed the mailbox app, but its health check did not pass. View Runtime Logs in the Vercel dashboard or run \`npx vercel logs --deployment ${url} --level error --expand\`. Fix the runtime error, then retry \`npx ownmail app update --name ${ctx.project.slug}\`.`,
		)
	}
	if (!healthy) {
		p.log.warn(`Give it a minute, then visit ${url}. If it stays down, run: npx ownmail project doctor`)
	}

	// One-time setup secrets are no longer needed once everything downstream ran.
	// Keep a deployment API key only when it is backed by the OS keyring so a
	// later setup resume can validate and reuse it without creating another key.
	if (ctx.project.hostingProvider === 'local') {
		clearPendingSecret(ctx.project, 'clientSecret')
		clearPendingSecret(ctx.project, 'appPassword')
	} else {
		clearPendingSecret(ctx.project, 'clientSecret')
		clearPendingSecret(ctx.project, 'appPassword')
		clearPendingSecret(ctx.project, 'sessionSecret')
		if (typeof ctx.project.pendingSecrets.apiKey === 'string') {
			clearPendingSecret(ctx.project, 'apiKey')
		}
	}
	saveProject(ctx.project)

	markStep(ctx.project, 'verify')
	p.note(
		[
			`Your mailbox app:  ${url}`,
			`Your email:        ${ctx.project.inboxEmail}`,
			'Password:          saved earlier (not shown again)',
			'',
			'IMAP:              imap.nylas.email:993 (SSL)',
			'SMTP:              smtp.nylas.email:465 (SSL) or 587 (STARTTLS)',
			'',
			'Reset password:    npx ownmail inbox reset-password',
			'Update later:      npx ownmail app update',
			'Get the source:    npx ownmail app eject',
			'Cleanup pending:   npx ownmail project cleanup',
		].join('\n'),
		'🎉 Done',
	)

	const shouldOpen = await p.confirm({ message: 'Open your mailbox app now?', initialValue: true })
	if (!p.isCancel(shouldOpen) && shouldOpen) {
		try {
			await open(url)
		} catch {
			p.log.warn(`Could not open the browser automatically. Visit ${url} when you’re ready.`)
		}
	}
}

async function finalizePendingApiKeyRotation(ctx: StepContext): Promise<void> {
	const rotation = ctx.project.pendingApiKeyRotation
	if (!rotation || rotation.replacementKeyId !== ctx.project.apiKeyId) return
	try {
		await requireGateway(ctx).revokeApiKey(
			tokens(ctx),
			ctx.project.region,
			requireNylasClientId(ctx.project.applicationId),
			rotation.previousKeyId,
		)
		delete ctx.project.pendingApiKeyRotation
		saveProject(ctx.project)
		p.log.info('Replaced the previous Nylas API key after the new key was installed.')
	} catch {
		p.log.warn(
			'The new Nylas API key is installed, but the previous key could not be revoked. OwnMail will retry on the next deployment.',
		)
	}
}

function appUrl(ctx: StepContext): string | undefined {
	return projectAppUrl(ctx.project)
}

/** A fresh 32-byte CSPRNG session secret; only ever handed to the hosting provider. */
function newSessionSecret(): string {
	return randomBytes(32).toString('base64url')
}

/**
 * `sessionSecret` is null when the provider already holds one. Omitting the key
 * leaves the deployed value in place instead of overwriting it.
 */
function runtimeEnvironment(
	ctx: StepContext,
	templateVersion: string,
	apiKey: string,
	sessionSecret: string | null,
): Record<string, string> {
	const apiBaseUrl = deployedApiBaseUrl(ctx.project.region)
	return {
		NYLAS_API_KEY: apiKey,
		...(sessionSecret ? { SESSION_SECRET: sessionSecret } : {}),
		NYLAS_CLIENT_ID: requireNylasClientId(ctx.project.applicationId),
		NYLAS_REGION: ctx.project.region,
		...(apiBaseUrl ? { NYLAS_API_BASE_URL: apiBaseUrl } : {}),
		APP_NAME: ctx.project.slug,
		OWNMAIL_SITE_NAME: configuredSiteName(ctx.project),
		INBOX_EMAIL: requireProjectValue(ctx.project.inboxEmail, 'Inbox email'),
		TEMPLATE_VERSION: templateVersion,
	}
}

function hostingLabel(provider: StepContext['project']['hostingProvider']): string {
	switch (provider) {
		case 'local':
			return 'Local hosting'
		default:
			return 'Manual hosting'
	}
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

function requirePendingApiKey(ctx: StepContext): string {
	const apiKey = readPendingSecret(ctx.project, 'apiKey')
	if (!apiKey) {
		throw new Error(
			'Pending Nylas API key is missing from secure local storage. Re-run `npx ownmail` to mint a fresh deploy key.',
		)
	}
	return apiKey
}

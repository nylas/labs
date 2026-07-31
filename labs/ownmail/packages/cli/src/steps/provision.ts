import * as p from '@clack/prompts'
import {
	type AuthResponse,
	DashboardAccountClient,
	DpopKey,
	type GatewayApplication,
	GatewayClient,
	type InboxDomain,
	NylasV3Client,
	type Region,
	type SsoLoginType,
} from '@nylas-labs/cli-kit'
import open from 'open'
import { z } from 'zod'
import { apiBaseUrl, dashboardAccountUrl, gatewayUrls } from '../nylas-env.js'
import {
	clearPendingSecret,
	hasPendingSecret,
	type PendingSecretStoreResult,
	readPendingSecret,
	storePendingSecret,
} from '../state/pending-secrets.js'
import type { ProjectState } from '../state/schema.js'
import { markStep, saveProject } from '../state/store.js'
import { OWNMAIL_USER_AGENT } from '../usage-attribution.js'
import { generateAppPassword, validateAppPassword } from '../util/password.js'
import { requireDashboard, requireGateway, requireV3, type StepContext, setAuth, tokens } from './context.js'

const APP_BRANDING_PREFIX = 'ownmail:'
const SANDBOX_GRANT_CAP = 5
const APPLICATION_REGIONS: Region[] = ['us', 'eu']
const DASHBOARD_EMAIL_SCHEMA = z.string().trim().max(254).email()
const DASHBOARD_PASSWORD_SCHEMA = z.string().min(1).max(1024)
const DASHBOARD_MFA_CODE_SCHEMA = z.string().regex(/^[0-9]{6}$/)
const DOMAIN_VERIFICATION_CHECKS = ['ownership', 'mx', 'spf', 'dkim', 'feedback'] as const
const DOMAIN_POLL_INTERVAL_MS = 30_000
const DOMAIN_POLL_TIMEOUT_MS = 30 * 60 * 1000

type DomainVerificationCheck = (typeof DOMAIN_VERIFICATION_CHECKS)[number]
type PollControl = 'back' | 'cancel'
type VerificationInput = Pick<
	NodeJS.ReadStream,
	'isPaused' | 'on' | 'pause' | 'removeListener' | 'resume'
> & {
	isTTY?: boolean
	isRaw?: boolean
	setRawMode?: (mode: boolean) => unknown
}

/** 01 — Dashboard email/password or SSO flow (login or register). */
export async function stepDashboardAuth(ctx: StepContext): Promise<void> {
	if (ctx.auth) {
		// Session may be stale — probe and refresh instead of re-prompting.
		try {
			await requireDashboard(ctx).currentSession(tokens(ctx))
			return
		} catch {
			try {
				const refreshed = await requireDashboard(ctx).refresh(tokens(ctx))
				setAuth(ctx, {
					...ctx.auth,
					userToken: refreshed.userToken,
					...(refreshed.orgToken ? { orgToken: refreshed.orgToken } : {}),
					updatedAt: Date.now(),
				})
				return
			} catch {
				p.log.warn('Your Nylas session expired — let’s log in again.')
				ctx.auth = null
			}
		}
	}

	const mode = await p.select({
		message: 'Do you already have a Nylas account?',
		options: [
			{ value: 'register' as const, label: 'No — create one (free)' },
			{ value: 'login' as const, label: 'Yes — log in' },
		],
	})
	if (p.isCancel(mode)) throw new CancelledError()

	const loginType = await p.select({
		message: 'Sign in with',
		options:
			mode === 'login'
				? [
						{ value: 'email_password' as const, label: 'Nylas email and password' },
						{ value: 'google_SSO' as const, label: 'Google' },
						{ value: 'microsoft_SSO' as const, label: 'Microsoft' },
						{ value: 'github_SSO' as const, label: 'GitHub' },
						{ value: 'saml_SSO' as const, label: 'Enterprise SAML' },
					]
				: [
						{ value: 'google_SSO' as const, label: 'Google' },
						{ value: 'microsoft_SSO' as const, label: 'Microsoft' },
						{ value: 'github_SSO' as const, label: 'GitHub' },
					],
	})
	if (p.isCancel(loginType)) throw new CancelledError()

	const samlSsoInput =
		loginType === 'saml_SSO'
			? {
					loginType,
					mode: 'login' as const,
					email: await promptDashboardEmail('Work email for Enterprise SAML', 'you@company.com'),
				}
			: undefined
	const dpop = ctx.dpop ?? (await DpopKey.generate())
	const dashboard = new DashboardAccountClient(dpop, dashboardAccountUrl(), fetch, OWNMAIL_USER_AGENT)
	ctx.dpop = dpop
	ctx.dashboard = dashboard
	ctx.gateway = new GatewayClient(dpop, gatewayUrls(), fetch, OWNMAIL_USER_AGENT)

	let result: AuthResponse
	if (loginType === 'email_password') {
		result = await authorizeWithPassword(dashboard)
	} else {
		const spinner = p.spinner()
		const ssoInput = samlSsoInput ?? { loginType: loginType as SsoLoginType, mode }
		const ssoResult = await dashboard.ssoAuthorize(ssoInput, async (started) => {
			const url = started.verificationUriComplete ?? started.verificationUri
			p.note(
				`Visit this URL to finish signing in:\n\n  ${url}\n\nCode: ${started.userCode}`,
				'Confirm in browser',
			)
			const shouldOpen = await p.confirm({
				message: 'Open this URL in your browser?',
				initialValue: true,
			})
			if (p.isCancel(shouldOpen)) throw new CancelledError()
			if (shouldOpen) {
				await open(url).catch(() => {
					p.log.warn('Could not open your browser automatically. Use the URL above.')
				})
			}
			spinner.start('Waiting for you to finish in the browser…')
		})
		if (ssoResult.status === 'mfa_required') {
			spinner.stop('Browser sign-in complete — MFA required')
			result = await completeDashboardMfa(
				dashboard,
				ssoResult.user.publicId,
				ssoResult.organizations[0]?.publicId,
			)
		} else if (ssoResult.status !== 'complete') {
			spinner.stop('Browser sign-in did not complete')
			throw new Error(
				ssoResult.status === 'access_denied'
					? loginType === 'saml_SSO'
						? 'Enterprise SAML sign-in was denied. Check your work email and ask your organization administrator to confirm your Nylas access, then retry.'
						: 'Sign-in was denied. If this Google, Microsoft, or GitHub email does not have a Nylas dashboard account, re-run ownmail and choose “No — create one (free)”.'
					: 'The sign-in link expired before it was confirmed. Re-run ownmail to start a new sign-in.',
			)
		} else {
			spinner.stop('Browser sign-in complete')
			result = ssoResult
		}
	}

	setAuth(ctx, {
		userToken: result.userToken,
		orgToken: result.orgToken,
		userPublicId: result.user.publicId,
		orgPublicId: result.organizations[0]?.publicId,
		dpopPrivateJwk: dpop.toStored().privateJwk as Record<string, unknown>,
		updatedAt: Date.now(),
	})
	markStep(ctx.project, 'dashboard-auth')
}

async function promptDashboardEmail(message: string, placeholder: string): Promise<string> {
	const emailInput = await p.text({
		message,
		placeholder,
		validate: (value) =>
			DASHBOARD_EMAIL_SCHEMA.safeParse(value).success ? undefined : 'Enter a valid email address.',
	})
	if (p.isCancel(emailInput)) throw new CancelledError()
	return DASHBOARD_EMAIL_SCHEMA.parse(emailInput).toLowerCase()
}

async function authorizeWithPassword(dashboard: DashboardAccountClient): Promise<AuthResponse> {
	const email = await promptDashboardEmail('Nylas account email', 'you@example.com')

	let password = await p.password({
		message: 'Nylas account password',
		validate: (value) =>
			DASHBOARD_PASSWORD_SCHEMA.safeParse(value).success
				? undefined
				: 'Enter a password between 1 and 1024 characters.',
	})
	if (p.isCancel(password)) throw new CancelledError()

	const spinner = p.spinner()
	spinner.start('Signing in to Nylas…')
	let loginResult: Awaited<ReturnType<DashboardAccountClient['loginWithPassword']>>
	try {
		loginResult = await dashboard.loginWithPassword({ email, password })
	} catch (err) {
		spinner.stop('Nylas sign-in failed')
		throw new Error(
			'Email/password sign-in failed. Check your credentials and confirm this account uses Nylas email/password login.',
			{ cause: err },
		)
	} finally {
		password = ''
	}

	if (loginResult.status === 'complete') {
		spinner.stop('Nylas sign-in complete')
		return loginResult
	}

	spinner.stop('Password accepted — MFA required')
	return completeDashboardMfa(dashboard, loginResult.user.publicId, loginResult.organizations[0]?.publicId)
}

async function completeDashboardMfa(
	dashboard: DashboardAccountClient,
	userPublicId: string,
	orgPublicId?: string,
): Promise<AuthResponse> {
	let code = await p.password({
		message: 'Six-digit authenticator code',
		validate: (value) =>
			DASHBOARD_MFA_CODE_SCHEMA.safeParse(value).success ? undefined : 'Enter a six-digit code.',
	})
	if (p.isCancel(code)) throw new CancelledError()

	const spinner = p.spinner()
	spinner.start('Verifying authenticator code…')
	try {
		const result = await dashboard.completeMfaLogin({
			userPublicId,
			code,
			...(orgPublicId ? { orgPublicId } : {}),
		})
		code = ''
		spinner.stop('MFA verification complete')
		return result
	} catch (err) {
		code = ''
		spinner.stop('MFA verification failed')
		throw new Error('MFA verification failed. Check the six-digit code and try again.', { cause: err })
	}
}

/** 02 — Resolve the active organization (picker when the user has several). */
export async function stepOrg(ctx: StepContext): Promise<void> {
	const dashboard = requireDashboard(ctx)
	const session = await dashboard.currentSession(tokens(ctx))
	const orgs = session.organizations ?? (session.organization ? [session.organization] : [])

	let orgPublicId = session.organization?.publicId ?? orgs[0]?.publicId
	if (orgs.length > 1) {
		const picked = await p.select({
			message: 'Which organization should own this mailbox?',
			options: orgs.map((o) => ({ value: o.publicId, label: o.name ?? o.publicId })),
			...(orgPublicId ? { initialValue: orgPublicId } : {}),
		})
		if (p.isCancel(picked)) throw new CancelledError()
		if (picked !== session.organization?.publicId) {
			const switched = await dashboard.switchOrg(tokens(ctx), picked)
			const auth = ctx.auth
			/* v8 ignore next -- tokens(ctx) above throws when auth is absent. -- @preserve */
			if (!auth) throw new Error('Not logged in — dashboard auth step must run first')
			setAuth(ctx, {
				...auth,
				orgToken: switched.orgToken,
				orgPublicId: picked,
				updatedAt: Date.now(),
			})
		}
		orgPublicId = picked
	}
	if (!orgPublicId)
		throw new Error('Could not resolve your organization — log in to the Nylas dashboard once and retry.')

	ctx.project.orgPublicId = orgPublicId
	if (ctx.auth && ctx.auth.orgPublicId !== orgPublicId) {
		setAuth(ctx, { ...ctx.auth, orgPublicId, updatedAt: Date.now() })
	}
	saveProject(ctx.project)
	markStep(ctx.project, 'org')
}

/** 03 — Find or create the sandbox application for this project. */
export async function stepApp(ctx: StepContext): Promise<void> {
	if (ctx.project.applicationId) {
		markStep(ctx.project, 'app')
		return
	}
	const gateway = requireGateway(ctx)
	const orgPublicId = ctx.project.orgPublicId
	if (!orgPublicId) throw new Error('Organization unavailable — rerun ownmail setup')
	const brandName = `${APP_BRANDING_PREFIX}${ctx.project.slug}`

	const existing = await findReusableSandboxApplication(ctx, gateway, orgPublicId, brandName)
	if (existing) {
		ctx.project.applicationId = existing.applicationId
		ctx.project.region = existing.region
		p.log.info(`Using existing ${existing.region.toUpperCase()} sandbox app: ${appDisplayName(existing)}`)
	} else {
		const created = await gateway.createApplication(tokens(ctx), ctx.project.region, orgPublicId, {
			region: ctx.project.region,
			environment: 'sandbox',
			branding: { name: brandName, description: 'Created by npx ownmail' },
		})
		ctx.project.applicationId = created.applicationId
	}
	saveProject(ctx.project)
	markStep(ctx.project, 'app')
}

type ReusableApplication = GatewayApplication & { region: Region }

async function findReusableSandboxApplication(
	ctx: StepContext,
	gateway: GatewayClient,
	orgPublicId: string,
	brandName: string,
): Promise<ReusableApplication | null> {
	const apps: ReusableApplication[] = []
	for (const region of prioritizedRegions(ctx.project.region)) {
		const listed = await gateway.listApplications(tokens(ctx), region, orgPublicId)
		for (const app of listed) {
			if (!isSandboxApplication(app)) continue
			apps.push({ ...app, region: parseRegion(app.region) ?? region })
		}
	}

	return apps.find((app) => app.branding?.name === brandName) ?? apps[0] ?? null
}

function prioritizedRegions(region: Region): Region[] {
	return [region, ...APPLICATION_REGIONS.filter((candidate) => candidate !== region)]
}

function isSandboxApplication(app: GatewayApplication): boolean {
	return app.environment?.toLowerCase() === 'sandbox'
}

function parseRegion(region: string): Region | null {
	return region === 'us' || region === 'eu' ? region : null
}

function appDisplayName(app: GatewayApplication): string {
	return app.branding?.name?.trim() || app.applicationId
}

/** 04 — Mint an API key (re-mint on resume is safe; old keys stay valid until revoked). */
export async function stepApiKey(ctx: StepContext): Promise<void> {
	const pendingApiKey = readPendingSecret(ctx.project, 'apiKey')
	if (pendingApiKey) {
		ctx.v3 = new NylasV3Client(
			pendingApiKey,
			ctx.project.region,
			fetch,
			apiBaseUrl(ctx.project.region),
			OWNMAIL_USER_AGENT,
		)
		markStep(ctx.project, 'api-key')
		return
	}
	if (hasPendingSecret(ctx.project, 'apiKey')) {
		clearPendingSecret(ctx.project, 'apiKey')
		saveProject(ctx.project)
		p.log.warn('Could not read the pending Nylas API key from local secure storage; minting a fresh one.')
	}

	const gateway = requireGateway(ctx)
	const applicationId = ctx.project.applicationId
	if (!applicationId) throw new Error('Nylas application unavailable — rerun ownmail setup')
	const spinner = p.spinner()
	spinner.start('Creating a Nylas API key…')
	let created: Awaited<ReturnType<typeof gateway.createApiKey>>
	try {
		created = await gateway.createApiKey(tokens(ctx), ctx.project.region, applicationId, {
			name: `ownmail ${ctx.project.slug} ${apiKeyNameSuffix()}`,
		})
	} catch (err) {
		spinner.stop('Could not create a Nylas API key.')
		throw err
	}
	spinner.stop('Nylas API key created.')
	ctx.project.apiKeyId = created.id
	const stored = storePendingSecret(ctx.project, 'apiKey', created.apiKey)
	warnIfLocalPendingSecret(stored, 'Nylas API key')
	ctx.v3 = new NylasV3Client(
		created.apiKey,
		ctx.project.region,
		fetch,
		apiBaseUrl(ctx.project.region),
		OWNMAIL_USER_AGENT,
	)
	saveProject(ctx.project)
	markStep(ctx.project, 'api-key')
}

function apiKeyNameSuffix(): string {
	return new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')
}

/** 03b/05a — Ensure the application has the `nylas` connector required by Nylas Connect. */
export async function stepConnector(ctx: StepContext): Promise<void> {
	const spinner = p.spinner()
	spinner.start('Checking Nylas Connect connector…')
	try {
		await requireV3(ctx).ensureConnector('nylas')
	} catch (err) {
		spinner.stop('Could not configure the Nylas Connect connector.')
		throw err
	}
	spinner.stop('Nylas Connect connector ready.')
	markStep(ctx.project, 'connector')
}

/** Gather the email-domain choice before creating any remote OwnMail resources. */
export async function stepDomainPlan(ctx: StepContext): Promise<void> {
	if (ctx.project.domainAddress || ctx.project.plannedDomainAddress || hasDurableResources(ctx.project)) {
		markStep(ctx.project, 'domain-plan')
		return
	}
	await planDomain(ctx)
	markStep(ctx.project, 'domain-plan')
}

async function planDomain(ctx: StepContext): Promise<void> {
	const dashboard = requireDashboard(ctx)
	const region = ctx.project.region

	const domains = await dashboard.listInboxDomains(tokens(ctx), { limit: 100 })
	const branded = domains.find((d) => d.branded && d.region === region)
	if (branded) {
		adoptDomain(ctx, branded.id, branded.domainAddress, true, isFullyVerified(branded))
		p.log.info(`Using your organization’s existing domain: ${branded.domainAddress}`)
		return
	}

	const choice = await p.select({
		message: 'Where should your email address live?',
		options: [
			{
				value: 'free' as const,
				label: 'Free subdomain — yourname.nylas.email',
				hint: 'ready instantly',
			},
			{
				value: 'custom' as const,
				label: 'My own domain — you@your-company.com',
				hint: 'needs DNS records',
			},
		],
	})
	if (p.isCancel(choice)) throw new CancelledError()

	if (choice === 'free') {
		await planBrandedDomain(ctx)
	} else {
		const domain = await p.text({
			message: 'Your domain (you must control its DNS)',
			placeholder: 'mail.your-company.com',
			validate: (v) =>
				/^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/.test(v ?? '')
					? undefined
					: 'Enter a domain like mail.your-company.com',
		})
		if (p.isCancel(domain)) throw new CancelledError()
		ctx.project.plannedDomainAddress = domain
		ctx.project.plannedDomainBranded = false
		saveProject(ctx.project)
	}
}

async function planBrandedDomain(ctx: StepContext): Promise<void> {
	const dashboard = requireDashboard(ctx)
	for (;;) {
		const sub = await p.text({
			message: 'Pick your subdomain',
			placeholder: 'acme',
			initialValue: ctx.project.slug,
			validate: (v) =>
				/^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$/.test(v ?? '')
					? undefined
					: 'Lowercase letters, digits, and hyphens (3–63 chars)',
		})
		if (p.isCancel(sub)) throw new CancelledError()
		const domainAddress = `${sub}.nylas.email`

		const availability = await dashboard.domainAvailability(tokens(ctx), domainAddress)
		if (!availability.available) {
			p.log.warn(`${domainAddress} is taken — try ${sub}-hq, ${sub}-app, or get-${sub}.`)
			continue
		}
		ctx.project.plannedDomainAddress = domainAddress
		ctx.project.plannedDomainBranded = true
		saveProject(ctx.project)
		return
	}
}

/** 05 — Create or resume the org's planned inbox domain. */
export async function stepDomain(ctx: StepContext): Promise<void> {
	if (ctx.project.domainAddress && ctx.project.domainVerified) {
		markStep(ctx.project, 'domain')
		return
	}
	if (ctx.project.domainId && ctx.project.domainAddress && ctx.project.domainBranded) {
		markStep(ctx.project, 'domain')
		return
	}
	if (ctx.project.domainId && ctx.project.domainAddress && !ctx.project.domainBranded) {
		await verifyCustomDomain(ctx, ctx.project.domainId, ctx.project.domainAddress)
		markStep(ctx.project, 'domain')
		return
	}
	if (!ctx.project.plannedDomainAddress) await planDomain(ctx)
	if (ctx.project.domainAddress) {
		markStep(ctx.project, 'domain')
		return
	}
	for (;;) {
		const address = ctx.project.plannedDomainAddress
		if (!address) throw new Error('Email domain plan is missing — re-run ownmail to choose a domain.')
		if (ctx.project.plannedDomainBranded) {
			try {
				await createBrandedDomain(ctx, address, ctx.project.region)
			} catch (err) {
				if (!isDomainCreateConflict(err)) throw err
				clearPlannedDomain(ctx)
				p.log.warn(`${address} was claimed before setup could create it — pick another subdomain.`)
				await planBrandedDomain(ctx)
				markStep(ctx.project, 'domain-plan')
				continue
			}
		} else {
			await createCustomDomain(ctx, address, ctx.project.region)
		}
		break
	}
	delete ctx.project.plannedDomainAddress
	delete ctx.project.plannedDomainBranded
	saveProject(ctx.project)
	markStep(ctx.project, 'domain')
}

async function createBrandedDomain(
	ctx: StepContext,
	domainAddress: string,
	region: 'us' | 'eu',
): Promise<void> {
	const dashboard = requireDashboard(ctx)
	const spinner = p.spinner()
	spinner.start(`Claiming ${domainAddress}…`)
	let created: Awaited<ReturnType<typeof dashboard.createInboxDomain>>
	try {
		created = await dashboard.createInboxDomain(tokens(ctx), {
			name: domainAddress.slice(0, -'.nylas.email'.length),
			domainAddress,
			region,
		})
	} catch (err) {
		spinner.stop(`Could not claim ${domainAddress}.`)
		throw err
	}
	spinner.stop(`${domainAddress} is yours — mail routing is live.`)
	adoptDomain(ctx, created.id, created.domainAddress, true, true)
}

async function createCustomDomain(ctx: StepContext, domain: string, region: 'us' | 'eu'): Promise<void> {
	const dashboard = requireDashboard(ctx)
	const created = await dashboard.createInboxDomain(tokens(ctx), {
		name: domain,
		domainAddress: domain,
		region,
	})
	adoptDomain(ctx, created.id, created.domainAddress, false, false)
	await verifyCustomDomain(ctx, created.id, domain)
}

async function verifyCustomDomain(ctx: StepContext, domainId: string, domain: string): Promise<void> {
	const dashboard = requireDashboard(ctx)
	const region = ctx.project.region
	p.log.step('Publish these DNS records at your DNS provider:')
	for (const type of DOMAIN_VERIFICATION_CHECKS) {
		try {
			const info = await dashboard.domainInfo(tokens(ctx), domainId, { region, type })
			const o = info.attempt?.options
			if (o?.host && o.type && o.value) {
				p.log.message(`  ${o.type.padEnd(6)} ${o.host}  →  ${o.value}`)
			}
		} catch {
			// Info for this check not available yet; verify loop below will surface it.
		}
	}

	const pending = new Set<DomainVerificationCheck>(DOMAIN_VERIFICATION_CHECKS)
	if (await refreshDomainVerificationState(ctx, domainId, pending)) {
		finishDomainVerification(ctx, domain)
		return
	}

	for (;;) {
		const mode = await p.select({
			message: `DNS verification is waiting on: ${[...pending].join(', ')}. How should OwnMail continue?`,
			options: [
				{
					value: 'poll' as const,
					label: 'Poll automatically',
					hint: 'every 30s; press Esc to go back',
				},
				{
					value: 'manual' as const,
					label: 'Retry verification now',
					hint: 'return here if DNS is still pending',
				},
			],
		})
		if (p.isCancel(mode)) throw new CancelledError()

		const spinner = p.spinner()
		if (mode === 'manual') {
			spinner.start('Checking DNS records…')
			if (await runDomainVerificationSweep(ctx, domainId, pending)) {
				spinner.stop(`${domain} verified — mail routing is live.`)
				finishDomainVerification(ctx, domain, false)
				return
			}
			spinner.stop(`Still waiting on: ${[...pending].join(', ')}.`)
			continue
		}

		spinner.start('Polling DNS every 30s — press Esc to go back or Ctrl+C to pause setup…')
		const controls = watchVerificationControls()
		const deadline = Date.now() + DOMAIN_POLL_TIMEOUT_MS
		try {
			while (Date.now() < deadline) {
				if (await runDomainVerificationSweep(ctx, domainId, pending)) {
					spinner.stop(`${domain} verified — mail routing is live.`)
					finishDomainVerification(ctx, domain, false)
					return
				}

				const control = controls.current()
				if (control === 'cancel') throw new CancelledError()
				if (control === 'back') {
					spinner.stop('Automatic polling paused.')
					break
				}

				spinner.message(`Waiting on: ${[...pending].join(', ')} — Esc goes back`)
				const waitedControl = await waitForPollInterval(controls.wait)
				if (waitedControl === 'cancel') throw new CancelledError()
				if (waitedControl === 'back') {
					spinner.stop('Automatic polling paused.')
					break
				}
			}

			if (Date.now() >= deadline) {
				spinner.stop('DNS not fully verified yet.')
				throw new Error(
					`Still waiting on: ${[...pending].join(', ')}. DNS can take a while — re-run ownmail to resume from here.`,
				)
			}
		} finally {
			controls.dispose()
		}
	}
}

async function runDomainVerificationSweep(
	ctx: StepContext,
	domainId: string,
	pending: Set<DomainVerificationCheck>,
): Promise<boolean> {
	const dashboard = requireDashboard(ctx)
	for (const type of [...pending]) {
		try {
			const result = await dashboard.verifyDomain(tokens(ctx), domainId, { type }, ctx.project.region)
			if (/verified|success|ok/i.test(result.status)) pending.delete(type)
		} catch {
			// A later authoritative domain refresh can still observe a completed check.
		}
	}

	const refreshed = await refreshDomainVerificationState(ctx, domainId, pending)
	return refreshed || (!pending.has('ownership') && !pending.has('mx'))
}

async function refreshDomainVerificationState(
	ctx: StepContext,
	domainId: string,
	pending: Set<DomainVerificationCheck>,
): Promise<boolean> {
	try {
		const domain = await requireDashboard(ctx).getInboxDomain(tokens(ctx), domainId, ctx.project.region)
		updatePendingDomainChecks(pending, domain)
		return isFullyVerified(domain)
	} catch {
		return false
	}
}

function updatePendingDomainChecks(
	pending: Set<DomainVerificationCheck>,
	domain: Pick<
		InboxDomain,
		'verifiedOwnership' | 'verifiedMx' | 'verifiedSpf' | 'verifiedDkim' | 'verifiedFeedback'
	>,
): void {
	const verified: Record<DomainVerificationCheck, boolean> = {
		ownership: domain.verifiedOwnership,
		mx: domain.verifiedMx,
		spf: domain.verifiedSpf,
		dkim: domain.verifiedDkim,
		feedback: domain.verifiedFeedback,
	}
	for (const type of DOMAIN_VERIFICATION_CHECKS) {
		if (verified[type]) pending.delete(type)
		else pending.add(type)
	}
}

function finishDomainVerification(ctx: StepContext, domain: string, logSuccess = true): void {
	if (logSuccess) p.log.success(`${domain} verified — mail routing is live.`)
	ctx.project.domainVerified = true
	saveProject(ctx.project)
}

export function watchVerificationControls(input: VerificationInput = process.stdin): {
	wait: Promise<PollControl>
	current: () => PollControl | null
	dispose: () => void
} {
	const wasPaused = input.isPaused()
	const wasRaw = Boolean(input.isRaw)
	let control: PollControl | null = null
	let resolveControl!: (value: PollControl) => void
	const wait = new Promise<PollControl>((resolve) => {
		resolveControl = resolve
	})
	const onData = (chunk: Buffer | string): void => {
		const key = chunk.toString()
		const next = key === '\u001b' ? 'back' : key === '\u0003' ? 'cancel' : null
		if (!next || control) return
		control = next
		resolveControl(next)
	}

	input.on('data', onData)
	if (input.isTTY && typeof input.setRawMode === 'function') input.setRawMode(true)
	input.resume()

	return {
		wait,
		current: () => control,
		dispose: () => {
			input.removeListener('data', onData)
			if (input.isTTY && typeof input.setRawMode === 'function' && Boolean(input.isRaw) !== wasRaw) {
				input.setRawMode(wasRaw)
			}
			if (wasPaused) input.pause()
		},
	}
}

async function waitForPollInterval(control: Promise<PollControl>): Promise<PollControl | null> {
	return new Promise((resolve) => {
		const timer = setTimeout(() => resolve(null), DOMAIN_POLL_INTERVAL_MS)
		void control.then((value) => {
			clearTimeout(timer)
			resolve(value)
		})
	})
}

function hasDurableResources(project: ProjectState): boolean {
	return Boolean(project.applicationId || project.domainId || project.grantId)
}

function clearPlannedDomain(ctx: StepContext): void {
	delete ctx.project.plannedDomainAddress
	delete ctx.project.plannedDomainBranded
	ctx.project.completedSteps = ctx.project.completedSteps.filter((step) => step !== 'domain-plan')
	saveProject(ctx.project)
}

function isDomainCreateConflict(err: unknown): boolean {
	return (err as { status?: unknown } | null)?.status === 409
}

function adoptDomain(
	ctx: StepContext,
	id: string,
	address: string,
	branded: boolean,
	verified: boolean,
): void {
	ctx.project.domainId = id
	ctx.project.domainAddress = address
	ctx.project.domainBranded = branded
	ctx.project.domainVerified = verified
	saveProject(ctx.project)
}

function isFullyVerified(d: { verifiedOwnership: boolean; verifiedMx: boolean }): boolean {
	return d.verifiedOwnership && d.verifiedMx
}

/** 06 — Create the Agent Account mailbox grant with an app password. */
export async function stepGrant(ctx: StepContext): Promise<void> {
	if (ctx.project.grantId) {
		const pendingAppPassword = readPendingSecret(ctx.project, 'appPassword')
		if (ctx.project.inboxEmail && pendingAppPassword) {
			await showInboxPassword(ctx.project.inboxEmail, pendingAppPassword)
		} else if (hasPendingSecret(ctx.project, 'appPassword')) {
			clearPendingSecret(ctx.project, 'appPassword')
			saveProject(ctx.project)
			p.log.warn(
				'Could not read the pending inbox password from local secure storage. Continue setup, then run `npx ownmail inbox reset-password` if you did not save it.',
			)
		}
		markStep(ctx.project, 'grant')
		return
	}
	const v3 = requireV3(ctx)
	const domain = ctx.project.domainAddress
	if (!domain) throw new Error('Domain unavailable — rerun ownmail setup')

	const existing = await v3.listGrants({ limit: 50 })
	const nylasGrants = existing.data.filter((g) => g.provider === 'nylas')
	const onOurDomain = nylasGrants.find(
		(g): g is (typeof nylasGrants)[number] & { email: string } =>
			typeof g.email === 'string' && g.email.endsWith(`@${domain}`),
	)
	if (onOurDomain) {
		const reuse = await p.confirm({
			message: `Found an existing inbox ${onOurDomain.email} on this app — use it? (Its password stays whatever you set before.)`,
		})
		if (p.isCancel(reuse)) throw new CancelledError()
		if (reuse) {
			ctx.project.grantId = onOurDomain.id
			ctx.project.inboxEmail = onOurDomain.email
			saveProject(ctx.project)
			markStep(ctx.project, 'grant')
			return
		}
	}
	if (nylasGrants.length >= SANDBOX_GRANT_CAP) {
		throw new Error(
			`This sandbox app already has ${nylasGrants.length} mailboxes (the sandbox cap is ${SANDBOX_GRANT_CAP}). ` +
				`Delete one in the Nylas dashboard or reuse an existing inbox, then re-run ownmail.`,
		)
	}

	const localPart = await p.text({
		message: 'Choose your email address',
		placeholder: 'contact',
		initialValue: 'contact',
		validate: (v) =>
			/^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/i.test(v ?? '')
				? undefined
				: 'Letters, digits, dots, hyphens, underscores',
	})
	if (p.isCancel(localPart)) throw new CancelledError()
	const email = `${localPart}@${domain}`

	const wantsOwnPassword = await p.confirm({
		message: 'Generate a strong password for this inbox? (choose “no” to type your own)',
		initialValue: true,
	})
	if (p.isCancel(wantsOwnPassword)) throw new CancelledError()

	let appPassword: string
	if (wantsOwnPassword) {
		appPassword = generateAppPassword(localPart)
	} else {
		const typed = await p.password({
			message: 'Inbox password (18–40 chars, uppercase, lowercase, digit, symbol, no spaces)',
			validate: (v) => validateAppPassword(v ?? '', localPart),
		})
		if (p.isCancel(typed)) throw new CancelledError()
		appPassword = typed
	}

	const spinner = p.spinner()
	spinner.start(`Creating ${email}…`)
	const grant = await v3.createAgentAccount({ email, appPassword, name: ctx.project.slug })
	spinner.stop(`${email} is live.`)

	ctx.project.grantId = grant.id
	ctx.project.inboxEmail = email
	const stored = storePendingSecret(ctx.project, 'appPassword', appPassword)
	warnIfLocalPendingSecret(stored, 'inbox password')
	saveProject(ctx.project)

	await showInboxPassword(email, appPassword)
	markStep(ctx.project, 'grant')
}

async function showInboxPassword(email: string, appPassword: string): Promise<void> {
	p.note(
		`Email:    ${email}\nPassword: ${appPassword}\n\nThis password is shown while setup is pending and cannot be recovered after deploy.\nSave it in your password manager now. You’ll use it to log into the mailbox app and IMAP/SMTP clients.`,
		'Your new inbox',
	)
	const saved = await p.confirm({
		message: 'I saved this inbox password somewhere safe.',
		initialValue: false,
	})
	if (p.isCancel(saved) || !saved) throw new CancelledError()
}

function warnIfLocalPendingSecret(result: PendingSecretStoreResult, label: string): void {
	if (result.storage === 'keyring') return
	p.log.warn(
		`Could not use the OS keyring for the ${label}. OwnMail saved a temporary pending copy in the permission-restricted local project file and will clear it after verification. If you abandon setup, run \`npx ownmail project cleanup\`.`,
	)
}

export class CancelledError extends Error {
	constructor() {
		super('Cancelled')
		this.name = 'CancelledError'
	}
}

import * as p from '@clack/prompts'
import {
	DashboardAccountClient,
	DpopKey,
	GatewayClient,
	NylasV3Client,
	type SsoLoginType,
} from '@nylas-labs/cli-kit'
import open from 'open'
import { markStep, saveProject } from '../state/store.js'
import { generateAppPassword, validateAppPassword } from '../util/password.js'
import { requireDashboard, requireGateway, requireV3, type StepContext, setAuth, tokens } from './context.js'

const APP_BRANDING_PREFIX = 'ownmail:'
const SANDBOX_GRANT_CAP = 5

/** 01 — Dashboard SSO device flow (login or register). */
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
		options: [
			{ value: 'google_SSO' as const, label: 'Google' },
			{ value: 'microsoft_SSO' as const, label: 'Microsoft' },
			{ value: 'github_SSO' as const, label: 'GitHub' },
		],
	})
	if (p.isCancel(loginType)) throw new CancelledError()

	const dpop = ctx.dpop ?? (await DpopKey.generate())
	const dashboard = new DashboardAccountClient(dpop)
	ctx.dpop = dpop
	ctx.dashboard = dashboard
	ctx.gateway = new GatewayClient(dpop)

	const spinner = p.spinner()
	const result = await dashboard.ssoAuthorize(
		{ loginType: loginType as SsoLoginType, mode },
		async (started) => {
			const url = started.verificationUriComplete ?? started.verificationUri
			p.note(
				`Your browser will open to finish signing in.\nIf it doesn’t, visit:\n\n  ${url}\n\nCode: ${started.userCode}`,
				'Confirm in browser',
			)
			await open(url).catch(() => {
				// Headless — the printed URL is the fallback.
			})
			spinner.start('Waiting for you to finish in the browser…')
		},
	)
	spinner.stop('Browser sign-in complete')

	if (result.status !== 'complete') {
		throw new Error(
			result.status === 'mfa_required'
				? 'This account requires MFA, which ownmail doesn’t support yet. Log in once at dashboard-v3.nylas.com and retry.'
				: `Sign-in did not complete (${result.status}). Please re-run ownmail.`,
		)
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
			setAuth(ctx, {
				...ctx.auth!,
				userToken: switched.userToken,
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
	const orgPublicId = ctx.project.orgPublicId!
	const brandName = `${APP_BRANDING_PREFIX}${ctx.project.slug}`

	const apps = await gateway.listApplications(tokens(ctx), ctx.project.region, orgPublicId)
	const existing = apps.find((a) => a.branding?.name === brandName)
	if (existing) {
		ctx.project.applicationId = existing.applicationId
	} else {
		const created = await gateway.createApplication(tokens(ctx), ctx.project.region, orgPublicId, {
			region: ctx.project.region,
			environment: 'sandbox',
			branding: { name: brandName, description: 'Created by npx ownmail' },
		})
		ctx.project.applicationId = created.applicationId
		ctx.project.pendingSecrets.clientSecret = created.clientSecret
	}
	saveProject(ctx.project)
	markStep(ctx.project, 'app')
}

/** 04 — Mint an API key (re-mint on resume is safe; old keys stay valid until revoked). */
export async function stepApiKey(ctx: StepContext): Promise<void> {
	if (ctx.project.pendingSecrets.apiKey) {
		ctx.v3 = new NylasV3Client(ctx.project.pendingSecrets.apiKey, ctx.project.region)
		markStep(ctx.project, 'api-key')
		return
	}
	const gateway = requireGateway(ctx)
	const created = await gateway.createApiKey(tokens(ctx), ctx.project.region, ctx.project.applicationId!, {
		name: `ownmail ${ctx.project.slug}`,
	})
	ctx.project.apiKeyId = created.id
	ctx.project.pendingSecrets.apiKey = created.apiKey
	ctx.v3 = new NylasV3Client(created.apiKey, ctx.project.region)
	saveProject(ctx.project)
	markStep(ctx.project, 'api-key')
}

/** 03b/05a — Ensure the application has a `nylas` connector (hosted auth requires it). */
export async function stepConnector(ctx: StepContext): Promise<void> {
	await requireV3(ctx).ensureConnector('nylas')
	markStep(ctx.project, 'connector')
}

/** 05 — Resolve or create the org's inbox domain. */
export async function stepDomain(ctx: StepContext): Promise<void> {
	if (ctx.project.domainAddress && ctx.project.domainVerified) {
		markStep(ctx.project, 'domain')
		return
	}
	const dashboard = requireDashboard(ctx)
	const region = ctx.project.region

	const domains = await dashboard.listInboxDomains(tokens(ctx), { limit: 100 })
	const branded = domains.find((d) => d.branded && d.region === region)
	if (branded) {
		adoptDomain(ctx, branded.id, branded.domainAddress, true, isFullyVerified(branded))
		p.log.info(`Using your organization’s existing domain: ${branded.domainAddress}`)
		markStep(ctx.project, 'domain')
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
		await createBrandedDomain(ctx, region)
	} else {
		await createCustomDomain(ctx, region)
	}
	markStep(ctx.project, 'domain')
}

async function createBrandedDomain(ctx: StepContext, region: 'us' | 'eu'): Promise<void> {
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
		const spinner = p.spinner()
		spinner.start(`Claiming ${domainAddress}…`)
		const created = await dashboard.createInboxDomain(tokens(ctx), {
			name: sub,
			domainAddress,
			region,
		})
		spinner.stop(`${domainAddress} is yours — mail routing is live.`)
		adoptDomain(ctx, created.id, created.domainAddress, true, true)
		return
	}
}

async function createCustomDomain(ctx: StepContext, region: 'us' | 'eu'): Promise<void> {
	const dashboard = requireDashboard(ctx)
	const domain = await p.text({
		message: 'Your domain (you must control its DNS)',
		placeholder: 'mail.your-company.com',
		validate: (v) =>
			/^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/.test(v ?? '')
				? undefined
				: 'Enter a domain like mail.your-company.com',
	})
	if (p.isCancel(domain)) throw new CancelledError()

	const created = await dashboard.createInboxDomain(tokens(ctx), {
		name: domain,
		domainAddress: domain,
		region,
	})
	adoptDomain(ctx, created.id, created.domainAddress, false, false)

	p.log.step('Publish these DNS records at your DNS provider:')
	const checks = ['ownership', 'mx', 'spf', 'dkim', 'feedback'] as const
	for (const type of checks) {
		try {
			const info = await dashboard.domainInfo(tokens(ctx), created.id, { region, type })
			const o = info.attempt?.options
			if (o?.host && o.type && o.value) {
				p.log.message(`  ${o.type.padEnd(6)} ${o.host}  →  ${o.value}`)
			}
		} catch {
			// Info for this check not available yet; verify loop below will surface it.
		}
	}

	const spinner = p.spinner()
	spinner.start('Waiting for DNS records (checking every 30s — Ctrl+C to pause; re-run ownmail to resume)…')
	const pending = new Set<string>(checks)
	const deadline = Date.now() + 30 * 60 * 1000
	while (pending.size > 0 && Date.now() < deadline) {
		for (const type of [...pending]) {
			try {
				const result = await dashboard.verifyDomain(tokens(ctx), created.id, { type }, region)
				if (/verified|success|ok/i.test(result.status)) pending.delete(type)
			} catch {
				// keep polling
			}
		}
		if (pending.size > 0) {
			spinner.message(`Waiting on: ${[...pending].join(', ')}`)
			await new Promise((r) => setTimeout(r, 30_000))
		}
	}
	if (pending.size > 0) {
		spinner.stop('DNS not fully verified yet.')
		throw new Error(
			`Still waiting on: ${[...pending].join(', ')}. DNS can take a while — re-run ownmail to resume from here.`,
		)
	}
	spinner.stop(`${domain} verified — mail routing is live.`)
	ctx.project.domainVerified = true
	saveProject(ctx.project)
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
		markStep(ctx.project, 'grant')
		return
	}
	const v3 = requireV3(ctx)
	const domain = ctx.project.domainAddress!

	const existing = await v3.listGrants({ limit: 50 })
	const nylasGrants = existing.data.filter((g) => g.provider === 'nylas')
	const onOurDomain = nylasGrants.find((g) => g.email?.endsWith(`@${domain}`))
	if (onOurDomain) {
		const reuse = await p.confirm({
			message: `Found an existing inbox ${onOurDomain.email} on this app — use it? (Its password stays whatever you set before.)`,
		})
		if (p.isCancel(reuse)) throw new CancelledError()
		if (reuse) {
			ctx.project.grantId = onOurDomain.id
			ctx.project.inboxEmail = onOurDomain.email!
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
		appPassword = generateAppPassword()
	} else {
		const typed = await p.password({
			message: 'Inbox password (18–40 chars, at least one uppercase, lowercase, and digit)',
			validate: (v) => validateAppPassword(v ?? ''),
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
	ctx.project.pendingSecrets.appPassword = appPassword
	saveProject(ctx.project)

	p.note(
		`Email:    ${email}\nPassword: ${appPassword}\n\nThis password is shown ONCE and cannot be recovered — save it now.\nYou’ll use it to log into your mailbox app (and IMAP/SMTP clients).`,
		'Your new inbox',
	)
	markStep(ctx.project, 'grant')
}

export class CancelledError extends Error {
	constructor() {
		super('Cancelled')
		this.name = 'CancelledError'
	}
}

import { z } from 'zod'

/**
 * Persistent CLI state. Two files under ~/.config/ownmail (0600):
 * - auth.json: dashboard session + DPoP private key
 * - projects/<slug>.json: one deployed project
 *
 * Durable secrets (API key, session secret) live only as Cloudflare Worker
 * secrets. `pendingSecrets` holds one-time plaintexts between minting and
 * `wrangler secret put`; it is scrubbed once the deploy step succeeds.
 */

export const AuthStateSchema = z.object({
	userToken: z.string(),
	orgToken: z.string().optional(),
	userPublicId: z.string().optional(),
	orgPublicId: z.string().optional(),
	dpopPrivateJwk: z.record(z.unknown()),
	updatedAt: z.number(),
})
export type AuthState = z.infer<typeof AuthStateSchema>

export const StepIdSchema = z.enum([
	'dashboard-auth',
	'org',
	'app',
	'connector',
	'api-key',
	'domain',
	'grant',
	'hosting',
	'cf-auth',
	'cf-resources',
	'redirect-uris',
	'deploy',
	'webhook',
	'verify',
])
export type StepId = z.infer<typeof StepIdSchema>

export const ProjectStateSchema = z.object({
	slug: z.string(),
	createdAt: z.number(),
	updatedAt: z.number(),

	region: z.enum(['us', 'eu']).default('us'),
	orgPublicId: z.string().optional(),
	hostingProvider: z.enum(['cloudflare', 'manual']).optional(),

	applicationId: z.string().optional(),
	apiKeyId: z.string().optional(),

	domainId: z.string().optional(),
	domainAddress: z.string().optional(),
	domainBranded: z.boolean().optional(),
	domainVerified: z.boolean().optional(),

	grantId: z.string().optional(),
	inboxEmail: z.string().optional(),

	workerName: z.string().optional(),
	workersDevUrl: z.string().optional(),
	manualDeployDir: z.string().optional(),
	manualAppUrl: z.string().url().optional(),
	kvNamespaceId: z.string().optional(),
	/** Custom domain serving the app itself (Cloudflare custom_domain route). */
	appDomain: z.string().optional(),

	templateVersion: z.string().optional(),
	ejected: z.boolean().default(false),

	completedSteps: z.array(StepIdSchema).default([]),

	/** One-time plaintexts awaiting `wrangler secret put`; scrubbed after deploy. */
	pendingSecrets: z
		.object({
			apiKey: z.string().optional(),
			clientSecret: z.string().optional(),
			appPassword: z.string().optional(),
		})
		.default({}),
})
export type ProjectState = z.infer<typeof ProjectStateSchema>

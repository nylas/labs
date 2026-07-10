import { z } from 'zod'

/**
 * Persistent CLI state. Two files under ~/.config/ownmail (0600):
 * - auth.json: dashboard session + DPoP private key
 * - projects/<slug>.json: one deployed project
 *
 * Durable secrets (API key, session secret) live only as Cloudflare Worker
 * secrets. `pendingSecrets` tracks one-time setup secrets between minting and
 * deploy. New writes use the OS credential store when available; legacy or
 * fallback string values are scrubbed once setup verification succeeds.
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
	'domain-plan',
	'plan-confirmed',
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

export const PendingSecretReferenceSchema = z.object({
	storage: z.literal('keyring'),
	service: z.string().min(1),
	account: z.string().min(1),
})
export type PendingSecretReference = z.infer<typeof PendingSecretReferenceSchema>

export const PendingSecretValueSchema = z.union([z.string(), PendingSecretReferenceSchema])
export type PendingSecretValue = z.infer<typeof PendingSecretValueSchema>

export const PendingSecretNameSchema = z.enum(['apiKey', 'clientSecret', 'appPassword'])
export type PendingSecretName = z.infer<typeof PendingSecretNameSchema>

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
	plannedDomainAddress: z.string().optional(),
	plannedDomainBranded: z.boolean().optional(),

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

	/** One-time setup secrets, preferably by OS keyring reference; scrubbed after verification. */
	pendingSecrets: z
		.object({
			apiKey: PendingSecretValueSchema.optional(),
			clientSecret: PendingSecretValueSchema.optional(),
			appPassword: PendingSecretValueSchema.optional(),
		})
		.default({}),
})
export type ProjectState = z.infer<typeof ProjectStateSchema>

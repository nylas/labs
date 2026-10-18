import type { GrantScopedClient } from '@nylas-labs/cli-kit/v3'

/**
 * A mailbox client: the provider's, or the local mock app's stand-in, which
 * answers every call the app makes through a request's mailbox.
 */
export type MailboxClient = Omit<
	Pick<GrantScopedClient, keyof GrantScopedClient>,
	'attachmentDownloadUrl' | 'deleteMessage' | 'getEvent'
>

/** The local mock app (`pnpm dev:ui`): a mailbox seeded with the design boards' mail, and who owns it. */
export type DevMocks = {
	createDevMailbox(): MailboxClient
	devMailboxEmail(email?: string): string
	devMailboxName(email?: string): string | undefined
}

/**
 * The mock mailbox is repository-only. Deployed builds and the packed
 * template carry none, so this answers null and mock mode stays off.
 * `vite.config.local.ts` (the mock app, and the Node build its SSR smoke test
 * serves) resolves `./dev-mailbox.js` to `dev-mocks.ts`, which exports the
 * real one under the same name.
 */
export const devMocks: DevMocks | null = null

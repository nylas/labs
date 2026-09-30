/**
 * Strongly consistent expiring-key operations for invitation claims on
 * Cloudflare. Cloudflare KV is eventually consistent and has no compare-and-set,
 * so each claim key is owned by one Durable Object instance (addressed by name)
 * whose storage calls are serialized. This module holds the storage logic so it
 * can be tested without the Workers runtime; `src/worker.ts` binds it to a
 * Durable Object class.
 */

const MAX_TTL_SECONDS = 24 * 60 * 60
const MAX_REVISION = 2_147_483_647
const ENTRY_KEY = 'entry'

type Entry = { value: string; expiresAt: number }

export type InvitationLockStorage = {
	get<T>(key: string): Promise<T | undefined>
	put<T>(key: string, value: T): Promise<void>
	delete(key: string): Promise<boolean>
	setAlarm(scheduledTime: number): Promise<void>
}

export class InvitationLockState {
	constructor(
		private readonly storage: InvitationLockStorage,
		private readonly now: () => number = Date.now,
	) {}

	async read(): Promise<string | null> {
		return (await this.current())?.value ?? null
	}

	async putIfAbsent(value: string, expirationTtl: number): Promise<boolean> {
		requireTtl(expirationTtl)
		if (typeof value !== 'string' || value.length === 0) throw new Error('Invalid lock value')
		if (await this.current()) return false
		await this.write(value, expirationTtl)
		return true
	}

	async claimRevision(revision: number, expirationTtl: number): Promise<boolean> {
		requireTtl(expirationTtl)
		if (!Number.isSafeInteger(revision) || revision < 0 || revision > MAX_REVISION) {
			throw new Error('Invalid lock revision')
		}
		const current = await this.current()
		if (current && Number(current.value) >= revision) return false
		await this.write(String(revision), expirationTtl)
		return true
	}

	async deleteIfValue(value: string): Promise<void> {
		if ((await this.current())?.value === value) await this.storage.delete(ENTRY_KEY)
	}

	/** Alarm handler: drops the entry once expired so idle locks leave no storage behind. */
	async expire(): Promise<void> {
		const entry = await this.storage.get<Entry>(ENTRY_KEY)
		if (!entry) return
		if (entry.expiresAt <= this.now()) await this.storage.delete(ENTRY_KEY)
		else await this.storage.setAlarm(entry.expiresAt)
	}

	private async current(): Promise<Entry | undefined> {
		const entry = await this.storage.get<Entry>(ENTRY_KEY)
		return entry && entry.expiresAt > this.now() ? entry : undefined
	}

	private async write(value: string, expirationTtl: number): Promise<void> {
		const expiresAt = this.now() + expirationTtl * 1_000
		await this.storage.put<Entry>(ENTRY_KEY, { value, expiresAt })
		await this.storage.setAlarm(expiresAt)
	}
}

function requireTtl(expirationTtl: number): void {
	if (!Number.isSafeInteger(expirationTtl) || expirationTtl < 1 || expirationTtl > MAX_TTL_SECONDS) {
		throw new Error('Invalid lock expiration')
	}
}

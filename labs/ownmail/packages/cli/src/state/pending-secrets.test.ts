import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProjectState } from './schema.js'

const hoisted = vi.hoisted(() => {
	const passwords = new Map<string, string>()
	const failingSet = new Set<string>()
	const failingGet = new Set<string>()
	const failingDelete = new Set<string>()
	class FakeEntry {
		constructor(
			private service: string,
			private account: string,
		) {}

		setPassword(value: string): void {
			const key = `${this.service}:${this.account}`
			if (failingSet.has(key)) throw new Error('set failed')
			passwords.set(key, value)
		}

		getPassword(): string | null {
			const key = `${this.service}:${this.account}`
			if (failingGet.has(key)) throw new Error('get failed')
			return passwords.get(key) ?? null
		}

		deletePassword(): void {
			const key = `${this.service}:${this.account}`
			if (failingDelete.has(key)) throw new Error('delete failed')
			passwords.delete(key)
		}
	}
	return { FakeEntry, passwords, failingSet, failingGet, failingDelete }
})

vi.mock('@napi-rs/keyring', () => ({ Entry: hoisted.FakeEntry }))

import {
	clearPendingSecret,
	clearPendingSecrets,
	hasPendingSecret,
	pendingSecretLabels,
	readPendingSecret,
	storePendingSecret,
} from './pending-secrets.js'

function project(overrides: Partial<ProjectState> = {}): ProjectState {
	return {
		slug: 'inbox',
		createdAt: 123,
		updatedAt: 123,
		region: 'us',
		ejected: false,
		completedSteps: [],
		pendingSecrets: {},
		...overrides,
	}
}

function key(account: string): string {
	return `ownmail:${account}`
}

beforeEach(() => {
	hoisted.passwords.clear()
	hoisted.failingSet.clear()
	hoisted.failingGet.clear()
	hoisted.failingDelete.clear()
	delete process.env.OWNMAIL_NYLAS_ENV
})

describe('pending setup secrets', () => {
	it('stores new secrets in the OS keyring by reference', () => {
		const state = project()
		const result = storePendingSecret(state, 'apiKey', 'nyk_secret')

		expect(result).toEqual({ storage: 'keyring' })
		expect(state.pendingSecrets.apiKey).toEqual({
			storage: 'keyring',
			service: 'ownmail',
			account: 'inbox:123:apiKey',
		})
		expect(JSON.stringify(state.pendingSecrets)).not.toContain('nyk_secret')
		expect(hoisted.passwords.get(key('inbox:123:apiKey'))).toBe('nyk_secret')
		expect(readPendingSecret(state, 'apiKey')).toBe('nyk_secret')
		expect(hasPendingSecret(state, 'apiKey')).toBe(true)
		expect(hasPendingSecret(state, 'appPassword')).toBe(false)
		expect(pendingSecretLabels(state)).toEqual(['Nylas API key (OS keyring)'])
	})

	it('falls back to the local project file when the keyring is unavailable', () => {
		const state = project()
		hoisted.failingSet.add(key('inbox:123:appPassword'))

		const result = storePendingSecret(state, 'appPassword', 'Sup3rSecret!!x')

		expect(result).toEqual({ storage: 'local' })
		expect(state.pendingSecrets.appPassword).toBe('Sup3rSecret!!x')
		expect(readPendingSecret(state, 'appPassword')).toBe('Sup3rSecret!!x')
		expect(pendingSecretLabels(state)).toEqual([
			'Inbox password awaiting final verification (local project file)',
		])
	})

	it('fails closed instead of writing durable local runtime secrets to project state', () => {
		hoisted.failingSet.add(key('inbox:123:sessionSecret'))
		const state = project()
		expect(() =>
			storePendingSecret(state, 'sessionSecret', 'session-secret', { allowLocalFallback: false }),
		).toThrow(/credential store required for local hosting/)
		expect(state.pendingSecrets.sessionSecret).toBeUndefined()
	})

	it('labels a keyring-backed local session secret', () => {
		const state = project()
		storePendingSecret(state, 'sessionSecret', 'session-secret', { allowLocalFallback: false })
		expect(pendingSecretLabels(state)).toEqual(['Local app session secret (OS keyring)'])
	})

	it('returns null when a keyring reference cannot be read', () => {
		const state = project()
		storePendingSecret(state, 'apiKey', 'nyk_secret')
		hoisted.failingGet.add(key('inbox:123:apiKey'))

		expect(readPendingSecret(state, 'apiKey')).toBeNull()
	})

	it('returns null when a keyring reference has no password value', () => {
		const state = project({
			pendingSecrets: {
				apiKey: { storage: 'keyring', service: 'ownmail', account: 'inbox:123:apiKey' },
			},
		})

		expect(readPendingSecret(state, 'apiKey')).toBeNull()
	})

	it('clears keyring and legacy local pending secrets', () => {
		const state = project({
			pendingSecrets: {
				clientSecret: 'legacy-client-secret',
			},
		})
		storePendingSecret(state, 'apiKey', 'nyk_secret')
		storePendingSecret(state, 'appPassword', 'Sup3rSecret!!x')

		expect(pendingSecretLabels(state)).toEqual([
			'Nylas API key (OS keyring)',
			'Legacy Nylas application client secret (local project file)',
			'Inbox password awaiting final verification (OS keyring)',
		])

		clearPendingSecrets(state)

		expect(state.pendingSecrets).toEqual({})
		expect(hoisted.passwords.has(key('inbox:123:apiKey'))).toBe(false)
		expect(hoisted.passwords.has(key('inbox:123:appPassword'))).toBe(false)
	})

	it('clears unusable keyring references from state even when delete fails', () => {
		const state = project()
		storePendingSecret(state, 'apiKey', 'nyk_secret')
		hoisted.failingDelete.add(key('inbox:123:apiKey'))

		clearPendingSecret(state, 'apiKey')

		expect(state.pendingSecrets.apiKey).toBeUndefined()
		expect(hoisted.passwords.get(key('inbox:123:apiKey'))).toBe('nyk_secret')
	})
})

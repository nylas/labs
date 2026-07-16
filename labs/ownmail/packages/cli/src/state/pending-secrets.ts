import { Entry } from '@napi-rs/keyring'
import { ownmailStateName } from '../nylas-env.js'
import type { PendingSecretName, PendingSecretReference, PendingSecretValue, ProjectState } from './schema.js'

export const PENDING_SECRET_NAMES: readonly PendingSecretName[] = [
	'apiKey',
	'clientSecret',
	'appPassword',
	'sessionSecret',
]

export type PendingSecretStorage = 'keyring' | 'local'

export type PendingSecretStoreResult = {
	storage: PendingSecretStorage
}

export function storePendingSecret(
	project: ProjectState,
	name: PendingSecretName,
	value: string,
	opts: { allowLocalFallback?: boolean } = {},
): PendingSecretStoreResult {
	const ref = keyringReference(project, name)
	try {
		entry(ref).setPassword(value)
		project.pendingSecrets[name] = ref
		return { storage: 'keyring' }
	} catch {
		if (opts.allowLocalFallback === false) {
			throw new Error(
				'OwnMail could not access the OS credential store required for local hosting. Unlock or enable the credential store, then retry; no additional runtime secret was written to disk.',
			)
		}
		project.pendingSecrets[name] = value
		return { storage: 'local' }
	}
}

export function readPendingSecret(project: ProjectState, name: PendingSecretName): string | null {
	const secret = project.pendingSecrets[name]
	if (!secret) return null
	if (typeof secret === 'string') return secret
	try {
		return entry(secret).getPassword() ?? null
	} catch {
		return null
	}
}

export function clearPendingSecret(project: ProjectState, name: PendingSecretName): void {
	const secret = project.pendingSecrets[name]
	if (secret && typeof secret !== 'string') {
		try {
			entry(secret).deletePassword()
		} catch {
			// Missing or locked keyring entries are already unusable; clear the local reference.
		}
	}
	delete project.pendingSecrets[name]
}

export function clearPendingSecrets(project: ProjectState): void {
	for (const name of PENDING_SECRET_NAMES) clearPendingSecret(project, name)
}

export function pendingSecretLabels(project: ProjectState): string[] {
	const labels: string[] = []
	for (const name of PENDING_SECRET_NAMES) {
		const secret = project.pendingSecrets[name]
		if (!secret) continue
		labels.push(`${pendingSecretLabel(name)} (${storageLabel(secret)})`)
	}
	return labels
}

export function hasPendingSecret(project: ProjectState, name: PendingSecretName): boolean {
	return Boolean(project.pendingSecrets[name])
}

function keyringReference(project: ProjectState, name: PendingSecretName): PendingSecretReference {
	return {
		storage: 'keyring',
		service: ownmailStateName(),
		account: `${project.slug}:${project.createdAt}:${name}`,
	}
}

function entry(ref: PendingSecretReference): Entry {
	return new Entry(ref.service, ref.account)
}

function storageLabel(secret: PendingSecretValue): string {
	return typeof secret === 'string' ? 'local project file' : 'OS keyring'
}

function pendingSecretLabel(name: PendingSecretName): string {
	switch (name) {
		case 'apiKey':
			return 'Nylas API key awaiting deploy'
		case 'clientSecret':
			return 'Legacy Nylas application client secret'
		case 'appPassword':
			return 'Inbox password awaiting final verification'
		case 'sessionSecret':
			return 'Local app session secret'
	}
}

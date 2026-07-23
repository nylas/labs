import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { configDir } from './store.js'

type LockOwner = { pid: number; startedAt: number }

export function acquireProjectLock(slug: string): () => void {
	if (!/^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])?$/.test(slug)) {
		throw new Error('Project name is invalid; refusing to create a project lock.')
	}
	const parent = join(configDir(), 'locks')
	const path = join(parent, `${slug}.lock`)
	mkdirSync(parent, { recursive: true, mode: 0o700 })
	try {
		mkdirSync(path, { mode: 0o700 })
	} catch (err) {
		if ((err as { code?: unknown })?.code !== 'EEXIST') {
			throw new Error(`OwnMail could not create a safe operation lock for "${slug}".`)
		}
		if (!removeDeadOwner(path)) {
			throw new Error(
				`Another OwnMail command is already changing "${slug}". Wait for it to finish, then retry.`,
			)
		}
		try {
			mkdirSync(path, { mode: 0o700 })
		} catch {
			throw new Error(
				`Another OwnMail command started changing "${slug}". Wait for it to finish, then retry.`,
			)
		}
	}
	try {
		writeFileSync(
			join(path, 'owner.json'),
			`${JSON.stringify({ pid: process.pid, startedAt: Date.now() } satisfies LockOwner)}\n`,
			{ mode: 0o600, flag: 'wx' },
		)
	} catch (err) {
		rmSync(path, { recursive: true, force: true })
		throw err
	}
	let released = false
	return () => {
		if (released) return
		released = true
		rmSync(path, { recursive: true, force: true })
	}
}

function removeDeadOwner(path: string): boolean {
	let owner: unknown
	try {
		owner = JSON.parse(readFileSync(join(path, 'owner.json'), 'utf8')) as unknown
	} catch {
		return false
	}
	if (
		typeof owner !== 'object' ||
		owner === null ||
		!('pid' in owner) ||
		typeof owner.pid !== 'number' ||
		!Number.isSafeInteger(owner.pid) ||
		owner.pid < 1 ||
		!('startedAt' in owner) ||
		typeof owner.startedAt !== 'number' ||
		!Number.isSafeInteger(owner.startedAt) ||
		owner.startedAt < 1
	) {
		return false
	}
	try {
		process.kill(owner.pid, 0)
		return false
	} catch (err) {
		if ((err as { code?: unknown })?.code !== 'ESRCH') return false
	}
	rmSync(path, { recursive: true, force: true })
	return true
}

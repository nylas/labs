import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import envPaths from 'env-paths'
import { ownmailStateName } from '../nylas-env.js'
import {
	type AuthState,
	AuthStateSchema,
	ProjectSlugSchema,
	type ProjectState,
	ProjectStateSchema,
} from './schema.js'

const paths = envPaths(ownmailStateName(), { suffix: '' })
const RESERVED_PROJECT_SLUGS = new Set(['__login__'])

export function configDir(): string {
	return paths.config
}

function projectsDir(): string {
	return join(configDir(), 'projects')
}

function readJson<T>(path: string): T | null {
	try {
		return JSON.parse(readFileSync(path, 'utf8')) as T
	} catch {
		return null
	}
}

function writeJson(path: string, value: unknown): void {
	mkdirSync(join(path, '..'), { recursive: true, mode: 0o700 })
	writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
}

// ---- Auth -------------------------------------------------------------------

const authPath = () => join(configDir(), 'auth.json')

export function loadAuth(): AuthState | null {
	const raw = readJson<unknown>(authPath())
	if (!raw) return null
	const parsed = AuthStateSchema.safeParse(raw)
	return parsed.success ? parsed.data : null
}

export function saveAuth(state: AuthState): void {
	writeJson(authPath(), state)
}

export function clearAuth(): void {
	try {
		unlinkSync(authPath())
	} catch {
		// already gone
	}
}

// ---- Projects ----------------------------------------------------------------

export function listProjects(): ProjectState[] {
	let files: string[]
	try {
		files = readdirSync(projectsDir()).filter((f) => f.endsWith('.json'))
	} catch {
		return []
	}
	const projects: ProjectState[] = []
	for (const file of files) {
		const raw = readJson<unknown>(join(projectsDir(), file))
		const parsed = ProjectStateSchema.safeParse(raw)
		if (parsed.success && !isReservedProjectSlug(parsed.data.slug)) projects.push(parsed.data)
	}
	return projects
}

export type ProjectStateIssue = { file: string; reason: 'invalid-json' | 'invalid-schema' }

export function listProjectStateIssues(slug?: string): ProjectStateIssue[] {
	if (slug && !isUserProjectSlug(slug)) return []
	const dir = projectsDir()
	const files = slug
		? [`${slug}.json`]
		: projectStateFiles(dir).filter((file) => !isReservedProjectFile(file))
	const issues: ProjectStateIssue[] = []
	for (const file of files) {
		const path = join(dir, file)
		if (slug && !existsSync(path)) continue
		let raw: unknown
		try {
			raw = JSON.parse(readFileSync(path, 'utf8')) as unknown
		} catch {
			issues.push({ file, reason: 'invalid-json' })
			continue
		}
		if (!ProjectStateSchema.safeParse(raw).success) {
			issues.push({ file, reason: 'invalid-schema' })
		}
	}
	return issues
}

export function loadProject(slug: string): ProjectState | null {
	if (!isUserProjectSlug(slug)) return null
	const raw = readJson<unknown>(join(projectsDir(), `${slug}.json`))
	if (!raw) return null
	const parsed = ProjectStateSchema.safeParse(raw)
	return parsed.success ? parsed.data : null
}

export function deleteProject(slug: string): boolean {
	if (!isUserProjectSlug(slug)) return false
	try {
		unlinkSync(join(projectsDir(), `${slug}.json`))
		return true
	} catch (err) {
		if ((err as { code?: unknown })?.code === 'ENOENT') return false
		throw err
	}
}

export function saveProject(state: ProjectState): void {
	if (!isUserProjectSlug(state.slug)) return
	state.updatedAt = Date.now()
	writeJson(join(projectsDir(), `${state.slug}.json`), state)
}

export function newProject(slug: string, region: 'us' | 'eu'): ProjectState {
	if (!isSafeProjectSlug(slug)) {
		throw new Error('Project names must use 3-40 lowercase letters, digits, and hyphens.')
	}
	return ProjectStateSchema.parse({
		slug,
		region,
		createdAt: Date.now(),
		updatedAt: Date.now(),
	})
}

export function markStep(state: ProjectState, step: ProjectState['completedSteps'][number]): void {
	if (!state.completedSteps.includes(step)) state.completedSteps.push(step)
	saveProject(state)
}

export function hasStep(state: ProjectState, step: ProjectState['completedSteps'][number]): boolean {
	return state.completedSteps.includes(step)
}

function projectStateFiles(dir: string): string[] {
	try {
		return readdirSync(dir).filter((f) => f.endsWith('.json'))
	} catch {
		return []
	}
}

function isReservedProjectFile(file: string): boolean {
	return file.endsWith('.json') && isReservedProjectSlug(file.slice(0, -'.json'.length))
}

function isReservedProjectSlug(slug: string): boolean {
	return RESERVED_PROJECT_SLUGS.has(slug)
}

function isSafeProjectSlug(slug: string): boolean {
	return ProjectSlugSchema.safeParse(slug).success
}

function isUserProjectSlug(slug: string): boolean {
	return isSafeProjectSlug(slug) && !isReservedProjectSlug(slug)
}

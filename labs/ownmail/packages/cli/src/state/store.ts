import { mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import envPaths from 'env-paths'
import { type AuthState, AuthStateSchema, type ProjectState, ProjectStateSchema } from './schema.js'

const paths = envPaths('ownmail', { suffix: '' })

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
		if (parsed.success) projects.push(parsed.data)
	}
	return projects
}

export function loadProject(slug: string): ProjectState | null {
	const raw = readJson<unknown>(join(projectsDir(), `${slug}.json`))
	if (!raw) return null
	const parsed = ProjectStateSchema.safeParse(raw)
	return parsed.success ? parsed.data : null
}

export function saveProject(state: ProjectState): void {
	state.updatedAt = Date.now()
	writeJson(join(projectsDir(), `${state.slug}.json`), state)
}

export function newProject(slug: string, region: 'us' | 'eu'): ProjectState {
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

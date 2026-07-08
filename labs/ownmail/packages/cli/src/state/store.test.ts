import { mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthState, ProjectState } from './schema.js'

vi.mock('env-paths', () => ({
	default: () => ({
		config: '/virtual/config',
		data: '/virtual/data',
		cache: '/virtual/cache',
		log: '/virtual/log',
		temp: '/virtual/temp',
	}),
}))

vi.mock('node:fs', () => ({
	readFileSync: vi.fn(),
	writeFileSync: vi.fn(),
	mkdirSync: vi.fn(),
	readdirSync: vi.fn(),
	unlinkSync: vi.fn(),
}))

import {
	clearAuth,
	configDir,
	hasStep,
	listProjects,
	loadAuth,
	loadProject,
	markStep,
	newProject,
	saveAuth,
	saveProject,
} from './store.js'

const mockRead = vi.mocked(readFileSync)
const mockWrite = vi.mocked(writeFileSync)
const mockMkdir = vi.mocked(mkdirSync)
const mockReaddir = vi.mocked(readdirSync)
const mockUnlink = vi.mocked(unlinkSync)

const validAuth: AuthState = {
	userToken: 'tok',
	dpopPrivateJwk: { kty: 'EC' },
	updatedAt: 1,
}

function validProject(slug = 'inbox'): ProjectState {
	return {
		slug,
		createdAt: 1,
		updatedAt: 1,
		region: 'us',
		ejected: false,
		completedSteps: [],
		pendingSecrets: {},
	}
}

beforeEach(() => {
	vi.clearAllMocks()
})

afterEach(() => {
	vi.restoreAllMocks()
})

describe('configDir', () => {
	it('exposes the env-paths config directory', () => {
		expect(configDir()).toBe('/virtual/config')
	})
})

describe('loadAuth', () => {
	it('returns parsed auth when the file holds a valid state', () => {
		mockRead.mockReturnValue(JSON.stringify(validAuth))
		expect(loadAuth()).toEqual(validAuth)
		expect(mockRead).toHaveBeenCalledWith('/virtual/config/auth.json', 'utf8')
	})

	it('returns null when the file is missing (read throws)', () => {
		mockRead.mockImplementation(() => {
			throw new Error('ENOENT')
		})
		expect(loadAuth()).toBeNull()
	})

	it('returns null when the file holds an invalid state', () => {
		mockRead.mockReturnValue(JSON.stringify({ userToken: 123 }))
		expect(loadAuth()).toBeNull()
	})
})

describe('saveAuth', () => {
	it('writes auth.json with a private mode after ensuring the directory', () => {
		saveAuth(validAuth)
		expect(mockMkdir).toHaveBeenCalledWith('/virtual/config', { recursive: true, mode: 0o700 })
		expect(mockWrite).toHaveBeenCalledWith(
			'/virtual/config/auth.json',
			`${JSON.stringify(validAuth, null, 2)}\n`,
			{ mode: 0o600 },
		)
	})
})

describe('clearAuth', () => {
	it('unlinks the auth file', () => {
		clearAuth()
		expect(mockUnlink).toHaveBeenCalledWith('/virtual/config/auth.json')
	})

	it('swallows the error when the file is already gone', () => {
		mockUnlink.mockImplementation(() => {
			throw new Error('ENOENT')
		})
		expect(() => clearAuth()).not.toThrow()
	})
})

describe('listProjects', () => {
	it('returns [] when the projects directory does not exist', () => {
		mockReaddir.mockImplementation(() => {
			throw new Error('ENOENT')
		})
		expect(listProjects()).toEqual([])
	})

	it('parses only valid .json files and skips others', () => {
		mockReaddir.mockReturnValue(['a.json', 'b.json', 'notes.txt'] as never)
		mockRead.mockImplementation((path) => {
			if (String(path).endsWith('a.json')) return JSON.stringify(validProject('a'))
			// b.json is invalid and must be dropped
			return JSON.stringify({ slug: 42 })
		})
		const projects = listProjects()
		expect(projects).toHaveLength(1)
		expect(projects[0]?.slug).toBe('a')
	})
})

describe('loadProject', () => {
	it('returns null when the file is missing', () => {
		mockRead.mockImplementation(() => {
			throw new Error('ENOENT')
		})
		expect(loadProject('inbox')).toBeNull()
	})

	it('returns null when the stored project is invalid', () => {
		mockRead.mockReturnValue(JSON.stringify({ slug: 42 }))
		expect(loadProject('inbox')).toBeNull()
	})

	it('returns the parsed project on success', () => {
		mockRead.mockReturnValue(JSON.stringify(validProject('inbox')))
		expect(loadProject('inbox')?.slug).toBe('inbox')
		expect(mockRead).toHaveBeenCalledWith('/virtual/config/projects/inbox.json', 'utf8')
	})
})

describe('saveProject', () => {
	it('bumps updatedAt and writes to the slug-named file', () => {
		const project = validProject('inbox')
		const before = Date.now()
		saveProject(project)
		expect(project.updatedAt).toBeGreaterThanOrEqual(before)
		expect(mockWrite).toHaveBeenCalledWith('/virtual/config/projects/inbox.json', expect.any(String), {
			mode: 0o600,
		})
	})
})

describe('newProject', () => {
	it('builds a project with defaults and the requested region', () => {
		const project = newProject('inbox', 'eu')
		expect(project.slug).toBe('inbox')
		expect(project.region).toBe('eu')
		expect(project.completedSteps).toEqual([])
		expect(project.ejected).toBe(false)
	})
})

describe('markStep / hasStep', () => {
	it('records a step once and persists it', () => {
		const project = validProject('inbox')
		markStep(project, 'deploy')
		expect(project.completedSteps).toEqual(['deploy'])
		expect(hasStep(project, 'deploy')).toBe(true)
		// Marking again does not duplicate.
		markStep(project, 'deploy')
		expect(project.completedSteps).toEqual(['deploy'])
		expect(mockWrite).toHaveBeenCalledTimes(2)
	})

	it('reports false for steps that have not run', () => {
		expect(hasStep(validProject('inbox'), 'verify')).toBe(false)
	})
})

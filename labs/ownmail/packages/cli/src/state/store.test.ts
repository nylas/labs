import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	renameSync,
	unlinkSync,
	writeFileSync,
} from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
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
	existsSync: vi.fn(),
	readFileSync: vi.fn(),
	writeFileSync: vi.fn(),
	mkdirSync: vi.fn(),
	readdirSync: vi.fn(),
	renameSync: vi.fn(),
	unlinkSync: vi.fn(),
}))

import {
	clearAuth,
	configDir,
	deleteProject,
	hasStep,
	listProjectStateIssues,
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
const mockRename = vi.mocked(renameSync)
const mockUnlink = vi.mocked(unlinkSync)
const mockExists = vi.mocked(existsSync)

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
	vi.resetAllMocks()
	mockExists.mockReturnValue(true)
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
			expect.stringMatching(/^\/virtual\/config\/auth\.json\..+\.tmp$/),
			`${JSON.stringify(validAuth, null, 2)}\n`,
			{ mode: 0o600, flag: 'wx' },
		)
		expect(mockRename).toHaveBeenCalledWith(
			expect.stringMatching(/^\/virtual\/config\/auth\.json\..+\.tmp$/),
			'/virtual/config/auth.json',
		)
	})

	it('removes a temporary file when an atomic state write fails', () => {
		mockWrite.mockImplementationOnce(() => {
			throw new Error('disk full')
		})

		expect(() => saveAuth(validAuth)).toThrow(/disk full/)
		expect(mockUnlink).toHaveBeenCalledWith(expect.stringMatching(/^\/virtual\/config\/auth\.json\..+\.tmp$/))
	})

	it('preserves the write failure if temporary-file cleanup also fails', () => {
		mockWrite.mockImplementationOnce(() => {
			throw new Error('disk full')
		})
		mockUnlink.mockImplementationOnce(() => {
			throw new Error('cleanup failed')
		})

		expect(() => saveAuth(validAuth)).toThrow(/disk full/)
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

	it('hides reserved internal project slugs from project listings', () => {
		mockReaddir.mockReturnValue(['__login__.json', 'a.json'] as never)
		mockRead.mockImplementation((path) =>
			String(path).endsWith('__login__.json')
				? JSON.stringify(validProject('__login__'))
				: JSON.stringify(validProject('a')),
		)

		expect(listProjects().map((project) => project.slug)).toEqual(['a'])
	})
})

describe('listProjectStateIssues', () => {
	it('returns [] when the projects directory does not exist', () => {
		mockReaddir.mockImplementation(() => {
			throw new Error('ENOENT')
		})
		expect(listProjectStateIssues()).toEqual([])
	})

	it('reports invalid JSON and invalid schema files', () => {
		mockReaddir.mockReturnValue(['bad-json.json', 'bad-schema.json', 'valid.json'] as never)
		mockRead.mockImplementation((path) => {
			if (String(path).endsWith('bad-json.json')) return '{'
			if (String(path).endsWith('bad-schema.json')) return JSON.stringify({ slug: 42 })
			return JSON.stringify(validProject('valid'))
		})
		expect(listProjectStateIssues()).toEqual([
			{ file: 'bad-json.json', reason: 'invalid-json' },
			{ file: 'bad-schema.json', reason: 'invalid-schema' },
		])
	})

	it('ignores reserved internal project files when reporting state issues', () => {
		mockReaddir.mockReturnValue(['__login__.json', 'bad-json.json'] as never)
		mockRead.mockImplementation((path) => {
			if (String(path).endsWith('__login__.json')) return '{'
			return '{'
		})

		expect(listProjectStateIssues()).toEqual([{ file: 'bad-json.json', reason: 'invalid-json' }])
		expect(listProjectStateIssues('__login__')).toEqual([])
	})

	it('checks a named project and ignores it when the file is absent', () => {
		mockExists.mockReturnValueOnce(false)
		expect(listProjectStateIssues('missing')).toEqual([])

		mockExists.mockReturnValueOnce(true)
		mockRead.mockReturnValueOnce(JSON.stringify({ slug: 42 }))
		expect(listProjectStateIssues('broken')).toEqual([{ file: 'broken.json', reason: 'invalid-schema' }])
	})

	it('does not inspect a path-shaped project name', () => {
		expect(listProjectStateIssues('../auth')).toEqual([])
		expect(mockExists).not.toHaveBeenCalled()
		expect(mockRead).not.toHaveBeenCalled()
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

	it('does not load reserved internal project slugs', () => {
		expect(loadProject('__login__')).toBeNull()
		expect(mockRead).not.toHaveBeenCalled()
	})

	it('does not load path-shaped project names', () => {
		expect(loadProject('../auth')).toBeNull()
		expect(mockRead).not.toHaveBeenCalled()
	})
})

describe('deleteProject', () => {
	it('unlinks the slug-named project file', () => {
		expect(deleteProject('inbox')).toBe(true)
		expect(mockUnlink).toHaveBeenCalledWith('/virtual/config/projects/inbox.json')
	})

	it('returns false when the project file is already gone', () => {
		mockUnlink.mockImplementation(() => {
			const err = new Error('missing') as Error & { code: string }
			err.code = 'ENOENT'
			throw err
		})
		expect(deleteProject('missing')).toBe(false)
	})

	it('rethrows filesystem errors other than ENOENT', () => {
		mockUnlink.mockImplementation(() => {
			const err = new Error('permission denied') as Error & { code: string }
			err.code = 'EACCES'
			throw err
		})
		expect(() => deleteProject('inbox')).toThrow('permission denied')
	})

	it('does not unlink path-shaped project names', () => {
		expect(deleteProject('../auth')).toBe(false)
		expect(mockUnlink).not.toHaveBeenCalled()
	})
})

describe('saveProject', () => {
	it('bumps updatedAt and writes to the slug-named file', () => {
		const project = validProject('inbox')
		const before = Date.now()
		saveProject(project)
		expect(project.updatedAt).toBeGreaterThanOrEqual(before)
		expect(mockWrite).toHaveBeenCalledWith(
			expect.stringMatching(/^\/virtual\/config\/projects\/inbox\.json\..+\.tmp$/),
			expect.any(String),
			{ mode: 0o600, flag: 'wx' },
		)
		expect(mockRename).toHaveBeenCalledWith(
			expect.stringMatching(/^\/virtual\/config\/projects\/inbox\.json\..+\.tmp$/),
			'/virtual/config/projects/inbox.json',
		)
	})

	it('does not persist reserved internal project slugs', () => {
		const project = validProject('__login__')

		saveProject(project)

		expect(mockWrite).not.toHaveBeenCalled()
	})

	it('does not persist path-shaped project names', () => {
		saveProject(validProject('../auth'))

		expect(mockWrite).not.toHaveBeenCalled()
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

	it('rejects path-shaped project names', () => {
		expect(() => newProject('../auth', 'us')).toThrow('Project names must use')
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

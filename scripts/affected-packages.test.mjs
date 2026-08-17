import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { computeAffectedPackages, isGlobalTestInput } from './affected-packages.mjs'

const packages = [
	{
		name: '@nylas-labs/cli-kit',
		directory: 'shared/nylas-cli-kit',
		hasTestScript: true,
		workspaceDependencies: new Set(),
	},
	{
		name: '@ownmail/app',
		directory: 'labs/ownmail/packages/app',
		hasTestScript: true,
		workspaceDependencies: new Set(['@nylas-labs/cli-kit']),
	},
	{
		name: 'ownmail',
		directory: 'labs/ownmail/packages/cli',
		hasTestScript: true,
		workspaceDependencies: new Set(['@nylas-labs/cli-kit', '@ownmail/app']),
	},
	{
		name: '@example/no-tests',
		directory: 'labs/example/packages/no-tests',
		hasTestScript: false,
		workspaceDependencies: new Set(),
	},
]

describe('computeAffectedPackages', () => {
	it('selects a changed package and every transitive dependent', () => {
		assert.deepEqual(
			computeAffectedPackages({ packages, changedPaths: ['shared/nylas-cli-kit/src/http.ts'] }),
			['@nylas-labs/cli-kit', '@ownmail/app', 'ownmail'],
		)
	})

	it('does not select dependencies when only a consumer changes', () => {
		assert.deepEqual(
			computeAffectedPackages({ packages, changedPaths: ['labs/ownmail/packages/app/src/server.ts'] }),
			['@ownmail/app', 'ownmail'],
		)
	})

	it('combines independent package changes without duplicates', () => {
		assert.deepEqual(
			computeAffectedPackages({
				packages,
				changedPaths: ['labs/ownmail/packages/app/src/server.ts', 'labs/ownmail/packages/cli/src/index.ts'],
			}),
			['@ownmail/app', 'ownmail'],
		)
	})

	it('selects every package in a lab for lab-wide inputs', () => {
		assert.deepEqual(
			computeAffectedPackages({ packages, changedPaths: ['labs/ownmail/scripts/smoke-release.mjs'] }),
			['@ownmail/app', 'ownmail'],
		)
	})

	it('selects all testable packages for global inputs or an unavailable range', () => {
		assert.deepEqual(computeAffectedPackages({ packages, changedPaths: ['pnpm-lock.yaml'] }), [
			'@nylas-labs/cli-kit',
			'@ownmail/app',
			'ownmail',
		])
		assert.deepEqual(computeAffectedPackages({ packages, changedPaths: [], forceAll: true }), [
			'@nylas-labs/cli-kit',
			'@ownmail/app',
			'ownmail',
		])
	})

	it('skips documentation-only changes and packages without tests', () => {
		assert.deepEqual(computeAffectedPackages({ packages, changedPaths: ['README.md'] }), [])
		assert.deepEqual(
			computeAffectedPackages({ packages, changedPaths: ['labs/example/packages/no-tests/src/index.ts'] }),
			[],
		)
	})

	it('fails closed for a removed shared workspace that is absent from the current graph', () => {
		assert.deepEqual(computeAffectedPackages({ packages, changedPaths: ['shared/removed/package.json'] }), [
			'@nylas-labs/cli-kit',
			'@ownmail/app',
			'ownmail',
		])
	})
})

describe('isGlobalTestInput', () => {
	it('recognizes CI and dependency graph inputs without treating docs as global', () => {
		assert.equal(isGlobalTestInput('.github/workflows/ci.yml'), true)
		assert.equal(isGlobalTestInput('scripts/affected-packages.test.mjs'), true)
		assert.equal(isGlobalTestInput('README.md'), false)
	})
})

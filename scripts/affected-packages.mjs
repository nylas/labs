#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { pathToFileURL } from 'node:url'

const WORKSPACE_PATHSPECS = [':(glob)shared/*/package.json', ':(glob)labs/*/packages/*/package.json']
const DEPENDENCY_FIELDS = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']
const GLOBAL_TEST_INPUTS = new Set([
	'.github/workflows/ci.yml',
	'.npmrc',
	'biome.json',
	'package.json',
	'pnpm-lock.yaml',
	'pnpm-workspace.yaml',
	'tsconfig.base.json',
	'turbo.json',
])
const GLOBAL_TEST_PREFIXES = ['.github/actions/', 'scripts/affected-packages.']
const SHA_PATTERN = /^[0-9a-f]{40}$/
const PACKAGE_NAME_PATTERN = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/i

export function computeAffectedPackages({ packages, changedPaths, forceAll = false }) {
	const packagesByName = new Map(packages.map((pkg) => [pkg.name, pkg]))
	const dependents = new Map(packages.map((pkg) => [pkg.name, new Set()]))

	for (const pkg of packages) {
		for (const dependency of pkg.workspaceDependencies) {
			if (packagesByName.has(dependency)) dependents.get(dependency)?.add(pkg.name)
		}
	}

	const affected = new Set()
	if (forceAll || changedPaths.some(isGlobalTestInput)) {
		for (const pkg of packages) affected.add(pkg.name)
	} else {
		for (const changedPath of changedPaths) {
			const owner = packages.find(
				(pkg) =>
					changedPath === `${pkg.directory}/package.json` || changedPath.startsWith(`${pkg.directory}/`),
			)
			if (owner) {
				affected.add(owner.name)
				continue
			}

			const labMatch = /^labs\/([^/]+)\//.exec(changedPath)
			if (labMatch) {
				const labPrefix = `labs/${labMatch[1]}/packages/`
				for (const pkg of packages) {
					if (pkg.directory.startsWith(labPrefix)) affected.add(pkg.name)
				}
				continue
			}

			// A path under shared/ that has no current owner can represent a deleted
			// workspace. Run everything because its previous dependents are no longer
			// discoverable from the checked-out package graph.
			if (changedPath.startsWith('shared/')) {
				for (const pkg of packages) affected.add(pkg.name)
			}
		}
	}

	const queue = [...affected]
	for (let index = 0; index < queue.length; index += 1) {
		for (const dependent of dependents.get(queue[index]) ?? []) {
			if (affected.has(dependent)) continue
			affected.add(dependent)
			queue.push(dependent)
		}
	}

	return packages
		.filter((pkg) => affected.has(pkg.name) && pkg.hasTestScript)
		.map((pkg) => pkg.name)
		.sort()
}

export function isGlobalTestInput(path) {
	return GLOBAL_TEST_INPUTS.has(path) || GLOBAL_TEST_PREFIXES.some((prefix) => path.startsWith(prefix))
}

function runGit(args, { allowFailure = false } = {}) {
	const result = spawnSync('git', args, { encoding: null, maxBuffer: 16 * 1024 * 1024 })
	if (result.status !== 0 && !allowFailure) {
		const message = result.stderr?.toString('utf8').trim() || `git ${args[0]} failed`
		throw new Error(message)
	}
	return result
}

function discoverPackages() {
	const result = runGit(['ls-files', '-z', '--', ...WORKSPACE_PATHSPECS])
	const packageFiles = result.stdout.toString('utf8').split('\0').filter(Boolean)
	const packages = packageFiles.map((packageFile) => {
		const manifest = JSON.parse(readFileSync(packageFile, 'utf8'))
		if (typeof manifest.name !== 'string' || !PACKAGE_NAME_PATTERN.test(manifest.name)) {
			throw new Error(`Invalid workspace package name in ${packageFile}`)
		}

		const workspaceDependencies = new Set()
		for (const field of DEPENDENCY_FIELDS) {
			for (const name of Object.keys(manifest[field] ?? {})) workspaceDependencies.add(name)
		}

		return {
			name: manifest.name,
			directory: dirname(packageFile),
			hasTestScript: typeof manifest.scripts?.test === 'string' && manifest.scripts.test.trim() !== '',
			workspaceDependencies,
		}
	})

	if (new Set(packages.map((pkg) => pkg.name)).size !== packages.length) {
		throw new Error('Workspace package names must be unique')
	}
	return packages
}

function commitExists(sha) {
	return runGit(['cat-file', '-e', `${sha}^{commit}`], { allowFailure: true }).status === 0
}

function changedPaths(base, head) {
	const result = runGit(['diff', '--name-only', '--diff-filter=ACMRDTUXB', '-z', `${base}...${head}`, '--'])
	return result.stdout.toString('utf8').split('\0').filter(Boolean)
}

function parseArguments(argv) {
	const args = new Map()
	for (let index = 0; index < argv.length; index += 2) {
		const key = argv[index]
		const value = argv[index + 1]
		if (!['--base', '--head', '--format'].includes(key) || value === undefined) {
			throw new Error('Usage: affected-packages.mjs --base <sha> --head <sha> [--format json|github]')
		}
		args.set(key, value)
	}
	return {
		base: args.get('--base'),
		head: args.get('--head'),
		format: args.get('--format') ?? 'json',
	}
}

function main() {
	const { base, head, format } = parseArguments(process.argv.slice(2))
	if (!['json', 'github'].includes(format)) throw new Error(`Unsupported output format: ${format}`)

	const packages = discoverPackages()
	const validRange =
		typeof base === 'string' &&
		typeof head === 'string' &&
		SHA_PATTERN.test(base) &&
		SHA_PATTERN.test(head) &&
		!/^0+$/.test(base) &&
		commitExists(base) &&
		commitExists(head)
	const paths = validRange ? changedPaths(base, head) : []
	if (!validRange) process.stderr.write('Git range unavailable; selecting every testable package.\n')

	const names = computeAffectedPackages({ packages, changedPaths: paths, forceAll: !validRange })
	if (format === 'github') {
		process.stdout.write(`packages=${JSON.stringify(names)}\n`)
		process.stdout.write(
			`ownmail=${packages.some((pkg) => names.includes(pkg.name) && pkg.directory.startsWith('labs/ownmail/'))}\n`,
		)
		process.stdout.write(
			`shared=${packages.some((pkg) => names.includes(pkg.name) && pkg.directory.startsWith('shared/'))}\n`,
		)
		return
	}
	process.stdout.write(`${JSON.stringify(names)}\n`)
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
	try {
		main()
	} catch (error) {
		process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
		process.exitCode = 1
	}
}

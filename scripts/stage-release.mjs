import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const commitSubject = run('git', ['log', '-1', '--format=%s']).trim()
if (!commitSubject.includes('chore(release): version packages')) {
	console.log('Skipping staging because this push did not merge a version-packages release PR.')
	process.exit(0)
}

const packages = JSON.parse(run('pnpm', ['-r', 'list', '--depth', '-1', '--json'])).filter(
	(workspace) => !workspace.private,
)
let staged = 0
const packsDir = mkdtempSync(join(tmpdir(), 'nylas-labs-stage-release-'))

try {
	for (const workspace of packages) {
		if (isPublished(workspace.name, workspace.version)) continue

		const tarball = packWorkspace(workspace)
		assertNoWorkspaceDependencies(tarball)

		console.log(`Staging ${workspace.name}@${workspace.version}`)
		run('npm', ['stage', 'publish', tarball])
		staged += 1
	}
} finally {
	rmSync(packsDir, { force: true, recursive: true })
}

if (staged === 0) console.log('No packages need staging.')

function isPublished(name, version) {
	try {
		execute('npm', ['view', `${name}@${version}`, 'version', '--json'])
		return true
	} catch (error) {
		const output = `${error.stdout ?? ''}\n${error.stderr ?? ''}`
		if (output.includes('E404') || output.includes('404 Not Found')) return false
		throw new Error(`Unable to determine whether ${name}@${version} is published.`, { cause: error })
	}
}

function packWorkspace(workspace) {
	run('pnpm', ['pack', '--pack-destination', packsDir], workspace.path)

	const filename = `${workspace.name.replace(/^@/, '').replace('/', '-')}-${workspace.version}.tgz`
	const tarball = join(packsDir, filename)
	if (!existsSync(tarball)) throw new Error(`pnpm pack did not create ${filename}.`)
	return tarball
}

function assertNoWorkspaceDependencies(tarball) {
	const packageJson = JSON.parse(run('tar', ['-xOzf', tarball, 'package/package.json']))
	if (JSON.stringify(packageJson).includes('workspace:')) {
		throw new Error(`Packed manifest for ${packageJson.name} still contains workspace dependencies.`)
	}
}

function run(command, args, cwd) {
	try {
		return execute(command, args, cwd)
	} catch (error) {
		const stderr = String(error.stderr ?? '').trim()
		throw new Error(`${command} ${args.join(' ')} failed${stderr ? `: ${stderr}` : '.'}`)
	}
}

function execute(command, args, cwd) {
	return execFileSync(command, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

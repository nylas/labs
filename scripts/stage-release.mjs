import { execFileSync } from 'node:child_process'

const commitSubject = run('git', ['log', '-1', '--format=%s']).trim()
if (!commitSubject.includes('chore(release): version packages')) {
	console.log('Skipping staging because this push did not merge a version-packages release PR.')
	process.exit(0)
}

const packages = JSON.parse(run('pnpm', ['-r', 'list', '--depth', '-1', '--json'])).filter(
	(workspace) => !workspace.private,
)
let staged = 0

for (const workspace of packages) {
	if (isPublished(workspace.name, workspace.version)) continue

	console.log(`Staging ${workspace.name}@${workspace.version}`)
	run('npm', ['stage', 'publish'], workspace.path)
	staged += 1
}

if (staged === 0) console.log('No packages need staging.')

function isPublished(name, version) {
	try {
		run('npm', ['view', `${name}@${version}`, 'version', '--json'])
		return true
	} catch (error) {
		const output = `${error.stdout ?? ''}\n${error.stderr ?? ''}`
		if (output.includes('E404') || output.includes('404 Not Found')) return false
		throw new Error(`Unable to determine whether ${name}@${version} is published.`, { cause: error })
	}
}

function run(command, args, cwd) {
	return execFileSync(command, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

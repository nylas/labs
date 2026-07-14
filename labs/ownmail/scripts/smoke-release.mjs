import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(fileURLToPath(new URL('../../..', import.meta.url)))
const tempRoot = mkdtempSync(join(tmpdir(), 'ownmail-release-smoke-'))
const packsDir = join(tempRoot, 'packs')
const installDir = join(tempRoot, 'install')

process.on('exit', () => rmSync(tempRoot, { force: true, recursive: true }))

mkdirSync(packsDir)
mkdirSync(installDir)

const packages = ['shared/nylas-cli-kit', 'labs/ownmail/packages/app', 'labs/ownmail/packages/cli']

for (const packageDir of packages) {
	runPnpm(['pack', '--pack-destination', packsDir], resolve(repoRoot, packageDir))
}

const tarballs = packages.map((packageDir) => {
	const packageJson = JSON.parse(readFileSync(resolve(repoRoot, packageDir, 'package.json'), 'utf8'))
	const filename = `${packageJson.name.replace(/^@/, '').replace('/', '-')}-${packageJson.version}.tgz`
	return resolve(packsDir, filename)
})

const cliPackageFiles = execFileSync('tar', ['-tzf', tarballs[2]], { encoding: 'utf8' })
if (!cliPackageFiles.includes('package/assets/screenshots/ownmail-mail-modes.png\n')) {
	throw new Error('Packed OwnMail CLI did not include the README screenshot asset.')
}

const rootPackage = JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf8'))
const localPackages = Object.fromEntries(
	packages.map((packageDir, index) => {
		const packageJson = JSON.parse(readFileSync(resolve(repoRoot, packageDir, 'package.json'), 'utf8'))
		return [packageJson.name, `file:${tarballs[index]}`]
	}),
)
writeFileSync(
	join(installDir, 'package.json'),
	`${JSON.stringify(
		{
			name: 'ownmail-release-smoke',
			private: true,
			version: '0.0.0',
			packageManager: rootPackage.packageManager,
			dependencies: localPackages,
			pnpm: { overrides: localPackages },
		},
		null,
		2,
	)}\n`,
)

runPnpm(['install', '--ignore-scripts'], installDir)

const ownmailBin = resolve(installDir, 'node_modules/.bin/ownmail')
const help = execFileSync(ownmailBin, ['--help'], { encoding: 'utf8' })
if (!help.includes('Your inbox. Your domain.') || !help.includes('COMMANDS')) {
	throw new Error('Packed OwnMail help output did not contain the expected command summary.')
}

const cliPackage = JSON.parse(
	readFileSync(resolve(repoRoot, 'labs/ownmail/packages/cli/package.json'), 'utf8'),
)
const version = execFileSync(ownmailBin, ['--version'], { encoding: 'utf8' }).trim()
if (!version.includes(cliPackage.version)) {
	throw new Error(`Packed OwnMail reported ${JSON.stringify(version)} instead of ${cliPackage.version}.`)
}

console.log(`OwnMail ${cliPackage.version} packed-install smoke test passed.`)

function runPnpm(args, cwd) {
	try {
		execFileSync('pnpm', args, { cwd, stdio: 'pipe' })
	} catch (error) {
		if (error?.stdout) process.stderr.write(error.stdout)
		if (error?.stderr) process.stderr.write(error.stderr)
		throw new Error(`pnpm ${args[0]} failed in ${cwd}`)
	}
}

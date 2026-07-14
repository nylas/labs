import { execFileSync } from 'node:child_process'
import { readFileSync as readFile } from 'node:fs'
import { fileURLToPath } from 'node:url'

const SUBJECT =
	/^(?:feat|fix|docs|refactor|test|chore|build|ci|perf|style|revert)\([a-z0-9@][a-z0-9@/_-]*\): \S.* \[TW-\d+\]$/
const RELEASE_SUBJECT = 'chore(release): version packages'

export function isValidCommitSubject(subject) {
	return subject === RELEASE_SUBJECT || SUBJECT.test(subject)
}

function fail(message) {
	console.error(message)
	process.exitCode = 1
}

function checkSubject(subject, label) {
	if (isValidCommitSubject(subject)) return true
	fail(
		`${label} must use Conventional Commits with a trailing TW ticket: \`fix(ownmail): preserve safe rotation recovery [TW-5954]\`. Do not prefix the subject with a ticket.`,
	)
	return false
}

function checkMessageFile(path) {
	const subject = readFile(path, 'utf8').split(/\r?\n/, 1)[0]
	return checkSubject(subject, 'Commit subject')
}

function checkRange(base, head) {
	const output = execFileSync('git', ['log', '--format=%H%x00%s', `${base}..${head}`], {
		encoding: 'utf8',
	}).trim()
	if (!output) return true
	return output
		.split('\n')
		.map((entry) => {
			const [sha, subject] = entry.split('\0')
			return checkSubject(subject, `Commit ${sha.slice(0, 7)}`)
		})
		.every(Boolean)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const cliArgs = process.argv.slice(2)
	const [mode, ...args] = cliArgs[0] === '--' ? cliArgs.slice(1) : cliArgs
	if (mode === '--range') {
		if (args.length !== 2) fail('Usage: pnpm commit:check -- --range <base> <head>')
		else checkRange(args[0], args[1])
	} else if (mode) {
		checkMessageFile(mode)
	} else {
		fail('Usage: pnpm commit:check -- <commit-message-file>')
	}
}

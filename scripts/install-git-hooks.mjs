import { execFileSync } from 'node:child_process'

try {
	execFileSync('git', ['rev-parse', '--git-dir'], { stdio: 'ignore' })
	execFileSync('git', ['config', '--local', 'core.hooksPath', '.githooks'], { stdio: 'ignore' })
} catch {
	// Package installation outside a Git checkout does not need local hooks.
}

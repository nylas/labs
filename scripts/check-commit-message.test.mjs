import assert from 'node:assert/strict'
import test from 'node:test'
import { isValidCommitSubject } from './check-commit-message.mjs'

test('accepts Conventional Commit subjects prefixed with TW tickets', () => {
	assert.equal(isValidCommitSubject('[TW-5954] fix(ownmail): preserve safe rotation recovery'), true)
	assert.equal(isValidCommitSubject('[TW-5961] docs(workflow): require TW ticket prefixes'), true)
})

test('rejects ticket-suffixed and malformed commit subjects', () => {
	assert.equal(isValidCommitSubject('fix(ownmail): preserve safe rotation recovery [TW-5954]'), false)
	assert.equal(isValidCommitSubject('fix: preserve safe rotation recovery [TW-5954]'), false)
	assert.equal(
		isValidCommitSubject('[TW-5954] fix(ownmail): preserve safe rotation recovery [TW-5954]'),
		false,
	)
})

test('allows the automated changeset release exemption', () => {
	assert.equal(isValidCommitSubject('chore(release): version packages'), true)
})

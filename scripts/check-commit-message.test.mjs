import assert from 'node:assert/strict'
import test from 'node:test'
import { isValidCommitSubject } from './check-commit-message.mjs'

test('accepts canonical Conventional Commit subjects with TW ticket suffixes', () => {
	assert.equal(isValidCommitSubject('fix(ownmail): preserve safe rotation recovery [TW-5954]'), true)
	assert.equal(isValidCommitSubject('docs(workflow): require TW ticket suffixes [TW-5961]'), true)
})

test('rejects ticket-prefixed and malformed commit subjects', () => {
	assert.equal(isValidCommitSubject('[TW-5954] fix(ownmail): preserve safe rotation recovery'), false)
	assert.equal(isValidCommitSubject('fix: preserve safe rotation recovery [TW-5954]'), false)
	assert.equal(isValidCommitSubject('fix(ownmail): preserve safe rotation recovery'), false)
})

test('allows the automated changeset release exemption', () => {
	assert.equal(isValidCommitSubject('chore(release): version packages'), true)
})

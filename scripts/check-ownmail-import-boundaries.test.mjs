import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import test from 'node:test'
import { findBoundaryImportViolations } from './check-ownmail-import-boundaries.mjs'

const sourceRoot = resolve('/workspace/ownmail/src')

function violations(file, sourceText) {
	return findBoundaryImportViolations({ filePath: resolve(sourceRoot, file), sourceText, sourceRoot })
}

test('allows relative imports inside one feature domain', () => {
	assert.deepEqual(
		violations(
			'features/mail/components/Message.tsx',
			"export { mailFolderTitle } from '../lib/mail-ui-model.js'",
		),
		[],
	)
})

test('allows package aliases and external packages', () => {
	assert.deepEqual(
		violations(
			'features/mail/components/Message.tsx',
			"import React from 'react'\nexport { cn } from '#shared/lib/utils'",
		),
		[],
	)
})

test('rejects a feature-to-shared relative import and suggests its alias', () => {
	const [violation] = violations(
		'features/mail/components/Message.tsx',
		"export { cn } from '../../../shared/lib/utils.js'",
	)
	assert.equal(violation?.sourceBoundary, 'features/mail')
	assert.equal(violation?.targetBoundary, 'shared')
	assert.equal(violation?.suggestedAlias, '#shared/lib/utils')
})

test('treats each feature as a separate boundary', () => {
	const [violation] = violations(
		'features/contacts/server/contact-functions.ts',
		"export { parseRecipientEmails } from '../../mail/server/recipients.js'",
	)
	assert.equal(violation?.targetBoundary, 'features/mail')
	assert.equal(violation?.suggestedAlias, '#features/mail/server/recipients')
})

test('rejects route-to-server relative imports', () => {
	const [violation] = violations('routes/login.tsx', "export { platform } from '../server/platform.js'")
	assert.equal(violation?.sourceBoundary, 'routes')
	assert.equal(violation?.targetBoundary, 'server')
	assert.equal(violation?.line, 1)
})

test('checks static exports and dynamic imports', () => {
	const results = violations(
		'features/mail/components/Message.test.tsx',
		[
			"export { cn } from '../../../shared/lib/utils.js'",
			"const shared = import('../../../shared/lib/presentation.js')",
		].join('\n'),
	)
	assert.equal(results.length, 2)
})

test('checks TypeScript import types and CommonJS imports', () => {
	const results = violations(
		'features/mail/server/mail.ts',
		[
			"type Platform = import('../../../server/platform.js').Platform",
			"const utils = require('../../../shared/lib/utils.js')",
		].join('\n'),
	)
	assert.equal(results.length, 2)
})

test('parses TypeScript and JSX syntax without mistaking text for imports', () => {
	assert.deepEqual(
		violations(
			'features/mail/components/Message.tsx',
			[
				"import type { ComponentProps } from 'react'",
				"type Props = ComponentProps<'p'> & { count?: number }",
				"export const Message = ({ count = 0 }: Props) => <p>import from '../../../server'</p>",
			].join('\n'),
		),
		[],
	)
})

import { readdirSync, readFileSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from '@babel/parser'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const APP_SOURCE_ROOT = resolve(REPO_ROOT, 'labs/ownmail/packages/app/src')
const SOURCE_FILE = /\.(?:ts|tsx)$/
const SOURCE_EXTENSION = /\.(?:[cm]?[jt]sx?)$/

function boundaryForPath(sourceRoot, filePath) {
	const relativePath = relative(sourceRoot, filePath)
	if (
		!relativePath ||
		relativePath === '..' ||
		relativePath.startsWith(`..${sep}`) ||
		isAbsolute(relativePath)
	) {
		return null
	}
	const [root, domain] = relativePath.split(sep)
	if (root === 'features' && domain) return `features/${domain}`
	if (root === 'app' || root === 'routes' || root === 'server' || root === 'shared') return root
	return null
}

function aliasForTarget(sourceRoot, targetPath) {
	const target = relative(sourceRoot, targetPath).split(sep).join('/').replace(SOURCE_EXTENSION, '')
	if (/^(?:app|features|server|shared)\//.test(target)) return `#${target}`
	return null
}

function stringLiteral(node) {
	return node?.type === 'StringLiteral' ? node : null
}

function callSpecifier(node) {
	if (node.type !== 'CallExpression') return null
	if (node.callee.type === 'Import') return stringLiteral(node.arguments[0])
	if (node.callee.type === 'Identifier' && node.callee.name === 'require') {
		return stringLiteral(node.arguments[0])
	}
	if (
		node.callee.type === 'MemberExpression' &&
		!node.callee.computed &&
		node.callee.object.type === 'Identifier' &&
		(node.callee.object.name === 'jest' || node.callee.object.name === 'vi') &&
		node.callee.property.type === 'Identifier' &&
		node.callee.property.name === 'mock'
	) {
		return stringLiteral(node.arguments[0])
	}
	return null
}

function moduleSpecifier(node) {
	switch (node.type) {
		case 'ImportDeclaration':
		case 'ExportAllDeclaration':
		case 'ExportNamedDeclaration':
			return stringLiteral(node.source)
		case 'ImportExpression':
			return stringLiteral(node.source)
		case 'CallExpression':
			return callSpecifier(node)
		case 'TSImportEqualsDeclaration':
			return node.moduleReference.type === 'TSExternalModuleReference'
				? stringLiteral(node.moduleReference.expression)
				: null
		case 'TSImportType':
			return stringLiteral(node.source ?? node.argument)
		default:
			return null
	}
}

function importedModules(sourceText, filePath) {
	const ast = parse(sourceText, {
		sourceFilename: filePath,
		sourceType: 'module',
		createImportExpressions: true,
		plugins: ['typescript', 'jsx'],
	})
	const modules = []
	const pending = [ast.program]
	const visited = new WeakSet()
	while (pending.length > 0) {
		const node = pending.pop()
		if (!node || typeof node !== 'object' || visited.has(node)) continue
		visited.add(node)
		const specifier = moduleSpecifier(node)
		if (specifier) modules.push(specifier)
		for (const value of Object.values(node)) {
			if (Array.isArray(value)) pending.push(...value)
			else if (value && typeof value === 'object') pending.push(value)
		}
	}
	return modules
}

export function findBoundaryImportViolations({ filePath, sourceText, sourceRoot = APP_SOURCE_ROOT }) {
	const sourceBoundary = boundaryForPath(sourceRoot, filePath)
	if (!sourceBoundary) return []
	const violations = []
	for (const moduleImport of importedModules(sourceText, filePath)) {
		const specifier = moduleImport.value
		if (specifier?.startsWith('.')) {
			const targetPath = resolve(dirname(filePath), specifier)
			const targetBoundary = boundaryForPath(sourceRoot, targetPath)
			if (targetBoundary && targetBoundary !== sourceBoundary) {
				violations.push({
					filePath,
					line: moduleImport.loc?.start.line ?? 1,
					column: (moduleImport.loc?.start.column ?? 0) + 1,
					specifier,
					sourceBoundary,
					targetBoundary,
					suggestedAlias: aliasForTarget(sourceRoot, targetPath),
				})
			}
		}
	}
	return violations
}

function sourceFiles(root) {
	const files = []
	const pending = [root]
	while (pending.length > 0) {
		const directory = pending.pop()
		if (!directory) continue
		for (const entry of readdirSync(directory, { withFileTypes: true })) {
			const path = resolve(directory, entry.name)
			if (entry.isDirectory()) pending.push(path)
			else if (SOURCE_FILE.test(entry.name) && entry.name !== 'routeTree.gen.ts') files.push(path)
		}
	}
	return files.sort()
}

export function checkOwnmailImportBoundaries(sourceRoot = APP_SOURCE_ROOT) {
	const files = sourceFiles(sourceRoot)
	return {
		checkedFiles: files.length,
		violations: files.flatMap((filePath) =>
			findBoundaryImportViolations({ filePath, sourceText: readFileSync(filePath, 'utf8'), sourceRoot }),
		),
	}
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const result = checkOwnmailImportBoundaries()
	if (result.violations.length === 0) {
		console.log(`OwnMail import boundaries: checked ${result.checkedFiles} files.`)
	} else {
		for (const violation of result.violations) {
			const file = relative(REPO_ROOT, violation.filePath)
			const suggestion = violation.suggestedAlias ? ` Use ${violation.suggestedAlias}.` : ''
			console.error(
				`${file}:${violation.line}:${violation.column} crosses ${violation.sourceBoundary} → ${violation.targetBoundary} with ${JSON.stringify(violation.specifier)}.${suggestion}`,
			)
		}
		console.error('Cross-boundary OwnMail imports must use package import aliases.')
		process.exitCode = 1
	}
}

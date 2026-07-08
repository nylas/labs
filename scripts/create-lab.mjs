#!/usr/bin/env node
/**
 * Scaffolds a new lab with all required boilerplate:
 *
 *   pnpm create-lab <name> ["one-line tagline"]
 *
 * Creates labs/<name>/ with a package, README (banner included), docs dir,
 * and test setup — wired into the workspace, turbo, and per-lab CI
 * automatically (they glob on labs/*).
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const [, , name, tagline = 'An experiment from Nylas Labs.'] = process.argv

if (!name || !/^[a-z][a-z0-9-]{1,30}$/.test(name)) {
	console.error('Usage: pnpm create-lab <name> ["tagline"]  (lowercase, digits, hyphens)')
	process.exit(1)
}
const labDir = join(root, 'labs', name)
if (existsSync(labDir)) {
	console.error(`labs/${name} already exists`)
	process.exit(1)
}

const pkgDir = join(labDir, 'packages', name)
mkdirSync(join(pkgDir, 'src'), { recursive: true })
mkdirSync(join(labDir, 'docs'), { recursive: true })

writeFileSync(
	join(pkgDir, 'package.json'),
	`${JSON.stringify(
		{
			name,
			version: '0.0.0',
			description: tagline,
			license: 'MIT',
			type: 'module',
			exports: { '.': { types: './dist/index.d.ts', default: './dist/index.js' } },
			files: ['dist'],
			scripts: {
				build: 'tsc -p tsconfig.json',
				typecheck: 'tsc -p tsconfig.json --noEmit',
				test: 'vitest run',
			},
			devDependencies: { '@types/node': '^24.0.0', typescript: '^7.0.0', vitest: '^3.1.0' },
			engines: { node: '>=20.0.0' },
		},
		null,
		2,
	)}\n`,
)
writeFileSync(
	join(pkgDir, 'tsconfig.json'),
	`${JSON.stringify(
		{
			extends: '../../../../tsconfig.base.json',
			compilerOptions: { outDir: 'dist', rootDir: 'src', types: ['node'] },
			include: ['src'],
			exclude: ['src/**/*.test.ts'],
		},
		null,
		2,
	)}\n`,
)
writeFileSync(
	join(pkgDir, 'src', 'index.ts'),
	`export function hello(): string {\n\treturn 'Hello from ${name}'\n}\n`,
)
writeFileSync(
	join(pkgDir, 'src', 'index.test.ts'),
	`import { describe, expect, it } from 'vitest'\nimport { hello } from './index.js'\n\ndescribe('${name}', () => {\n\tit('greets', () => {\n\t\texpect(hello()).toContain('${name}')\n\t})\n})\n`,
)
writeFileSync(
	join(labDir, 'README.md'),
	`<img src="./assets/banner.svg" alt="${name}" width="100%" />

# ${name}

**${tagline}**

> 🧪 **Experiment** — this lab is exploratory. Try it, break it,
> [tell us what you think](https://github.com/nylas/labs/discussions).

## What is this?

_Describe the problem and the one-command magic here._

## Status

| Stage | Meaning |
|---|---|
| 🧪 Experiment | Actively exploring — APIs change without notice |

## Development

\`\`\`bash
pnpm install
pnpm turbo build test --filter='./labs/${name}/packages/*'
\`\`\`
`,
)

// Banner
execFileSync(process.execPath, [join(root, 'scripts', 'create-banner.mjs'), name, tagline], {
	stdio: 'inherit',
})

console.log(`
✅ labs/${name} is ready.

Next steps:
  1. pnpm install                     # link the new package
  2. Add ["${name}"] to .changeset/config.json "fixed" if the lab grows multiple packages
  3. Add the lab to the table in the root README.md
  4. Build something people want.
`)

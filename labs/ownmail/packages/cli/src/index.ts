#!/usr/bin/env node
import { createRequire } from 'node:module'
import { defineCommand, runMain } from 'citty'

const require = createRequire(import.meta.url)
const { version } = require('../package.json') as { version: string }

async function runCommand(action: () => Promise<void>): Promise<void> {
	const { runTopLevel } = await import('./commands/shared.js')
	await runTopLevel(action)
}

const nameArg = {
	type: 'string',
	description: 'Project name (prompted if omitted)',
	required: false,
} as const

const create = defineCommand({
	meta: { name: 'create', description: 'Create (or resume creating) your mailbox app' },
	args: {
		name: nameArg,
		region: { type: 'string', description: 'Nylas region (us or eu)', default: 'us' },
	},
	async run({ args }) {
		await runCommand(async () => {
			const { runCreate } = await import('./commands/create.js')
			await runCreate({
				...(args.name ? { name: args.name } : {}),
				region: args.region === 'eu' ? 'eu' : 'us',
			})
		})
	},
})

const main = defineCommand({
	meta: {
		name: 'ownmail',
		version,
		description: 'Launch an inbox on your domain—with one guided command.',
	},
	subCommands: {
		create,
		update: defineCommand({
			meta: { name: 'update', description: 'Redeploy with the latest app template (config-preserving)' },
			args: { name: nameArg },
			run: ({ args }) =>
				runCommand(async () => {
					const { runUpdate } = await import('./commands/update.js')
					await runUpdate(args.name ? { name: args.name } : {})
				}),
		}),
		eject: defineCommand({
			meta: { name: 'eject', description: 'Get the full app source and own it from here' },
			args: { name: nameArg, dir: { type: 'positional', description: 'Target directory', required: false } },
			run: ({ args }) =>
				runCommand(async () => {
					const { runEject } = await import('./commands/eject.js')
					await runEject({
						...(typeof args.name === 'string' ? { name: args.name } : {}),
						...(typeof args.dir === 'string' ? { dir: args.dir } : {}),
					})
				}),
		}),
		doctor: defineCommand({
			meta: { name: 'doctor', description: 'Check your project health; use --fix for repairs' },
			args: {
				name: nameArg,
				fix: { type: 'boolean', description: 'Repair safe issues such as missing redirect URIs' },
			},
			run: ({ args }) =>
				runCommand(async () => {
					const { runDoctor } = await import('./commands/doctor.js')
					await runDoctor({
						...(typeof args.name === 'string' ? { name: args.name } : {}),
						fix: args.fix === true,
					})
				}),
		}),
		grants: defineCommand({
			meta: { name: 'grants', description: 'List the inboxes on your Nylas app' },
			args: { name: nameArg },
			run: ({ args }) =>
				runCommand(async () => {
					const { runGrants } = await import('./commands/misc.js')
					await runGrants(args.name ? { name: args.name } : {})
				}),
		}),
		login: defineCommand({
			meta: { name: 'login', description: 'Log into your Nylas account again' },
			run: () =>
				runCommand(async () => {
					const { runLogin } = await import('./commands/misc.js')
					await runLogin()
				}),
		}),
		destroy: defineCommand({
			meta: { name: 'destroy', description: 'Delete the deployed app (keeps your inbox and mail)' },
			args: { name: nameArg },
			run: ({ args }) =>
				runCommand(async () => {
					const { runDestroy } = await import('./commands/misc.js')
					await runDestroy(args.name ? { name: args.name } : {})
				}),
		}),
		delete: defineCommand({
			meta: {
				name: 'delete',
				description: 'Delete a local project record; use --hosted to delete hosted app content too',
			},
			args: {
				name: nameArg,
				hosted: {
					type: 'boolean',
					description: 'Also delete recorded Cloudflare hosted app content',
				},
			},
			run: ({ args }) =>
				runCommand(async () => {
					const { runDeleteProject } = await import('./commands/misc.js')
					await runDeleteProject({
						...(typeof args.name === 'string' ? { name: args.name } : {}),
						hosted: args.hosted === true,
					})
				}),
		}),
		'cleanup-secrets': defineCommand({
			meta: {
				name: 'cleanup-secrets',
				description: 'Clear local pending setup secrets without deleting remote mail data',
			},
			args: { name: nameArg },
			run: ({ args }) =>
				runCommand(async () => {
					const { runCleanupSecrets } = await import('./commands/misc.js')
					await runCleanupSecrets(typeof args.name === 'string' ? { name: args.name } : {})
				}),
		}),
		status: defineCommand({
			meta: { name: 'status', description: 'Show your projects and their state' },
			args: { json: { type: 'boolean', description: 'Print machine-readable JSON' } },
			run: ({ args }) =>
				runCommand(async () => {
					const { runStatus } = await import('./commands/status.js')
					await runStatus({ json: args.json === true })
				}),
		}),
		inbox: defineCommand({
			meta: { name: 'inbox', description: 'Manage inboxes' },
			subCommands: {
				add: defineCommand({
					meta: { name: 'add', description: 'Add another inbox on your domain' },
					args: { name: nameArg },
					run: ({ args }) =>
						runCommand(async () => {
							const { runInboxAdd } = await import('./commands/inbox.js')
							await runInboxAdd(args.name ? { name: args.name } : {})
						}),
				}),
				'reset-password': defineCommand({
					meta: { name: 'reset-password', description: 'Reset an inbox password' },
					args: {
						name: nameArg,
						email: { type: 'positional', description: 'Inbox email', required: false },
					},
					run: ({ args }) =>
						runCommand(async () => {
							const { runInboxResetPassword } = await import('./commands/inbox.js')
							await runInboxResetPassword({
								...(typeof args.name === 'string' ? { name: args.name } : {}),
								...(typeof args.email === 'string' ? { email: args.email } : {}),
							})
						}),
				}),
			},
		}),
		'rotate-key': defineCommand({
			meta: { name: 'rotate-key', description: 'Rotate the API key your app uses' },
			args: { name: nameArg },
			run: ({ args }) =>
				runCommand(async () => {
					const { runRotateKey } = await import('./commands/rotate.js')
					await runRotateKey(args.name ? { name: args.name } : {})
				}),
		}),
		'app-domain': defineCommand({
			meta: { name: 'app-domain', description: 'Serve your app on your own domain' },
			args: {
				name: nameArg,
				domain: {
					type: 'positional',
					description: 'Domain (zone must be on your Cloudflare account)',
					required: false,
				},
			},
			run: ({ args }) =>
				runCommand(async () => {
					const { runAppDomain } = await import('./commands/app-domain.js')
					await runAppDomain({
						...(typeof args.name === 'string' ? { name: args.name } : {}),
						...(typeof args.domain === 'string' ? { domain: args.domain } : {}),
					})
				}),
		}),
	},
	args: {
		name: nameArg,
		region: { type: 'string', description: 'Nylas region (us or eu)', default: 'us' },
	},
	async run({ args, rawArgs }) {
		// Default command: bare `npx ownmail` runs create/resume.
		if (rawArgs.length === 0 || rawArgs[0]?.startsWith('-')) {
			await runCommand(async () => {
				const { runCreate } = await import('./commands/create.js')
				await runCreate({
					...(args.name ? { name: args.name as string } : {}),
					region: args.region === 'eu' ? 'eu' : 'us',
				})
			})
		}
	},
})

runMain(main)

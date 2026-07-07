#!/usr/bin/env node
import { defineCommand, runMain } from 'citty'
import { runAppDomain } from './commands/app-domain.js'
import { runCreate } from './commands/create.js'
import { runDoctor } from './commands/doctor.js'
import { runEject } from './commands/eject.js'
import { runInboxAdd, runInboxResetPassword } from './commands/inbox.js'
import { runDestroy, runGrants, runLogin } from './commands/misc.js'
import { runRotateKey } from './commands/rotate.js'
import { runTopLevel } from './commands/shared.js'
import { runStatus } from './commands/status.js'
import { runUpdate } from './commands/update.js'

const nameArg = { type: 'string', description: 'Project name', required: false } as const

const create = defineCommand({
	meta: { name: 'create', description: 'Create (or resume creating) your mailbox app' },
	args: {
		name: nameArg,
		region: { type: 'string', description: 'Nylas region (us or eu)', default: 'us' },
	},
	async run({ args }) {
		await runCreate({
			...(args.name ? { name: args.name } : {}),
			region: args.region === 'eu' ? 'eu' : 'us',
		})
	},
})

const main = defineCommand({
	meta: {
		name: 'ownmail',
		description: 'Your inbox. Your domain. No per-seat fees. Powered by Nylas.',
	},
	subCommands: {
		create,
		update: defineCommand({
			meta: { name: 'update', description: 'Redeploy with the latest app template (config-preserving)' },
			args: { name: nameArg },
			run: ({ args }) => runTopLevel(() => runUpdate(args.name ? { name: args.name } : {})),
		}),
		eject: defineCommand({
			meta: { name: 'eject', description: 'Get the full app source and own it from here' },
			args: { name: nameArg, dir: { type: 'positional', description: 'Target directory', required: false } },
			run: ({ args }) =>
				runTopLevel(() =>
					runEject({
						...(typeof args.name === 'string' ? { name: args.name } : {}),
						...(typeof args.dir === 'string' ? { dir: args.dir } : {}),
					}),
				),
		}),
		doctor: defineCommand({
			meta: { name: 'doctor', description: 'Check (and fix) your project’s health' },
			args: { name: nameArg },
			run: ({ args }) => runTopLevel(() => runDoctor(args.name ? { name: args.name } : {})),
		}),
		grants: defineCommand({
			meta: { name: 'grants', description: 'List the inboxes on your Nylas app' },
			args: { name: nameArg },
			run: ({ args }) => runTopLevel(() => runGrants(args.name ? { name: args.name } : {})),
		}),
		login: defineCommand({
			meta: { name: 'login', description: 'Log into your Nylas account again' },
			run: () => runTopLevel(() => runLogin()),
		}),
		destroy: defineCommand({
			meta: { name: 'destroy', description: 'Delete the deployed app (keeps your inbox and mail)' },
			args: { name: nameArg },
			run: ({ args }) => runTopLevel(() => runDestroy(args.name ? { name: args.name } : {})),
		}),
		status: defineCommand({
			meta: { name: 'status', description: 'Show your projects and their state' },
			run: () => runTopLevel(() => runStatus()),
		}),
		inbox: defineCommand({
			meta: { name: 'inbox', description: 'Manage inboxes' },
			subCommands: {
				add: defineCommand({
					meta: { name: 'add', description: 'Add another inbox on your domain' },
					args: { name: nameArg },
					run: ({ args }) => runTopLevel(() => runInboxAdd(args.name ? { name: args.name } : {})),
				}),
				'reset-password': defineCommand({
					meta: { name: 'reset-password', description: 'Reset an inbox password' },
					args: {
						name: nameArg,
						email: { type: 'positional', description: 'Inbox email', required: false },
					},
					run: ({ args }) =>
						runTopLevel(() =>
							runInboxResetPassword({
								...(typeof args.name === 'string' ? { name: args.name } : {}),
								...(typeof args.email === 'string' ? { email: args.email } : {}),
							}),
						),
				}),
			},
		}),
		'rotate-key': defineCommand({
			meta: { name: 'rotate-key', description: 'Rotate the API key your app uses' },
			args: { name: nameArg },
			run: ({ args }) => runTopLevel(() => runRotateKey(args.name ? { name: args.name } : {})),
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
				runTopLevel(() =>
					runAppDomain({
						...(typeof args.name === 'string' ? { name: args.name } : {}),
						...(typeof args.domain === 'string' ? { domain: args.domain } : {}),
					}),
				),
		}),
	},
	args: {
		name: nameArg,
		region: { type: 'string', description: 'Nylas region (us or eu)', default: 'us' },
	},
	async run({ args, rawArgs }) {
		// Default command: bare `npx ownmail` runs create/resume.
		if (rawArgs.length === 0 || rawArgs[0]?.startsWith('-')) {
			await runCreate({
				...(args.name ? { name: args.name as string } : {}),
				region: args.region === 'eu' ? 'eu' : 'us',
			})
		}
	},
})

runMain(main)

#!/usr/bin/env node
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { type ArgsDef, type CommandDef, type CommandMeta, defineCommand, runMain } from 'citty'

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
	meta: { name: 'create', description: 'Create or resume a mailbox app' },
	args: {
		name: nameArg,
		region: { type: 'string', description: 'Nylas region (us or eu)', default: 'us' },
		'site-name': { type: 'string', description: 'Name shown in the deployed app' },
	},
	async run({ args }) {
		await runCommand(async () => {
			const { runCreate } = await import('./commands/create.js')
			await runCreate({
				...(args.name ? { name: args.name } : {}),
				region: args.region === 'eu' ? 'eu' : 'us',
				...(typeof args['site-name'] === 'string' ? { siteName: args['site-name'] } : {}),
			})
		})
	},
})

const appName = defineCommand({
	meta: { name: 'name', description: 'Show or change the name displayed in your app' },
	args: {
		name: nameArg,
		'site-name': {
			type: 'positional',
			description: 'Display name, such as Acme Mail (prompted if omitted)',
			required: false,
		},
	},
	run: ({ args }) =>
		runCommand(async () => {
			const { runAppName } = await import('./commands/app-name.js')
			await runAppName({
				...(typeof args.name === 'string' ? { name: args.name } : {}),
				...(typeof args['site-name'] === 'string' ? { siteName: args['site-name'] } : {}),
			})
		}),
})

const appDomain = defineCommand({
	meta: { name: 'domain', description: 'Serve your app on your own domain' },
	args: {
		name: nameArg,
		domain: {
			type: 'positional',
			description: 'App hostname, such as mail.example.com',
			required: false,
		},
		primary: {
			type: 'boolean',
			description: 'Make this primary for sign-in and Nylas instant updates',
		},
		secondary: {
			type: 'boolean',
			description: 'Attach an additional domain without moving instant updates',
		},
	},
	run: ({ args }) =>
		runCommand(async () => {
			const { runAppDomain } = await import('./commands/app-domain.js')
			await runAppDomain({
				...(typeof args.name === 'string' ? { name: args.name } : {}),
				...(typeof args.domain === 'string' ? { domain: args.domain } : {}),
				...(args.primary === true ? { primary: true } : {}),
				...(args.secondary === true ? { secondary: true } : {}),
			})
		}),
})

const appUpdate = defineCommand({
	meta: { name: 'update', description: 'Redeploy the latest app while preserving configuration' },
	args: { name: nameArg },
	run: ({ args }) =>
		runCommand(async () => {
			const { runUpdate } = await import('./commands/update.js')
			await runUpdate(args.name ? { name: args.name } : {})
		}),
})

const appEject = defineCommand({
	meta: { name: 'eject', description: 'Export the full app source and own it from here' },
	args: { name: nameArg, dir: { type: 'positional', description: 'Target directory', required: false } },
	run: ({ args }) =>
		runCommand(async () => {
			const { runEject } = await import('./commands/eject.js')
			await runEject({
				...(typeof args.name === 'string' ? { name: args.name } : {}),
				...(typeof args.dir === 'string' ? { dir: args.dir } : {}),
			})
		}),
})

const appDestroy = defineCommand({
	meta: { name: 'destroy', description: 'Delete the deployment but keep inboxes and mail' },
	args: { name: nameArg },
	run: ({ args }) =>
		runCommand(async () => {
			const { runDestroy } = await import('./commands/misc.js')
			await runDestroy(args.name ? { name: args.name } : {})
		}),
})

const inboxList = defineCommand({
	meta: { name: 'list', alias: 'grants', description: 'List inboxes on your Nylas app' },
	args: { name: nameArg },
	run: ({ args }) =>
		runCommand(async () => {
			const { runGrants } = await import('./commands/misc.js')
			await runGrants(args.name ? { name: args.name } : {})
		}),
})

const inboxAdd = defineCommand({
	meta: { name: 'add', description: 'Add another inbox on your domain' },
	args: { name: nameArg },
	run: ({ args }) =>
		runCommand(async () => {
			const { runInboxAdd } = await import('./commands/inbox.js')
			await runInboxAdd(args.name ? { name: args.name } : {})
		}),
})

const inboxResetPassword = defineCommand({
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
})

const projectStatus = defineCommand({
	meta: { name: 'status', alias: 'list', description: 'Show projects, deployment health, and next steps' },
	args: { json: { type: 'boolean', description: 'Print machine-readable JSON' } },
	run: ({ args }) =>
		runCommand(async () => {
			const { runStatus } = await import('./commands/status.js')
			await runStatus({ json: args.json === true })
		}),
})

const projectDoctor = defineCommand({
	meta: { name: 'doctor', description: 'Check project health; use --fix for safe repairs' },
	args: { name: nameArg, fix: { type: 'boolean', description: 'Repair safe configuration issues' } },
	run: ({ args }) =>
		runCommand(async () => {
			const { runDoctor } = await import('./commands/doctor.js')
			await runDoctor({
				...(typeof args.name === 'string' ? { name: args.name } : {}),
				fix: args.fix === true,
			})
		}),
})

const projectDelete = defineCommand({
	meta: { name: 'delete', description: 'Delete local project state; optionally delete Cloudflare content' },
	args: {
		name: nameArg,
		hosted: { type: 'boolean', description: 'Also delete recorded Cloudflare hosted content' },
	},
	run: ({ args }) =>
		runCommand(async () => {
			const { runDeleteProject } = await import('./commands/misc.js')
			await runDeleteProject({
				...(typeof args.name === 'string' ? { name: args.name } : {}),
				hosted: args.hosted === true,
			})
		}),
})

const projectCleanup = defineCommand({
	meta: { name: 'cleanup', description: 'Clear pending local setup secrets without touching mail' },
	args: { name: nameArg },
	run: ({ args }) =>
		runCommand(async () => {
			const { runCleanupSecrets } = await import('./commands/misc.js')
			await runCleanupSecrets(typeof args.name === 'string' ? { name: args.name } : {})
		}),
})

const authLogin = defineCommand({
	meta: { name: 'login', description: 'Log into your Nylas account again' },
	run: () =>
		runCommand(async () => {
			const { runLogin } = await import('./commands/misc.js')
			await runLogin()
		}),
})

const authRotateKey = defineCommand({
	meta: { name: 'rotate-key', description: 'Rotate the API key used by your app' },
	args: { name: nameArg },
	run: ({ args }) =>
		runCommand(async () => {
			const { runRotateKey } = await import('./commands/rotate.js')
			await runRotateKey(args.name ? { name: args.name } : {})
		}),
})

const app = defineCommand({
	meta: { name: 'app', description: 'Customize, deploy, and export the mailbox app' },
	subCommands: { name: appName, domain: appDomain, update: appUpdate, eject: appEject, destroy: appDestroy },
})

const inbox = defineCommand({
	meta: { name: 'inbox', description: 'List and manage mailbox accounts' },
	subCommands: { list: inboxList, add: inboxAdd, 'reset-password': inboxResetPassword },
})

const project = defineCommand({
	meta: { name: 'project', description: 'Inspect, repair, and remove OwnMail project state' },
	subCommands: {
		status: projectStatus,
		doctor: projectDoctor,
		delete: projectDelete,
		cleanup: projectCleanup,
	},
})

const auth = defineCommand({
	meta: { name: 'auth', description: 'Manage Nylas login and app credentials' },
	subCommands: { login: authLogin, 'rotate-key': authRotateKey },
})

function legacy<T extends ArgsDef>(command: CommandDef<T>, name: string): CommandDef<T> {
	return defineCommand({
		...command,
		meta: { ...((command.meta ?? {}) as CommandMeta), name, hidden: true },
	})
}

export const main = defineCommand({
	meta: {
		name: 'ownmail',
		version,
		description: 'Launch and customize an inbox on your domain.',
	},
	subCommands: {
		create,
		app,
		inbox,
		project,
		auth,
		update: legacy(appUpdate, 'update'),
		eject: legacy(appEject, 'eject'),
		doctor: legacy(projectDoctor, 'doctor'),
		grants: legacy(inboxList, 'grants'),
		login: legacy(authLogin, 'login'),
		destroy: legacy(appDestroy, 'destroy'),
		delete: legacy(projectDelete, 'delete'),
		'cleanup-secrets': legacy(projectCleanup, 'cleanup-secrets'),
		status: legacy(projectStatus, 'status'),
		'rotate-key': legacy(authRotateKey, 'rotate-key'),
		'app-domain': legacy(appDomain, 'app-domain'),
	},
	args: {
		name: nameArg,
		region: { type: 'string', description: 'Nylas region (us or eu)', default: 'us' },
		'site-name': { type: 'string', description: 'Name shown in the deployed app' },
	},
	async run({ args, rawArgs }) {
		if (rawArgs.length === 0 || rawArgs[0]?.startsWith('-')) {
			await runCommand(async () => {
				const { runCreate } = await import('./commands/create.js')
				await runCreate({
					...(args.name ? { name: args.name as string } : {}),
					region: args.region === 'eu' ? 'eu' : 'us',
					...(typeof args['site-name'] === 'string' ? { siteName: args['site-name'] } : {}),
				})
			})
		}
	},
})

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) runMain(main)

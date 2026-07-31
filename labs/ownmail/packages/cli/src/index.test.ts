import { type CommandDef, renderUsage } from 'citty'
import { describe, expect, it } from 'vitest'
import { main } from './index.js'

describe('OwnMail command help', () => {
	it('keeps the root help focused on logical command groups', async () => {
		const usage = await renderUsage(main)

		expect(usage).toContain('create')
		expect(usage).toContain('app')
		expect(usage).toContain('inbox')
		expect(usage).toContain('project')
		expect(usage).toContain('auth')
		expect(usage).not.toContain('app-domain')
		expect(usage).not.toContain('cleanup-secrets')
	})

	it.each([
		['app', ['name', 'domain', 'update', 'eject', 'destroy']],
		['inbox', ['list, grants', 'add', 'reset-password']],
		['project', ['status, list', 'doctor', 'delete', 'cleanup']],
		['auth', ['login', 'rotate-key']],
	] as const)('makes %s functionality explorable from group help', async (group, commands) => {
		const command = await resolveSubCommand(group)
		const usage = await renderUsage(command, main)

		for (const name of commands) expect(usage).toContain(name)
		expect(usage).toContain(`ownmail ${group} <command> --help`)
	})

	it('retains the old flat commands as hidden compatibility aliases', async () => {
		const subCommands = await Promise.resolve(
			typeof main.subCommands === 'function' ? main.subCommands() : main.subCommands,
		)
		for (const name of ['status', 'update', 'doctor', 'grants', 'app-domain', 'rotate-key']) {
			const command = await Promise.resolve(subCommands?.[name])
			const meta = await Promise.resolve(typeof command?.meta === 'function' ? command.meta() : command?.meta)
			expect(meta?.hidden).toBe(true)
		}
	})
})

async function resolveSubCommand(name: string): Promise<CommandDef> {
	const subCommands = await Promise.resolve(
		typeof main.subCommands === 'function' ? main.subCommands() : main.subCommands,
	)
	const command = await Promise.resolve(subCommands?.[name])
	if (!command) throw new Error(`Missing ${name} command`)
	return command
}

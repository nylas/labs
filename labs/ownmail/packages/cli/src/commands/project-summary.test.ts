import { describe, expect, it } from 'vitest'
import type { ProjectState } from '../state/schema.js'
import { activeAppUrl, projectStatusSummary, redirectCallbackUrls } from './project-summary.js'

function project(overrides: Partial<ProjectState> = {}): ProjectState {
	return {
		slug: 'acme',
		createdAt: 0,
		updatedAt: 0,
		region: 'us',
		ejected: false,
		completedSteps: [],
		pendingSecrets: {},
		...overrides,
	} as ProjectState
}

describe('projectStatusSummary', () => {
	it('summarizes an unstarted project', () => {
		expect(projectStatusSummary(project())).toMatchObject({
			stage: 'Not started',
			health: 'Setup has not started.',
			hosting: 'Not selected',
			nextCommand: 'npx ownmail',
		})
	})

	it('summarizes a live Cloudflare project with a custom app domain', () => {
		const summary = projectStatusSummary(
			project({
				hostingProvider: 'cloudflare',
				workersDevUrl: 'https://acme.workers.dev',
				appDomain: 'mail.acme.com',
				domainVerified: true,
				completedSteps: [
					'dashboard-auth',
					'org',
					'app',
					'api-key',
					'connector',
					'domain',
					'grant',
					'hosting',
					'cf-auth',
					'cf-resources',
					'deploy',
					'webhook',
					'redirect-uris',
					'verify',
				],
			}),
		)
		expect(summary).toMatchObject({
			stage: 'Live',
			health: 'Setup complete.',
			hosting: 'Cloudflare Workers',
			appUrl: 'https://mail.acme.com',
			nextCommand: 'npx ownmail update',
			domainVerified: true,
		})
	})

	it('summarizes complete state that is missing an app URL', () => {
		expect(
			projectStatusSummary(
				project({
					completedSteps: [
						'dashboard-auth',
						'org',
						'app',
						'api-key',
						'connector',
						'domain',
						'grant',
						'hosting',
						'cf-auth',
						'cf-resources',
						'deploy',
						'webhook',
						'redirect-uris',
						'verify',
					],
				}),
			),
		).toMatchObject({
			stage: 'Needs app URL',
			nextCommand: 'npx ownmail',
		})
	})

	it('summarizes ejected source even when no app URL is recorded', () => {
		expect(projectStatusSummary(project({ ejected: true }))).toMatchObject({
			stage: 'Ejected',
			health: 'Source exported; app URL is not recorded.',
			hosting: 'Ejected source',
			nextCommand: 'wrangler deploy',
		})
	})
})

describe('activeAppUrl', () => {
	it('prefers custom app domain, then manual URL, then workers.dev', () => {
		expect(
			activeAppUrl(
				project({
					appDomain: 'mail.acme.com',
					manualAppUrl: 'https://manual.acme.com',
					workersDevUrl: 'https://acme.workers.dev',
				}),
			),
		).toBe('https://mail.acme.com')
		expect(activeAppUrl(project({ manualAppUrl: 'https://manual.acme.com' }))).toBe('https://manual.acme.com')
		expect(activeAppUrl(project({ workersDevUrl: 'https://acme.workers.dev' }))).toBe('https://acme.workers.dev')
	})
})

describe('redirectCallbackUrls', () => {
	it('includes localhost, workers.dev, and custom app-domain callbacks for Cloudflare projects', () => {
		expect(
			redirectCallbackUrls(
				project({
					hostingProvider: 'cloudflare',
					workersDevUrl: 'https://acme.workers.dev',
					appDomain: 'mail.acme.com',
				}),
			),
		).toEqual([
			'http://localhost:3000/auth/callback',
			'https://acme.workers.dev/auth/callback',
			'https://mail.acme.com/auth/callback',
		])
	})

	it('uses the manual app URL and excludes workers.dev for manual projects', () => {
		expect(
			redirectCallbackUrls(
				project({
					hostingProvider: 'manual',
					manualAppUrl: 'https://manual.acme.com',
					workersDevUrl: 'https://acme.workers.dev',
				}),
			),
		).toEqual(['http://localhost:3000/auth/callback', 'https://manual.acme.com/auth/callback'])
	})
})

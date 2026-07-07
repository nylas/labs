import { GATEWAY_URLS, type Region, V3_URLS } from '@nylas-labs/cli-kit'

export type OwnmailNylasEnvironment = 'production' | 'staging'

const STAGING_DASHBOARD_ACCOUNT_URL = 'https://dashboard-account-stg.eu.nylas.com'
const STAGING_API_BASE_URL = 'https://api-staging.us.nylas.com'
const STAGING_GATEWAY_URLS: Record<Region, string> = {
	us: 'https://dashboard-api-gateway-staging.us.nylas.com/graphql',
	eu: 'https://dashboard-api-gateway-staging.eu.nylas.com/graphql',
}

export function ownmailNylasEnvironment(): OwnmailNylasEnvironment {
	return process.env.OWNMAIL_NYLAS_ENV === 'staging' ? 'staging' : 'production'
}

export function ownmailStateName(): string {
	return ownmailNylasEnvironment() === 'staging' ? 'ownmail-staging' : 'ownmail'
}

export function resourceNameSuffix(): string {
	return ownmailNylasEnvironment() === 'staging' ? '-staging' : ''
}

export function defaultProjectRegion(region: Region): Region {
	return region
}

export function dashboardAccountUrl(): string | undefined {
	return ownmailNylasEnvironment() === 'staging' ? STAGING_DASHBOARD_ACCOUNT_URL : undefined
}

export function gatewayUrls(): Record<Region, string> {
	return ownmailNylasEnvironment() === 'staging' ? STAGING_GATEWAY_URLS : { ...GATEWAY_URLS }
}

export function apiBaseUrl(region: Region): string {
	return ownmailNylasEnvironment() === 'staging' ? STAGING_API_BASE_URL : V3_URLS[region]
}

export function deployedApiBaseUrl(region: Region): string | undefined {
	return ownmailNylasEnvironment() === 'staging' ? apiBaseUrl(region) : undefined
}

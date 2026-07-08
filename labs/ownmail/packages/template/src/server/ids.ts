const MAX_PROVIDER_ID_LENGTH = 1000

export function validNylasProviderId(value: string | null | undefined): value is string {
	return (
		typeof value === 'string' &&
		value.length > 0 &&
		value.length <= MAX_PROVIDER_ID_LENGTH &&
		!/[\r\n]/.test(value)
	)
}

export function requireNylasProviderId(value: string, label: string): string {
	if (!validNylasProviderId(value)) throw new Error(`Invalid ${label}`)
	return value
}

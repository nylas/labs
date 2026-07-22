/**
 * Compatibility facade for tests and incremental consumers. Runtime modules
 * import the owning domain directly so dependencies stay explicit.
 */
export * from '#features/calendar/lib/calendar-ui-model'
export * from '#features/mail/lib/mail-ui-model'
export * from '#shared/lib/color-tone'
export * from '#shared/lib/presentation'
export { cn } from '#shared/lib/utils'
export * from '../config/layout.js'

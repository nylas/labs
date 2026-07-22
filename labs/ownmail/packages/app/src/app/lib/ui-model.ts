/**
 * Compatibility facade for tests and incremental consumers. Runtime modules
 * import the owning domain directly so dependencies stay explicit.
 */
export * from '../../features/calendar/lib/calendar-ui-model.js'
export * from '../../features/mail/lib/mail-ui-model.js'
export * from '../../shared/lib/color-tone.js'
export * from '../../shared/lib/presentation.js'
export { cn } from '../../shared/lib/utils.js'
export * from '../config/layout.js'

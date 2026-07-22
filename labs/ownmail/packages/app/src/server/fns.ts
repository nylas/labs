/**
 * Compatibility facade for route tests and incremental consumers. New code
 * imports server functions from the feature that owns them.
 */
export * from '../features/account/server/account-functions.js'
export * from '../features/contacts/server/contact-functions.js'
export * from '../features/mail/server/mail-functions.js'

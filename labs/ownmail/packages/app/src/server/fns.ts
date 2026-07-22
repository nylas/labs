/**
 * Compatibility facade for route tests and incremental consumers. New code
 * imports server functions from the feature that owns them.
 */
export * from '#features/account/server/account-functions'
export * from '#features/contacts/server/contact-functions'
export * from '#features/mail/server/mail-functions'

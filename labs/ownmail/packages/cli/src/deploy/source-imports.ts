/**
 * Native package import aliases used by the editable OwnMail source template.
 * Keep these in sync with @ownmail/app/package.json.
 */
export const sourceImports = {
	'#app/components/*': './src/app/components/*.tsx',
	'#app/config/*': './src/app/config/*.ts',
	'#app/lib/*': './src/app/lib/*.ts',
	'#app/preferences/*': './src/app/preferences/*.ts',
	'#app/query/*': './src/app/query/*.tsx',
	'#features/account/server/*': './src/features/account/server/*.ts',
	'#features/auth/components/*': './src/features/auth/components/*.tsx',
	'#features/calendar/components/*': './src/features/calendar/components/*.tsx',
	'#features/calendar/lib/*': './src/features/calendar/lib/*.ts',
	'#features/calendar/server/*': './src/features/calendar/server/*.ts',
	'#features/calendar/state/*': './src/features/calendar/state/*.ts',
	'#features/contacts/components/*': './src/features/contacts/components/*.tsx',
	'#features/contacts/lib/*': './src/features/contacts/lib/*.ts',
	'#features/contacts/server/*': './src/features/contacts/server/*.ts',
	'#features/contacts/state/*': './src/features/contacts/state/*.ts',
	'#features/mail/components/*': './src/features/mail/components/*.tsx',
	'#features/mail/lib/*': './src/features/mail/lib/*.ts',
	'#features/mail/server/*': './src/features/mail/server/*.ts',
	'#features/mail/state/*': './src/features/mail/state/*.ts',
	'#server/*': './src/server/*.ts',
	'#shared/components/*': './src/shared/components/*.tsx',
	'#shared/hooks/*': './src/shared/hooks/*.ts',
	'#shared/lib/*': './src/shared/lib/*.ts',
} as const

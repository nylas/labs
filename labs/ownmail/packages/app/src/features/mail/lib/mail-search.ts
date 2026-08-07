export const MAIL_SEARCH_MAX_BYTES = 512
export const MAIL_SEARCH_MAX_NODES = 64
export const MAIL_SEARCH_MAX_DEPTH = 8

export type MailSearchValidation =
	| { valid: true; query: string }
	| { valid: false; query: string; message: string }

export type MailSearchSuggestion = {
	id: string
	label: string
	description: string
	start: number
	end: number
	text: string
	cursor: number
}

type Token = { kind: 'term' | 'phrase'; value: string } | { kind: 'and' | 'or' | 'not' | 'left' | 'right' }

type ParseResult = { positive: boolean; nodes: number }

const UNSUPPORTED_CHARACTER = /[:*&|!<>]/u
const SEARCHABLE_CHARACTER = /[\p{L}\p{N}@]/u

function invalid(query: string, message: string): MailSearchValidation {
	return { valid: false, query, message }
}

function tokenize(query: string): Token[] | string {
	const tokens: Token[] = []
	let index = 0
	while (index < query.length) {
		const character = query[index] as string
		if (/\s/u.test(character)) {
			index += 1
			continue
		}
		if (UNSUPPORTED_CHARACTER.test(character)) {
			return `“${character}” isn't supported in mail search.`
		}
		if (character === '(' || character === ')') {
			tokens.push({ kind: character === '(' ? 'left' : 'right' })
			index += 1
			continue
		}
		if (character === '"') {
			let phrase = ''
			index += 1
			while (index < query.length && query[index] !== '"') {
				const phraseCharacter = query[index] as string
				if (UNSUPPORTED_CHARACTER.test(phraseCharacter)) {
					return `“${phraseCharacter}” isn't supported in mail search.`
				}
				phrase += phraseCharacter
				index += 1
			}
			if (query[index] !== '"') return 'Close the quoted phrase before searching.'
			if (!phrase.trim() || !SEARCHABLE_CHARACTER.test(phrase)) {
				return 'Quoted phrases need at least one searchable word.'
			}
			tokens.push({ kind: 'phrase', value: phrase })
			index += 1
			continue
		}
		if (character === '-') {
			const next = query[index + 1]
			if (!next || /\s/u.test(next) || next === '-') {
				return 'Attach “-” directly to one term, phrase, or group.'
			}
			tokens.push({ kind: 'not' })
			index += 1
			continue
		}

		let value = ''
		while (index < query.length) {
			const termCharacter = query[index] as string
			if (/\s/u.test(termCharacter) || termCharacter === '(' || termCharacter === ')') break
			if (termCharacter === '"') return 'Start a quoted phrase after a space or operator.'
			if (UNSUPPORTED_CHARACTER.test(termCharacter)) {
				return `“${termCharacter}” isn't supported in mail search.`
			}
			value += termCharacter
			index += 1
		}
		if (!SEARCHABLE_CHARACTER.test(value)) return 'Add a searchable word or email address.'
		const operator = value.toUpperCase()
		tokens.push(
			operator === 'AND' ? { kind: 'and' } : operator === 'OR' ? { kind: 'or' } : { kind: 'term', value },
		)
	}
	return tokens
}

function parse(tokens: Token[]): ParseResult | string {
	let index = 0
	let depth = 0

	function parsePrimary(): ParseResult | string {
		const token = tokens[index]
		if (!token) return 'Finish the search expression before searching.'
		if (token.kind === 'term' || token.kind === 'phrase') {
			index += 1
			return { positive: true, nodes: 1 }
		}
		if (token.kind !== 'left') return 'Add a term, phrase, or group here.'
		index += 1
		depth += 1
		if (depth > MAIL_SEARCH_MAX_DEPTH)
			return `Search groups can be nested up to ${MAIL_SEARCH_MAX_DEPTH} levels.`
		if (tokens[index]?.kind === 'right') return 'Search groups cannot be empty.'
		const result = parseQuery()
		if (typeof result === 'string') return result
		if (tokens[index]?.kind !== 'right') return 'Close every search group with “)”.'
		index += 1
		depth -= 1
		return result
	}

	function parseUnary(): ParseResult | string {
		if (tokens[index]?.kind !== 'not') return parsePrimary()
		index += 1
		const result = parsePrimary()
		if (typeof result === 'string') return result
		return { positive: false, nodes: result.nodes + 1 }
	}

	function canStartUnary(token: Token | undefined): boolean {
		return (
			token?.kind === 'term' || token?.kind === 'phrase' || token?.kind === 'left' || token?.kind === 'not'
		)
	}

	function parseAnd(): ParseResult | string {
		let result = parseUnary()
		if (typeof result === 'string') return result
		let parts = 1
		while (true) {
			const token = tokens[index]
			if (token?.kind === 'and') {
				index += 1
				if (!canStartUnary(tokens[index])) return 'Add a term, phrase, or group after AND.'
			} else if (!canStartUnary(token)) {
				break
			}
			const next = parseUnary()
			if (typeof next === 'string') return next
			result = { positive: result.positive || next.positive, nodes: result.nodes + next.nodes }
			parts += 1
		}
		return { ...result, nodes: result.nodes + (parts > 1 ? 1 : 0) }
	}

	function parseQuery(): ParseResult | string {
		let result = parseAnd()
		if (typeof result === 'string') return result
		let alternatives = 1
		if (!result.positive && tokens[index]?.kind === 'or') {
			return 'Each OR alternative needs a positive search term.'
		}
		while (tokens[index]?.kind === 'or') {
			index += 1
			const next = parseAnd()
			if (typeof next === 'string') return next
			if (!result.positive || !next.positive) return 'Each OR alternative needs a positive search term.'
			result = { positive: true, nodes: result.nodes + next.nodes }
			alternatives += 1
		}
		return { ...result, nodes: result.nodes + (alternatives > 1 ? 1 : 0) }
	}

	const result = parseQuery()
	if (typeof result === 'string') return result
	if (index !== tokens.length) {
		return 'Remove the unmatched “)”.'
	}
	if (!result.positive) return 'Add a positive term before exclusions.'
	return result
}

export function validateMailSearchQuery(raw: string): MailSearchValidation {
	const query = raw.trim()
	if (!query) return { valid: true, query: '' }
	if (new TextEncoder().encode(query).byteLength > MAIL_SEARCH_MAX_BYTES) {
		return invalid(query, `Keep the search under ${MAIL_SEARCH_MAX_BYTES} UTF-8 bytes.`)
	}
	const tokens = tokenize(query)
	if (typeof tokens === 'string') return invalid(query, tokens)
	const parsed = parse(tokens)
	if (typeof parsed === 'string') return invalid(query, parsed)
	if (parsed.nodes > MAIL_SEARCH_MAX_NODES) {
		return invalid(query, `Use at most ${MAIL_SEARCH_MAX_NODES} terms and operators in one search.`)
	}
	return { valid: true, query }
}

export function requireValidMailSearchQuery(raw: unknown): string {
	if (typeof raw !== 'string') throw new Error('Invalid search query')
	const result = validateMailSearchQuery(raw)
	if (!result.valid) throw new Error('Invalid search query')
	return result.query
}

function insertSuggestion(
	id: string,
	label: string,
	description: string,
	start: number,
	end: number,
	text: string,
	cursorOffset = text.length,
): MailSearchSuggestion {
	return { id, label, description, start, end, text, cursor: start + cursorOffset }
}

export function mailSearchSuggestions(value: string, cursor = value.length): MailSearchSuggestion[] {
	const beforeCursor = value.slice(0, cursor)
	const trimmed = value.trim()
	if (!trimmed) {
		return [
			insertSuggestion('phrase', 'Exact phrase', 'Words together, in this order', 0, value.length, '""', 1),
			insertSuggestion(
				'either',
				'Either expression',
				'Match one side or the other',
				0,
				value.length,
				'( OR )',
				1,
			),
		]
	}

	const suggestions: MailSearchSuggestion[] = []
	const operatorMatch = beforeCursor.match(/(?:^|\s|\()(a(?:n(?:d)?)?|o(?:r)?)$/iu)
	if (operatorMatch?.[1]) {
		const fragment = operatorMatch[1]
		const operator = fragment.toLowerCase().startsWith('a') ? 'AND' : 'OR'
		const start = cursor - fragment.length
		suggestions.push(
			insertSuggestion(
				`complete-${operator.toLowerCase()}`,
				operator,
				operator === 'AND' ? 'Require both expressions' : 'Match either expression',
				start,
				cursor,
				`${operator} `,
			),
		)
	}

	const validation = validateMailSearchQuery(value)
	if (validation.valid && validation.query) {
		const suffix = cursor > 0 && /\s/u.test(value[cursor - 1] ?? '') ? '' : ' '
		suggestions.push(
			insertSuggestion('or', 'OR another expression', 'Match either side', cursor, cursor, `${suffix}OR `),
			insertSuggestion(
				'exclude',
				'Exclude a term',
				'Skip results containing the next term or group',
				cursor,
				cursor,
				`${suffix}-`,
			),
		)
		if (!/^\([\s\S]+\)$/u.test(trimmed) && /\s|\b(?:AND|OR)\b/iu.test(trimmed)) {
			const start = value.indexOf(trimmed)
			suggestions.push(
				insertSuggestion(
					'group',
					'Group this expression',
					'Keep its logic together with parentheses',
					start,
					start + trimmed.length,
					`(${trimmed})`,
				),
			)
		}
	}
	return suggestions.slice(0, 4)
}

export function applyMailSearchSuggestion(
	value: string,
	suggestion: MailSearchSuggestion,
): { value: string; cursor: number } {
	return {
		value: `${value.slice(0, suggestion.start)}${suggestion.text}${value.slice(suggestion.end)}`,
		cursor: suggestion.cursor,
	}
}

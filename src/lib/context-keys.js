export function isContextKey({ key, contextPrefix, contextSuffix }) {
	if (contextPrefix?.length) return key.startsWith(contextPrefix)
	if (contextSuffix?.length) return key.endsWith(contextSuffix)
	throw new Error(`Either the context prefix or context suffix must be defined`)
}

export function formatContextKeyFromKey({ key, prefix, suffix }) {
	return `${prefix}${key}${suffix}`
}


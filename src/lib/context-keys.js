import { localizeFormatted } from '../localizer/localize.js'

export function isContextKey({ appLang, key, contextPrefix, contextSuffix, log }) {
	if (contextPrefix?.length) return key.startsWith(contextPrefix)
	if (contextSuffix?.length) return key.endsWith(contextSuffix)
	log.D(`contextPrefix=${contextPrefix}`)
	log.D(`contextSuffix=${contextSuffix}`)
	throw new Error(
		localizeFormatted({
			token: 'error-context-prefix-and-suffix-not-defined',
			lang: appLang,
			log
		})
	)
}

export function formatContextKeyFromKey({ key, prefix, suffix }) {
	return `${prefix}${key}${suffix}`
}

import { isBcp47LanguageTagValid } from './localizer/localize.js'
import { unique } from './utils.js'

// Helper function to parse comma-separated list
export function languageList(value, log) {
	const languages = unique(value.split(',').map(item => item.trim()))
	const invalid = languages.filter(tag => !isBcp47LanguageTagValid(tag))
	if (invalid.length) {
		log.E(`Found invalid language(s): ${invalid.join(', ')}`)
		process.exit(1)
	}
	return languages
}

export function keyList(value) {
	return value.split(',').map(item => item.trim())
}


const PLACEHOLDER_RE = /(%%[^%]+%%|\{\{[^}]+\}\}|%[sdifFox]|\{\d+\})/g

// Deliberately narrow, high-confidence signs that a model returned commentary
// instead of a translation. This is not intended to judge translation quality.
const MODEL_COMMENTARY_PATTERNS = [
	/\b(?:I (?:apologize|cannot|can't|do not|don't|am unable|recommend|need to correct|should clarify)|Unable to translate)\b/i,
	/\b(?:Here is the correct translation|Please (?:provide|clarify) the target language|professional translation service|consult(?:ing)? (?:with )?a native speaker)\b/i,
	/(?:^|\n)\s*(?:Note|Translation):\s/i,
	/(?:^|\n)\s*AI:\s*(?:Human|I)\b/i,
]

const MAX_TRANSLATION_LENGTH_MULTIPLIER = 8
const MAX_TRANSLATION_LENGTH_FLOOR = 500

export function extractPlaceholders(value) {
	if (typeof value !== 'string') return []
	return (value.match(PLACEHOLDER_RE) || []).sort()
}

export function validateTranslation({ source, translated }) {
	if (typeof translated !== 'string' || !translated.trim()) {
		return { valid: false, reason: 'translation is empty or not a string' }
	}

	const sourcePlaceholders = extractPlaceholders(source)
	const translatedPlaceholders = extractPlaceholders(translated)
	if (sourcePlaceholders.join('\0') !== translatedPlaceholders.join('\0')) {
		return {
			valid: false,
			reason: `placeholder mismatch (expected ${JSON.stringify(sourcePlaceholders)}, got ${JSON.stringify(translatedPlaceholders)})`,
		}
	}

	if (MODEL_COMMENTARY_PATTERNS.some(pattern => pattern.test(translated))) {
		return { valid: false, reason: 'translation contains model commentary or a refusal' }
	}

	const maxLength = Math.max(String(source ?? '').length * MAX_TRANSLATION_LENGTH_MULTIPLIER, MAX_TRANSLATION_LENGTH_FLOOR)
	if (translated.length > maxLength) {
		return { valid: false, reason: `translation is implausibly long (${translated.length} characters; maximum ${maxLength})` }
	}

	return { valid: true, reason: null }
}

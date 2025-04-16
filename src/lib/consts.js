import * as path from 'path'

export const TRANSLATION_FAILED_RESPONSE_TEXT = '<<<TRANSLATION_FAILED>>>'
export const LANGTAG_ENGLISH = 'en'
export const LANGTAG_DEFAULT = LANGTAG_ENGLISH

export const VALID_TRANSLATION_PROVIDERS = [
	'anthropic',
	'google',
	'openai'
]

export const ENV_VARS = [
	{ name: 'ANTHROPIC_API_KEY', description: 'Your Anthropic API key' },
	{ name: 'OPENAI_API_KEY', description: 'Your OpenAI API key' },
	{ name: 'GOOGLE_API_KEY', description: 'Your Google Gemini API key' },
	{ name: 'ALT_LANGUAGE', description: 'POSIX locale used for display' }
]

export const LOCALIZATION_SRC_DIR = path.resolve('localization')
export const DEFAULT_CACHE_FILENAME = '.localization.cache.json'
export const DEFAULT_CONFIG_FILENAME = 'config.json'
export const OVERLOADED_BACKOFF_INTERVAL_MS = 30 * 1000
export const CWD = process.cwd()

export const SUPPORTED_REFERENCE_FILE_EXTENSIONS = [
	'js',
	'mjs',
	'json',
	'jsonc'
]

export const DEFAULT_LLM_MODELS = {
	anthropic: 'claude-3-7-sonnet-20250219',
	google: 'gemini-2.0-flash',
	openai: 'gpt-4-turbo'
}


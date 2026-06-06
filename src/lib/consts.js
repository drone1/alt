export const LANGTAG_ENGLISH = 'en'
export const LANGTAG_DEFAULT = LANGTAG_ENGLISH

// Vendors ALT can translate through. Pick one with `--provider <name>`.
export const VALID_TRANSLATION_PROVIDERS = [
	'anthropic',
	'google',
	'openai'
]

// How ALT reaches each vendor. `api` = direct HTTP API with an API key
// (`<PROVIDER>_API_KEY` env var). `harness` = vendor's own CLI tool in
// non-interactive mode, authenticated via that tool's own session — currently
// only Anthropic exposes this, via the `claude` (Claude Code) CLI.
//
// The first entry for each provider is the default when `--access` is omitted.
export const PROVIDER_ACCESS_METHODS = {
	anthropic: [ 'api', 'harness' ],
	google: [ 'api' ],
	openai: [ 'api' ],
}

export const DEFAULT_ACCESS_METHOD = 'api'

export const ENV_VARS = [
	{ name: 'ANTHROPIC_API_KEY', description: 'Your Anthropic API key (for --provider anthropic --access api)' },
	{ name: 'OPENAI_API_KEY', description: 'Your OpenAI API key' },
	{ name: 'GOOGLE_API_KEY', description: 'Your Google Gemini API key' },
	{ name: 'ALT_LANGUAGE', description: 'BCP47 language tag used for display' }
]

// Default per-batch translation count for access methods that expose batched
// translation (currently `harness`). The sweet spot: amortizes the harness CLI's
// ~1.5–2s spawn cost over many translations while keeping the redo cost on a
// poison-key failure bounded.
export const DEFAULT_BATCH_SIZE = 25

// Default number of concurrent batches across languages. 1 is safe for any
// provider; bumping is usually fine for `harness` on a fresh subscription.
export const DEFAULT_CONCURRENCY = 1

export const LOCALIZATION_SRC_DIR = 'localization'
export const DEFAULT_CACHE_FILENAME = '.localization.cache.json'
export const DEFAULT_CONFIG_FILENAME = 'alt.config.json'
export const OVERLOADED_BACKOFF_INTERVAL_MS = 30 * 1000
export const CWD = process.cwd()

export const SUPPORTED_REFERENCE_FILE_EXTENSIONS = [
	'js',
	'mjs',
	'json',
	'jsonc'
]

// Default model per (provider, accessMethod). The `harness` access method
// accepts short aliases (haiku/sonnet/opus) which auto-track the latest model
// of each tier — usually what you want when piggybacking on a subscription.
export const DEFAULT_LLM_MODELS = {
	anthropic: {
		api: 'claude-haiku-4-5-20251001',
		harness: 'haiku',
	},
	google: {
		api: 'gemini-2.0-flash',
	},
	openai: {
		api: 'gpt-4.1-mini',
	},
}

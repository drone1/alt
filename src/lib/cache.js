import { readJsonFile } from './io.js'
import { KEY_HASH_LENGTH } from './utils.js'

// Sections of the cache that are keyed by target language at the top level.
// Everything in them belongs to exactly one language, so anything under a
// language we are no longer translating is dead weight.
const LANGUAGE_KEYED_SECTIONS = Object.freeze(['referenceKeyHashes', 'state', 'untranslatable'])

// Nothing ever evicted from this file. A language dropped from targetLanguages
// kept its entries forever, and because the whole document is rewritten on every
// run those entries were paid for again every time. In one consuming project 65
// of 97 `state` languages and 98 of 128 `referenceKeyHashes` languages were dead
// — 17 MB of a 57 MB file that no run would ever read again.
//
// Two further classes of junk accumulate here:
//
//   Legacy flat entries. `referenceKeyHashes` used to be a flat key -> hash map
//   before it was nested per language. The nesting shipped without a migration,
//   so the old string-valued entries sit at the language level indefinitely; the
//   `?.[targetLang]?.[key]` read path tolerates them purely by accident.
//
//   Case variants. Cache sections are keyed by the raw targetLang spelling while
//   output filenames are lowercased, so re-casing a language in config orphans
//   its cache under the old spelling and silently re-translates the whole
//   language from scratch. Matching case-insensitively and re-keying to the
//   configured spelling makes that a no-op instead.
export function pruneCache({ cache, targetLanguages = [], referenceLanguage = null, log = null }) {
	// The reference language is legitimately present: a same-language pass records
	// hashes for it like any other target.
	const live = new Map()
	for (const lang of [ ...targetLanguages, ...(referenceLanguage ? [referenceLanguage] : []) ]) {
		if (typeof lang === 'string' && lang.length) live.set(lang.toLowerCase(), lang)
	}

	const dropped = { languages: new Set(), legacyEntries: 0, recased: new Set() }

	// Nothing configured means nothing is knowably dead — evicting on an empty
	// list would wipe a cache whenever a caller forgot to pass the languages.
	if (!live.size) return { cache, dropped }

	for (const section of LANGUAGE_KEYED_SECTIONS) {
		const original = cache[section]
		if (!original || typeof original !== 'object') continue

		const rebuilt = {}
		for (const [rawLang, value] of Object.entries(original)) {
			// Legacy flat entry: a language bucket is always an object.
			if (!value || typeof value !== 'object' || Array.isArray(value)) {
				dropped.legacyEntries++
				continue
			}
			const canonical = live.get(rawLang.toLowerCase())
			if (!canonical) {
				dropped.languages.add(rawLang)
				continue
			}
			if (canonical !== rawLang) dropped.recased.add(`${rawLang} -> ${canonical}`)
			// Merge rather than overwrite, so both spellings' work survives a
			// re-casing. The configured spelling wins on conflict.
			rebuilt[canonical] = { ...(rebuilt[canonical] ?? {}), ...value }
		}
		cache[section] = rebuilt
	}

	if (log && (dropped.languages.size || dropped.legacyEntries || dropped.recased.size)) {
		const parts = []
		if (dropped.languages.size) parts.push(`${dropped.languages.size} unconfigured language(s)`)
		if (dropped.legacyEntries) parts.push(`${dropped.legacyEntries} legacy flat entr(ies)`)
		if (dropped.recased.size) parts.push(`re-cased ${[ ...dropped.recased ].join(', ')}`)
		log.V(`Cache cleanup: ${parts.join('; ')}`)
	}

	return { cache, dropped }
}

// Shorten any stored hash written before KEY_HASH_LENGTH was introduced.
// Truncating a prefix of the same digest yields exactly what calculateHash now
// returns, so every surviving entry still matches and nothing is re-translated.
// Without this, shortening the digest would invalidate the entire cache.
export function migrateHashLengths(cache) {
	let migrated = 0
	const shorten = (v) => {
		if (typeof v !== 'string' || v.length <= KEY_HASH_LENGTH) return v
		migrated++
		return v.slice(0, KEY_HASH_LENGTH)
	}

	cache.referenceHash = shorten(cache.referenceHash)

	for (const section of ['referenceKeyHashes', 'untranslatable']) {
		const bucket = cache[section]
		if (!bucket || typeof bucket !== 'object') continue
		for (const lang of Object.keys(bucket)) {
			const entries = bucket[lang]
			if (!entries || typeof entries !== 'object') continue
			for (const key of Object.keys(entries)) entries[key] = shorten(entries[key])
		}
	}

	for (const lang of Object.keys(cache.state ?? {})) {
		const keyHashes = cache.state[lang]?.keyHashes
		if (!keyHashes || typeof keyHashes !== 'object') continue
		for (const key of Object.keys(keyHashes)) keyHashes[key] = shorten(keyHashes[key])
	}

	return { cache, migrated }
}

export async function loadCache(path, { targetLanguages = [], referenceLanguage = null, log = null } = {}) {
	const storedCache = await readJsonFile(path)
	const cache = {
		referenceHash: storedCache?.referenceHash ?? '',
		referenceKeyHashes: storedCache?.referenceKeyHashes ?? {},
		state: storedCache?.state ?? {},
		// untranslatable[targetLang][key] = <sourceHash>. Marks a (lang, key) the
		// provider returned verbatim from a source that *should* have been
		// translated — e.g. a model that doesn't speak that target language and
		// just echoed the English. Skipping these on subsequent runs prevents the
		// orchestrator from re-asking the same impossible question, and dropping
		// them from the output JSON lets the runtime fall back to the source
		// language instead of shipping an English string in a non-English file.
		untranslatable: storedCache?.untranslatable ?? {},
		lastRun: storedCache?.lastRun ?? null,
	}
	const { migrated } = migrateHashLengths(cache)
	if (migrated && log) log.V(`Cache cleanup: shortened ${migrated} oversized hash(es)`)
	return pruneCache({ cache, targetLanguages, referenceLanguage, log }).cache
}

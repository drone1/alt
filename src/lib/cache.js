import { readJsonFile } from './io.js'
import { KEY_HASH_LENGTH } from './utils.js'

// referenceKeyHashes stored one key -> hash map PER LANGUAGE, but the value is a
// hash of the reference text, which is the same text for every language. In a
// real cache 178,823 pairs collapsed to 6,144 distinct keys with only 322
// genuine per-language deviations — 9.7 MB to hold ~0.4 MB of information, and a
// new reference key cost one entry per language instead of one entry.
//
// The shape is now a canonical `sourceKeyHashes` plus `sourceKeyHashOverrides`
// carrying only what actually differs. A deviation means that language is stale
// for that key. An override of null is a TOMBSTONE: it records "this language
// has no hash for this key", which absence alone cannot express once a canonical
// value exists, and which markUntranslatable relies on.
export function getReferenceKeyHash(cache, lang, key) {
	const override = cache.sourceKeyHashOverrides?.[lang]
	if (override && key in override) return override[key] ?? undefined
	return cache.sourceKeyHashes?.[key]
}

export function setReferenceKeyHash(cache, lang, key, hash) {
	cache.sourceKeyHashes = cache.sourceKeyHashes ?? {}
	cache.sourceKeyHashOverrides = cache.sourceKeyHashOverrides ?? {}

	// First writer defines canonical. Every language in a run writes the same
	// reference hash for a key, so canonical converges and overrides stay rare.
	if (!(key in cache.sourceKeyHashes)) {
		cache.sourceKeyHashes[key] = hash
	}

	const langOverrides = cache.sourceKeyHashOverrides[lang]
	if (cache.sourceKeyHashes[key] === hash) {
		// Matches canonical — any override, including a tombstone, is now wrong.
		if (langOverrides && key in langOverrides) {
			delete langOverrides[key]
			if (!Object.keys(langOverrides).length) delete cache.sourceKeyHashOverrides[lang]
		}
		return
	}
	cache.sourceKeyHashOverrides[lang] = langOverrides ?? {}
	cache.sourceKeyHashOverrides[lang][key] = hash
}

export function deleteReferenceKeyHash(cache, lang, key) {
	// A tombstone is required rather than a delete: with a canonical value
	// present, removing the override would resurrect the canonical hash for this
	// language instead of clearing it.
	if (cache.sourceKeyHashes && key in cache.sourceKeyHashes) {
		cache.sourceKeyHashOverrides = cache.sourceKeyHashOverrides ?? {}
		cache.sourceKeyHashOverrides[lang] = cache.sourceKeyHashOverrides[lang] ?? {}
		cache.sourceKeyHashOverrides[lang][key] = null
		return
	}
	const langOverrides = cache.sourceKeyHashOverrides?.[lang]
	if (langOverrides && key in langOverrides) delete langOverrides[key]
}

// Fold a legacy per-language referenceKeyHashes map into canonical + overrides.
// Canonical is the most common hash for each key, which minimises overrides.
export function migrateReferenceKeyHashes(cache) {
	const legacy = cache.referenceKeyHashes
	if (!legacy || typeof legacy !== 'object' || !Object.keys(legacy).length) {
		cache.sourceKeyHashes = cache.sourceKeyHashes ?? {}
		cache.sourceKeyHashOverrides = cache.sourceKeyHashOverrides ?? {}
		delete cache.referenceKeyHashes
		return { cache, canonical: 0, overrides: 0 }
	}

	const countsByKey = new Map()
	for (const entries of Object.values(legacy)) {
		if (!entries || typeof entries !== 'object') continue
		for (const [key, hash] of Object.entries(entries)) {
			if (typeof hash !== 'string') continue
			if (!countsByKey.has(key)) countsByKey.set(key, new Map())
			const counts = countsByKey.get(key)
			counts.set(hash, (counts.get(hash) ?? 0) + 1)
		}
	}

	const canonical = {}
	for (const [key, counts] of countsByKey) {
		let bestHash = null
		let bestCount = -1
		for (const [hash, count] of counts) {
			if (count > bestCount) { bestHash = hash; bestCount = count }
		}
		canonical[key] = bestHash
	}

	const overrides = {}
	let overrideCount = 0
	for (const [lang, entries] of Object.entries(legacy)) {
		if (!entries || typeof entries !== 'object') continue
		for (const [key, hash] of Object.entries(entries)) {
			if (typeof hash !== 'string' || canonical[key] === hash) continue
			overrides[lang] = overrides[lang] ?? {}
			overrides[lang][key] = hash
			overrideCount++
		}
		// A key this language never had must stay absent for it. Without a
		// tombstone the canonical hash answers the lookup instead, the key looks
		// already up to date, and that language never gets it translated at all.
		for (const key of Object.keys(canonical)) {
			if (key in entries) continue
			overrides[lang] = overrides[lang] ?? {}
			overrides[lang][key] = null
			overrideCount++
		}
	}

	// Pre-existing values win: a partially migrated cache must not be clobbered.
	cache.sourceKeyHashes = { ...canonical, ...(cache.sourceKeyHashes ?? {}) }
	cache.sourceKeyHashOverrides = { ...overrides, ...(cache.sourceKeyHashOverrides ?? {}) }
	delete cache.referenceKeyHashes

	return { cache, canonical: Object.keys(canonical).length, overrides: overrideCount }
}

// Re-pick canonical from what the languages actually hold now.
//
// `setReferenceKeyHash` defines canonical on first write and never revises it,
// which is fine until a reference string changes: canonical stays pinned to the
// old hash and every language then stores an identical override for the new
// one. That is precisely the per-language duplication canonical exists to
// remove, and it compounds — one consuming project went from 10,433 overrides
// to 92,059 in a single run, with canonical stuck at 6,242 keys.
//
// Running this on load bounds the damage: overrides are re-derived from the
// materialized per-language view each time, so a key where everyone now agrees
// collapses back to canonical alone instead of accumulating forever.
export function recanonicalizeReferenceKeyHashes(cache, languages) {
	// The materialized view is what each language would actually read, so
	// rebuilding from it cannot change any lookup's answer — only where the
	// answer is stored. A language with no entry for a key stays absent, and
	// migrateReferenceKeyHashes turns that absence back into a tombstone.
	const live = languages.filter(lang => typeof lang === 'string' && lang.length)
	if (!live.length) return { cache, overridesBefore: 0, overridesAfter: 0 }

	const overrides = cache.sourceKeyHashOverrides ?? {}
	let overridesBefore = 0
	for (const lang of Object.keys(overrides)) overridesBefore += Object.keys(overrides[lang]).length

	const keys = new Set(Object.keys(cache.sourceKeyHashes ?? {}))
	for (const lang of Object.keys(overrides)) for (const key of Object.keys(overrides[lang])) keys.add(key)

	const materialized = {}
	for (const lang of live) {
		const entries = {}
		for (const key of keys) {
			const hash = getReferenceKeyHash(cache, lang, key)
			if (typeof hash === 'string') entries[key] = hash
		}
		materialized[lang] = entries
	}

	cache.referenceKeyHashes = materialized
	cache.sourceKeyHashes = {}
	cache.sourceKeyHashOverrides = {}
	const { overrides: overridesAfter } = migrateReferenceKeyHashes(cache)

	return { cache, overridesBefore, overridesAfter }
}

// Sections of the cache that are keyed by target language at the top level.
// Everything in them belongs to exactly one language, so anything under a
// language we are no longer translating is dead weight.
const LANGUAGE_KEYED_SECTIONS = Object.freeze(['sourceKeyHashOverrides', 'state', 'untranslatable'])

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

	for (const key of Object.keys(cache.sourceKeyHashes ?? {})) {
		cache.sourceKeyHashes[key] = shorten(cache.sourceKeyHashes[key])
	}

	for (const section of ['referenceKeyHashes', 'sourceKeyHashOverrides', 'untranslatable']) {
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

export async function loadCache(path, { targetLanguages = [], referenceLanguage = null, log = null, trackTargetEdits = true } = {}) {
	const storedCache = await readJsonFile(path)
	const cache = {
		referenceHash: storedCache?.referenceHash ?? '',
		referenceKeyHashes: storedCache?.referenceKeyHashes ?? {},
		sourceKeyHashes: storedCache?.sourceKeyHashes ?? {},
		sourceKeyHashOverrides: storedCache?.sourceKeyHashOverrides ?? {},
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
	const { canonical, overrides } = migrateReferenceKeyHashes(cache)
	if (canonical && log) log.V(`Cache cleanup: folded referenceKeyHashes into ${canonical} canonical + ${overrides} override(s)`)
	const { migrated } = migrateHashLengths(cache)
	if (migrated && log) log.V(`Cache cleanup: shortened ${migrated} oversized hash(es)`)

	// `state` exists only to protect hand-edited target values. With tracking
	// off it is never written or consulted again, but a cache migrated from a
	// tracked run still carries the whole blob and rewrites it every run — 9.7
	// MB of a 15 MB file in one project. Drop it here so opting out actually
	// reclaims the space instead of merely freezing it.
	if (!trackTargetEdits && Object.keys(cache.state ?? {}).length) {
		if (log) log.V(`Cache cleanup: dropped ${Object.keys(cache.state).length} state language(s) (target-edit tracking is off)`)
		cache.state = {}
	}

	const pruned = pruneCache({ cache, targetLanguages, referenceLanguage, log }).cache

	const languages = [ ...targetLanguages, ...(referenceLanguage ? [referenceLanguage] : []) ]
	const { overridesBefore, overridesAfter } = recanonicalizeReferenceKeyHashes(pruned, languages)
	if (log && overridesBefore !== overridesAfter) {
		log.V(`Cache cleanup: re-canonicalized reference hashes, ${overridesBefore} override(s) -> ${overridesAfter}`)
	}
	return pruned
}

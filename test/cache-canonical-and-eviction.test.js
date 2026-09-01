import { expect } from 'chai'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import {
	deleteReferenceKeyHash,
	getReferenceKeyHash,
	loadCache,
	recanonicalizeReferenceKeyHashes,
	setReferenceKeyHash,
} from '../src/lib/cache.js'

const LANGS = ['fr', 'de', 'nl', 'sv']
const OLD_HASH = 'aaaaaaaaaaaaaaaa'
const NEW_HASH = 'bbbbbbbbbbbbbbbb'
const KEY = 'page-editor-add-component'

function countOverrides(cache) {
	let n = 0
	for (const lang of Object.keys(cache.sourceKeyHashOverrides ?? {})) {
		n += Object.keys(cache.sourceKeyHashOverrides[lang]).length
	}
	return n
}

describe('canonical reference hashes', () => {
	// Reproduces the production shape: canonical pinned to a hash nobody holds
	// any more, with every language carrying the same override for the new one.
	function staleCanonicalCache() {
		const cache = { sourceKeyHashes: { [KEY]: OLD_HASH }, sourceKeyHashOverrides: {} }
		for (const lang of LANGS) setReferenceKeyHash(cache, lang, KEY, NEW_HASH)
		return cache
	}

	it('reproduces the leak: a changed reference value gives every language its own override', () => {
		const cache = staleCanonicalCache()
		expect(cache.sourceKeyHashes[KEY]).to.equal(OLD_HASH)
		expect(countOverrides(cache)).to.equal(LANGS.length)
		// Every one of them is the same string — pure duplication.
		for (const lang of LANGS) expect(cache.sourceKeyHashOverrides[lang][KEY]).to.equal(NEW_HASH)
	})

	it('collapses unanimous overrides back into canonical', () => {
		const cache = staleCanonicalCache()
		const { overridesBefore, overridesAfter } = recanonicalizeReferenceKeyHashes(cache, LANGS)

		expect(overridesBefore).to.equal(LANGS.length)
		expect(overridesAfter).to.equal(0)
		expect(cache.sourceKeyHashes[KEY]).to.equal(NEW_HASH)
		expect(countOverrides(cache)).to.equal(0)
	})

	it('never changes what any language reads', () => {
		const cache = staleCanonicalCache()
		// One straggler still on the old hash: it has not been re-run yet, and it
		// MUST stay stale or it will never be re-translated.
		setReferenceKeyHash(cache, 'sv', KEY, OLD_HASH)

		const before = LANGS.map(lang => getReferenceKeyHash(cache, lang, KEY))
		recanonicalizeReferenceKeyHashes(cache, LANGS)
		const after = LANGS.map(lang => getReferenceKeyHash(cache, lang, KEY))

		expect(after).to.deep.equal(before)
		expect(getReferenceKeyHash(cache, 'sv', KEY)).to.equal(OLD_HASH)
		// Canonical follows the majority, so the straggler is the only override.
		expect(cache.sourceKeyHashes[KEY]).to.equal(NEW_HASH)
		expect(countOverrides(cache)).to.equal(1)
	})

	it('preserves an explicit tombstone', () => {
		const cache = { sourceKeyHashes: {}, sourceKeyHashOverrides: {} }
		for (const lang of ['fr', 'de', 'nl']) setReferenceKeyHash(cache, lang, KEY, NEW_HASH)

		// A tombstone is the only way to say "this language has no hash for this
		// key" once a canonical value exists. Re-canonicalization has to keep it,
		// or the language silently inherits canonical, reads as up to date, and is
		// never translated again.
		deleteReferenceKeyHash(cache, 'sv', KEY)
		expect(getReferenceKeyHash(cache, 'sv', KEY)).to.equal(undefined)

		recanonicalizeReferenceKeyHashes(cache, LANGS)
		expect(getReferenceKeyHash(cache, 'sv', KEY)).to.equal(undefined)
		expect(cache.sourceKeyHashOverrides.sv[KEY]).to.equal(null)
	})

	// Not the fix's doing, but worth pinning: absent an explicit tombstone, a
	// language with no recorded hash reads canonical. The upfront `missingOutputKey`
	// check is what actually gets such a key translated, not the hash.
	it('leaves the inherit-canonical behaviour of an unrecorded language alone', () => {
		const cache = { sourceKeyHashes: {}, sourceKeyHashOverrides: {} }
		for (const lang of ['fr', 'de', 'nl']) setReferenceKeyHash(cache, lang, KEY, NEW_HASH)

		expect(getReferenceKeyHash(cache, 'sv', KEY)).to.equal(NEW_HASH)
		recanonicalizeReferenceKeyHashes(cache, LANGS)
		expect(getReferenceKeyHash(cache, 'sv', KEY)).to.equal(NEW_HASH)
	})

	it('does not compound across repeated runs', () => {
		const cache = staleCanonicalCache()
		recanonicalizeReferenceKeyHashes(cache, LANGS)

		// A second reference edit, then another load.
		const NEWER = 'cccccccccccccccc'
		for (const lang of LANGS) setReferenceKeyHash(cache, lang, KEY, NEWER)
		recanonicalizeReferenceKeyHashes(cache, LANGS)

		expect(cache.sourceKeyHashes[KEY]).to.equal(NEWER)
		expect(countOverrides(cache)).to.equal(0)
	})

	it('is a no-op when given no languages', () => {
		const cache = staleCanonicalCache()
		const overrides = countOverrides(cache)
		recanonicalizeReferenceKeyHashes(cache, [])
		expect(countOverrides(cache)).to.equal(overrides)
	})
})

describe('loadCache language eviction', () => {
	let dir
	let cachePath

	const write = (cache) => fs.writeFileSync(cachePath, JSON.stringify(cache))

	beforeEach(() => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), 'alt-evict-'))
		cachePath = path.join(dir, '.localization.cache.json')
		const state = {}
		const untranslatable = {}
		for (const lang of LANGS) {
			state[lang] = { keyHashes: { [KEY]: OLD_HASH } }
			untranslatable[lang] = { 'some-key': OLD_HASH }
		}
		write({ referenceHash: OLD_HASH, sourceKeyHashes: { [KEY]: OLD_HASH }, state, untranslatable })
	})

	afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

	it('evicts a language the project genuinely dropped', async () => {
		const cache = await loadCache(cachePath, { targetLanguages: ['fr', 'de', 'nl'], referenceLanguage: 'en' })
		expect(Object.keys(cache.state).sort()).to.deep.equal(['de', 'fr', 'nl'])
	})

	it('keeps every language when the run is narrowed to one', async () => {
		// The English-parity case. Passing only the languages this invocation
		// translates is what destroyed a real project's cache; the caller must
		// hand loadCache the configured set instead.
		const cache = await loadCache(cachePath, { targetLanguages: LANGS, referenceLanguage: 'en' })
		expect(Object.keys(cache.state).sort()).to.deep.equal([ ...LANGS ].sort())
		expect(Object.keys(cache.untranslatable).sort()).to.deep.equal([ ...LANGS ].sort())
	})

	it('evicts nothing when no languages are supplied', async () => {
		const cache = await loadCache(cachePath, { targetLanguages: [], referenceLanguage: null })
		expect(Object.keys(cache.state).sort()).to.deep.equal([ ...LANGS ].sort())
	})

	it('drops state entirely when target-edit tracking is off', async () => {
		const cache = await loadCache(cachePath, { targetLanguages: LANGS, referenceLanguage: 'en', trackTargetEdits: false })
		expect(cache.state).to.deep.equal({})
		// Everything else survives — only the hand-edit protection is discarded.
		expect(Object.keys(cache.untranslatable).sort()).to.deep.equal([ ...LANGS ].sort())
		expect(cache.sourceKeyHashes[KEY]).to.equal(OLD_HASH)
	})

	it('re-canonicalizes on load, not just when called directly', async () => {
		// The bloated shape as it appears on disk: canonical stuck on a hash no
		// language holds, every language carrying the same override.
		const overrides = {}
		for (const lang of LANGS) overrides[lang] = { [KEY]: NEW_HASH }
		write({ referenceHash: OLD_HASH, sourceKeyHashes: { [KEY]: OLD_HASH }, sourceKeyHashOverrides: overrides, state: {} })

		const cache = await loadCache(cachePath, { targetLanguages: LANGS, referenceLanguage: 'en' })

		// The four that agreed collapse into canonical and hold no override each.
		expect(cache.sourceKeyHashes[KEY]).to.equal(NEW_HASH)
		for (const lang of LANGS) {
			expect(getReferenceKeyHash(cache, lang, KEY)).to.equal(NEW_HASH)
			expect(cache.sourceKeyHashOverrides[lang] ?? {}, `${lang} override`).to.not.have.property(KEY)
		}
		// The reference language read the old canonical and must keep reading it,
		// so it is the one legitimate override left.
		expect(countOverrides(cache)).to.equal(1)
		expect(getReferenceKeyHash(cache, 'en', KEY)).to.equal(OLD_HASH)
	})

	it('keeps state when tracking is on', async () => {
		const cache = await loadCache(cachePath, { targetLanguages: LANGS, referenceLanguage: 'en', trackTargetEdits: true })
		expect(Object.keys(cache.state).sort()).to.deep.equal([ ...LANGS ].sort())
	})
})

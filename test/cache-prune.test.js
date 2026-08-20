import { expect } from 'chai'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import * as crypto from 'crypto'
import { deleteReferenceKeyHash, getReferenceKeyHash, loadCache, migrateHashLengths, migrateReferenceKeyHashes, pruneCache, setReferenceKeyHash } from '../src/lib/cache.js'
import { calculateHash, KEY_HASH_LENGTH } from '../src/lib/utils.js'
import { writeJsonFile, DEFAULT_JSON_INDENT } from '../src/lib/io.js'

const noopLog = { W: () => {}, V: () => {}, D: () => {}, E: () => {}, I: () => {}, T: () => {} }

const cacheWith = (overrides = {}) => ({
	referenceHash: 'abc',
	referenceKeyHashes: {},
	state: {},
	untranslatable: {},
	lastRun: null,
	...overrides,
})

describe('cache pruning', () => {
	it('drops languages that are no longer configured', () => {
		const cache = cacheWith({
			sourceKeyHashOverrides: { fr: { a: '1' }, aa: { a: '1' }, agq: { a: '1' } },
			state: { fr: { keyHashes: { a: '1' } }, aa: { keyHashes: { a: '1' } } },
			untranslatable: { fr: { a: '1' }, aa: { a: '1' } },
		})
		const { dropped } = pruneCache({ cache, targetLanguages: ['fr'], referenceLanguage: 'en' })
		expect(Object.keys(cache.sourceKeyHashOverrides)).to.deep.equal(['fr'])
		expect(Object.keys(cache.state)).to.deep.equal(['fr'])
		expect(Object.keys(cache.untranslatable)).to.deep.equal(['fr'])
		expect([ ...dropped.languages ].sort()).to.deep.equal(['aa', 'agq'])
	})

	it('keeps the reference language, which a same-language pass legitimately records', () => {
		const cache = cacheWith({ sourceKeyHashOverrides: { en: { a: '1' }, fr: { a: '1' } } })
		pruneCache({ cache, targetLanguages: ['fr'], referenceLanguage: 'en' })
		expect(Object.keys(cache.sourceKeyHashOverrides).sort()).to.deep.equal(['en', 'fr'])
	})

	it('drops legacy flat entries left by the un-migrated nesting change', () => {
		// Pre-nesting, referenceKeyHashes was a flat key -> hash map. Those string
		// values still sit at the language level and are read as languages.
		const cache = cacheWith({
			sourceKeyHashOverrides: {
				fr: { a: '1' },
				'page-editor-add-component': 'deadbeef',
				'_context:error-hm': 'deadbeef',
			},
		})
		const { dropped } = pruneCache({ cache, targetLanguages: ['fr'], referenceLanguage: 'en' })
		expect(Object.keys(cache.sourceKeyHashOverrides)).to.deep.equal(['fr'])
		expect(dropped.legacyEntries).to.equal(2)
	})

	it('merges case variants onto the configured spelling instead of orphaning them', () => {
		// Cache sections key on the raw targetLang spelling while output filenames
		// are lowercased, so re-casing a language used to silently re-translate it.
		const cache = cacheWith({
			sourceKeyHashOverrides: { 'zh-HK': { a: '1', b: '2' }, 'zh-hk': { c: '3' } },
		})
		const { dropped } = pruneCache({ cache, targetLanguages: ['zh-hk'], referenceLanguage: 'en' })
		expect(Object.keys(cache.sourceKeyHashOverrides)).to.deep.equal(['zh-hk'])
		// Nothing is lost in the merge — all three keys survive.
		expect(cache.sourceKeyHashOverrides['zh-hk']).to.deep.equal({ a: '1', b: '2', c: '3' })
		expect([ ...dropped.recased ]).to.deep.equal(['zh-HK -> zh-hk'])
	})

	it('refuses to evict anything when no languages are configured', () => {
		// Guards against wiping a cache because a caller forgot to pass languages.
		const cache = cacheWith({ sourceKeyHashOverrides: { fr: { a: '1' }, aa: { a: '1' } } })
		pruneCache({ cache, targetLanguages: [], referenceLanguage: null })
		expect(Object.keys(cache.sourceKeyHashOverrides).sort()).to.deep.equal(['aa', 'fr'])
	})

	it('leaves a fully-live cache byte-identical', () => {
		const cache = cacheWith({
			sourceKeyHashOverrides: { fr: { a: '1' }, de: { b: '2' } },
			state: { fr: { keyHashes: { a: '1' } }, de: { keyHashes: { b: '2' } } },
		})
		const before = JSON.stringify(cache)
		pruneCache({ cache, targetLanguages: ['fr', 'de'], referenceLanguage: 'en' })
		expect(JSON.stringify(cache)).to.equal(before)
	})

	it('prunes on load', async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'alt-cache-'))
		try {
			const file = path.join(dir, 'c.json')
			fs.writeFileSync(file, JSON.stringify(cacheWith({
				referenceKeyHashes: { fr: { a: 'h1' }, aa: { a: 'h1' } },
			})))
			const loaded = await loadCache(file, { targetLanguages: ['fr'], referenceLanguage: 'en', log: noopLog })
			// Migrated to the canonical shape, and the dead language is gone.
			expect(loaded.referenceKeyHashes).to.equal(undefined)
			expect(loaded.sourceKeyHashes).to.deep.equal({ a: 'h1' })
			expect(getReferenceKeyHash(loaded, 'fr', 'a')).to.equal('h1')
		} finally {
			fs.rmSync(dir, { recursive: true, force: true })
		}
	})

	it('measurably shrinks a cache shaped like the real one', () => {
		// 30 live languages plus 65 dead ones, which is the observed ratio.
		const build = (langs) => Object.fromEntries(langs.map(l => [l,
			Object.fromEntries(Array.from({ length: 200 }, (_, i) => [`key-${i}`, 'a'.repeat(64)]))]))
		const liveLangs = Array.from({ length: 30 }, (_, i) => `live-${i}`)
		const deadLangs = Array.from({ length: 65 }, (_, i) => `dead-${i}`)
		const cache = cacheWith({
			sourceKeyHashOverrides: build([ ...liveLangs, ...deadLangs ]),
			state: Object.fromEntries([ ...liveLangs, ...deadLangs ].map(l => [l, { keyHashes: {} }])),
		})
		const before = JSON.stringify(cache).length
		pruneCache({ cache, targetLanguages: liveLangs, referenceLanguage: 'en' })
		const after = JSON.stringify(cache).length
		expect(after).to.be.lessThan(before * 0.4)
	})
})

describe('json writing', () => {
	let dir
	beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'alt-io-')) })
	afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }) })

	it('indents human-facing files by default', () => {
		const file = path.join(dir, 'out.json')
		writeJsonFile(file, { a: 1, b: 2 }, noopLog)
		const raw = fs.readFileSync(file, 'utf8')
		expect(raw).to.contain('\n')
		expect(DEFAULT_JSON_INDENT).to.equal(2)
	})

	it('writes the cache without indentation', () => {
		const file = path.join(dir, 'cache.json')
		const data = { a: 1, b: { c: 2 } }
		writeJsonFile(file, data, noopLog, { indent: 0 })
		const raw = fs.readFileSync(file, 'utf8')
		expect(raw).to.not.contain('\n')
		// Still valid and identical in content — only the whitespace differs.
		expect(JSON.parse(raw)).to.deep.equal(data)
	})

	it('throws instead of reporting a failed write as success', () => {
		// A directory where the file should be makes the write fail.
		const file = path.join(dir, 'blocked.json')
		fs.mkdirSync(file)
		expect(() => writeJsonFile(file, { a: 1 }, noopLog)).to.throw()
	})
})

describe('hash length migration', () => {
	it('produces exactly what calculateHash now returns, so nothing re-translates', () => {
		// The whole safety argument: truncating a stored full-length digest must
		// equal a fresh short digest of the same content. If this ever stops being
		// true, adopting the shorter length silently re-translates every key in
		// every language.
		const content = 'Hello there'
		const fullDigest = crypto.createHash('sha256').update(content).digest('hex')
		expect(fullDigest.slice(0, KEY_HASH_LENGTH)).to.equal(calculateHash(content))
	})

	it('shortens every stored hash in every section', () => {
		const long = 'a'.repeat(64)
		const cache = cacheWith({
			referenceHash: long,
			sourceKeyHashes: { k: long },
			state: { fr: { keyHashes: { k: long } } },
			untranslatable: { fr: { k: long } },
		})
		const { migrated } = migrateHashLengths(cache)
		expect(migrated).to.equal(4)
		expect(cache.referenceHash).to.have.lengthOf(KEY_HASH_LENGTH)
		expect(cache.sourceKeyHashes.k).to.have.lengthOf(KEY_HASH_LENGTH)
		expect(cache.state.fr.keyHashes.k).to.have.lengthOf(KEY_HASH_LENGTH)
		expect(cache.untranslatable.fr.k).to.have.lengthOf(KEY_HASH_LENGTH)
	})

	it('is idempotent and leaves already-short hashes untouched', () => {
		const cache = cacheWith({ sourceKeyHashes: { k: calculateHash('x') } })
		const before = JSON.stringify(cache)
		const { migrated } = migrateHashLengths(cache)
		expect(migrated).to.equal(0)
		expect(JSON.stringify(cache)).to.equal(before)
	})

	it('keeps a migrated cache matching freshly computed hashes end to end', () => {
		// Simulate a pre-migration cache built with full digests, then confirm a
		// fresh run's hash for the same content compares equal after migration.
		const values = ['Hello there', 'Goodbye now', 'Third string']
		const cache = cacheWith({
			sourceKeyHashes: Object.fromEntries(values.map((v, i) => [`k${i}`,
				crypto.createHash('sha256').update(v).digest('hex')])),
		})
		migrateHashLengths(cache)
		values.forEach((v, i) => {
			expect(cache.sourceKeyHashes[`k${i}`]).to.equal(calculateHash(v))
		})
	})
})

describe('reference key hash deduplication', () => {
	it('migrates a per-language map to canonical + only real deviations', () => {
		const cache = cacheWith({
			referenceKeyHashes: {
				fr: { a: 'h1', b: 'h2' },
				de: { a: 'h1', b: 'h2' },
				es: { a: 'h1', b: 'STALE' },
			},
		})
		const { canonical } = migrateReferenceKeyHashes(cache)
		expect(canonical).to.equal(2)
		expect(cache.sourceKeyHashes).to.deep.equal({ a: 'h1', b: 'h2' })
		expect(cache.sourceKeyHashOverrides).to.deep.equal({ es: { b: 'STALE' } })
		expect(cache.referenceKeyHashes).to.equal(undefined)
	})

	it('answers every lookup exactly as the old per-language map did', () => {
		// The safety property: for every (lang, key) the migrated cache must
		// return precisely what the legacy structure held. Anything else silently
		// re-translates, or worse, skips a key that changed.
		const legacy = {
			fr: { a: 'h1', b: 'h2', c: 'h3' },
			de: { a: 'h1', b: 'OLD', c: 'h3' },
			es: { a: 'h1', c: 'h3' },
		}
		const cache = cacheWith({ referenceKeyHashes: JSON.parse(JSON.stringify(legacy)) })
		migrateReferenceKeyHashes(cache)
		for (const [lang, entries] of Object.entries(legacy)) {
			for (const [key, hash] of Object.entries(entries)) {
				expect(getReferenceKeyHash(cache, lang, key), `${lang}/${key}`).to.equal(hash)
			}
		}
		// A language that never had the key must still report nothing for it.
		expect(getReferenceKeyHash(cache, 'es', 'b')).to.equal(undefined)
	})

	it('stores no override when a write matches canonical', () => {
		const cache = cacheWith({ sourceKeyHashes: { a: 'h1' }, sourceKeyHashOverrides: {} })
		setReferenceKeyHash(cache, 'fr', 'a', 'h1')
		expect(cache.sourceKeyHashOverrides).to.deep.equal({})
		expect(getReferenceKeyHash(cache, 'fr', 'a')).to.equal('h1')
	})

	it('stores an override when a write deviates, and clears it when it converges', () => {
		const cache = cacheWith({ sourceKeyHashes: { a: 'h1' }, sourceKeyHashOverrides: {} })
		setReferenceKeyHash(cache, 'fr', 'a', 'h2')
		expect(getReferenceKeyHash(cache, 'fr', 'a')).to.equal('h2')
		setReferenceKeyHash(cache, 'fr', 'a', 'h1')
		expect(getReferenceKeyHash(cache, 'fr', 'a')).to.equal('h1')
		// Converging must not leave an empty language bucket behind.
		expect(cache.sourceKeyHashOverrides).to.deep.equal({})
	})

	it('tombstones a delete so canonical does not resurrect', () => {
		// This is why a delete cannot simply remove the override: canonical would
		// answer the next lookup and the key would look up to date forever.
		const cache = cacheWith({ sourceKeyHashes: { a: 'h1' }, sourceKeyHashOverrides: {} })
		deleteReferenceKeyHash(cache, 'fr', 'a')
		expect(getReferenceKeyHash(cache, 'fr', 'a')).to.equal(undefined)
		expect(getReferenceKeyHash(cache, 'de', 'a')).to.equal('h1')
		// Writing it back clears the tombstone.
		setReferenceKeyHash(cache, 'fr', 'a', 'h1')
		expect(getReferenceKeyHash(cache, 'fr', 'a')).to.equal('h1')
	})

	it('is idempotent across repeated migrations', () => {
		const cache = cacheWith({ referenceKeyHashes: { fr: { a: 'h1' }, de: { a: 'OLD' } } })
		migrateReferenceKeyHashes(cache)
		const once = JSON.stringify(cache)
		migrateReferenceKeyHashes(cache)
		expect(JSON.stringify(cache)).to.equal(once)
	})

	it('collapses a realistically shaped map', () => {
		const langs = Array.from({ length: 30 }, (_, i) => `l${i}`)
		const keys = Array.from({ length: 2000 }, (_, i) => `key-${i}`)
		const referenceKeyHashes = Object.fromEntries(langs.map(l =>
			[l, Object.fromEntries(keys.map(k => [k, 'a'.repeat(16)]))]))
		const cache = cacheWith({ referenceKeyHashes })
		const before = JSON.stringify(cache).length
		migrateReferenceKeyHashes(cache)
		const after = JSON.stringify(cache).length
		expect(after).to.be.lessThan(before * 0.1)
	})
})

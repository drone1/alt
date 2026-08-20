import { expect } from 'chai'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import * as crypto from 'crypto'
import { loadCache, migrateHashLengths, pruneCache } from '../src/lib/cache.js'
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
			referenceKeyHashes: { fr: { a: '1' }, aa: { a: '1' }, agq: { a: '1' } },
			state: { fr: { keyHashes: { a: '1' } }, aa: { keyHashes: { a: '1' } } },
			untranslatable: { fr: { a: '1' }, aa: { a: '1' } },
		})
		const { dropped } = pruneCache({ cache, targetLanguages: ['fr'], referenceLanguage: 'en' })
		expect(Object.keys(cache.referenceKeyHashes)).to.deep.equal(['fr'])
		expect(Object.keys(cache.state)).to.deep.equal(['fr'])
		expect(Object.keys(cache.untranslatable)).to.deep.equal(['fr'])
		expect([ ...dropped.languages ].sort()).to.deep.equal(['aa', 'agq'])
	})

	it('keeps the reference language, which a same-language pass legitimately records', () => {
		const cache = cacheWith({ referenceKeyHashes: { en: { a: '1' }, fr: { a: '1' } } })
		pruneCache({ cache, targetLanguages: ['fr'], referenceLanguage: 'en' })
		expect(Object.keys(cache.referenceKeyHashes).sort()).to.deep.equal(['en', 'fr'])
	})

	it('drops legacy flat entries left by the un-migrated nesting change', () => {
		// Pre-nesting, referenceKeyHashes was a flat key -> hash map. Those string
		// values still sit at the language level and are read as languages.
		const cache = cacheWith({
			referenceKeyHashes: {
				fr: { a: '1' },
				'page-editor-add-component': 'deadbeef',
				'_context:error-hm': 'deadbeef',
			},
		})
		const { dropped } = pruneCache({ cache, targetLanguages: ['fr'], referenceLanguage: 'en' })
		expect(Object.keys(cache.referenceKeyHashes)).to.deep.equal(['fr'])
		expect(dropped.legacyEntries).to.equal(2)
	})

	it('merges case variants onto the configured spelling instead of orphaning them', () => {
		// Cache sections key on the raw targetLang spelling while output filenames
		// are lowercased, so re-casing a language used to silently re-translate it.
		const cache = cacheWith({
			referenceKeyHashes: { 'zh-HK': { a: '1', b: '2' }, 'zh-hk': { c: '3' } },
		})
		const { dropped } = pruneCache({ cache, targetLanguages: ['zh-hk'], referenceLanguage: 'en' })
		expect(Object.keys(cache.referenceKeyHashes)).to.deep.equal(['zh-hk'])
		// Nothing is lost in the merge — all three keys survive.
		expect(cache.referenceKeyHashes['zh-hk']).to.deep.equal({ a: '1', b: '2', c: '3' })
		expect([ ...dropped.recased ]).to.deep.equal(['zh-HK -> zh-hk'])
	})

	it('refuses to evict anything when no languages are configured', () => {
		// Guards against wiping a cache because a caller forgot to pass languages.
		const cache = cacheWith({ referenceKeyHashes: { fr: { a: '1' }, aa: { a: '1' } } })
		pruneCache({ cache, targetLanguages: [], referenceLanguage: null })
		expect(Object.keys(cache.referenceKeyHashes).sort()).to.deep.equal(['aa', 'fr'])
	})

	it('leaves a fully-live cache byte-identical', () => {
		const cache = cacheWith({
			referenceKeyHashes: { fr: { a: '1' }, de: { b: '2' } },
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
				referenceKeyHashes: { fr: { a: '1' }, aa: { a: '1' } },
			})))
			const loaded = await loadCache(file, { targetLanguages: ['fr'], referenceLanguage: 'en', log: noopLog })
			expect(Object.keys(loaded.referenceKeyHashes)).to.deep.equal(['fr'])
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
			referenceKeyHashes: build([ ...liveLangs, ...deadLangs ]),
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
			referenceKeyHashes: { fr: { k: long } },
			state: { fr: { keyHashes: { k: long } } },
			untranslatable: { fr: { k: long } },
		})
		const { migrated } = migrateHashLengths(cache)
		expect(migrated).to.equal(4)
		expect(cache.referenceHash).to.have.lengthOf(KEY_HASH_LENGTH)
		expect(cache.referenceKeyHashes.fr.k).to.have.lengthOf(KEY_HASH_LENGTH)
		expect(cache.state.fr.keyHashes.k).to.have.lengthOf(KEY_HASH_LENGTH)
		expect(cache.untranslatable.fr.k).to.have.lengthOf(KEY_HASH_LENGTH)
	})

	it('is idempotent and leaves already-short hashes untouched', () => {
		const cache = cacheWith({ referenceKeyHashes: { fr: { k: calculateHash('x') } } })
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
			referenceKeyHashes: {
				fr: Object.fromEntries(values.map((v, i) => [`k${i}`,
					crypto.createHash('sha256').update(v).digest('hex')])),
			},
		})
		migrateHashLengths(cache)
		values.forEach((v, i) => {
			expect(cache.referenceKeyHashes.fr[`k${i}`]).to.equal(calculateHash(v))
		})
	})
})

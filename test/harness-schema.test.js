import { expect } from 'chai'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { buildAliasedBatch, SCHEMA_PROPERTY_NAME_RE, translateBatch } from '../src/providers/anthropic/harness.mjs'

// Two real offenders from the consuming project. The first is 83 characters;
// the second is well under the limit but carries a colon, which the charset
// rejects — a length-only guard would wave it through.
const OVER_LONG_KEY = 'vis-setting-help-gpu-particle-renderer-advanced-sprite-randomize-frame-per-particle'
const COLON_KEY = 'ent-displayinfo-banner:controller-label'
const ORDINARY_KEY = 'page-editor-add-component'

const noopLog = { W: () => {}, V: () => {}, D: () => {}, E: () => {}, I: () => {} }

function items() {
	return [
		{ key: OVER_LONG_KEY, text: 'Randomize frame per particle', context: 'help text for a renderer setting' },
		{ key: COLON_KEY, text: 'Controller', context: null },
		{ key: ORDINARY_KEY, text: 'Add component', context: null },
	]
}

describe('harness batch schema', () => {
	it('confirms the offending keys really do violate the API constraint', () => {
		// Guards the premise: if this ever stops being true the aliasing below is
		// solving a problem that no longer exists.
		expect(OVER_LONG_KEY.length).to.be.greaterThan(64)
		expect(SCHEMA_PROPERTY_NAME_RE.test(OVER_LONG_KEY)).to.equal(false)
		expect(SCHEMA_PROPERTY_NAME_RE.test(COLON_KEY)).to.equal(false)
		expect(SCHEMA_PROPERTY_NAME_RE.test(ORDINARY_KEY)).to.equal(true)
	})

	it('emits only property names the API will accept', () => {
		const { schema } = buildAliasedBatch(items())
		const names = Object.keys(schema.properties)
		expect(names).to.have.lengthOf(3)
		for (const name of names) {
			expect(SCHEMA_PROPERTY_NAME_RE.test(name), `property name ${name}`).to.equal(true)
		}
		// required must stay in lockstep with properties, since that is what
		// enforces per-key identity and makes a partial response recoverable.
		expect(schema.required).to.deep.equal(names)
		expect(schema.additionalProperties).to.equal(false)
	})

	it('never puts a real localization key in the schema', () => {
		const { schema } = buildAliasedBatch(items())
		const serialized = JSON.stringify(schema)
		for (const key of [OVER_LONG_KEY, COLON_KEY, ORDINARY_KEY]) {
			expect(serialized).to.not.contain(key)
		}
	})

	it('keys the source map by alias and round-trips back to real keys', () => {
		const { sourceMap, keyByAlias, aliasByKey } = buildAliasedBatch(items())
		expect(Object.keys(sourceMap)).to.deep.equal(['k0', 'k1', 'k2'])
		expect(sourceMap.k0).to.equal('Randomize frame per particle')
		expect(sourceMap.k1).to.equal('Controller')
		expect(keyByAlias.k0).to.equal(OVER_LONG_KEY)
		expect(keyByAlias.k1).to.equal(COLON_KEY)
		expect(aliasByKey[OVER_LONG_KEY]).to.equal('k0')
		// Every alias must map back to exactly the key that produced it.
		for (const [alias, key] of Object.entries(keyByAlias)) {
			expect(aliasByKey[key]).to.equal(alias)
		}
	})

	it('aliases context lines and surfaces real keys only as identifier hints', () => {
		const { contextLines, identifierHintLines } = buildAliasedBatch(items())
		expect(contextLines).to.deep.equal(['k0: help text for a renderer setting'])
		expect(identifierHintLines).to.deep.equal([
			`k0 = ${OVER_LONG_KEY}`,
			`k1 = ${COLON_KEY}`,
			`k2 = ${ORDINARY_KEY}`,
		])
	})

	it('scales past the alias-collision boundary', () => {
		// k1 vs k10 vs k100 must stay distinct.
		const many = Array.from({ length: 150 }, (_, i) => ({ key: `key-${i}`, text: `t${i}`, context: null }))
		const { schema, keyByAlias } = buildAliasedBatch(many)
		expect(Object.keys(schema.properties)).to.have.lengthOf(150)
		expect(new Set(Object.keys(keyByAlias)).size).to.equal(150)
		expect(keyByAlias.k1).to.equal('key-1')
		expect(keyByAlias.k10).to.equal('key-10')
		expect(keyByAlias.k100).to.equal('key-100')
	})

	it('handles an empty context list without emitting a stray line', () => {
		const { contextLines } = buildAliasedBatch([{ key: 'a', text: 'A', context: null }])
		expect(contextLines).to.deep.equal([])
	})
})

// Integration: drive the real translateBatch against a stub `claude` on PATH.
// The stub asserts the schema it receives and answers keyed by alias, which is
// what the live CLI does — so a regression that leaks aliases downstream, or
// that sends raw keys upstream, fails here.
describe('harness translateBatch (stubbed claude)', () => {
	let binDir
	let originalPath
	let capturePath

	const installStub = (body) => {
		fs.writeFileSync(path.join(binDir, 'claude'), body, { mode: 0o755 })
	}

	beforeEach(() => {
		binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alt-harness-stub-'))
		capturePath = path.join(binDir, 'capture.json')
		originalPath = process.env.PATH
		process.env.PATH = `${binDir}${path.delimiter}${originalPath}`
	})

	afterEach(() => {
		process.env.PATH = originalPath
		fs.rmSync(binDir, { recursive: true, force: true })
	})

	it('sends valid property names and returns real keys', async () => {
		// Echoes each required property back with a marker, and records the
		// schema and prompt it was handed so the test can inspect them.
		installStub(`#!/usr/bin/env node
const fs = require('fs')
const args = process.argv.slice(2)
const schema = JSON.parse(args[args.indexOf('--json-schema') + 1])
const prompt = args[args.length - 1]
fs.writeFileSync(${JSON.stringify(capturePath)}, JSON.stringify({ schema, prompt }))
const structured = {}
for (const name of schema.required) structured[name] = 'translated:' + name
process.stdout.write(JSON.stringify({ is_error: false, total_cost_usd: 0.01, structured_output: structured }))
`)

		const result = await translateBatch({
			items: items(),
			sourceLang: 'en',
			targetLang: 'fr',
			model: 'haiku',
			appContextMessage: null,
			log: noopLog,
		})

		expect(result.error).to.equal(null)
		expect(result.hardFail).to.equal(false)

		// Real keys come back out...
		expect(Object.keys(result.translations).sort()).to.deep.equal([COLON_KEY, ORDINARY_KEY, OVER_LONG_KEY].sort())
		expect(result.translations[OVER_LONG_KEY]).to.equal('translated:k0')
		expect(result.translations[COLON_KEY]).to.equal('translated:k1')
		expect(result.cost).to.equal(0.01)

		// ...and no alias leaks out.
		for (const key of Object.keys(result.translations)) {
			expect(SCHEMA_PROPERTY_NAME_RE.test(key) && /^k\d+$/.test(key)).to.equal(false)
		}

		const captured = JSON.parse(fs.readFileSync(capturePath, 'utf8'))
		for (const name of Object.keys(captured.schema.properties)) {
			expect(SCHEMA_PROPERTY_NAME_RE.test(name), `sent property ${name}`).to.equal(true)
		}
		// The model still gets to see the real key names, just not as identifiers.
		expect(captured.prompt).to.contain(`k0 = ${OVER_LONG_KEY}`)
	})

	it('drops empty translations so the orchestrator can retry them', async () => {
		installStub(`#!/usr/bin/env node
const args = process.argv.slice(2)
const schema = JSON.parse(args[args.indexOf('--json-schema') + 1])
const structured = {}
schema.required.forEach((name, i) => { structured[name] = i === 0 ? '   ' : 'ok:' + name })
process.stdout.write(JSON.stringify({ is_error: false, structured_output: structured }))
`)

		const result = await translateBatch({
			items: items(), sourceLang: 'en', targetLang: 'fr', model: 'haiku', appContextMessage: null, log: noopLog,
		})

		expect(result.translations).to.not.have.property(OVER_LONG_KEY)
		expect(result.translations[COLON_KEY]).to.equal('ok:k1')
	})

	it('reproduces the old failure: raw keys would be rejected by the API', async () => {
		// The stub enforces the real API rule. If translateBatch ever sends raw
		// keys again, this fails exactly the way production did.
		installStub(`#!/usr/bin/env node
const args = process.argv.slice(2)
const schema = JSON.parse(args[args.indexOf('--json-schema') + 1])
const bad = Object.keys(schema.properties).filter(n => !/^[a-zA-Z0-9_.-]{1,64}$/.test(n))
if (bad.length) {
	process.stdout.write(JSON.stringify({
		is_error: true,
		subtype: 'success',
		result: "API Error: 400 tools.0.custom.input_schema.properties: Property keys should match pattern '^[a-zA-Z0-9_.-]{1,64}$'",
	}))
	process.exit(1)
}
const structured = {}
for (const name of schema.required) structured[name] = 'ok'
process.stdout.write(JSON.stringify({ is_error: false, structured_output: structured }))
`)

		const result = await translateBatch({
			items: items(), sourceLang: 'en', targetLang: 'fr', model: 'haiku', appContextMessage: null, log: noopLog,
		})

		expect(result.error).to.equal(null)
		expect(Object.keys(result.translations)).to.have.lengthOf(3)
	})
})

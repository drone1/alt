import { expect } from 'chai'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { classifyHardFailure, parseClaudeEnvelope, translateBatch } from '../src/providers/anthropic/harness.mjs'

// The two messages that cost us days of misdiagnosis. Both arrive on STDOUT,
// inside the CLI's JSON envelope, with an exit code of 1 and an empty stderr —
// so on the failure path they are the ONLY thing that distinguishes a malformed
// request from a spent subscription.
const SCHEMA_ERROR_MESSAGE = "API Error: 400 tools.0.custom.input_schema.properties: Property keys should match pattern '^[a-zA-Z0-9_.-]{1,64}$'"
const QUOTA_ERROR_MESSAGE = "You've hit your weekly limit · resets 4am (UTC)"
const AUTH_ERROR_MESSAGE = 'API Error: 401 {"type":"error","error":{"type":"authentication_error","message":"OAuth token has expired"}}'
const TRANSIENT_ERROR_MESSAGE = 'API Error: 529 {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}'

// The old stdout head was 200 characters. Anything at or beyond this offset was
// invisible to the operator, so the tests below assert their message really is
// past it rather than assuming.
const OLD_STDOUT_HEAD_CHARS = 200

const ITEMS = [
	{ key: 'page-editor-add-component', text: 'Add component', context: null },
	{ key: 'page-editor-remove-component', text: 'Remove component', context: null },
]

// Records everything the harness logs so the assertions can be made against the
// actual operator-visible output rather than against internal state.
function makeLog() {
	const calls = []
	const record = (...args) => { calls.push(args.map(a => String(a)).join(' ')) }
	return { calls, text: () => calls.join('\n'), W: record, V: record, D: record, E: record, I: record }
}

// A realistic `claude --output-format json` failure envelope. Field order and
// the usage/modelUsage blocks mirror the live CLI, which is what pushes `result`
// several hundred bytes past the start of the payload.
function failureEnvelopeJson(message, overrides = {}) {
	const envelope = {
		is_error: true,
		duration_ms: 1342,
		duration_api_ms: 0,
		num_turns: 1,
		stop_reason: 'stop_sequence',
		session_id: '0f0f2c1e-6a3b-4c55-9f0e-2b7d41a9c3de',
		total_cost_usd: 0,
		usage: {
			input_tokens: 4,
			cache_creation_input_tokens: 0,
			cache_read_input_tokens: 0,
			output_tokens: 3,
			server_tool_use: { web_search_requests: 0, web_fetch_requests: 0 },
			service_tier: 'standard',
			cache_creation: { ephemeral_1h_input_tokens: 0, ephemeral_5m_input_tokens: 0 },
		},
		modelUsage: {
			'claude-haiku-4-5-20251001': {
				inputTokens: 4,
				outputTokens: 3,
				cacheReadInputTokens: 0,
				cacheCreationInputTokens: 0,
				webSearchRequests: 0,
				costUSD: 0,
				contextWindow: 200000,
			},
		},
		permission_denials: [],
		uuid: 'd6b8f3a2-7c14-4f9e-8a55-1c2b3d4e5f60',
		subtype: 'success',
		...overrides,
		result: message,
	}
	return JSON.stringify(envelope)
}

describe('harness failure classification', () => {
	it('never throws on unparseable stdout', () => {
		for (const input of ['', '   ', 'not json at all', '{"broken":', '[1,2,3]', null, undefined, 42]) {
			expect(() => parseClaudeEnvelope(input)).to.not.throw()
			expect(parseClaudeEnvelope(input)).to.equal(null)
		}
		expect(parseClaudeEnvelope('{"a":1}')).to.deep.equal({ a: 1 })
	})

	it('separates hard failures from retryable ones', () => {
		expect(classifyHardFailure({ message: AUTH_ERROR_MESSAGE })).to.not.equal(null)
		expect(classifyHardFailure({ message: 'Not logged in' })).to.not.equal(null)
		expect(classifyHardFailure({ message: SCHEMA_ERROR_MESSAGE })).to.not.equal(null)
		expect(classifyHardFailure({ message: QUOTA_ERROR_MESSAGE })).to.not.equal(null)
		// A rate limit or an overloaded upstream contains "limit"/"Overloaded"
		// but clears on retry — treating it as terminal would abort whole runs.
		expect(classifyHardFailure({ message: TRANSIENT_ERROR_MESSAGE })).to.equal(null)
		expect(classifyHardFailure({ message: 'API Error: 429 rate_limit_error' })).to.equal(null)
		expect(classifyHardFailure({ message: 'read ECONNRESET' })).to.equal(null)
		expect(classifyHardFailure({ message: '' })).to.equal(null)
	})
})

// Integration: drive the real translateBatch against a stub `claude` on PATH
// that reproduces each observed production failure byte-for-byte.
describe('harness translateBatch failure diagnostics (stubbed claude)', () => {
	let binDir
	let originalPath

	// Writes a stub that prints `payload` on stdout, `errPayload` on stderr, and
	// exits with `exitCode` — the exact shape of the failures we investigated.
	const installFailingStub = ({ payload = '', errPayload = '', exitCode = 1 }) => {
		const body = `#!/usr/bin/env node
const out = ${JSON.stringify(payload)}
const err = ${JSON.stringify(errPayload)}
if (out.length) process.stdout.write(out)
if (err.length) process.stderr.write(err)
process.exit(${exitCode})
`
		fs.writeFileSync(path.join(binDir, 'claude'), body, { mode: 0o755 })
	}

	// Same, but exits 0 — the CLI's other failure shape, where the error is
	// reported inside a well-formed envelope.
	const installErrorEnvelopeStub = (payload) => {
		fs.writeFileSync(path.join(binDir, 'claude'), `#!/usr/bin/env node
process.stdout.write(${JSON.stringify(payload)})
`, { mode: 0o755 })
	}

	const run = async (log) => translateBatch({
		items: ITEMS,
		sourceLang: 'en',
		targetLang: 'fr',
		model: 'haiku',
		appContextMessage: null,
		log,
	})

	beforeEach(() => {
		binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alt-harness-diag-'))
		originalPath = process.env.PATH
		process.env.PATH = `${binDir}${path.delimiter}${originalPath}`
	})

	afterEach(() => {
		process.env.PATH = originalPath
		fs.rmSync(binDir, { recursive: true, force: true })
	})

	it('surfaces an API 400 schema rejection that sits past the old stdout head', async () => {
		const payload = failureEnvelopeJson(SCHEMA_ERROR_MESSAGE)
		// Guards the premise: if the envelope ever shrinks below the old cut-off,
		// this test stops proving anything.
		expect(payload.indexOf(SCHEMA_ERROR_MESSAGE)).to.be.greaterThan(OLD_STDOUT_HEAD_CHARS)
		installFailingStub({ payload })

		const log = makeLog()
		const result = await run(log)

		// The operator must see the reason, not just the envelope prefix.
		expect(log.text()).to.contain(SCHEMA_ERROR_MESSAGE)
		expect(log.text()).to.contain('input_schema')
		// A malformed request cannot be fixed by retrying it three times.
		expect(result.hardFail).to.equal(true)
		expect(result.error).to.contain('malformed')
	})

	it('treats a quota message on a non-zero exit as a hard failure', async () => {
		const payload = failureEnvelopeJson(QUOTA_ERROR_MESSAGE)
		expect(payload.indexOf(QUOTA_ERROR_MESSAGE)).to.be.greaterThan(OLD_STDOUT_HEAD_CHARS)
		installFailingStub({ payload })

		const log = makeLog()
		const result = await run(log)

		expect(log.text()).to.contain('weekly limit')
		expect(result.hardFail).to.equal(true)
		expect(result.error).to.contain('subscription limit')
	})

	it('classifies an auth failure reported on stdout, not stderr', async () => {
		installFailingStub({ payload: failureEnvelopeJson(AUTH_ERROR_MESSAGE), errPayload: '' })

		const log = makeLog()
		const result = await run(log)

		expect(log.text()).to.contain('stderr: <empty>')
		expect(log.text()).to.contain('authentication_error')
		expect(result.hardFail).to.equal(true)
		expect(result.error).to.contain('not authenticated')
	})

	it('still classifies an auth failure reported on stderr', async () => {
		installFailingStub({ payload: '', errPayload: 'Invalid API key · Not logged in' })

		const result = await run(makeLog())

		expect(result.hardFail).to.equal(true)
		expect(result.error).to.contain('not authenticated')
	})

	it('does not mistake an overloaded upstream for a terminal failure', async () => {
		installFailingStub({ payload: failureEnvelopeJson(TRANSIENT_ERROR_MESSAGE) })

		const log = makeLog()
		const result = await run(log)

		expect(log.text()).to.contain('Overloaded')
		expect(result.hardFail).to.equal(false)
		expect(result.error).to.contain('exited with code 1')
	})

	it('falls back to the stdout head when stdout is not JSON', async () => {
		const garbage = 'claude: internal error while starting up\nstack trace follows...'
		installFailingStub({ payload: garbage, exitCode: 2 })

		const log = makeLog()
		const result = await run(log)

		expect(log.text()).to.contain('stdout head:')
		expect(log.text()).to.contain('internal error while starting up')
		expect(result.error).to.equal('claude exited with code 2')
		expect(result.hardFail).to.equal(false)
	})

	it('survives a non-zero exit with nothing on either stream', async () => {
		installFailingStub({ payload: '', errPayload: '', exitCode: 1 })

		const log = makeLog()
		const result = await run(log)

		expect(log.text()).to.contain('stderr: <empty>')
		expect(log.text()).to.contain('stdout: <empty>')
		expect(result.error).to.equal('claude exited with code 1')
		expect(result.hardFail).to.equal(false)
		expect(result.translations).to.deep.equal({})
	})

	it('logs the whole error message on the is_error path, not the first 300 chars', async () => {
		// The tail is what identifies the failure in real API errors, and it was
		// the part being cut.
		const longMessage = `API Error: 500 ${'detail '.repeat(60)}TRAILING-REASON-MARKER`
		expect(longMessage.length).to.be.greaterThan(300)
		installErrorEnvelopeStub(JSON.stringify({ is_error: true, subtype: 'error_during_execution', result: longMessage }))

		const log = makeLog()
		const result = await run(log)

		expect(log.text()).to.contain('TRAILING-REASON-MARKER')
		expect(result.hardFail).to.equal(false)
		expect(result.backoffInterval).to.be.greaterThan(0)
	})

	it('keeps a subscription limit reported with exit code 0 a hard failure', async () => {
		installErrorEnvelopeStub(JSON.stringify({ is_error: true, subtype: 'success', result: QUOTA_ERROR_MESSAGE }))

		const log = makeLog()
		const result = await run(log)

		expect(log.text()).to.contain('weekly limit')
		expect(result.hardFail).to.equal(true)
		expect(result.error).to.contain('subscription limit')
	})
})

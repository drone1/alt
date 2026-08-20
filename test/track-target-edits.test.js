import { expect } from 'chai'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { execa } from 'execa'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ALT = path.join(__dirname, '..', 'alt.mjs')

// `state` records a hash of every translated string, solely so a hand-edited
// target value is never overwritten. It is about half the cache by size, and a
// project that never hand-edits its target files pays that for nothing.
//
// The dangerous interaction: missingOutputValueHash fires when a key has no
// recorded hash. If disabling tracking did not also disable that reason, every
// key would look stale on every run and re-translate forever.
describe('--no-track-target-edits', () => {
	let workDir
	let binDir
	let originalPath

	const refPath = () => path.join(workDir, 'reference.js')
	const frPath = () => path.join(workDir, 'fr.json')
	const cachePath = () => path.join(workDir, '.localization.cache.json')

	beforeEach(() => {
		workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alt-track-'))
		binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alt-track-bin-'))
		originalPath = process.env.PATH
		fs.writeFileSync(refPath(), `export default {\n\t'greeting': 'Hello there',\n\t'farewell': 'Goodbye now',\n}\n`)
		fs.writeFileSync(path.join(binDir, 'claude'), `#!/usr/bin/env node
const fs = require('fs')
const args = process.argv.slice(2)
const schema = JSON.parse(args[args.indexOf('--json-schema') + 1])
const countFile = process.env.CALL_COUNT_FILE
if (countFile) fs.appendFileSync(countFile, schema.required.length + '\\n')
const structured = {}
for (const name of schema.required) structured[name] = 'TRANSLATED'
process.stdout.write(JSON.stringify({ is_error: false, structured_output: structured }))
`, { mode: 0o755 })
	})

	afterEach(() => {
		process.env.PATH = originalPath
		fs.rmSync(workDir, { recursive: true, force: true })
		fs.rmSync(binDir, { recursive: true, force: true })
	})

	const runAlt = (extra = [], countFile = null) => execa('node', [
		ALT, 'translate', '-r', refPath(), '-rl', 'en', '-tl', 'fr', '-o', workDir,
		'--access', 'harness', '--reference-exported-var-name', 'default', '-y', ...extra,
	], {
		env: {
			...process.env,
			PATH: `${binDir}${path.delimiter}${originalPath}`,
			ALT_TEST: '1',
			...(countFile ? { CALL_COUNT_FILE: countFile } : {}),
		},
		reject: false,
	})

	it('records no target hashes when disabled', async () => {
		await runAlt(['--no-track-target-edits'])
		const cache = JSON.parse(fs.readFileSync(cachePath(), 'utf8'))
		const hashes = cache.state?.fr?.keyHashes ?? {}
		expect(Object.keys(hashes)).to.deep.equal([])
		// The translations themselves still land.
		expect(JSON.parse(fs.readFileSync(frPath(), 'utf8')).greeting).to.equal('TRANSLATED')
	})

	it('still records them by default', async () => {
		await runAlt()
		const cache = JSON.parse(fs.readFileSync(cachePath(), 'utf8'))
		expect(Object.keys(cache.state.fr.keyHashes).sort()).to.deep.equal(['farewell', 'greeting'])
	})

	it('does not re-translate on the next run when disabled', async () => {
		// Convergence check: a run with tracking off must still recognise its own
		// output next time. (Removing the trackTargetEdits guard on
		// missingOutputValueHash does NOT break this — verified by mutation — so
		// that guard is correctness-of-reporting, not the thing keeping this green.)
		await runAlt(['--no-track-target-edits'])
		const countFile = path.join(workDir, 'calls.txt')
		fs.writeFileSync(countFile, '')
		await runAlt(['--no-track-target-edits'], countFile)
		const calls = fs.readFileSync(countFile, 'utf8').trim()
		expect(calls, `provider was called again: ${calls}`).to.equal('')
	})

	it('shrinks the cache measurably', async () => {
		await runAlt()
		const withTracking = fs.statSync(cachePath()).size
		fs.rmSync(cachePath())
		fs.rmSync(frPath())
		await runAlt(['--no-track-target-edits'])
		const withoutTracking = fs.statSync(cachePath()).size
		expect(withoutTracking).to.be.lessThan(withTracking)
	})
})

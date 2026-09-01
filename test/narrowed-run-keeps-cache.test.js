import { expect } from 'chai'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { execa } from 'execa'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ALT = path.join(__dirname, '..', 'alt.mjs')

const CONFIGURED_LANGUAGES = ['fr', 'de', 'nl']

// A consuming project runs `alt --target-languages en` as an English-parity
// check every time its reference file is saved. That narrowed invocation used
// to be read as "this project has one language", so cache eviction deleted
// every real language's entries out of a shared, committed cache — and the
// gutted file then rode into the trunk inside an unrelated commit, forcing a
// six-figure re-translation.
describe('a narrowed run does not evict the project\'s languages', () => {
	let workDir
	let binDir
	let originalPath

	const refPath = () => path.join(workDir, 'reference.js')
	const cachePath = () => path.join(workDir, '.localization.cache.json')
	const readCache = () => JSON.parse(fs.readFileSync(cachePath(), 'utf8'))

	beforeEach(() => {
		workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alt-narrowed-'))
		binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alt-narrowed-bin-'))
		originalPath = process.env.PATH

		fs.writeFileSync(refPath(), `export default {\n\t'greeting': 'Hello there',\n}\n`)
		fs.writeFileSync(path.join(workDir, 'alt.config.json'), JSON.stringify({
			referenceLanguage: 'en',
			targetLanguages: CONFIGURED_LANGUAGES,
			outputDir: workDir,
			referenceFile: refPath(),
			provider: 'anthropic',
			access: 'harness',
		}))
		fs.writeFileSync(path.join(binDir, 'claude'), `#!/usr/bin/env node
const args = process.argv.slice(2)
const schema = JSON.parse(args[args.indexOf('--json-schema') + 1])
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

	const runAlt = (extra = []) => execa('node', [
		ALT, 'translate',
		'-c', path.join(workDir, 'alt.config.json'),
		'--reference-exported-var-name', 'default',
		'-y', '-N',
		...extra,
	], {
		cwd: workDir,
		env: { ...process.env, PATH: `${binDir}${path.delimiter}${originalPath}`, ALT_TEST: '1' },
		reject: false,
	})

	it('keeps every configured language when the run translates only English', async () => {
		await runAlt()
		const populated = readCache()
		expect(Object.keys(populated.state).sort()).to.deep.equal([ ...CONFIGURED_LANGUAGES ].sort())

		// The parity pass: one language on the command line, config untouched.
		await runAlt(['-tl', 'en'])

		const after = readCache()
		for (const lang of CONFIGURED_LANGUAGES) {
			expect(Object.keys(after.state), `state kept ${lang}`).to.include(lang)
		}
	})

	it('still evicts a language the config itself dropped', async () => {
		await runAlt()
		expect(Object.keys(readCache().state)).to.include('nl')

		const configPath = path.join(workDir, 'alt.config.json')
		const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
		config.targetLanguages = ['fr', 'de']
		fs.writeFileSync(configPath, JSON.stringify(config))

		await runAlt()
		expect(Object.keys(readCache().state)).to.not.include('nl')
	})
})

import { expect } from 'chai'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { execa } from 'execa'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ALT = path.join(__dirname, '..', 'alt.mjs')

// The batched (harness) path used to lack the sourceLang !== targetLang guard
// that the single-key path has had since 7a22f51. With the reference language
// also listed as a target, the provider correctly returns the source verbatim,
// the batched path read that as "untranslatable", and markUntranslatable DELETED
// the key from the output file. For a target that IS the reference language that
// output file is the source of truth, so the string was destroyed outright —
// which is exactly how 66 English strings vanished from a consuming project.
//
// test/translate-command.test.js already covers same-language copying, but only
// on the api path: with no --access it resolves to 'api', whose provider exports
// no translateBatch, so useBatched is false and the batched copy never runs.
// These force --access harness with a stub `claude` on PATH.
describe('batched path with target === reference language', () => {
	let workDir
	let binDir
	let originalPath

	const refPath = () => path.join(workDir, 'reference.js')
	const enPath = () => path.join(workDir, 'en.json')
	const cachePath = () => path.join(workDir, '.localization.cache.json')

	beforeEach(() => {
		workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alt-samelang-'))
		binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alt-samelang-bin-'))
		originalPath = process.env.PATH

		fs.writeFileSync(refPath(), `export default {\n\t'greeting': 'Hello there',\n\t'farewell': 'Goodbye now',\n}\n`)

		// Faithful stub: a real model asked to translate en -> en returns the
		// input unchanged. That truthful answer is what used to trigger deletion.
		fs.writeFileSync(path.join(binDir, 'claude'), `#!/usr/bin/env node
const args = process.argv.slice(2)
const schema = JSON.parse(args[args.indexOf('--json-schema') + 1])
const prompt = args[args.length - 1]
const sources = JSON.parse(prompt.slice(prompt.indexOf('{'), prompt.lastIndexOf('}') + 1))
const structured = {}
for (const name of schema.required) structured[name] = sources[name]
process.stdout.write(JSON.stringify({ is_error: false, structured_output: structured }))
`, { mode: 0o755 })
	})

	afterEach(() => {
		process.env.PATH = originalPath
		fs.rmSync(workDir, { recursive: true, force: true })
		fs.rmSync(binDir, { recursive: true, force: true })
	})

	const runAlt = () => execa('node', [
		ALT, 'translate',
		'-r', refPath(),
		'-rl', 'en',
		'-tl', 'en',
		'-o', workDir,
		'--access', 'harness',
		'--reference-exported-var-name', 'default',
		'-y',
	], {
		env: { ...process.env, PATH: `${binDir}${path.delimiter}${originalPath}`, ALT_TEST: '1' },
		reject: false,
	})

	it('keeps the English strings instead of deleting them', async () => {
		const result = await runAlt()
		expect(fs.existsSync(enPath()), `en.json missing. stdout:\n${result.stdout}\n${result.stderr}`).to.equal(true)

		const en = JSON.parse(fs.readFileSync(enPath(), 'utf8'))
		expect(en).to.have.property('greeting', 'Hello there')
		expect(en).to.have.property('farewell', 'Goodbye now')
	})

	it('does not record the reference language as untranslatable', async () => {
		await runAlt()
		expect(fs.existsSync(cachePath())).to.equal(true)
		const cache = JSON.parse(fs.readFileSync(cachePath(), 'utf8'))
		const untranslatableEn = cache.untranslatable?.en ?? {}
		expect(Object.keys(untranslatableEn), 'reference language marked untranslatable').to.deep.equal([])
	})

	it('is idempotent — a second run neither deletes nor re-adds', async () => {
		await runAlt()
		const first = fs.readFileSync(enPath(), 'utf8')
		await runAlt()
		expect(fs.readFileSync(enPath(), 'utf8')).to.equal(first)
	})
})

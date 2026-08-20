import { expect } from 'chai'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { execa } from 'execa'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ALT = path.join(__dirname, '..', 'alt.mjs')

// Two of the documented "why are we translating this" reasons could never fire.
//
//   outputFileDidNotExist — the read defaulted to {} BEFORE the emptiness test,
//   so the test was against an always-truthy value.
//
//   missingOutputValueHash — the stored hash is read through optional chaining,
//   which yields undefined, but the test compared against null. A key sitting in
//   the output file with no recorded hash was silently treated as up to date.
describe('re-translation reasons', () => {
	let workDir
	let binDir
	let originalPath

	const refPath = () => path.join(workDir, 'reference.js')
	const frPath = () => path.join(workDir, 'fr.json')
	const cachePath = () => path.join(workDir, '.localization.cache.json')

	beforeEach(() => {
		workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alt-reasons-'))
		binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alt-reasons-bin-'))
		originalPath = process.env.PATH
		fs.writeFileSync(refPath(), `export default {\n\t'greeting': 'Hello there',\n}\n`)
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
		'-r', refPath(),
		'-rl', 'en',
		'-tl', 'fr',
		'-o', workDir,
		'--access', 'harness',
		'--reference-exported-var-name', 'default',
		'-y', '-d',
		...extra,
	], {
		env: { ...process.env, PATH: `${binDir}${path.delimiter}${originalPath}`, ALT_TEST: '1' },
		reject: false,
	})

	it('reports outputFileDidNotExist when there is no output file', async () => {
		const result = await runAlt()
		const out = `${result.stdout}\n${result.stderr}`
		expect(out).to.match(/outputFileDidNotExist:\s*true/)
	})

	it('does not report outputFileDidNotExist once the file exists', async () => {
		await runAlt()
		expect(fs.existsSync(frPath())).to.equal(true)
		const second = await runAlt()
		const out = `${second.stdout}\n${second.stderr}`
		expect(out).to.not.match(/outputFileDidNotExist:\s*true/)
	})

	it('re-translates a key whose output value has no recorded hash', async () => {
		await runAlt()
		expect(JSON.parse(fs.readFileSync(frPath(), 'utf8')).greeting).to.equal('TRANSLATED')

		// Simulate the real-world inconsistency: the value and its reference hash
		// are recorded, but the per-key output hash is not. Before the fix this
		// key looked up to date and was skipped forever.
		const cache = JSON.parse(fs.readFileSync(cachePath(), 'utf8'))
		delete cache.state.fr.keyHashes.greeting
		fs.writeFileSync(cachePath(), JSON.stringify(cache))
		fs.writeFileSync(frPath(), JSON.stringify({ greeting: 'STALE' }))

		const second = await runAlt()
		const out = `${second.stdout}\n${second.stderr}`
		expect(out).to.match(/missingOutputValueHash:\s*true/)
		expect(JSON.parse(fs.readFileSync(frPath(), 'utf8')).greeting).to.equal('TRANSLATED')
	})
})

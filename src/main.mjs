import * as path from 'path'
import { program } from 'commander'
import { fileURLToPath } from 'url'
import { initLocalizer } from './localizer/localize.js'
import {
	DEFAULT_CONFIG_FILENAME,
	ENV_VARS,
	LANGTAG_DEFAULT,
	LOCALIZATION_SRC_DIR,
} from './lib/consts.js'
import { readJsonFile } from './lib/io.js'
import { printLogo } from './lib/logo.js'
import { createLog, initLogFromOptions } from './lib/logging.js'
import { keyList, languageList } from './lib/options.js'
import { runTranslation } from './commands/translate.js'
import { registerSignalHandlers } from './shutdown.js'
import { runListModels } from './commands/list-models.js'

const __dirname = path.dirname(
	fileURLToPath(import.meta.url)
)

// Main function
export async function run() {
	const log = createLog(process.argv.includes('--dev'))

	const appState = {
		__dirname: path.dirname(fileURLToPath(import.meta.url)),
		lang: null,	// The app language, for output display (unrelated to translator)
		tmpDir: null,
		filesToWrite: {},	// Map of file path => JSON data to write
		errors: [],
		log
	}

	try {
		registerSignalHandlers(appState)

		appState.lang = await initLocalizer({
			defaultAppLanguage: LANGTAG_DEFAULT,
			appLanguage: process.env?.ALT_LANGUAGE,
			srcDir: path.resolve(__dirname, LOCALIZATION_SRC_DIR),
			log
		})

		const p = await readJsonFile(path.resolve(__dirname, '../package.json'))
		if (!p) throw new Error(`Couldn't read 'package.json'`)

		// Define CLI options
		program
			.version(p.version)
			.description(p.description)
			.on('--help', () => {
				log.I()
				log.I('Environment variables:')
				ENV_VARS.forEach(v => {
					log.I(`  ${v.name.padEnd(37)} ${v.description}`)
				})
			})

		const SHARED_OPTIONS = {
			'provider': {
				flags: '-p, --provider <name>',
				description: `AI provider to use for translations (anthropic, openai); overrides any 'provider' config setting`
			}
		}

		const addSharedOptions = ({ required, notRequired, program }) => {
			required = (required || []).map(k => ({ k, f: 'requiredOption' }))
			notRequired = (notRequired || []).map(k => ({ k, f: 'option' }))
			;[
				...required,
				...notRequired
			].forEach(({ k, f }) => {
				const so = SHARED_OPTIONS[k]
				program[f](so.flags, so.description, so?.defaultValue)
			})
		}

		const runCommand = async function() {
			const command = this.name()
			const options = this.opts()

			if (options.logo) {
				await printLogo({
					fontsSrcDir: path.resolve(__dirname, '../assets/figlet-fonts/'),
					tagline: p.description,
					log
				})
			}

			initLogFromOptions({ options, log })

			switch (command) {
				case 'translate':
					await runTranslation({ appState, options, log })
					break

				case 'list-models':
					await runListModels({ appState, options, log })
					break
			}
		}

		addSharedOptions({
			notRequired: [ 'provider' ],
			program: program
				.command('translate')
				.requiredOption('-r, --reference-file <path>', 'Path to reference file of source strings to be translated. This file can be in .js, .mjs, .json, or .jsonc formats and is presumed to be' +
					' in the reference language specified by --reference-language')
				.option('-rl, --reference-language <language>', `The reference file's language; overrides any 'referenceLanguage' config setting`)
				.option('-o, --output-dir <path>', 'Output directory for localized files')
				.option('-l, --target-languages <list>', `Comma-separated list of language codes; overrides any 'targetLanguages' config setting`, value => languageList(value, log))
				.option('-k, --keys <list>', 'Comma-separated list of keys to process', keyList)
				.option('-R, --reference-exported-var-name <var name>', `For .js or .mjs reference files, this will be the exported variable, e.g. for 'export default = {...}' you'd use 'default' here, or 'data' for 'export const data = { ... }'. For .json or .jsonc reference files, this value is ignored.`, 'default')
				.option('-f, --force', 'Force regeneration of all translations', false)
				.option('-rtw, --realtime-writes', 'Write updates to disk immediately, rather than on shutdown', false)
				.option('-m, --app-context-message <message>', `Description of your app to give context. Passed with each translation request; overrides any 'appContextMessage' config setting`)
				.option('-y, --tty', 'Use tty/simple renderer; useful for CI', false)
				.option('-c, --config-file <path>', `Path to config file; defaults to <output dir>/${DEFAULT_CONFIG_FILENAME}`)
				.option('-x, --max-retries <integer>', 'Maximum retries on failure', 3)
				.option('-n, --normalize-output-filenames', `Normalizes output filenames (to all lower-case); overrides any 'normalizeOutputFilenames' in config setting`, false)
				.option('-N, --no-logo', `Suppress logo printout`, true)  // NB: maps to options.logo, not options.noLogo
				.option('-cp, --context-prefix <value>', `String to be prefixed to all keys to search for additional context, which are passed along to the AI for context`)
				.option('-cs, --context-suffix <value>', `String to be suffixed to all keys to search for additional context, which are passed along to the AI for context`)
				.option('-L, --look-for-context-data', `If specified, ALT will pass any context data specified in the reference file to the AI provider for translation. At least one of --contextPrefix or --contextSuffix must be specified`, false)
				.option('-v, --verbose', `Enables verbose spew`, false)
				.option('-d, --debug', `Enables debug spew`, false)
				.option('-t, --trace', `Enables trace spew`, false)
				.option('--dev', `Enable dev mode, which prints stack traces with errors`, false)
				.hook('preAction', (thisCommand) => {
					const opts = thisCommand.opts()
					if (opts.lookForContextData && !(opts.contextPrefix?.length || opts.contextSuffix?.length)) {
						thisCommand.error('--lookForContextData requires at least 1 of --contextPrefix or --contextSuffix be defined and non-empty')
					}
				})
				.action(runCommand)
		})

		addSharedOptions({
			required: [ 'provider' ],
			program: program
				.command('list-models')
				.action(runCommand)
		})

		program.parse(process.argv)
	} catch (error) {
		log.E(error)
	}
}

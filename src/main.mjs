import * as path from 'path'
import { program } from 'commander'
import { fileURLToPath } from 'url'
import { initLocalizer } from './localizer/localize.js'
import {
	DEFAULT_CONFIG_FILENAME,
	ENV_VARS,
	LANGTAG_DEFAULT,
	LOCALIZATION_SRC_DIR,
} from './consts.js'
import { readJsonFile } from './io.js'
import { printLogo } from './logo.js'
import { createLog, initLogFromOptions } from './logging.js'
import { keyList, languageList } from './options.js'
import { runTranslation } from './translate.js'
import { registerSignalHandlers } from './shutdown.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Main function
export async function run() {
	const log = createLog()

	const appState = {
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
			.requiredOption('-r, --reference-file <path>', 'Path to reference JSONC file (default language)')
			.option('-rl, --reference-language <language>', `The reference file's language; overrides any 'referenceLanguage' config setting`)
			.option('-p, --provider <name>', `AI provider to use for translations (anthropic, openai); overrides any 'provider' config setting`)
			.option('-o, --output-dir <path>', 'Output directory for localized files')
			.option('-l, --target-languages <list>', `Comma-separated list of language codes; overrides any 'targetLanguages' config setting`, value => languageList(value, log))
			.option('-k, --keys <list>', 'Comma-separated list of keys to process', keyList)
			.option('-j, --reference-var-name <var name>', `The exported variable in the reference file, e.g. export default = {...} you'd use 'default'`, 'default')
			.option('-f, --force', 'Force regeneration of all translations', false)
			.option('-rtw, --realtime-writes', 'Write updates to disk immediately, rather than on shutdown', false)
			.option('-m, --app-context-message <message>', `Description of your app to give context. Passed with each translation request; overrides any 'appContextMessage' config setting`)
			.option('-y, --tty', 'Use tty/simple renderer; useful for CI', false)
			.option('-c, --config-file <path>', `Path to config file; defaults to <output dir>/${DEFAULT_CONFIG_FILENAME}`)
			.option('-x, --max-retries <integer>', 'Maximum retries on failure', 3)
			.option('-n, --normalize-output-filenames', `Normalizes output filenames (to all lower-case); overrides any 'normalizeOutputFilenames' in config setting`, false)
			.option('-v, --verbose', `Enables verbose spew`, false)
			.option('-d, --debug', `Enables debug spew`, false)
			.option('-t, --trace', `Enables trace spew`, false)
			.option('--no-logo', `Suppress logo printout`, true)  // NB: maps to options.logo, not options.noLogo
			.option('--context-prefix <value>', `String to be prefixed to all keys to search for additional context, which are passed along to the AI for context`)
			.option('--context-suffix <value>', `String to be suffixed to all keys to search for additional context, which are passed along to the AI for context`)
			.option('--look-for-context-data', `If specified, ALT will pass any context data specified in the reference file to the AI provider for translation. At least one of --contextPrefix or --contextSuffix must be specified`, false)
			.hook('preAction', (thisCommand) => {
				const opts = thisCommand.opts()
				if (opts.lookForContextData && !(opts.contextPrefix?.length || opts.contextSuffix?.length)) {
					thisCommand.error('--lookForContextData requires at least 1 of --contextPrefix or --contextSuffix be defined and non-empty')
				}
			})
			.action(async (thisCommand) => {
			})	// Dummy action() for preAction

		program
			.command('translate', { isDefault: true }) // This makes it the default command
			.action(async () => {
				const options = program.opts()
				if (options.logo) {
					await printLogo({
						fontsSrcDir: path.resolve(__dirname, '../assets/figlet-fonts/'),
						tagline: p.description,
						log
					})
				}
				initLogFromOptions({ options, log })
				await runTranslation({ appState, options, log })
			})

		program.parse(process.argv)
	} catch (error) {
		log.E(error)
	}
}

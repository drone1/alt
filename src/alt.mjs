import { program } from 'commander'
import { Buffer } from 'buffer'
import { pathToFileURL, fileURLToPath } from 'url'
import { Listr } from 'listr2'
import axios from 'axios'
import os from 'os'
import stripJsonComments from 'strip-json-comments'
import figlet from 'figlet'
import gradient from 'gradient-string'
import * as locale from 'locale-codes'
import * as fs from 'fs'
import * as fsp from 'fs/promises'
import * as crypto from 'crypto'
import * as path from 'path'
import { TRANSLATION_FAILED_RESPONSE_TEXT } from './consts.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const DEFAULT_CACHE_FILENAME = '.localization.cache.json'
const DEFAULT_CONFIG_FILENAME = 'config.json'
const OVERLOADED_BACKOFF_INTERVAL_MS = 30 * 1000

const CWD = process.cwd()
const appState = {
	filesToWrite: {},	// Map of file path => JSON data to write

	log: {
		e: function (...args) {
			console.error(...args)
		},
		w: function (...args) {
			console.warn(...args)
		},
		i: function (...args) {
			console.log(...args)
		},
	},
}

function unique(array) {
	return [...new Set(array)]
}

// Helper function to parse comma-separated list
function languageList(value, log) {
	const languages = unique(value.split(',').map(item => item.trim()))
	const invalid = languages.filter(lang => !locale.getByTag(lang))
	if (invalid.length) {
		log.e(`Found invalid language(s): ${invalid.join(', ')}`)
		process.exit(1)
	}
	return languages
}

function keyList(value) {
	return value.split(',').map(item => item.trim())
}

// Calculate hash of a string
function calculateHash(content) {
	return crypto.createHash('sha256').update(content).digest('hex')
}

async function readFileAsText(filePath) {
	try {
		return await fsp.readFile(filePath, 'utf8')
	} catch (error) {
		if (error.code === 'ENOENT') {
			return null
		}
		throw error
	}
}

function parseJson(s) {
	try {
		return JSON.parse(s)
	} catch (e) {
		return null
	}
}

// Read and parse JSONC file
async function readJsonFile(filePath, isJSONComments = false) {
	let content = await readFileAsText(filePath)
	if (isJSONComments) content = stripJsonComments.stripJsonComments(content)
	return parseJson(content)
}

// Dynamically imports the javascript file at filePath, which can be relative or absolute
async function importJsFile(filePath) {
	if (!path.isAbsolute(filePath)) {
		filePath = path.resolve(CWD, filePath)
	}
	// Convert the file path to a proper URL
	const fileUrl = pathToFileURL(filePath)
	return await import(fileUrl)
}

function normalizeKey(key) {
	return key.normalize('NFC') // Normalized Form C is generally recommended
}

function normalizeData(data) {
	if (!data) return null
	const normalizedData = {}
	for (const [key, value] of Object.entries(data)) {
		// Force UTF-8 encoding for the key
		const utf8Key = Buffer.from(key, 'utf8').toString('utf8')

		// Force UTF-8 encoding for string values
		const utf8Value = typeof value === 'string'
			? Buffer.from(value, 'utf8').toString('utf8')
			: value

		normalizedData[normalizeKey(utf8Key)] = utf8Value
	}
	return normalizedData
}

function bufferToUtf8(buffer) {
	// If it's already a string, return it
	if (typeof buffer === 'string') return buffer

	// If it's a Buffer, convert to UTF-8 string
	if (Buffer.isBuffer(buffer)) {
		return buffer.toString('utf8')
	}

	// If it's an ArrayBuffer or TypedArray, convert to Buffer first
	if (buffer instanceof ArrayBuffer ||
		(typeof buffer === 'object' && buffer.buffer instanceof ArrayBuffer)) {
		return Buffer.from(buffer).toString('utf8')
	}

	// Fallback - try to convert whatever it is to a string
	return String(buffer)
}

function dirExists(dir, log) {
	try {
		log.d(`fetching stats for ${dir}...`)
		return fs.statSync(dir).isDirectory()
	} catch (error) {
		log.e(error)
		return false
	}
}

// Write JSON file
function writeJsonFile(filePath, data, log) {
	assertValidPath(filePath)
	assertIsObj(data)
	log.v(`Preparing to write ${filePath}...`)

	// Create normalized version of data with consistent key encoding
	log.d(`Normaliziing data...`)
	const normalizedData = {}
	for (const [key, value] of Object.entries(data)) {
		normalizedData[normalizeKey(key)] = value
	}
	log.d(`Done.`)

	try {
		const dir = path.dirname(filePath)
		log.d(`Ensuring directory ${dir} exists...`)
		if (!dirExists(dir, log)) {
			log.d(`Directory ${dir} did not exist; creating...`)
			fs.mkdirSync(dir, { recursive: true })
		}
		log.d(`Done.`)
	} catch (err) {
		log.e(err)
	}

	log.i(`Writing ${filePath}...`)
	try {
		fs.writeFileSync(filePath, JSON.stringify(normalizedData, null, 2), 'utf8')
	} catch (err) {
		log.e(err)
	}
	log.d(`Done.`)
}

async function loadCache(path) {
	const storedCache = await readJsonFile(path)
	return {
		referenceHash: storedCache?.referenceHash ?? '',
		referenceKeyHashes: storedCache?.referenceKeyHashes ?? {},
		state: storedCache?.state ?? {},
		lastRun: storedCache?.lastRun ?? null,
	}
}

async function loadTranslationProvider(providerName) {
	const apiKeyName = `${providerName.toUpperCase()}_API_KEY`
	const apiKey = process.env[apiKeyName]
	if (!apiKey?.length) throw new Error('${apiKeyName} environment variable is not set')
	return {
		apiKey,
		api: await importJsFile(path.resolve(__dirname, `providers/${providerName}.mjs`)),
	}
}

const VALID_TRANSLATION_PROVIDERS = ['anthropic', 'openai']

async function printLogo({ tagline, log }) {
	const fontName = 'THIS.flf'
	const fontPath = path.resolve(__dirname, `../assets/figlet-fonts/${fontName}`)
	const fontData = await fsp.readFile(fontPath, 'utf8')
	figlet.parseFont(fontName, fontData)
	const asciiTitle = figlet.textSync('ALT', {
		font: fontName,
		horizontalLayout: 'full',
		verticalLayout: 'default',
	})

	log.i(`\n${gradient(['#000FFF', '#ed00b1'])(asciiTitle)}\n`)
}

function isContextKey({ key, contextPrefix, contextSuffix }) {
	if (contextPrefix?.length) return key.startsWith(contextPrefix)
	if (contextSuffix?.length) return key.endsWith(contextSuffix)
	throw new Error(`Either the context prefix or context suffix must be defined`)
}

function formatContextKeyFromKey({ key, prefix, suffix }) {
	return `${prefix}${key}${suffix}`
}

function normalizeOutputPath({ dir, filename, normalize }) {
	return path.join(dir, normalize ? filename.toLowerCase() : filename)
}

// Main function
export async function run() {
	const { log } = appState

	let exitCode = 0
	try {
		const p = await readJsonFile(path.resolve(__dirname, '../package.json'))
		if (!p) throw new Error(`Couldn't read 'package.json'`)

		// Define CLI options
		program
			.version(p.version)
			.description(p.description)
			.requiredOption('-r, --reference <path>', 'Path to reference JSONC file (default language)')
			.option('-rl, --reference-language <language>', `The reference file's language; overrides any 'referenceLanguage' config setting`)
			.option('-p, --provider <name>', `AI provider to use for translations (anthropic, openai); overrides any 'provider' config setting`)
			.option('-o, --output-dir <path>', 'Output directory for localized files', process.cwd())
			.option('-l, --target-languages <list>', `Comma-separated list of language codes; overrides any 'targetLanguages' config setting`, value => languageList(value, log))
			.option('-k, --keys <list>', 'Comma-separated list of keys to process', keyList)
			.option('-j, --reference-var-name <var name>', `The exported variable in the reference file, e.g. export default = {...} you'd use 'default'`, 'default')
			.option('-f, --force', 'Force regeneration of all translations', false)
			.option('-m, --app-context-message <message>', `Description of your app to give context. Passed with each translation request; overrides any 'appContextMessage' config setting`)
			.option('-y, --tty', 'Use tty/simple renderer; useful for CI', false)
			.option('-c, --config <path>', `Path to config file; defaults to <output dir>/${DEFAULT_CONFIG_FILENAME}`)
			.option('-x, --max-retries <integer>', 'Maximum retries on failure', 100)  // This is super high because of the extra-simple way we handle being rate-limited; essentially we want to continue retrying forever but not forever; see comment near relevant code
			.option('-e, --concurrent <integer>', `Maximum # of concurrent tasks`, 5)
			.option('-n, --normalize-output-filenames', `Normalizes output filenames (to all lower-case)`, false)
			.option('--context-prefix <value>', `String to be prefixed to all keys to search for additional context, which are passed along to the AI for context`, '')
			.option('--context-suffix <value>', `String to be suffixed to all keys to search for additional context, which are passed along to the AI for context`, '')
			.option('--look-for-context-data', `If specified, ALT will pass any context data specified in the reference file to the AI provider for translation. At least one of --contextPrefix or --contextSuffix must be specified`, false)
			.hook('preAction', (thisCommand) => {
				const opts = thisCommand.opts()
				if (opts.lookForContextData && !(opts.contextPrefix?.length || opts.contextSuffix?.length)) {
					thisCommand.error('--lookForContextData requires at least 1 of --contextPrefix or --contextSuffix be defined and non-empty')
				}
			}).action(() => {
		}) // Dummy required for preAction to trigger
			.option('-w, --write-on-quit', `Write files to disk only on quit (including SIGTERM); useful if running ALT causes your server to restart constantly`, false)
			.option('-v, --verbose', `Enables verbose spew`, false)
			.option('-d, --debug', `Enables debug spew`, false)
			.option('-t, --trace', `Enables trace spew`, false)
			.parse(process.argv)

		await printLogo({ tagline: p.description, log })
		const options = program.opts()

		// Init optional logging functions
		log.v = (options.trace || options.debug || options.verbose) ? function (...args) {
			console.log(...args)
		} : () => {
		}
		log.d = (options.trace || options.debug) ? function (...args) {
			console.debug(...args)
		} : () => {
		}
		log.t = options.trace ? function (...args) {
			console.debug(...args)
		} : () => {
		}

		// Load config file or create default
		const configFilePath = options.config ??
			path.resolve(options.outputDir, DEFAULT_CONFIG_FILENAME)
		log.v(`Attempting to load config file from "${configFilePath}"`)
		let config = await readJsonFile(configFilePath) || {
			targetLanguages: [],
			referenceLanguage: null
		}

		// Validate provider
		const provider = options.provider ?? config.provider
		if (!VALID_TRANSLATION_PROVIDERS.includes(options.provider)) {
			log.e(`Error: Unknown provider "${options.provider}". Supported providers: ${VALID_TRANSLATION_PROVIDERS.join(', ')}`)
			process.exit(2)
		}

		const referenceLanguage = options.referenceLanguage || config.referenceLanguage
		if (!referenceLanguage || !referenceLanguage.length) {
			log.e(`Error: No reference language specified. Use --reference-language option or add 'referenceLanguages' to your config file`)
			process.exit(2)
		}

		// Get target languages from CLI or config
		const targetLanguages = options.targetLanguages || config.targetLanguages
		if (!targetLanguages || !targetLanguages.length) {
			log.e(`Error: No target languages specified. Use --target-languages option or add 'targetLanguages' to your config file`)
			process.exit(2)
		}

		// No app context message is OK
		const appContextMessage = options.appContextMessage ?? config.appContextMessage ?? null
		log.d(`appContextMessage:`, appContextMessage)

		const cacheFilePath = path.resolve(options.outputDir, DEFAULT_CACHE_FILENAME)

		log.v(`Attempting to load cache file from "${cacheFilePath}"`)
		const readOnlyCache = await loadCache(cacheFilePath)
		log.d(`Loaded cache file`)

		// Create a tmp dir for storing the .mjs reference file; we can't dynamically import .js files directly, so we make a copy...
		const tmpDir = await mkTmpDir()
		appState.tmpDir = tmpDir

		// Copy to a temp location first so we can ensure it has an .mjs extension
		const tmpReferencePath = await copyFileToTempAndEnsureExtension({
			filePath: options.reference,
			tmpDir,
			ext: 'mjs',
		})
		const referenceContent = normalizeData(JSON.parse(JSON.stringify(await importJsFile(tmpReferencePath))), log)  // TODO: Don't do this
		const referenceData = referenceContent[options.referenceVarName]
		if (!referenceData) {
			log.e(`No reference data found in variable "${options.referenceVarName}" in ${options.reference}`)
			process.exit(2)
		}

		const referenceHash = calculateHash(await readFileAsText(options.reference))
		const referenceChanged = referenceHash !== readOnlyCache.referenceHash
		if (referenceChanged) {
			log.v('Reference file has changed since last run')
		}

		// Clone the cache for writing to
		const writableCache = JSON.parse(JSON.stringify(readOnlyCache))

		writableCache.referenceHash = referenceHash
		writableCache.lastRun = new Date().toISOString()

		// Always write this file, since it changes every run ('lastRun')
		assertValidPath(cacheFilePath)
		appState.filesToWrite[cacheFilePath] = writableCache

		const { apiKey, api: translationProvider } = await loadTranslationProvider(options.provider)
		log.v(`translation provider "${options.provider}" loaded`)

		const tasks = new Listr([], {
			concurrent: false, // Process languages one by one
			...(options.tty ? { renderer: 'simple' } : {}),
			rendererOptions: { collapse: true, clearOutput: true },
			clearOutput: false,
			registerSignalListeners: true,
		})

		appState.tasks = tasks

		const addContextToTranslation = options.lookForContextData

		// Process each language
		for (const lang of targetLanguages) {
			log.d(`Processing language ${lang}...`)
			let stringsTranslatedForLanguage = 0

			let outputDataModified = false

			const outputFilePath = normalizeOutputPath({
				dir: options.outputDir,
				filename: `${lang}.json`,
				normalize: options.normalizeOutputFilenames,
			})
			log.d(`outputFilePath=${outputFilePath}`)

			// Read existing output data
			let outputData = normalizeData(await readJsonFile(outputFilePath)) || {}
			if (!outputData) {
				outputData = {}
				outputDataModified = true
			}

			// Initialize language in cache if it doesn't exist
			if (!writableCache.state[lang]) {
				log.v(`lang ${lang} not in cache; update needed...`)
				writableCache.state[lang] = { keyHashes: {} }
			}

			tasks.add([{
				title: `Localize "${lang}"`,
				task: async (ctx, task) => {
					ctx.nextTaskDelayMs = 0

					let keysToProcess = options.keys?.length
						? options.keys
						: Object.keys(referenceData)

					if (addContextToTranslation) {
						keysToProcess = keysToProcess
							.filter(key => !isContextKey({
								key,
								contextPrefix: options.contextPrefix,
								contextSuffix: options.contextSuffix,
							}))
					}

					log.t(`keys to process: ${keysToProcess.join(',')}`)
					const subtasks = keysToProcess.map(key => {
						const contextKey = formatContextKeyFromKey({
							key,
							prefix: options.contextPrefix,
							suffix: options.contextSuffix,
						})
						log.t(`contextKey=${contextKey}`)
						const storedHashForReferenceValue = readOnlyCache?.referenceKeyHashes?.[key]
						const storedHashForLangAndValue = readOnlyCache.state[lang]?.keyHashes?.[key]
						const refValue = referenceData[key]
						const refContextValue = (contextKey in referenceData) ? referenceData[contextKey] : null
						const referenceValueHash = calculateHash(`${refValue}${refContextValue?.length ? `_${refContextValue}` : ''}`)	// If either of the ref value or the context value change, we'll update
						const curValue = (key in outputData) ? outputData[key] : null
						return {
							title: `Processing "${key}"`,
							task: async (ctx, subtask) => {
								const {
									success,
									translated,
									newValue,
									userModifiedTargetValue,
									error,
								} = await translateKeyForLanguage({
									task: subtask,
									ctx,
									config,
									translationProvider,
									apiKey,
									appContextMessage,
									referenceValueHash,
									storedHashForReferenceValue,
									storedHashForLangAndValue,
									lang,
									key,
									refValue,
									refContextValue,
									curValue,
									options,
									log,
								})

								if (success) {
									++stringsTranslatedForLanguage

									if (translated) {
										outputDataModified = true
										outputData[key] = newValue

										// Write real-time translation updates
										if (!options.writeOnQuit) {
											await writeJsonFile(outputFilePath, outputData, log)
											log.v(`Wrote ${outputFilePath}`)
										} else {
											log.v(`Delaying write for ${outputFilePath} due to --writeOnQuit...`)
										}

										const hashForTranslated = calculateHash(newValue)
										log.d(`Updating hash for translated ${lang}.${key}: ${hashForTranslated}`)
										writableCache.state[lang].keyHashes[key] = hashForTranslated
										subtask.title = `Translated ${key}: "${newValue}"`

										// Update the hash for the reference key, so we can monitor if the user changed a specific key
										writableCache.referenceKeyHashes[key] = referenceValueHash

										// Update state file every time, in case the user kills the process
										if (!options.writeOnQuit) {
											await writeJsonFile(cacheFilePath, writableCache, log)
											log.v(`Wrote ${cacheFilePath}`)
										} else {
											log.v(`Delaying write for ${cacheFilePath} due to --writeOnQuit...`)
										}
									} else {
										log.v(`Keeping existing translation and hash for ${lang}/${key}...`)

										// Allow the user to directly edit/tweak output key values
										if (userModifiedTargetValue) {
											subtask.title = `Skipping ${key}; value modified by user`
										} else {
											subtask.title = `No update needed for ${key}`
										}
									}

									// This will allow the app to shut down with non-tty/non-simple rendering, where rendering can fall far behind, if all keys are already processed and Promises are resolving immediately but rendering is far behind
									await sleep(1)
								} else if (error) {
									throw new Error(error)
								}

								log.d('writeOnQuit', options.writeOnQuit)
								log.d(outputDataModified)
								if (options.writeOnQuit && outputDataModified && !(outputFilePath in appState.filesToWrite)) {
									log.d(`Noting write-on-quit needed for ${outputFilePath}...`)
									appState.filesToWrite[outputFilePath] = outputData
								}
							}	// End of task function
						}
					})

					return task.newListr(
						subtasks, {
							concurrent: parseInt(options.concurrent),
							rendererOptions: { collapse: true, persistentOutput: true },
							registerSignalListeners: true,
						},
					)
				}
			}])
		}

		await tasks.run()
	} catch (error) {
		log.e('Error:', error)
		exitCode = 2
	}

	await shutdown(appState, false)

	if (exitCode > 0) {
		process.exit(exitCode)
	}
}

async function translateKeyForLanguage({
										   task,
										   ctx,
										   translationProvider,
										   apiKey,
																				 appContextMessage,
										   referenceValueHash,
										   storedHashForReferenceValue,
										   storedHashForLangAndValue,
										   lang,
										   key,
										   refValue,
										   refContextValue,
										   curValue,
										   options: { force, referenceLanguage, maxRetries },
										   log,
									   }) {
	const result = { success: true, translated: false, userModifiedTargetValue: false, newValue: null, error: null }

	// Skip non-string values (objects, arrays, etc.)
	if (typeof refValue !== 'string') {
		result.error = `Value for reference key "${key}" was not a string! Skipping...`
		result.success = false
		return result
	}

	const currentValueHash = curValue?.length ? calculateHash(curValue) : null

	// Check if translation needs update
	const missingOutputKey = curValue === null
	const missingOutputValueHash = storedHashForLangAndValue === null

	// Calculate reference value hash and compare with stored hash
	const userMissingReferenceValueHash = !storedHashForReferenceValue?.length
	const userModifiedReferenceValue = referenceValueHash && storedHashForReferenceValue && referenceValueHash !== storedHashForReferenceValue
	const userModifiedTargetValue = storedHashForLangAndValue && currentValueHash && currentValueHash !== storedHashForLangAndValue
	result.userModifiedTargetValue = userModifiedTargetValue

	log.d(`Reference key: "${key}"`)
	log.d('storedHashForReferenceValue', storedHashForReferenceValue)
	log.d('referenceValueHash ', referenceValueHash)
	log.d('userMissingReferenceValueHash', userMissingReferenceValueHash)
	log.d('userModifiedReferenceValue', userModifiedReferenceValue)
	log.d('curValue', curValue)
	log.d('currentValueHash', currentValueHash)
	log.d('storedHashForLangAndValue', storedHashForLangAndValue)
	log.d('userModifiedTargetValue ', userModifiedTargetValue)

	const needsTranslation = force ||
		userMissingReferenceValueHash ||
		userModifiedReferenceValue ||
		userModifiedTargetValue ||
		missingOutputKey ||
		missingOutputValueHash

	if (needsTranslation) {
		if (force) log.d(`Forcing update...`)
		if (missingOutputKey) log.d(`No "${key}" in output data...`)
		if (!storedHashForLangAndValue) log.d(`Hash was not found in storage...`)
		if (userModifiedTargetValue) log.d(`User modified target value: hashes differ (${currentValueHash} / ${storedHashForLangAndValue})...`)

		// Call translation provider
		log.d(`[${lang}] Translating "${key}"...`)
		task.title = `Translating "${key}"...`

		const providerName = translationProvider.name()
		let translated = null
		let newValue

		// Because of the simple (naive) way we handle being rate-limited and backing off, we kind of want to retry forever but not forever.
		// A single key may need to retry many times, since the algorithm is quite simple: if a task is told to retry after 10s,
		// any subsequent tasks that run will delay 10s also, then those concurrent remaining tasks will all hammer at once, some
		// will complete (maybe), then we'll wait again, then hammer again. A more proper solution may or may not be forthcoming...
		for (let attempt = 0; !newValue && attempt <= maxRetries; ++attempt) {
			const attemptStr = attempt > 0 ? ` [Attempt: ${attempt + 1}]` : ''
			task.title = `Translating with ${providerName}` + attemptStr

			log.d(`[translate] attempt=${attempt}`)

			log.d('next task delay', ctx.nextTaskDelayMs)
			if (ctx.nextTaskDelayMs > 0) {
				const msg = `Rate limited; sleeping for ${Math.floor(ctx.nextTaskDelayMs / 1000)}s...` + attemptStr
				task.title = msg
				log.d(msg)
				await sleep(ctx.nextTaskDelayMs)
			}

			const translateResult = await translate({
				task,
				provider: translationProvider,
				text: refValue,
				context: refContextValue,
				sourceLang: referenceLanguage,
				targetLang: lang,
				appContextMessage,
				apiKey,
				maxRetries: maxRetries,
				attemptStr,
				log,
			})

			if (translateResult.backoffInterval > 0) {
				log.d(`backing off... interval: ${translateResult.backoffInterval}`)
				task.title = 'Rate limited'
				log.d(`ctx.nextTaskDelayMs=${ctx.nextTaskDelayMs}`)
				ctx.nextTaskDelayMs = Math.max(ctx.nextTaskDelayMs, translateResult.backoffInterval)
			} else {
				newValue = translateResult.translated
			}
		}

		if (!newValue?.length) throw new Error(`Translation was empty; target lanugage=${lang}; key=${key}; text=${refValue}`)

		log.d('translated text', newValue)
		result.translated = true
		result.newValue = newValue
	}

	return result
}

async function mkTmpDir() {
	return await fsp.mkdtemp(path.join(os.tmpdir(), 'alt-'))
}

function ensureExtension(filename, extension) {
	if (!extension.startsWith('.')) extension = '.' + extension
	return filename.endsWith(extension) ? filename : filename + extension
}

// This is basically so that we can dynamicaly import .js files by copying them to temp .mjs files, to avoid errors from node
async function copyFileToTempAndEnsureExtension({ filePath, tmpDir, ext }) {
	try {
		const fileName = ensureExtension(path.basename(filePath), ext)
		const destPath = path.join(tmpDir, fileName)
		await fsp.copyFile(filePath, destPath)
		return destPath
	} catch (error) {
		log.e(`Error copying file to temp directory: ${error.message}`)
		throw error
	}
}

function rmDir(dir, log) {
	try {
		fs.rmSync(dir, { recursive: true, force: true })
		log.d(`Removed dir ${dir}`)
	} catch (error) {
		log.e(`Error cleaning up temp directory "${dir}": ${error.message}`)
		throw error
	}
}

function shutdown(appState, kill) {
	const { log, filesToWrite } = appState

	if (kill) log.i('Forcing shutdown...')

	// Write any data to disk
	//log.d('filesToWrite keys:', Object.keys(filesToWrite))
	let filesWrittenCount = 0
	for (const path of Object.keys(filesToWrite)) {
		log.d('path:', path)
		const json = filesToWrite[path]
		log.t('json:', json)
		writeJsonFile(path, json, appState.log)
		++filesWrittenCount
	}

	log.d(`Wrote ${filesWrittenCount} files to disk.`)

	if (appState?.tmpDir) {
		rmDir(appState.tmpDir, log)
	}

	if (kill) process.exit(1)
}

export function sleep(ms, log) {
	if (ms === 0) return
	return new Promise(resolve => setTimeout(resolve, ms))
}

async function translate({
							 task,
							 provider,
							 appContextMessage,
							 text,
							 context,
							 sourceLang,
							 targetLang,
							 apiKey,
							 attemptStr,
							 log,
						 }) {
	log.d(`[translate] targetLang=${targetLang}; text=${text}`)
	const result = { translated: null, backoffInterval: 0 }

	try {
		const providerName = provider.name()
		task.title = `Preparing endpoint configuration...`
		const messages = []
		messages.push(
			`You are a professional translator for an application's text from ${sourceLang} to ${targetLang}. `
			+ `Translate the text accurately without adding explanations or additional content. Only return the text. `,
			//+ `If and only if you absolutely cannot translate the text, you can respond with "${TRANSLATION_FAILED_RESPONSE_TEXT}" -- but please try to translate the text if you can. It would be greatly appreciated.`,	// With this, the AI seems to be lazy and use it way too often
		)
		if (appContextMessage?.length) {
			messages.push(`Here is some high-level information about the application you are translating text for: ${appContextMessage}`)
		}
		if (context) {
			messages.push(`Here is some additional context for the string you are going to translate: ${context}`)
		}
		messages.push(
			`Here we go. Translate the following text from ${sourceLang} to ${targetLang}:`
			+ `\n\n${text}`,
		)
		log.d(`prompt: `, messages)
		const { url, params, config } = provider.getTranslationRequestDetails({ messages, apiKey, log })
		task.title = `Hitting ${providerName} endpoint${attemptStr}...`
		const response = await axios.post(url, params, config)
		log.t('response headers', response.headers)
		const translated = provider.getResult(response, log)
		if (!translated?.length) throw new Error(`${providerName} translated text to empty string`)
		log.d(`${translated}`)
		if (translated === TRANSLATION_FAILED_RESPONSE_TEXT) throw new Error(`${providerName} failed to translate string to ${targetLang}; string: ${text}`)
		result.translated = translated
	} catch (error) {
		const response = error?.response
		if (response) {
			if (response.status === 429) {
				result.backoffInterval = provider.getSleepInterval(response.headers, log)
				log.d(`Rate limited; retrying in ${result.backoffInterval}`)
			} else if (error.response.status === 529) { // Unofficial 'overloaded' code
				result.backoffInterval = OVERLOADED_BACKOFF_INTERVAL_MS
				log.d(`Overloaded; retrying in ${result.backoffInterval}`)
			}
		} else {
			log.w(`API failed. Error:`, error.message)
		}
	}

	return result
}

function assert(b, msg) {
	if (!b) {
		debugger
		throw new Error(msg || `Assertion failed`)
	}
}

function assertIsNonEmptyString(s, msg) {
	assert(s?.length, msg || `parameter was not a non-empty string`)
}

function assertValidPath(path, msg) {
	assertIsNonEmptyString(path, msg || `parameter was not a valid path`)
}

function assertIsObj(x, msg) {
	assert(typeof x === 'object', msg || `parameter was not an object`)
}

// Shutdown in the normal render mode may seem to be failing, but technically it's not; if you're processing all languages,
// and a lot of tokens do not need to be updated, the promises have likely already completed but rendering takes ages to
// catch up; this means SIGTERM will only work if there are strings that need translation, since they take actual time
// NB: Using async fs API's isn't reliable here; use the sync API otherwise only the first file can be written to disk
process.on('SIGINT', () => shutdown(appState, true))
process.on('SIGTERM', () => shutdown(appState, true))

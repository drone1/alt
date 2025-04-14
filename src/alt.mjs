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

	errors: [],

	log: {
		E: function(...args) {
			console.error(...args)
		},
		W: function(...args) {
			console.warn(...args)
		},
		I: function(...args) {
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
		log.E(`Found invalid language(s): ${invalid.join(', ')}`)
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
		log.D(`fetching stats for ${dir}...`)
		return fs.statSync(dir).isDirectory()
	} catch (error) {
		log.E(error)
		return false
	}
}

// Write JSON file
function writeJsonFile(filePath, data, log) {
	assertValidPath(filePath)
	assertIsObj(data)
	log.V(`Preparing to write ${filePath}...`)

	// Create normalized version of data with consistent key encoding
	log.D(`Normalizing data...`)
	const normalizedData = {}
	for (const [key, value] of Object.entries(data)) {
		normalizedData[normalizeKey(key)] = value
	}
	log.D(`Done.`)

	try {
		const dir = path.dirname(filePath)
		log.D(`Ensuring directory ${dir} exists...`)
		if (!dirExists(dir, log)) {
			log.D(`Directory ${dir} did not exist; creating...`)
			fs.mkdirSync(dir, { recursive: true })
		}
		log.D(`Done.`)
	} catch (err) {
		log.E(err)
	}

	log.V(`Writing ${filePath}...`)
	try {
		fs.writeFileSync(filePath, JSON.stringify(normalizedData, null, 2), 'utf8')
	} catch (err) {
		log.E(err)
	}
	log.D(`Done.`)
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

async function loadTranslationProvider(providerName, log) {
	const apiKeyName = `${providerName.toUpperCase()}_API_KEY`
	const apiKey = process.env[apiKeyName]
	if (!apiKey?.length) {
		log.E(`${apiKeyName} environment variable is not set`)
		process.exit(1)
	}
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

	log.I(`\n${gradient([
		'#000FFF',
		'#ed00b1'
	])(asciiTitle)}\n`)
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

	try {
		const p = await readJsonFile(path.resolve(__dirname, '../package.json'))
		if (!p) throw new Error(`Couldn't read 'package.json'`)

		// Define CLI options
		program
			.version(p.version)
			.description(p.description)
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
				initLog({ options, log })
				await runTranslation({ options, log })
			})

		program.parse(process.argv)

		await printLogo({ tagline: p.description, log })
	} catch (error) {
		log.E(error)
	}
}

function initLog({ options, log }) {
	// Init optional logging functions
	log.V = (options.trace || options.debug || options.verbose) ? function(...args) {
		console.log(...args)
	} : () => {
	}
	log.D = (options.trace || options.debug) ? function(...args) {
		console.debug(...args)
	} : () => {
	}
	log.T = options.trace ? function(...args) {
		console.debug(...args)
	} : () => {
	}
}

async function loadConfig({ configFile, refFileDir, log }) {
	let configFilePath
	if (configFile?.length) {
		log.V(`Using config file specified by --config-file "${configFile}"...`)
		configFilePath = configFile
	} else {
		log.V(`Using config file path based on reference file dir, "${refFileDir}"...`)
		configFilePath = path.resolve(refFileDir, DEFAULT_CONFIG_FILENAME)
	}

	log.V(`Attempting to load config file from "${configFilePath}"`)
	return await readJsonFile(configFilePath) || {
		provider: null,
		targetLanguages: [],
		lookForContextData: true,
		contextPrefix: '',
		contextSuffix: '',
		referenceLanguage: null,
		normalizeOutputFilenames: false
	}
}

async function runTranslation({ options, log }) {
	let exitCode = 0
	try {
		const refFileDir = path.dirname(options.referenceFile)
		let outputDir = options.outputDir ?? refFileDir

		// Load config file or create default
		const config = await loadConfig({
			configFile: options.configFile,
			refFileDir,
			log
		})

		// Validate provider
		const provider = options.provider ?? config.provider
		if (!VALID_TRANSLATION_PROVIDERS.includes(provider)) {
			log.E(`Error: Unknown provider "${options.provider}". Supported providers: ${VALID_TRANSLATION_PROVIDERS.join(', ')}`)
			process.exit(2)
		}

		const referenceLanguage = options.referenceLanguage || config.referenceLanguage
		if (!referenceLanguage || !referenceLanguage.length) {
			log.E(`Error: No reference language specified. Use --reference-language option or add 'referenceLanguages' to your config file`)
			process.exit(2)
		}

		// Get target languages from CLI or config
		const targetLanguages = options.targetLanguages || config.targetLanguages
		if (!targetLanguages || !targetLanguages.length) {
			log.E(`Error: No target languages specified. Use --target-languages option or add 'targetLanguages' to your config file`)
			process.exit(2)
		}

		const normalizeOutputFilenames = options.normalizeOutputFilenames || config.normalizeOutputFilenames

		// No app context message is OK
		const appContextMessage = options.appContextMessage ?? config.appContextMessage ?? null
		log.D(`appContextMessage:`, appContextMessage)

		const cacheFilePath = path.resolve(outputDir, DEFAULT_CACHE_FILENAME)

		log.V(`Attempting to load cache file from "${cacheFilePath}"`)
		const readOnlyCache = await loadCache(cacheFilePath)
		log.D(`Loaded cache file`)

		// Create a tmp dir for storing the .mjs reference file; we can't dynamically import .js files directly, so we make a copy...
		const tmpDir = await mkTmpDir()
		appState.tmpDir = tmpDir

		// Copy to a temp location first so we can ensure it has an .mjs extension
		const tmpReferencePath = await copyFileToTempAndEnsureExtension({
			filePath: options.referenceFile,
			tmpDir,
			ext: 'mjs',
		})
		const referenceContent = normalizeData(JSON.parse(JSON.stringify(await importJsFile(tmpReferencePath))), log)  // TODO: Don't do this
		const referenceData = referenceContent[options.referenceVarName]
		if (!referenceData) {
			log.E(`No reference data found in variable "${options.referenceVarName}" in ${options.referenceFile}`)
			process.exit(2)
		}

		const referenceHash = calculateHash(await readFileAsText(options.referenceFile))
		const referenceChanged = referenceHash !== readOnlyCache.referenceHash
		if (referenceChanged) {
			log.V('Reference file has changed since last run')
		}

		// Clone the cache for writing to
		const writableCache = JSON.parse(JSON.stringify(readOnlyCache))

		writableCache.referenceHash = referenceHash
		writableCache.lastRun = new Date().toISOString()

		// Always write this file, since it changes every run ('lastRun')
		assertValidPath(cacheFilePath)
		appState.filesToWrite[cacheFilePath] = writableCache

		const { apiKey, api: translationProvider } = await loadTranslationProvider(provider, log)
		log.V(`translation provider "${options.provider}" loaded`)

		const addContextToTranslation = options.lookForContextData || config.lookForContextData

		const workQueue = []
		const errors = appState.errors

		// Process each language
		for (const targetLang of targetLanguages) {
			log.D(`Processing language ${targetLang}...`)
			const outputFilePath = normalizeOutputPath({
				dir: outputDir,
				filename: `${targetLang}.json`,
				normalize: normalizeOutputFilenames
			})
			log.D(`outputFilePath=${outputFilePath}`)

			// Read existing output data
			let outputData = normalizeData(await readJsonFile(outputFilePath)) || {}
			let outputFileDidNotExist = false
			if (!outputData) {
				outputFileDidNotExist = true
			}

			// Initialize language in cache if it doesn't exist
			if (!writableCache.state[targetLang]) {
				log.V(`target language ${targetLang} not in cache; update needed...`)
				writableCache.state[targetLang] = { keyHashes: {} }
			}

			let keysToProcess = options.keys?.length
				? options.keys
				: Object.keys(referenceData)

			if (addContextToTranslation) {
				keysToProcess = keysToProcess
					.filter(key => !isContextKey({
						key,
						contextPrefix: options.contextPrefix ?? config.contextPrefix,
						contextSuffix: options.contextSuffix ?? config.contextSuffix
					}))
			}

			log.T(`keys to process: ${keysToProcess.join(',')}`)
			for (const key of keysToProcess) {
				const contextKey = formatContextKeyFromKey({
					key,
					prefix: options.contextPrefix,
					suffix: options.contextSuffix
				})
				log.T(`contextKey=${contextKey}`)
				const storedHashForReferenceValue = readOnlyCache?.referenceKeyHashes?.[key]
				const storedHashForTargetLangAndValue = readOnlyCache.state[targetLang]?.keyHashes?.[key]
				const refValue = referenceData[key]
				const refContextValue = (contextKey in referenceData) ? referenceData[contextKey] : null
				const referenceValueHash = calculateHash(`${refValue}${refContextValue?.length ? `_${refContextValue}` : ''}`)	// If either of the ref value or the context value change, we'll update
				const curValue = (key in outputData) ? outputData[key] : null

				// Skip non-string values (objects, arrays, etc.)
				if (typeof refValue !== 'string') {
					errors.push(`Value for reference key "${key}" was not a string! Skipping...`)
					continue
				}

				const currentValueHash = curValue?.length ? calculateHash(curValue) : null

				// Check if translation needs update
				const missingOutputKey = curValue === null
				const missingOutputValueHash = storedHashForTargetLangAndValue === null

				// Calculate reference value hash and compare with stored hash
				const userMissingReferenceValueHash = !storedHashForReferenceValue?.length
				const userModifiedReferenceValue = Boolean(referenceValueHash) && Boolean(storedHashForReferenceValue) && referenceValueHash !== storedHashForReferenceValue
				const userModifiedTargetValue = Boolean(storedHashForTargetLangAndValue) && Boolean(currentValueHash) && currentValueHash !== storedHashForTargetLangAndValue

				log.D(`Reference key: "${key}"`)
				log.D('storedHashForReferenceValue', storedHashForReferenceValue)
				log.D('referenceValueHash ', referenceValueHash)
				log.D('userMissingReferenceValueHash', userMissingReferenceValueHash)
				log.D('userModifiedReferenceValue', userModifiedReferenceValue)
				log.D('curValue', curValue)
				log.D('currentValueHash', currentValueHash)
				log.D('storedHashForTargetLangAndValue', storedHashForTargetLangAndValue)
				log.D('userModifiedTargetValue ', userModifiedTargetValue)

				// Map reason key => true/false
				const possibleReasonsForTranslationMap = {
					forced: options.force,
					outputFileDidNotExist,
					userMissingReferenceValueHash,
					userModifiedReferenceValue,
					missingOutputKey,
					missingOutputValueHash
				}
				log.D(`possibleReasonsForTranslationMap`, possibleReasonsForTranslationMap)

				// Filter out keys which are not true
				let reasonsForTranslationMap = {}
				let needsTranslation = false
				Object.keys(possibleReasonsForTranslationMap)
					.forEach(k => {
						if (possibleReasonsForTranslationMap[k]) {
							reasonsForTranslationMap[k] = true
							needsTranslation = true
						}
					})
				log.D(`reasonsForTranslationMap`, reasonsForTranslationMap)

				if (needsTranslation && !userModifiedTargetValue) {
					log.D(`Translation needed for ${targetLang}/${key}...`)
					if (reasonsForTranslationMap.forced) log.D(`Forcing update...`)
					if (reasonsForTranslationMap.missingOutputKey) log.D(`No "${key}" in output data...`)
					if (!reasonsForTranslationMap.storedHashForTargetLangAndValue) log.D(`Hash was not found in storage...`)

					const newTask = {
						key,
						sourceLang: referenceLanguage,
						targetLang,
						reasonsForTranslationMap,
						outputData,
						outputFilePath,
						writableCache,
						cacheFilePath,
						state: {
							translationProvider,
							apiKey,
							appContextMessage,
							storedHashForReferenceValue,
							refValue,
							refContextValue,
							referenceValueHash,
							userMissingReferenceValueHash,
							userModifiedReferenceValue,
							curValue,
							currentValueHash,
							storedHashForTargetLangAndValue
						}
					}

					workQueue.push(newTask)
				} else {
					if (userModifiedTargetValue) log.D(`User modified target value: hashes differ (${currentValueHash} / ${storedHashForTargetLangAndValue})...`)
					log.V(`[${targetLang}] ${key} no translation needed.`)
				}
			}
		}

		let nextTaskDelayMs = 0
		let totalTasks = workQueue.length
		let errorsEncountered = 0
		for (const taskInfoIdx in workQueue) {
			const taskInfo = workQueue[taskInfoIdx]
			log.D(taskInfo)
			const progress = 100 * Math.floor(100 * taskInfoIdx / totalTasks) / 100

			await new Listr([
				{
					title: `[${progress}%] Processing ${taskInfo.targetLang}/${taskInfo.key}...`,
					task: async (ctx, task) => {
						ctx.nextTaskDelayMs = nextTaskDelayMs

						return task.newListr([
							{
								title: 'Translating...',
								task: async (_, task) => {
									const translationResult = await processTranslationTask({ taskInfo, listrTask: task, listrCtx: ctx, options, log })

									// TODO: Get this from return value from processTranslationTask()
									nextTaskDelayMs = translationResult.nextTaskDelayMs

									if (translationResult.error) {
										++errorsEncountered
										throw new Error(translationResult.error)
									}

									// NOTE: Perhaps not needed anymore?
									// This will allow the app to shut down with non-tty/non-simple rendering, where rendering can fall far behind, if all keys are already processed and Promises are resolving
									// immediately but rendering is far behind
									await sleep(1)
								},
								concurrent: false, // Process languages one by one
								rendererOptions: { collapse: false, clearOutput: false },
								exitOnError: false
							}
						])
					}
				}
			], {
				concurrent: false, // Process languages one by one
				...(options.tty ? { renderer: 'simple' } : {}),
				rendererOptions: { collapse: false, clearOutput: false },
				registerSignalListeners: true,
				collapseSubtasks: false
			}).run()
		}

		if (totalTasks > 0) {
			let str = `[100%] `
			if (errorsEncountered > 0) str += `Finished with ${errorsEncountered} error${errorsEncountered > 1 ? 's' : ''}`
			else str += `Done`
			log.I(`\x1B[38;2;44;190;78m✔\x1B[0m ${str}`)
		} else {
			log.I('\x1B[38;2;44;190;78m✔\x1B[0m Nothing to do')
		}
	} catch (error) {
		log.E('Error:', error)
		exitCode = 2
	}

	await shutdown(appState, false)

	if (exitCode > 0) {
		process.exit(exitCode)
	}
}

const USER_REASONS_FOR_UPDATES = {
	forced: `Forced update`,
	outputFileDidNotExist: f => `Output file ${f} did not exist`,
	userMissingReferenceValueHash: `No reference hash found`,
	userModifiedReferenceValue: `User modified reference string`,
	missingOutputKey: `No existing translation found`,
	missingOutputValueHash: `No hash found in cache file`
}

async function processTranslationTask({ taskInfo, listrTask, listrCtx, options, log }) {
	const { key, sourceLang, targetLang, reasonsForTranslationMap, outputData, outputFilePath, writableCache, cacheFilePath, state } = taskInfo
	const {
		translationProvider,
		apiKey,
		appContextMessage,
		storedHashForReferenceValue,
		refValue,
		refContextValue,
		referenceValueHash,
		userMissingReferenceValueHash,
		userModifiedReferenceValue,
		curValue,
		currentValueHash,
		storedHashForTargetLangAndValue
	} = state

	let reasons = Object.keys(reasonsForTranslationMap).map(k => USER_REASONS_FOR_UPDATES[k]).join(', ')
	listrTask.output = reasons

	const {
		success,
		translated,
		nextTaskDelayMs,
		newValue,
		error
	} = await translateKeyForLanguage({
		listrTask,
		ctx: listrCtx,
		translationProvider,
		apiKey,
		referenceValueHash,
		storedHashForReferenceValue,
		storedHashForTargetLangAndValue,
		sourceLang,
		targetLang,
		key,
		refValue,
		refContextValue,
		curValue,
		options,
		log
	})

	let outputDataModified = false

	if (success) {
		if (translated) {
			outputDataModified = true
			outputData[key] = newValue

			// Write real-time translation updates
			if (options.realtimeWrites) {
				await writeJsonFile(outputFilePath, outputData, log)
				log.V(`Wrote ${outputFilePath}`)
			}

			const hashForTranslated = calculateHash(newValue)
			log.D(`Updating hash for translated ${targetLang}.${key}: ${hashForTranslated}`)
			writableCache.state[targetLang].keyHashes[key] = hashForTranslated
			listrTask.output = `Translated ${key}: "${newValue}"`

			// Update the hash for the reference key, so we can monitor if the user changed a specific key
			writableCache.referenceKeyHashes[key] = referenceValueHash

			// Update state file every time, in case the user kills the process
			if (options.realtimeWrites) {
				await writeJsonFile(cacheFilePath, writableCache, log)
				log.V(`Wrote ${cacheFilePath}`)
			}
		} else {
			log.V(`Keeping existing translation and hash for ${targetLang}/${key}...`)

			// Allow the user to directly edit/tweak output key values
			listrTask.output = `No update needed for ${key}`
		}
	}

	log.D('realtimeWrites', options.realtimeWrites)
	log.D(outputDataModified)
	if (!options.realtimeWrites && outputDataModified && !(outputFilePath in appState.filesToWrite)) {
		log.D(`Noting write-on-quit needed for ${outputFilePath}...`)
		appState.filesToWrite[outputFilePath] = outputData
	}

	return { nextTaskDelayMs, error }
}

async function translateKeyForLanguage({
																				 listrTask,
																				 ctx,
																				 translationProvider,
																				 apiKey,
																				 appContextMessage,
																				 sourceLang,
																				 targetLang,
																				 key,
																				 refValue,
																				 refContextValue,
																				 options: { force, referenceLanguage, maxRetries },
																				 log
																			 }) {
	const result = { success: false, translated: false, newValue: null, nextTaskDelayMs: 0, error: null }

	// Call translation provider
	log.D(`[${targetLang}] Translating "${key}"...`)
	listrTask.output = `Translating "${key}"...`

	const providerName = translationProvider.name()
	let translated = null
	let newValue

	// Because of the simple (naive) way we handle being rate-limited and backing off, we kind of want to retry forever but not forever.
	// A single key may need to retry many times, since the algorithm is quite simple: if a task is told to retry after 10s,
	// any subsequent tasks that run will delay 10s also, then those concurrent remaining tasks will all hammer at once, some
	// will complete (maybe), then we'll wait again, then hammer again. A more proper solution may or may not be forthcoming...
	for (let attempt = 0; !newValue && attempt <= maxRetries; ++attempt) {
		const attemptStr = attempt > 0 ? ` [Attempt: ${attempt + 1}]` : ''
		log.D(`[translate] attempt=${attempt}`)

		log.D('next task delay', ctx.nextTaskDelayMs)
		if (ctx.nextTaskDelayMs > 0) {
			const msg = `Rate limited; sleeping for ${Math.floor(ctx.nextTaskDelayMs / 1000)}s...` + attemptStr
			listrTask.output = msg
			log.D(msg)
			await sleep(ctx.nextTaskDelayMs)
		}

		const translateResult = await translate({
			listrTask,
			ctx,
			provider: translationProvider,
			text: refValue,
			context: refContextValue,
			sourceLang,
			targetLang,
			appContextMessage,
			apiKey,
			maxRetries: maxRetries,
			attemptStr,
			log
		})

		translateResult.backoffInterval = 5000

		if (translateResult.backoffInterval > 0) {
			log.D(`backing off... interval: ${translateResult.backoffInterval}`)
			listrTask.output = 'Rate limited'
			log.D(`ctx.nextTaskDelayMs=${ctx.nextTaskDelayMs}`)
			result.nextTaskDelayMs = Math.max(ctx.nextTaskDelayMs, translateResult.backoffInterval)
		} else {
			newValue = translateResult.translated
			result.success = true
		}
	}

	if (newValue?.length) {
		log.D('translated text', newValue)
		result.translated = true
		result.newValue = newValue
	} else {
		result.error = `Translation was empty; target language=${targetLang}; key=${key}; text=${refValue}`
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
		log.E(`Error copying file to temp directory: ${error.message}`)
		throw error
	}
}

function rmDir(dir, log) {
	try {
		fs.rmSync(dir, { recursive: true, force: true })
		log.D(`Removed dir ${dir}`)
	} catch (error) {
		log.E(`Error cleaning up temp directory "${dir}": ${error.message}`)
		throw error
	}
}

function shutdown(appState, kill) {
	const { log, errors, filesToWrite } = appState

	if (kill) log.I('Forcing shutdown...')

	if (errors.length) {
		log.E(`ALT encountered some errors: ${errors.join('\n')}`)
	}

	// Write any data to disk
	//log.D('filesToWrite keys:', Object.keys(filesToWrite))
	let filesWrittenCount = 0
	for (const path of Object.keys(filesToWrite)) {
		log.D('path:', path)
		const json = filesToWrite[path]
		log.T('json:', json)
		writeJsonFile(path, json, appState.log)
		++filesWrittenCount
	}

	log.D(`Wrote ${filesWrittenCount} files to disk.`)

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
													 listrTask,
													 ctx,
													 provider,
													 appContextMessage,
													 text,
													 context,
													 sourceLang,
													 targetLang,
													 apiKey,
													 attemptStr,
													 log
												 }) {
	log.D(`[translate] sourceLang=${sourceLang}; targetLang=${targetLang}; text=${text}`)
	const result = { translated: null, backoffInterval: 0 }

	const providerName = provider.name()

	try {
		const providerName = provider.name()
		listrTask.output = `Preparing endpoint configuration...`
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
		log.D(`prompt: `, messages)
		const { url, params, config } = provider.getTranslationRequestDetails({ messages, apiKey, log })
		log.T('url', url)
		log.T('params', params)
		log.T('config', config)
		listrTask.output = `Hitting ${providerName} endpoint${attemptStr}...`
		const response = await axios.post(url, params, config)
		log.T('response headers', response.headers)
		const translated = provider.getResult(response, log)
		if (!translated?.length) throw new Error(`${providerName} translated text to empty string. You may need to top up your credits.`)
		log.D(`${translated}`)
		if (translated === TRANSLATION_FAILED_RESPONSE_TEXT) throw new Error(`${providerName} failed to translate string to ${targetLang}; string: ${text}`)
		result.translated = translated
	} catch (error) {
		const response = error?.response
		if (response) {
			if (response.status === 429) {
				result.backoffInterval = provider.getSleepInterval(response.headers, log)
				log.D(`Rate limited; retrying in ${result.backoffInterval}`)
			} else if (error.response.status === 529) { // Unofficial 'overloaded' code
				result.backoffInterval = OVERLOADED_BACKOFF_INTERVAL_MS
				log.D(`Overloaded; retrying in ${result.backoffInterval}`)
				listrTask.output = `${providerName} overloaded; retrying in ${result.backoffInterval / 1000}s `
			}
		} else {
			log.w(`API failed. Error:`, error.message)
		}
	}

	log.D(`[translate] `, result)

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

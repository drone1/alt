import * as path from 'path'
import axios from 'axios'
import { Listr } from 'listr2'
import { localize, localizeFormatted } from '../localizer/localize.js'
import {
	DEFAULT_CACHE_FILENAME, DEFAULT_LLM_MODELS,
	OVERLOADED_BACKOFF_INTERVAL_MS,
	VALID_TRANSLATION_PROVIDERS
} from '../lib/consts.js'
import { assertIsObj, assertValidPath } from '../lib/assert.js'
import {
	dirExists,
	ensureDir,
	mkTmpDir,
	normalizeOutputPath,
	readFileAsText,
	readJsonFile,
	writeJsonFile,
} from '../lib/io.js'
import { calculateHash, getFileExtension, normalizeData, sleep } from '../lib/utils.js'
import { formatContextKeyFromKey, isContextKey } from '../lib/context-keys.js'
import { loadConfig } from '../lib/config.js'
import { loadTranslationProvider } from '../lib/provider.js'
import { loadCache } from '../lib/cache.js'
import { shutdown } from '../shutdown.js'
import { loadReferenceFile } from '../lib/reference-loader.js'

export async function runTranslation({ appState, options, log }) {
	let exitCode = 0
	try {
		// Attempt to load a config file, or return default values
		const config = await loadConfig({
			configFile: options.configFile,
			log
		})
		assertIsObj(config)

		const referenceFile = options.referenceFile ?? config.referenceFile
		if (!referenceFile?.length) {
			throw new Error(
				localize({
					token: 'error-no-reference-file-specified',
					lang: appState.lang,
					log
				})
			)
		}
		log.D(`referenceFile=${referenceFile}`)

		// Resolve referenceExportedVarName
		let referenceExportedVarName
		const referenceFileExt = getFileExtension(referenceFile)
		if (['js','mjs'].includes(referenceFileExt)) {
			log.D(`Searching for reference exported var name for .${referenceFileExt} extension...`)
			if (options.referenceExportedVarName?.length) {
				log.D(`Found reference exported var name via --reference-exported-var-name`)
				referenceExportedVarName = options.referenceExportedVarName
			} else if (config.referenceExportedVarName?.length) {
				log.D(`Found reference exported var name in config, via 'referenceExportedVarName'`)
				referenceExportedVarName = config.referenceExportedVarName
			} else {
				log.D(`No reference exported var name found; `)
			}
		}
		log.D(`referenceExportedVarName=${referenceExportedVarName}`)

		const refFileDir = path.dirname(referenceFile)
		let outputDir = path.resolve(options.outputDir ?? config.outputDir ?? refFileDir)
		log.D(`outputDir=${outputDir}`)
		if (!outputDir?.length) {
			throw new Error(
				localizeFormatted({
					token: 'error-no-output-dir-specified',
					data: { refFileDir },
					lang: appState.lang,
					log
				})
			)
		}

		if (!dirExists(outputDir, log)) {
			log.V(`Directory "${outputDir}" did not exist -- creating...`)
			ensureDir(outputDir, log)

			if (!dirExists(outputDir, log)) {
				throw new Error(
					localizeFormatted({
						token: 'error-dir-create-failed',
						data: { dir: outputDir },
						lang: appState.lang,
						log
					})
				)
			}
		} else {
			log.D(`Output dir "${outputDir}" existed`)
		}

		// Validate provider
		const providerName = (options.provider ?? config.provider)?.toLowerCase()
		if (!VALID_TRANSLATION_PROVIDERS.includes(providerName)) {
			throw new Error(
				(providerName
					? localizeFormatted({
						token: 'error-unknown-provider',
						data: { providerName },
						lang: appState.lang,
						log
					})
					: localize({
						token: 'error-no-provider-specified',
						lang: appState.lang,
						log
					}))
				+ localizeFormatted({
					token: 'supported-providers',
					data: { providers: VALID_TRANSLATION_PROVIDERS.join(', ') },
					lang: appState.lang,
					log
				})
			)
		}

		const referenceLanguage = options.referenceLanguage || config.referenceLanguage
		if (!referenceLanguage || !referenceLanguage.length) {
			throw new Error(
				localize({ token: 'error-no-reference-language', lang: appState.lang, log })
			)
		}

		// Get target languages from CLI or config
		const targetLanguages = options.targetLanguages || config.targetLanguages
		if (!targetLanguages || !targetLanguages.length) {
			throw new Error(
				localize({ token: 'error-no-target-languages', lang: appState.lang, log })
			)
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
		const referenceData = await loadReferenceFile({ appLang: appState.lang, referenceFile, referenceExportedVarName, tmpDir, log })
		if (!referenceData) {
			throw new Error(
				localizeFormatted({
					token: 'error-no-reference-data-in-variable',
					data: {
						referenceExportedVarName,
						referenceFile,
					},
					lang: appState.lang,
					log
				})
			)
		}

		const referenceHash = calculateHash(await readFileAsText(referenceFile))
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

		const { apiKey, api: translationProvider } = await loadTranslationProvider({ __dirname: appState.__dirname, providerName, log })
		log.V(`translation provider "${providerName}" loaded`)

		log.D(`options.lookForContextData=${options.lookForContextData}`)
		log.D(`config.lookForContextData=${config.lookForContextData}`)
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

			const contextPrefix = options.contextPrefix ?? config.contextPrefix
			const contextSuffix = options.contextSuffix ?? config.contextSuffix

			if (addContextToTranslation) {
				keysToProcess = keysToProcess
					.filter(key => !isContextKey({
						appLang: appState.lang,
						key,
						contextPrefix,
						contextSuffix,
						log
					}))
			}

			log.T(`keys to process: ${keysToProcess.join(',')}`)
			for (const key of keysToProcess) {
				const contextKey = formatContextKeyFromKey({
					key,
					prefix: contextPrefix,
					suffix: contextSuffix
				})
				log.T(`contextKey=${contextKey}`)
				const storedHashForReferenceValue = readOnlyCache?.referenceKeyHashes?.[targetLang]?.[key]	// See https://github.com/drone1/alt/issues/1
				const storedHashForTargetLangAndValue = readOnlyCache.state[targetLang]?.keyHashes?.[key]
				const refValue = referenceData[key]
				const refContextValue = (contextKey in referenceData) ? referenceData[contextKey] : null
				const referenceValueHash = calculateHash(`${refValue}${refContextValue?.length ? `_${refContextValue}` : ''}`)	// If either of the ref value or the context value change, we'll update
				const curValue = (key in outputData) ? outputData[key] : null

				// Skip non-string values (objects, arrays, etc.)
				const refValueType = typeof refValue
				if (refValueType !== 'string') {
					if (refValueType === 'undefined') {
						// This can happen if a user specifies a key explicitly via --keys
						errors.push(
							localizeFormatted({
								token: 'error-value-not-in-reference-data',
								data: { key },
								lang: appState.lang,
								log
							})
						)
					} else {
						errors.push(
							localizeFormatted({
								token: 'error-value-not-a-string',
								data: { key, type: refValueType },
								lang: appState.lang,
								log
							})
						)
					}
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

		let totalTasks = workQueue.length
		let errorsEncountered = 0
		for (const taskInfoIdx in workQueue) {
			const taskInfo = workQueue[taskInfoIdx]
			log.T(taskInfo)
			const progress = 100 * Math.floor(100 * taskInfoIdx / totalTasks) / 100

      // Broadcast progress for CI
      if (process.env.CI) {
          console.log(`::notice::${progress}% - ${taskInfo.targetLang}/${taskInfo.key}`)
      }

			await new Listr([
				{
					title: localizeFormatted({
						token: 'msg-processing-lang-and-key',
						data: { progress, targetLang: taskInfo.targetLang, key: taskInfo.key },
						lang: appState.lang,
						log
					}),
					task: async (ctx, task) => {
						return task.newListr([
							{
								title: localize({ token: 'msg-translating', lang: appState.lang, log }),
								task: async (_, task) => {
									const translationResult = await processTranslationTask({
										appState, taskInfo, listrTask: task, options, log
									})

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
				...((options.tty || options.trace || options.debug || options.verbose) ? { renderer: 'simple' } : {}),
				rendererOptions: { collapse: false, clearOutput: false },
				registerSignalListeners: true,
				collapseSubtasks: false
			}).run()
		}

		if (totalTasks > 0) {
			let str = `[100%] `
			if (errorsEncountered > 0) {
				str += localizeFormatted({
					token: 'msg-finished-with-errors',
					data: { errorsEncountered, s: errorsEncountered > 1 ? 's' : '' },
					lang: appState.lang,
					log
				})
			} else {
				str += `Done`
			}
			log.I(`\x1B[38;2;44;190;78m✔\x1B[0m ${str}`)
		} else {
			log.I(`\x1B[38;2;44;190;78m✔\x1B[0m ${localize({ token: 'msg-nothing-to-do', lang: appState.lang, log })}`)
		}
	} catch (error) {
		log.E(error)
		exitCode = 2
	}

	await shutdown(appState, false)

	if (exitCode > 0) {
		process.exit(exitCode)
	}
}

export async function processTranslationTask({ appState, taskInfo, listrTask, options, log }) {
	const { key, sourceLang, targetLang, reasonsForTranslationMap, outputData, outputFilePath, writableCache, cacheFilePath, state } = taskInfo
	const { referenceValueHash } = state

	listrTask.output = Object.keys(reasonsForTranslationMap)
		.map(k => localize({ token: `msg-translation-reason-${k}`, lang: appState.lang, log }))
		.join(', ')

	const {
		success,
		translated,
		newValue,
		error
	} = await translateKeyForLanguage({
		appState,
		listrTask,
		sourceLang,
		targetLang,
		key,
		options,
		state,
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
			listrTask.output = localizeFormatted({ token: 'msg-show-translation-result', data: { key, newValue }, lang: appState.lang, log })

			// Update the hash for the reference key, so we can monitor if the user changed a specific key
			writableCache.referenceKeyHashes[targetLang] = writableCache.referenceKeyHashes[targetLang] || {}
			writableCache.referenceKeyHashes[targetLang][key] = referenceValueHash

			// Update state file every time, in case the user kills the process
			if (options.realtimeWrites) {
				await writeJsonFile(cacheFilePath, writableCache, log)
				log.V(`Wrote ${cacheFilePath}`)
			}
		} else {
			log.V(`Keeping existing translation and hash for ${targetLang}/${key}...`)

			// Allow the user to directly edit/tweak output key values
			listrTask.output = localizeFormatted({ token: 'msg-no-update-needed-for-key', data: { key }, lang: appState.lang, log })
		}
	}

	log.D('realtimeWrites', options.realtimeWrites)
	log.D(outputDataModified)
	if (!options.realtimeWrites && outputDataModified && !(outputFilePath in appState.filesToWrite)) {
		log.D(`Noting write-on-quit needed for ${outputFilePath}...`)
		appState.filesToWrite[outputFilePath] = outputData
	}

	return { error }
}

async function translateKeyForLanguage({
																				 appState,
																				 listrTask,
																				 sourceLang,
																				 targetLang,
																				 state,
																				 key,
																				 options: { maxRetries, model },
																				 log
																			 }) {
	const { translationProvider, apiKey, appContextMessage, refValue, refContextValue } = state
	const result = { success: false, translated: false, newValue: null, error: null }

	const providerName = translationProvider.name().toLowerCase()
	model = model ?? DEFAULT_LLM_MODELS[providerName]
	if (!model?.length) {
		throw new Error(
			localizeFormatted({ token: 'error-invalid-llm-model', data: { model }, lang: appState.lang, log })
		)
	}

	// Call translation provider
	log.D(`[${targetLang}] Translating "${key}"...`)
	listrTask.output = localizeFormatted({ token: 'msg-translating-key', data: { key }, lang: appState.lang, log })

	let newValue

	for (let attempt = 0; !newValue?.length && attempt <= maxRetries; ++attempt) {
		const attemptStr = attempt > 0 ? ` [Attempt: ${attempt + 1}]` : ''
		log.D(`[translate] attempt=${attempt}`)

		const translateResult = await translate({
			appState,
			listrTask,
			provider: translationProvider,
			text: refValue,
			context: refContextValue,
			sourceLang,
			targetLang,
			appContextMessage,
			apiKey,
			model,
			maxRetries: maxRetries,
			attemptStr,
			log
		})

		const { backoffInterval } = translateResult
		if (backoffInterval > 0) {
			log.D(`backing off... interval: ${backoffInterval}`)

			if (backoffInterval > 0) {
				listrTask.output = localizeFormatted({
					token: 'msg-rate-limited-sleeping',
					data: { interval: Math.floor(backoffInterval / 1000), attemptStr }, lang: appState.lang, log
				})
				await sleep(backoffInterval)
			}
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
		result.error = localizeFormatted({ token: 'error-translation-failed', data: { targetLang, key, refValue }, lang: appState.lang, log })
	}

	return result
}

async function translate({
													 appState,
													 listrTask,
													 provider,
													 appContextMessage,
													 text,
													 context,
													 sourceLang,
													 targetLang,
													 apiKey,
													 model,
													 attemptStr,
													 log
												 }) {
	log.D(`[translate] sourceLang=${sourceLang}; targetLang=${targetLang}; text=${text}`)
	const result = { translated: null, backoffInterval: 0 }

	if (sourceLang === targetLang) {
		log.D(`Using reference value since source & target language are the same`)
		result.translated = text
	} else {
		await translateTextViaProvider({
			appState, provider, listrTask, sourceLang, targetLang, appContextMessage, context, text, log, apiKey, model, attemptStr, providerName: provider.name(), outResult: result
		})
	}

	log.D(`[translate] `, result)

	return result
}

async function translateTextViaProvider({
																					appState,
																					provider,
																					listrTask,
																					sourceLang,
																					targetLang,
																					appContextMessage,
																					context,
																					text,
																					log,
																					apiKey,
																					model,
																					attemptStr,
																					providerName,
																					outResult
																				}) {
	try {
		const providerName = provider.name()
		listrTask.output = localize({ token: 'msg-preparing-endpoint-config', lang: appState.lang, log })
		const messages = []
		messages.push(
			`You are a professional translator for an application's text from ${sourceLang} to ${targetLang}. `
			+ `Translate the text accurately without adding explanations or additional content. Only return the text. `
		)
		if (appContextMessage?.length) {
			messages.push(`Here is some high-level information about the application you are translating text for: ${appContextMessage}`)
		}
		if (context) {
			messages.push(`Here is some additional context for the string you are going to translate: ${context}`)
		}
		messages.push(
			`Here we go. Translate the following text from ${sourceLang} to ${targetLang}:`
			+ `\n\n${text}`
		)
		log.D(`prompt: `, messages)
		const { url, params, config } = provider.getTranslationRequestDetails({ model, messages, apiKey, log })
		log.T('url: ', url, 'params: ', params, 'config: ', config)
		listrTask.output = localizeFormatted({ token: 'msg-hitting-provider-endpoint', data: { providerName, attemptStr }, lang: appState.lang, log })
		const response = await axios.post(url, params, config)
		log.T('response headers', response.headers)
		const translated = provider.getResult(response, log)
		if (!translated?.length) throw new Error(`${providerName} translated text to empty string. You may need to top up your credits.`)
		log.D(`${translated}`)
		outResult.translated = translated
	} catch (error) {
		let errorHandled = false

		const response = error?.response
		if (response) {
			if (response.status === 429) {
				outResult.backoffInterval = provider.getSleepInterval(response.headers, log)
				log.D(`Rate limited; retrying in ${outResult.backoffInterval}`)
				errorHandled = true
			} else if (response.status === 529) { // Unofficial 'overloaded' code
				outResult.backoffInterval = OVERLOADED_BACKOFF_INTERVAL_MS
				log.D(`Overloaded; retrying in ${outResult.backoffInterval}`)
				listrTask.output = `${providerName} overloaded; retrying in ${outResult.backoffInterval / 1000}s `
				errorHandled = true
			}
		}

		if (!errorHandled) {
			log.W(`${providerName} API failed.`, error?.message ?? error)
		}
	}
}


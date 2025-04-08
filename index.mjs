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
import * as fs from 'fs/promises'
import * as crypto from 'crypto'
import * as path from 'path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DEFAULT_CACHE_FILENAME = '.localization.cache.json'
const DEFAULT_CONFIG_FILENAME = 'config.json'
const OVERLOADED_BACKOFF_INTERVAL_MS = 30 * 1000

const CWD = process.cwd()
const appState = {}

function unique(array) {
  return [...new Set(array)]
}

// Helper function to parse comma-separated list
function languageList(value) {
  const languages = unique(value.split(',').map(item => item.trim()))
  const invalid = languages.filter(lang => !locale.getByTag(lang))
  if (invalid.length) {
    console.error(`Found invalid language(s): ${invalid.join(', ')}`)
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
    return await fs.readFile(filePath, 'utf8')
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
  } catch(e) {
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

// Write JSON file
async function writeJsonFile(filePath, data) {
  // Create normalized version of data with consistent key encoding
  const normalizedData = {}
  for (const [key, value] of Object.entries(data)) {
    normalizedData[normalizeKey(key)] = value
  }
  
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, JSON.stringify(normalizedData, null, 2), 'utf8')
}

async function loadTranslationProvider(providerName) {
  const apiKeyName = `${providerName.toUpperCase()}_API_KEY`
  const apiKey = process.env[apiKeyName]
  if (!apiKey?.length) throw new Error('${apiKeyName} environment variable is not set')
  return {
    apiKey,
    api: await importJsFile(path.resolve(__dirname, `providers/${providerName}.mjs`))
  }
}

const VALID_TRANSLATION_PROVIDERS = ['anthropic', 'openai']

async function printLogo({ tagline }) {
  const fontName = 'THIS.flf'
  const fontPath = path.resolve(__dirname, `./figlet-fonts/${fontName}`)
  const fontData = await fs.readFile(fontPath, 'utf8')
  figlet.parseFont(fontName, fontData)
  const asciiTitle = figlet.textSync('ALT', {
    font: fontName,
    horizontalLayout: 'full',
    verticalLayout: 'default'
  })

  console.log(`\n${gradient(['#000FFF', '#ed00b1'])(asciiTitle)}\n`)
}

function isContextKey({key, contextPrefix, contextSuffix}) {
  if (contextPrefix?.length) return key.startsWith(contextPrefix)
  if (contextSuffix?.length) return key.endsWith(contextSuffix)
  throw new Error(`Either the context prefix or context suffix must be defined`)
}

function formatContextKeyFromKey({key, prefix, suffix}) {
  return `${prefix}${key}${suffix}`
}

function normalizeOutputPath({dir, filename, normalize}) {
  return path.join(dir, normalize ? filename.toLowerCase() : filename)
}

// Main function
export async function run() {
  try {
    const p = await readJsonFile(path.resolve(__dirname, './package.json'))
    if (!p) throw new Error(`Couldn't read 'package.json'`)

    // Define CLI options
    program
      .version(p.version)
      .description(p.description)
      .requiredOption('-r, --reference <path>', 'Path to reference JSONC file (default language)')
      .requiredOption('-p, --provider <name>', 'AI provider to use for translations (anthropic, openai)')
      .option('-o, --output-dir <path>', 'Output directory for localized files', process.cwd())
      .option('-l, --languages <list>', 'Comma-separated list of language codes', languageList)
      .option('-k, --keys <list>', 'Comma-separated list of keys to process', keyList)
      .option('-g, --referenceLanguage <language>', `The reference file's language`, 'en')
      .option('-j, --referenceVarName <var name>', `The exported variable in the reference file, e.g. export default = {...} you'd use 'default'`, 'default')
      .option('-f, --force', 'Force regeneration of all translations', false)
      .option('-y, --tty', 'Use tty/simple renderer; useful for CI', false)
      .option('-c, --config <path>', 'Path to config file', null)
      .option('-t, --maxRetries <integer>', 'Maximum retries on failure', 100)  // This is super high because of the extra-simple way we handle being rate-limited; essentially we want to continue retrying forever but not forever; see comment near relevant code
      .option('-e, --concurrent <integer>', `Maximum # of concurrent tasks`, 5)
      .option('-n, --normalize', `Normalizes output filenames (to all lower-case)`, false)
      .option('--contextPrefix <value>', `String to be prefixed to all keys to search for additional context, which are passed along to the AI for context`, '')
      .option('--contextSuffix <value>', `String to be suffixed to all keys to search for additional context, which are passed along to the AI for context`, '')
      .option('--lookForContextData', `If specified, ALT will pass any context data specified in the reference file to the AI provider for translation. At least one of --contextPrefix or --contextSuffix must be specified`, false)
      .hook('preAction', (thisCommand) => {
        const opts = thisCommand.opts()
        if (opts.lookForContextData && !(opts.contextPrefix?.length || opts.contextSuffix?.length)) {
          thisCommand.error('--lookForContextData requires at least 1 of --contextPrefix or --contextSuffix be defined and non-empty')
        }
      }).action(() => {}) // Dummy required for preAction to trigger
      .option('--verbose', `Enables verbose spew`, false)
      .option('--debug', `Enables debug spew`, false)
      .option('--trace', `Enables trace spew`, false)
      .parse(process.argv)

    await printLogo({tagline: p.description})
    const options = program.opts()

    const log = {
      e: function(...args) { console.error(...args)},
      w: function(...args) { console.warn(...args)},
      i: function(...args) { console.log(...args)},
      v: (options.trace || options.debug || options.verbose) ? function(...args) { console.log(...args)} : () => {},
      d: (options.trace || options.debug) ? function(...args) { console.debug(...args)} : () => {},
      t: options.trace ? function(...args) { console.debug(...args)} : () => {}
    }

    appState.log = log

    // Validate provider
    if (!VALID_TRANSLATION_PROVIDERS.includes(options.provider)) {
      console.error(`Error: Unknown provider "${options.provider}". Supported providers: ${VALID_TRANSLATION_PROVIDERS.join(', ')}`)
      process.exit(2)
    }

    // Create a tmp dir for storing the .mjs reference file; we can't dynamically import .js files directly, so we make a copy...
    const tmpDir = await mkTmpDir()
    appState.tmpDir = tmpDir

    //
    // Load config file or create default
    const configFilePath = !options.config
      ? path.resolve(options.outputDir, DEFAULT_CONFIG_FILENAME)
      : options.config
    log.v(`Attempting to load config file from "${configFilePath}"`)
    let config = await readJsonFile(configFilePath) || {
      languages: [],
      referenceLanguage: 'en',
    }

    const cacheFilePath = path.resolve(options.outputDir, DEFAULT_CACHE_FILENAME)
    log.v(`Attempting to load cache file from "${cacheFilePath}"`)
    const cache = await readJsonFile(cacheFilePath) || {
      referenceHash: '',
      state: {},
      lastRun: null
    }
    log.d(`Loaded cache file`)

    // Copy to a temp location first so we can ensure it has an .mjs extension
    const tmpReferencePath = await copyFileToTempAndEnsureExtension({filePath: options.reference, tmpDir, ext: 'mjs'})
    const referenceContent = normalizeData(JSON.parse(JSON.stringify(await importJsFile(tmpReferencePath))), log)  // TODO: Don't do this
    const referenceData = referenceContent[options.referenceVarName]
    if (!referenceData) {
      log.e(`No reference data found in variable "${options.referenceVarName}" in ${options.reference}`)
      process.exit(2)
    }

    const referenceHash = calculateHash(await readFileAsText(options.reference))
    const referenceChanged = referenceHash !== cache.referenceHash
    if (referenceChanged) {
      log.v('Reference file has changed since last run')
    }

    // Get languages from CLI or config
    const languages = options.languages || config.languages
    if (!languages || !languages.length) {
      console.error('Error: No languages specified. Use --languages option or add languages to your config file')
      process.exit(2)
    }

    cache.referenceHash = referenceHash
    cache.lastRun = new Date().toISOString()

    const { apiKey, api: translationProvider } = await loadTranslationProvider(options.provider)
    log.v(`translation provider "${options.provider}" loaded`)

    const tasks = new Listr([], {
      concurrent: false, // Process languages one by one
      ...(options.tty ? { renderer: 'simple' } : {}),
      rendererOptions: { collapse: true, clearOutput: true },
      clearOutput: false,
      registerSignalListeners: true
    })

    appState.tasks = tasks

    const addContextToTranslation = options.lookForContextData

    // Process each language
    for (const lang of languages) {
      log.d(`Processing language ${lang}...`)
      let stringsTranslatedForLanguage = 0

      let needsUpdate = options.force || referenceChanged

      const outputFilePath = normalizeOutputPath({ dir: options.outputDir, filename: `${lang}.json`, normalize: options.normalize })
      log.d(`outputFilePath=${outputFilePath}`)
      let outputData = normalizeData(await readJsonFile(outputFilePath)) || {}
      log.d('outputData', outputData)
      log.t(Object.keys(outputData))

      // Initialize language in cache if it doesn't exist
      if (!cache.state[lang]) {
        log.v(`lang ${lang} not in cache; update needed...`)
        cache.state[lang] = { keyHashes: {} }
        needsUpdate = true
      }

      // Check if output file exists and has correct structure
      if (!outputData) {
        outputData = {}
        needsUpdate = true
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
                  .filter(key => !isContextKey({ key, contextPrefix: options.contextPrefix, contextSuffix: options.contextSuffix }))
            }

            log.d(`keys to process: ${keysToProcess.join(',')}`)
            const subtasks = keysToProcess.map(key => {
              const contextKey = formatContextKeyFromKey({key, prefix: options.contextPrefix, suffix: options.contextSuffix})
              log.d(`contextKey=${contextKey}`)
              const storedHashForLangAndValue = cache.state[lang]?.keyHashes?.[key]
              return {
                title: `Processing "${key}"`,
                task: async (ctx, subtask) => {
                  const { success, translated, newValue, userModifiedTargetValue, error } = await translateKeyForLanguage({
                    task: subtask,
                    ctx,
                    translationProvider,
                    apiKey,
                    storedHashForLangAndValue,
                    lang,
                    key,
                    refValue: referenceData[key],
                    refContextValue: (contextKey in referenceData) ? referenceData[contextKey] : null,
                    curValue: (key in outputData) ? outputData[key] : null,
                    options,
                    log
                  })

                  if (success) {
                    ++stringsTranslatedForLanguage

                    if (translated) {
                      // Write updated translations
                      outputData[key] = newValue
                      await writeJsonFile(outputFilePath, outputData)
                      log.v(`Wrote ${outputFilePath}`)

                      const hashForTranslated = calculateHash(newValue)
                      log.d(`Updating hash for translated ${lang}.${key}: ${hashForTranslated}`)
                      cache.state[lang].keyHashes[key] = hashForTranslated
                      subtask.title = `Translated ${key}: "${newValue}"`

                      // Update state file every time, in case the user kills the process
                      await writeJsonFile(cacheFilePath, cache)
                      log.v(`Wrote ${cacheFilePath}`)
                    } else {
                      log.v(`Keeping existing translation and hash for ${lang}/${key}...`)
                      //cache.state[lang].keyHashes[key] = storedHashForLangAndValue
                      if (userModifiedTargetValue) {
                        subtask.title = `Skipping ${key}; value modified by user`
                      } else {
                        subtask.title = `No update needed for ${key}`
                      }
                    }

                    // This will allow the app to shutdown with non-tty/non-simple rendering, where rendering can fall far behind, if all keys are already processed and Promises are resolving immediately but rendering is far behind
                    await sleep(1)
                  } else if (error) {
                    throw new Error(error)
                  }
                }
              }
            })

            return task.newListr(
              subtasks, {
                concurrent: parseInt(options.concurrent),
                rendererOptions: { collapse: true, persistentOutput: true },
                registerSignalListeners: true
              }
            )
        }
      }])
    }

    tasks.add({
      'title': 'Cleanup',
      task: () => shutdown(appState, false)
    })

    await tasks.run()
  } catch (error) {
    console.error('Error:', error)  // NB: 'log' doesn't exist here
    process.exit(2)
  }
}

async function translateKeyForLanguage({task, ctx, translationProvider, apiKey, storedHashForLangAndValue, lang, key, refValue, refContextValue, curValue, options: { force, referenceLanguage, maxRetries }, log}) {
  const result = { success: true, translated: false, userModifiedTargetValue: false, newValue: null, error: null }

  // When reading keys from files
  log.d(`Reference key: "${key}", Bytes:`, Buffer.from(key).toString('hex'))

  // Skip non-string values (objects, arrays, etc.)
  if (typeof refValue !== 'string') {
    result.error = `Value for reference key "${key}" was not a string! Skipping...`
    result.success = false
    return result
  }
  
  const currentValueHash = curValue?.length ? calculateHash(curValue) : null

  log.d('curValue', curValue)
  log.d('storedHashForLangAndValue', storedHashForLangAndValue)
  log.d('currentValueHash', currentValueHash)

  // Check if translation needs update
  const missingOutputKey = curValue === null

  // In translateKeyForLanguage function
  // Calculate reference value hash and compare with stored hash
  const referenceValueHash = calculateHash(JSON.stringify(refValue))
  const userModifiedTargetValue = storedHashForLangAndValue && currentValueHash && currentValueHash !== storedHashForLangAndValue
  log.d('userModifiedTargetValue ', userModifiedTargetValue)
  result.userModifiedTargetValue = userModifiedTargetValue

  // Check if translation needs update using the reference hash instead of comparing current translation hash
  const needsTranslation = force ||
      !userModifiedTargetValue &&
      (missingOutputKey || !storedHashForLangAndValue)

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

    // Because of the simple way we handle being rate-limited and backing off, we kind of want to retry forever but not forever.
    // A single key may need to retry many times, since the algorithm is quite simple: if a task is told to retry after 10s,
    // any subsequent tasks that run will delay 10s also, then those concurrent remaining tasks will all hammer at once, some
    // will complete (maybe), then we'll wait again, then hammer again. A more proper solution may or may not be forthcoming...
    for (let attempt = 0; !newValue && attempt <= maxRetries; ++attempt) {
      const attemptStr = attempt > 0 ? ` [Attempt: ${attempt+1}]` : ''
      task.title = `Translating with ${providerName}` + attemptStr

      log.d(`[translate] attempt=${attempt}`)

      log.d('next task delay', ctx.nextTaskDelayMs)
      if (ctx.nextTaskDelayMs > 0) {
        const msg = `Rate limited; sleeping for ${Math.floor(ctx.nextTaskDelayMs/1000)}s...` + attemptStr
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

    if (!newValue?.length) throw new Error(`Translation was empty`)

    log.d('translated text', newValue)
    result.translated = true
    result.newValue = newValue
  }

  return result
}

async function mkTmpDir() {
    return await fs.mkdtemp(path.join(os.tmpdir(), 'alt-'))
}

function ensureExtension(filename, extension) {
  if (!extension.startsWith('.')) extension = '.' + extension
  return filename.endsWith(extension) ? filename : filename + extension
}

// This is basically so that we can dynamicaly import .js files by copying them to temp .mjs files, to avoid errors from node
async function copyFileToTempAndEnsureExtension({filePath, tmpDir, ext}) {
  try {
    const fileName = ensureExtension(path.basename(filePath), ext)
    const destPath = path.join(tmpDir, fileName)
    await fs.copyFile(filePath, destPath)
    return destPath
  } catch (error) {
    console.error(`Error copying file to temp directory: ${error.message}`)
    throw error
  }
}

async function rmDir(dir) {
  try {
    await fs.rm(dir, { recursive: true, force: true })
  } catch (error) {
    console.error(`Error cleaning up temp directory "${dir}": ${error.message}`)
    throw error
  }
}

async function shutdown(appState, exit) {
  console.log('Shutting down...')

  if (appState) {
    if (appState?.tmpDir) {
      await rmDir(appState.tmpDir)
    }
  }

  if (exit) process.exit(1)
}

export function sleep(ms, log) {
	if (ms === 0) return
	return new Promise(resolve => setTimeout(resolve, ms))
}

async function translate({task, provider, text, context, sourceLang, targetLang, apiKey, attemptStr, log }) {
  const result = { translated: null, backoffInterval: 0 }

  try {
    const providerName = provider.name()
    task.title = `Preparing endpoint configuration...`
    const { url, params, config } = provider.getTranslationRequestDetails({ text, context, sourceLang, targetLang, apiKey, log })
    task.title = `Hitting ${providerName} endpoint${attemptStr}...`
    const response = await axios.post(url, params, config)
    log.d('response headers', response.headers)
    const translated = provider.getResult(response, log)
    if (!translated?.length) throw new Error(`${providerName} translated text to empty string`)
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
      log.w(`API failed with error`, error.message)
    }
  }

  return result
}

// Shutdown in the normal render mode may seem to be failing, but technically it's not; if you're processing all languages,
// and a lot of tokens do not need to be updated, the promises have likely already completed but rendering takes ages to
// catch up; this means SIGTERM will only work if there are strings that need translation, since they take actual time
process.on('SIGINT', async () => await shutdown(appState, true))
process.on('SIGTERM', async () => await shutdown(appState, true))

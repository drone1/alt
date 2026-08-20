import * as path from 'path'
import { DEFAULT_CONFIG_FILENAME } from './consts.js'
import { fileExists, readJsonFile } from './io.js'

export async function loadConfig({ configFile, log }) {
	let configFilePath
	if (configFile?.length) {
		log.V(`Using config file specified by --config-file "${configFile}"...`)
		configFilePath = configFile
	} else {
		// Search for a config in the current working directory
		const cwdConfigFilePath = path.resolve(process.cwd(), DEFAULT_CONFIG_FILENAME)
		if (await fileExists(cwdConfigFilePath)) {
			log.V(`Using config file in current working dir, "${process.cwd()}"...`)
			configFilePath = cwdConfigFilePath
		} else {
			log.V(`"${DEFAULT_CONFIG_FILENAME}" not wasn't found in the current working directory...`)
		}
	}

	let result
	if (configFilePath?.length) {
		log.V(`Attempting to load config file from "${configFilePath}"`)
		result = await readJsonFile(configFilePath)
	}

	if (!result) {
		result = {
			provider: null,
			targetLanguages: [],
			lookForContextData: false,
			contextPrefix: '',
			contextSuffix: '',
			outputDir: null,
			referenceFile: null,
			referenceLanguage: null,
			normalizeOutputFilenames: false,
			// `state` records a hash of every translated string purely so a
			// hand-edited target value is never overwritten. It is half the cache
			// by size — 9.6 MB of a 19 MB file in one real project — and projects
			// that never hand-edit their target files pay it for nothing. Default
			// true to preserve existing behaviour; set false to stop recording it.
			trackTargetEdits: true
		}
	}

	return result
}

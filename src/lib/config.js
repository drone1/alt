import * as path from 'path'
import { DEFAULT_CONFIG_FILENAME } from './consts.js'
import { readJsonFile } from './io.js'

export async function loadConfig({ configFile, refFileDir, log }) {
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


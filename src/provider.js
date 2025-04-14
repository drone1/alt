import * as path from 'path'
import { importJsFile } from './io.js'

export async function loadTranslationProvider({__dirname, providerName, log}) {
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


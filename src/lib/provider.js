import * as path from 'path'
import { importJsFile } from './io.js'
import { DEFAULT_ACCESS_METHOD, PROVIDER_ACCESS_METHODS } from './consts.js'

// Load a translation provider module by (provider, accessMethod). Validates the
// access method against PROVIDER_ACCESS_METHODS for the given provider, then
// imports `providers/<provider>/<accessMethod>.mjs`.
//
// Providers that authenticate by other means (e.g. anthropic/harness, which
// relies on the `claude` CLI's own OAuth session) opt out of the env-var check
// by exporting `requiresApiKey = false`. Otherwise we require
// `<PROVIDER>_API_KEY` to be set.
export async function loadTranslationProvider({ __dirname, providerName, accessMethod, log }) {
	accessMethod = accessMethod || DEFAULT_ACCESS_METHOD

	const validAccessMethods = PROVIDER_ACCESS_METHODS[providerName]
	if (!validAccessMethods?.length) {
		log.E(`Unknown provider "${providerName}"`)
		process.exit(1)
	}
	if (!validAccessMethods.includes(accessMethod)) {
		log.E(`Provider "${providerName}" does not support access method "${accessMethod}". Supported: ${validAccessMethods.join(', ')}`)
		process.exit(1)
	}

	const api = await importJsFile(path.resolve(__dirname, `providers/${providerName}/${accessMethod}.mjs`))

	if (api.requiresApiKey === false) {
		return { apiKey: null, accessMethod, api }
	}

	const apiKeyName = `${providerName.toUpperCase()}_API_KEY`
	const apiKey = process.env[apiKeyName]
	if (!apiKey?.length) {
		log.E(`${apiKeyName} environment variable is not set`)
		process.exit(1)
	}

	return { apiKey, accessMethod, api }
}

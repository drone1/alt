import { loadTranslationProvider } from '../lib/provider.js'

export async function runListModels({ appState, options, log }) {
	const { apiKey, api } = await loadTranslationProvider({ __dirname: appState.__dirname, providerName: options.provider, log })
	return log.I(await api.listModels(apiKey))
}

export function name() {
	return 'Google'
}

export async function listModels(apiKey) {
	let allModels = []
	let pageToken = null
	let hasMore = true

	while (hasMore) {
		const url = new URL('https://generativelanguage.googleapis.com/v1/models')

		// Add API key as query parameter
		url.searchParams.append('key', apiKey)

		// Add page token if we have one
		if (pageToken) {
			url.searchParams.append('pageToken', pageToken)
		}

		const response = await fetch(url, {
			method: 'GET',
			headers: {
				'Content-Type': 'application/json'
			}
		})

		const result = await response.json()

		if (result.models && result.models.length > 0) {
			allModels = [
				...allModels,
				...result.models
			]

			// Check if there's another page
			if (result.nextPageToken) {
				pageToken = result.nextPageToken
			} else {
				hasMore = false
			}
		} else {
			hasMore = false
		}
	}

	return { models: allModels }
}

export function getTranslationRequestDetails({ model, messages, apiKey, log }) {
	return {
		url: `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
		params: {
			contents: messages.map(m => ({
				role: 'user',
				parts: [ { text: m } ]
			}))
		},
		config: {
			headers: {
				'Content-Type': 'application/json'
			}
		}
	}
}

export function getResult(response, log) {
	return response.data.candidates?.[0]?.content?.parts?.[0]?.text?.trim?.() || ''
}

function getHeader(headers, name) {
	return headers[name] || headers.get?.(name)
}

export function getSleepInterval(headers, log) {
	log.T(headers)
	const retryAfter = parseInt(getHeader(headers, 'retry-after'))
	log.D('retryAfter', retryAfter)
	return isNaN(retryAfter) ? 0 : 1000 * retryAfter + 200
}

export function name() {
	return 'OpenAI'
}

export async function listModels(apiKey) {
	let allModels = []
	let hasMore = true
	let lastId = null

	while (hasMore) {
		const url = new URL('https://api.openai.com/v1/models')
		if (lastId) {
			url.searchParams.append('after', lastId)
		}

		const response = await fetch(url, {
			method: 'GET',
			headers: {
				'Authorization': `Bearer ${apiKey}`,
				'Content-Type': 'application/json'
			}
		})

		const result = await response.json()

		if (result.data && result.data.length > 0) {
			allModels = [
				...allModels,
				...result.data
			]

			// Check if OpenAI has pagination indicators
			// OpenAI might use different pagination methods
			if (result.has_more && result.last_id) {
				lastId = result.last_id
				hasMore = true
			} else {
				hasMore = false
			}
		} else {
			hasMore = false
		}
	}

	return { data: allModels }
}

export function getTranslationRequestDetails({ model, messages, apiKey, log }) {
	return {
		url: 'https://api.openai.com/v1/chat/completions',
		params: {
			model,
			messages: messages.map((m, idx) => {
				return {
					role: idx === messages.length - 1 ? 'user' : 'system',
					content: m,
				}
			}),
			temperature: 0.3,
			max_tokens: 1024,
		},
		config: {
			headers: {
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${apiKey}`,
			},
		},
	}
}

export function getResult(response) {
	return response.data.choices[0].message.content.trim()
}

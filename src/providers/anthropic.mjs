export function name() {
	return 'Anthropic'
}

export function getTranslationRequestDetails({ messages, apiKey, log }) {
	return {
		url: 'https://api.anthropic.com/v1/messages',
		params: {
			model: 'claude-3-7-sonnet-20250219',
			max_tokens: 1024,
			messages: messages.map(m => ({ role: 'user', content: m })),
		},
		config: {
			headers: {
				'Content-Type': 'application/json',
				'x-api-key': apiKey,
				'anthropic-version': '2023-06-01',
			},
		},
	}
}

export function getResult(response, log) {
	return response.data.content[0].text.trim()
}

function getHeader(headers, name) {
	return headers[name] || headers.get?.(name)
}

export function getSleepInterval(headers, log) {
	log.T(headers)
	if (getHeader(headers, 'x-should-retry') !== 'true')
		return 0

	const retryAfter = parseInt(getHeader(headers, 'retry-after'))
	log.D('retryAfter', retryAfter)
	return 1000 * retryAfter + 200
}

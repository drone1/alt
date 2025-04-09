export function name() {
	return 'OpenAI'
}

export function getTranslationRequestDetails({ messages, apiKey, log }) {
	return {
		url: 'https://api.openai.com/v1/chat/completions',
		params: {
			model: 'gpt-4-turbo',
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

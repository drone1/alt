export function name() {
  return "Anthropic"
}

export function getTranslationRequestDetails({text, context, sourceLang, targetLang, apiKey, log }) {
  context = context?.length ? ` (and for context, this string will be used for the following reason: ${context})` : ''
  return {
    url: 'https://api.anthropic.com/v1/messages',
    params: {
      model: "claude-3-7-sonnet-20250219",
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: `Translate the following text from ${sourceLang} to ${targetLang}. Only return the translated text, no explanations or additional comments${context}:

${text}`
        }
      ]
    },
    config: {
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      }
    }
  }
}

export function getResult(response, log) {
  return response.data.content[0].text.trim()
}

function getHeader(headers, name) {
  return headers[name] || headers.get?.(name)
}
  
export function getSleepInterval(headers, log) {
  log.d(headers)
  if (getHeader(headers, 'x-should-retry') !== 'true')
    return 0

  const retryAfter = parseInt(getHeader(headers, 'retry-after'))
  log.d('retryAfter', retryAfter)
  return 1000 * retryAfter
}

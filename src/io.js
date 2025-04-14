import * as fsp from 'fs/promises'
import stripJsonComments from 'strip-json-comments'

export function parseJson(s) {
	try {
		return JSON.parse(s)
	} catch (e) {
		return null
	}
}

export async function readFileAsText(filePath) {
	try {
		return await fsp.readFile(filePath, 'utf8')
	} catch (error) {
		if (error.code === 'ENOENT') {
			return null
		}
		throw error
	}
}

export async function readJsonFile(filePath, isJSONComments = false) {
	let content = await readFileAsText(filePath)
	if (isJSONComments) content = stripJsonComments.stripJsonComments(content)
	return parseJson(content)
}

export async function fileExists(path) {
	try {
		await fsp.access(path)
		return true
	} catch {
		return false
	}
}

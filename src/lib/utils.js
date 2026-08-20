import { Buffer } from 'buffer'
import * as crypto from 'crypto'

export function obj2Str(obj, exclude = null, expandJson = false) {
	let result = ''

	const maybeJson = x => {
		return expandJson && isObject(x) ? j2s(x) : x
	}

	if (exclude) {
		for (let p in obj) {
			if (exclude.includes(p)) continue
			result += `${p}=${maybeJson(obj[p])}; `
		}
	} else {
		for (let p in obj) {
			result += `${p}=${maybeJson(obj[p])}; `
		}
	}
	return result.substring(0, result.length - 2) // Remove trailing semicolon+space
}

export const REPLACESTRINGVARSWITHOBJECTVALUESWARNINGCODE_MISSINGVAR = 0
export const REPLACESTRINGVARSWITHOBJECTVALUESWARNINGCODE_UNKNOWNVARSPECIFIED = 1

/**
 * Replaces variables in a string (format %%varName%%) with their corresponding values
 * from an object.
 *
 * @param {string} format - The string containing variables like %%var1%%
 * @param {object} data - Object with keys matching the variable names
 * @param {array} outWarningsArray - Output array for tracking warnings
 * @returns {string} - The string with all variables replaced with their values
 */
export function replaceStringVarsWithObjectValues({format, data, outWarningsArray}) {
	//assertIsString(format)
	//assertIsObj(data)
	//assert(!outWarningsArray || Array.isArray(outWarningsArray))

	// Regex pattern to match %%varName%% patterns
	const regex = /%%([^%]+)%%/g

	// NB: No need to add 'format' to 'message'; a calling func can print that once
	const addWarning = (code, message) => outWarningsArray?.push({ code, message })

	// Replace all matches using the replacement function
	const dataKeySet = new Set(Object.keys(data))	// For tracking if we've got superfluous keys in 'data'
	const result = format.replace(regex, (match, varName) => {
		if (data.hasOwnProperty(varName)) {
			dataKeySet.delete(varName)	// OK to call if doesn't exist (which can happen for situations with multiple vars with the same name)
			return data[varName]
		}

		addWarning(REPLACESTRINGVARSWITHOBJECTVALUESWARNINGCODE_MISSINGVAR, `'format' string missing data for var "${varName}"`)

		// Return the original match if the variable doesn't exist
		return match
	})

	if (dataKeySet.size) {
		for (const varName of dataKeySet) {
			addWarning(REPLACESTRINGVARSWITHOBJECTVALUESWARNINGCODE_UNKNOWNVARSPECIFIED, `unknown var "${varName}" specified in data obj`)
		}
	}

	return result
}

export function sleep(ms, log) {
	if (ms === 0) return
	return new Promise(resolve => setTimeout(resolve, ms))
}

export function ensureExtension(filename, extension) {
	if (!extension.startsWith('.')) extension = '.' + extension
	return filename.endsWith(extension) ? filename : filename + extension
}

export function unique(array) {
	return [ ...new Set(array) ]
}

// Calculate hash of a string
// These hashes exist only to answer "did this string change since last run".
// A full 64-char sha256 hex spends 48 bytes per entry proving something a 64-bit
// prefix already proves: across ~6,000 keys in one language the collision
// probability is around 1e-12, and the sole consequence of a collision is one
// key not being re-translated — there is no corruption path. Over the ~342,000
// key/language pairs in a real cache the full digest cost ~16.5 MB.
//
// Truncation is a prefix operation on the same digest, so a stored full-length
// hash truncates to exactly what a fresh call now returns. That is what lets
// migrateHashLengths rewrite an existing cache without invalidating a single
// entry. Do not change this length without a matching migration: a mismatch
// re-translates every key in every language.
export const KEY_HASH_LENGTH = 16

export function calculateHash(content) {
	return crypto.createHash('sha256').update(content).digest('hex').slice(0, KEY_HASH_LENGTH)
}

export function normalizeKey(key) {
	return key.normalize('NFC')
}

export function normalizeData(data) {
	if (!data) return null
	const normalizedData = {}
	for (const [ key, value ] of Object.entries(data)) {
		// Force UTF-8 encoding for the key
		const utf8Key = Buffer.from(key, 'utf8').toString('utf8')

		// Force UTF-8 encoding for string values
		const utf8Value = typeof value === 'string'
			? Buffer.from(value, 'utf8').toString('utf8')
			: value

		normalizedData[normalizeKey(utf8Key)] = utf8Value
	}
	return normalizedData
}

export function pick(o, ...props) {
	return Object.assign(
		{},
		...props.filter(prop => o[prop] !== undefined)
			.map(prop => ({ [prop]: o[prop] }))
	)
}

// Returns the extension without the '.'
export function getFileExtension(path) {
	if (path.indexOf('.') < 0) return null
	return path.split('.').pop().toLowerCase()
}


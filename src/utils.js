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

const ReplaceStringVarsWithObjectValuesWarningCodeToStringMap = {
	[REPLACESTRINGVARSWITHOBJECTVALUESWARNINGCODE_MISSINGVAR]: 'missing variable',
	[REPLACESTRINGVARSWITHOBJECTVALUESWARNINGCODE_UNKNOWNVARSPECIFIED]: 'unknown var specified'
}

export function replaceStringVarsWithObjectValuesWarningCodeToString(code) {
	if (!(code in ReplaceStringVarsWithObjectValuesWarningCodeToStringMap)) throw new Error(`replaceStringVarsWithObjectValues() warning code ${code} does not exist`)
	return ReplaceStringVarsWithObjectValuesWarningCodeToStringMap[code]
}

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

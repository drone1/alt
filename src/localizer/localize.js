import * as locale from 'locale-codes'
import * as path from 'path'
import { obj2Str, replaceStringVarsWithObjectValues } from '../utils.js'
import { readJsonFile } from '../io.js'
import { LANGTAG_DEFAULT } from '../consts.js'

const LocalizationMap = {}

export async function initLocalizer({ defaultAppLanguage, appLanguage, srcDir, log }) {
	let lang

	// Always load the default language, as a fallback
	await addLocalizationDataForLanguage({ lang: defaultAppLanguage, srcPath: path.resolve(srcDir, `${defaultAppLanguage}.json`), log })

	if (appLanguage?.length && appLanguage !== defaultAppLanguage) {
		try {
			if (!isBcp47LanguageTagValid(appLanguage)) {
				log.W(`"${appLanguage}" is not a valid BCP47 language`)
				throw new Error()	// Print another warning and use default language
			}
			await addLocalizationDataForLanguage({ lang: appLanguage, srcPath: path.resolve(srcDir, `${appLanguage}.json`), log })
			lang = appLanguage
		} catch (err) {
			log.W(`No localization data found for language "${appLanguage}"; falling back to "${defaultAppLanguage}"...`)
			lang = defaultAppLanguage
		}
	} else {
		lang = defaultAppLanguage
	}

	return lang
}

export function isBcp47LanguageTagValid(tag) {
	return locale.getByTag(tag)
}

export function isDefaultLanguage(tag) {
	return tag === LANGTAG_DEFAULT
}

export function localizeFormatted({ token, data, lang, fallbackToken, log }) {
	//assertIsObj(data)
	//assertIsNonEmptyString(lang)
	//assertValidBcp47LanguageTag(lang)

	// We don't use fallbackToken directly in our call to localize(), because we don't want to inadvertently format in odd ways
	// But let's see how we end up using this function; for now we just directly localize the fallback below, if localize() fails here
	const str = localize({ token, lang, log })

	// Directly attempt to localize the fallback (or returns '')
	if (!str?.length) {
		const fallbackResult = localize({ token: fallbackToken, lang, log })
		if (fallbackResult.indexOf('%%') >= 0) {
			log.W(`'fallbackToken' should not include formatting variables; not currently supported; string="${fallbackResult}"`)
		}
		return fallbackResult
	}

	const warnings = []
	const result = replaceStringVarsWithObjectValues({
		format: str, data, outWarningsArray: warnings
	})

	if (warnings.length) warnings.forEach(w => log.W(`[localizeFormatted] warning: ${w.message} (code=${w.code})`))

	return result
}

export function localize({ token, lang, fallbackToken, log }) {
	log.D(`[localize] ${obj2Str({ token, lang, fallbackToken })}`)

	if (!isBcp47LanguageTagValid(lang)) {
		log.D(`[localize] Invalid language "${lang}" passed; falling back to default language...`)
		lang = LANGTAG_DEFAULT
	}

	if (!token) token = ''

	if (token.startsWith('#')) {
		log.D(`[localize] removed leading '#' character`)
		token = token.substring(1)
	}

	if (!token.length && fallbackToken) {
		log.D(`[localize] token was empty; trying fallback...`)
		return localize({ token: fallbackToken, lang, log })
	}

	if (!(lang in LocalizationMap)) {
		log.W(`[localize] lang "${lang}" was not in LocalizationMap`)

		if (!isDefaultLanguage(lang)) {
			return localize({ token, lang: LANGTAG_DEFAULT, log })
		}
		return ''
	} else if (!(token in LocalizationMap[lang])) {
		log.D(`[localize] token "${token}" was not in LocalizationMap[${lang}]`)

		// If it didn't exist, check the fallback in the same language
		if (fallbackToken) {
			log.D(`[localize] falling back to token ${fallbackToken}`)
			return localize({ token: fallbackToken, lang, log })
		}

		// If no fallback in the same language, attempt to find an english version of 'token'
		if (!isDefaultLanguage(lang)) {
			log.D(`[localize] attempting to fall back to english`)
			// This will get the fallback in english if not found in the requested language
			return localize({ token, lang: LANGTAG_DEFAULT, fallbackToken, log })
		}

		log.W(`Failed to find localization string for language="${lang}", token="${token}"`)

		return ''
	}

	const result = LocalizationMap[lang][token]
	log.D(`[localize] success; found localization string; ${obj2Str({ token, lang, result })}`)

	return result
}

async function addLocalizationDataForLanguage({ lang, srcPath, log }) {
	//assertValidBcp47LanguageTag(lang)
	//assertIsObj(data)
	//assertIsObj(LocalizationMap)

	const data = await readJsonFile(srcPath)
	if (!data) throw new Error(`Failed to load localization file "${srcPath}"`)

	LocalizationMap[lang] = LocalizationMap.lang ?? {}
	LocalizationMap[lang] = { ...LocalizationMap.lang, ...data }
}

import { copyFileToTempAndEnsureExtension, importJsFile, readJsonFile } from './io.js'
import { getFileExtension } from './utils.js'
import { SUPPORTED_REFERENCE_FILE_EXTENSIONS } from './consts.js'
import { localizeFormatted } from '../localizer/localize.js'

export async function loadReferenceFile({ appLang, options: { referenceFile, referenceExportedVarName }, tmpDir, log }) {
	const ext = getFileExtension(referenceFile)?.toLowerCase()
	if (!SUPPORTED_REFERENCE_FILE_EXTENSIONS.includes(ext)) {
		throw new Error(
			localizeFormatted({
				token: 'error-bad-reference-file-ext',
				data: { ext },
				lang: appLang,
				log
			})
		)
	}

	let content
	let useRefVar
	switch(ext) {
		case 'js': {
			log.D(`Reading JS file "${referenceFile}"...`)

			// For .js, we need to copy to a temp location as an .mjs so we can dynamically import
			const tmpReferencePath = await copyFileToTempAndEnsureExtension({
				filePath: referenceFile,
				tmpDir,
				ext: 'mjs',
			})
			//const referenceContent = normalizeData(await importJsFile(tmpReferencePath), log)
			content = await importJsFile(tmpReferencePath)
			useRefVar = true
			break
		}

		case 'mjs': {
			// We can dynamically import an .mjs directly from its actual path
			log.D(`Reading MJS file "${referenceFile}"...`)
			content = await importJsFile(referenceFile)
			useRefVar = true
			break
		}

		case 'json': {
			log.D(`Reading JSON file "${referenceFile}"...`)
			content = await readJsonFile(referenceFile, false)
			useRefVar = false
			break
		}

		case 'jsonc': {
			log.D(`Reading JSONC file "${referenceFile}"...`)
			content = await readJsonFile(referenceFile, true)
			useRefVar = false
			break
		}
	}

	if (!content) {
		throw new Error(
			localizeFormatted({
				token: 'error-reference-file-load-failed',
				data: { referenceFile },
				lang: appLang,
				log
			})
		)
	}

	let result
	if (useRefVar && referenceExportedVarName?.length) {
		log.D(`[loadReferenceFile] useRefVar: ${useRefVar}`)
		if (!(referenceExportedVarName in content)) {
			throw new Error(
				localizeFormatted({
					token: 'error-reference-var-not-found-in-data',
					data: { referenceExportedVarName, referenceFile, possibleKeys: Object.keys(content) },
					lang: appLang,
					log
				})
			)
		}

		result = content[referenceExportedVarName]
	} else {
		result = content
	}

	return result
}

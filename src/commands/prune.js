import * as path from 'path'
import { localize, localizeFormatted } from '../localizer/localize.js'
import { readJsonFile, writeJsonFile, normalizeOutputPath } from '../lib/io.js'
import { loadConfig } from '../lib/config.js'
import { loadReferenceFile } from '../lib/reference-loader.js'
import { assertIsObj } from '../lib/assert.js'
import { shutdown } from '../shutdown.js'

export async function runPrune({ appState, options, log }) {
	let exitCode = 0
	try {
		// Load config
		const config = await loadConfig({
			configFile: options.configFile,
			log
		})
		assertIsObj(config)

		const referenceFile = options.referenceFile ?? config.referenceFile
		if (!referenceFile?.length) {
			throw new Error(
				localize({
					token: 'error-no-reference-file-specified',
					lang: appState.lang,
					log
				})
			)
		}
		log.D(`referenceFile=${referenceFile}`)

		// Load reference file
		const refFileDir = path.dirname(referenceFile)
		const outputDir = path.resolve(options.outputDir ?? config.outputDir ?? refFileDir)
		log.D(`outputDir=${outputDir}`)

		// Create a tmp dir for storing the .mjs reference file
		const { mkTmpDir } = await import('../lib/io.js')
		const tmpDir = await mkTmpDir()
		appState.tmpDir = tmpDir

		// Resolve referenceExportedVarName
		let referenceExportedVarName
		const { getFileExtension } = await import('../lib/utils.js')
		const referenceFileExt = getFileExtension(referenceFile)
		if (['js','mjs'].includes(referenceFileExt)) {
			log.D(`Searching for reference exported var name for .${referenceFileExt} extension...`)
			if (options.referenceExportedVarName?.length) {
				log.D(`Found reference exported var name via --reference-exported-var-name`)
				referenceExportedVarName = options.referenceExportedVarName
			} else if (config.referenceExportedVarName?.length) {
				log.D(`Found reference exported var name in config, via 'referenceExportedVarName'`)
				referenceExportedVarName = config.referenceExportedVarName
			}
		}
		log.D(`referenceExportedVarName=${referenceExportedVarName}`)

		// Load reference data
		const referenceData = await loadReferenceFile({
			appLang: appState.lang,
			referenceFile,
			referenceExportedVarName,
			tmpDir,
			log
		})

		if (!referenceData) {
			throw new Error(
				localizeFormatted({
					token: 'error-no-reference-data-in-variable',
					data: {
						referenceExportedVarName,
						referenceFile,
					},
					lang: appState.lang,
					log
				})
			)
		}

		const referenceKeys = new Set(Object.keys(referenceData))
		log.V(`Reference file contains ${referenceKeys.size} keys`)

		// Get target languages
		const targetLanguages = options.targetLanguages || config.targetLanguages
		if (!targetLanguages || !targetLanguages.length) {
			throw new Error(
				localize({ token: 'error-no-target-languages', lang: appState.lang, log })
			)
		}

		const normalizeOutputFilenames = options.normalizeOutputFilenames || config.normalizeOutputFilenames

		let totalKeysRemoved = 0
		let filesModified = 0

		// Process each target language file
		for (const targetLang of targetLanguages) {
			const outputFilePath = normalizeOutputPath({
				dir: outputDir,
				filename: `${targetLang}.json`,
				normalize: normalizeOutputFilenames
			})
			log.D(`Processing ${outputFilePath}...`)

			// Read existing output data
			const outputData = await readJsonFile(outputFilePath)
			if (!outputData) {
				log.V(`File ${outputFilePath} does not exist, skipping...`)
				continue
			}

			const keysToRemove = []
			for (const key of Object.keys(outputData)) {
				if (!referenceKeys.has(key)) {
					keysToRemove.push(key)
				}
			}

			if (keysToRemove.length > 0) {
				log.I(`Found ${keysToRemove.length} obsolete key(s) in ${targetLang}.json:`)
				keysToRemove.forEach(key => {
					log.I(`  - ${key}`)
					delete outputData[key]
				})

				// Write the pruned file
				if (!options.dryRun) {
					writeJsonFile(outputFilePath, outputData, log)
					log.V(`Wrote ${outputFilePath}`)
					filesModified++
				}
				totalKeysRemoved += keysToRemove.length
			} else {
				log.V(`No obsolete keys found in ${targetLang}.json`)
			}
		}

		if (options.dryRun) {
			log.I(`\nDry run complete. Would have removed ${totalKeysRemoved} key(s) from ${filesModified} file(s).`)
		} else if (totalKeysRemoved > 0) {
			log.I(`\nRemoved ${totalKeysRemoved} obsolete key(s) from ${filesModified} file(s).`)
		} else {
			log.I(`\nNo obsolete keys found. All target files are up to date.`)
		}

	} catch (error) {
		log.E(error)
		exitCode = 2
	}

	await shutdown(appState, false)

	if (exitCode > 0) {
		process.exit(exitCode)
	}
}

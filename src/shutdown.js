import { rmDir, writeJsonFile } from './lib/io.js'
import { DEFAULT_CACHE_FILENAME } from './lib/consts.js'

export function shutdown(appState, kill) {
	const { log, errors, tmpDir, filesToWrite } = appState

	if (kill) log.I('Forcing shutdown...')

	if (errors.length) {
		log.E(`ALT encountered some errors: ${errors.join('\n')}`)
	}

	// Write any data to disk
	//log.D('filesToWrite keys:', Object.keys(filesToWrite))
	let filesWrittenCount = 0
	let writeFailures = 0
	for (const path of Object.keys(filesToWrite)) {
		log.D('path:', path)
		const json = filesToWrite[path]
		log.T('json:', json)
		// The cache is machine-only; indenting it is pure size for no reader.
		const indent = path.endsWith(DEFAULT_CACHE_FILENAME) ? 0 : undefined
		try {
			writeJsonFile(path, json, appState.log, indent === undefined ? undefined : { indent })
			++filesWrittenCount
		} catch (err) {
			// Keep going so one bad path cannot cost every other file's
			// translations, but do not let the run look clean afterwards.
			++writeFailures
			log.E(`Failed to write ${path}: ${err.message}`)
		}
	}

	log.D(`Wrote ${filesWrittenCount} files to disk.`)
	if (writeFailures) {
		log.E(`${writeFailures} file(s) could not be written — their contents are lost.`)
		errors.push(`${writeFailures} file(s) could not be written`)
	}

	if (tmpDir?.length) {
		rmDir(tmpDir, log)
	}

	if (kill) process.exit(1)
}

export function registerSignalHandlers(appState) {
	// NB: Using async fs API's isn't reliable here; use the sync API otherwise only the first file can be written to disk
	process.on('SIGINT', () => shutdown(appState, true))
	process.on('SIGTERM', () => shutdown(appState, true))
}

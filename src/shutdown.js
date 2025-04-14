import { rmDir, writeJsonFile } from './io.js'

export function shutdown(appState, kill) {
	const { log, errors, tmpDir, filesToWrite } = appState

	if (kill) log.I('Forcing shutdown...')

	if (errors.length) {
		log.E(`ALT encountered some errors: ${errors.join('\n')}`)
	}

	// Write any data to disk
	//log.D('filesToWrite keys:', Object.keys(filesToWrite))
	let filesWrittenCount = 0
	for (const path of Object.keys(filesToWrite)) {
		log.D('path:', path)
		const json = filesToWrite[path]
		log.T('json:', json)
		writeJsonFile(path, json, appState.log)
		++filesWrittenCount
	}

	log.D(`Wrote ${filesWrittenCount} files to disk.`)

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

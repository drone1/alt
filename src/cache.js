import { readJsonFile } from './io.js'

export async function loadCache(path) {
	const storedCache = await readJsonFile(path)
	return {
		referenceHash: storedCache?.referenceHash ?? '',
		referenceKeyHashes: storedCache?.referenceKeyHashes ?? {},
		state: storedCache?.state ?? {},
		lastRun: storedCache?.lastRun ?? null,
	}
}


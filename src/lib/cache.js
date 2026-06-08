import { readJsonFile } from './io.js'

export async function loadCache(path) {
	const storedCache = await readJsonFile(path)
	return {
		referenceHash: storedCache?.referenceHash ?? '',
		referenceKeyHashes: storedCache?.referenceKeyHashes ?? {},
		state: storedCache?.state ?? {},
		// untranslatable[targetLang][key] = <sourceHash>. Marks a (lang, key) the
		// provider returned verbatim from a source that *should* have been
		// translated — e.g. a model that doesn't speak that target language and
		// just echoed the English. Skipping these on subsequent runs prevents the
		// orchestrator from re-asking the same impossible question, and dropping
		// them from the output JSON lets the runtime fall back to the source
		// language instead of shipping an English string in a non-English file.
		untranslatable: storedCache?.untranslatable ?? {},
		lastRun: storedCache?.lastRun ?? null,
	}
}


export default {
	'msg-nothing-to-do': `Nothing to do`,
	'msg-finished-with-errors': `Finished with %%errorsEncountered%% error%%s%%`,

	'msg-translating': 'Translating...',
	'msg-translating-key': `Translating %%key%%`,
	'msg-preparing-endpoint-config': `Preparing endpoint configuration...`,
	'msg-hitting-provider-endpoint': `Hitting %%providerName%% endpoint%%attemptStr%%...`,

	'msg-no-update-needed-for-key': `No update needed for %%key%%`,
	'msg-rate-limited-sleeping': `Rate limited; sleeping for %%interval%%s...%%attemptStr%%`,
	'msg-show-translation-result': `Translated %%key%%: "%%newValue%%"`,
	'msg-processing-lang-and-key': `[%%progress%%%] Processing %%targetLang%% – %%key%%...`,

	'msg-translation-reason-forced': `Forced update`,
	'msg-translation-reason-outputFileDidNotExist': `Output file %%outputFile%% did not exist`,
	'msg-translation-reason-userMissingReferenceValueHash': `No reference hash found`,
	'msg-translation-reason-userModifiedReferenceValue': `User modified reference string`,
	'msg-translation-reason-missingOutputKey': `No existing translation found`,
	'msg-translation-reason-missingOutputValueHash': `No hash found in cache file`,

	'error-value-not-a-string': `Value for reference key "%%key%%" was "%%type%%". Expected a string! Skipping...`,
	'error-value-not-in-reference-data': `Key "%%key%%" did not exist in reference file`,
	'error-translation-failed': `Translation failed for target language=%%targetLang%%; key=%%key%%; text=%%refValue%%`,
	'error-bad-reference-file-ext': `Unsupported file type for reference file "%%ext%%"`,
	'error-reference-var-not-found-in-data': `Couldn't find "%%referenceExportedVarName%%" in reference file "%%referenceFile%%". Did you mean one of these instead?: %%possibleKeys%%`,
	'error-reference-file-load-failed': `Failed to load reference file "%%referenceFile%%"`,
	'error-invalid-llm-model': `Invalid LLM model specified: %%model%%`,
	'error-context-prefix-and-suffix-not-defined': `Either the context prefix or context suffix must be defined`,
	'error-no-provider-specified': `No provider specified.`,
	'error-unknown-provider': `Unknown provider "%%providerName%%".`,
	'error-no-reference-language': `No reference language specified. Use --reference-language option or add 'referenceLanguage' to your config file`,
	'error-no-target-languages': `No target languages specified. Use --target-languages option or add 'targetLanguages' to your config file`,
	'error-no-reference-data-in-variable': `No reference data found in variable "%%referenceExportedVarName%%" in "%%referenceFile%%"`,
	'error-copying-file-to-temp-dir': `Error copying file to temp directory: %%error%%`,
	'error-no-output-dir-specified': `No output directory specified via '--output-dir', in a config file (via 'outputDir'), or in the same directory as your reference file ("%%refFileDir%%")`,
	'error-dir-create-failed': `Failed to create directory "%%dir%%"`,
	'error-no-reference-file-specified': `No reference file specified via '--reference-file' or in config file (via 'referenceFile')`,

	'supported-providers': `Supported providers are: %%providers%%`
}

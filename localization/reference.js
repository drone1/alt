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
	'error-value-not-in-reference-data': `Key "%%key%%" did not exist in reference file`
}

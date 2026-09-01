[![Run Tests](https://github.com/drone1/alt/actions/workflows/test.yml/badge.svg)](https://github.com/drone1/alt/actions/workflows/test.yml)
![Claude](https://img.shields.io/badge/Anthropic-black?logo=anthropic&logoColor=white)
![ChatGPT](https://img.shields.io/badge/ChatGPT-74aa9c?logo=openai&logoColor=white)
![Gemini](https://img.shields.io/badge/Gemini-4285F4?logo=google&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-339933?logo=nodedotjs&logoColor=white)
![Contributions Welcome](https://img.shields.io/badge/contributions-welcome-brightgreen)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

![Demo](https://github.com/drone1/alt/raw/refs/heads/media/assets/videos/alt.gif)

<!--ts-->
* [AI Localization Tool](#ai-localization-tool)
   * [Features](#features)
   * [Installation](#installation)
   * [Setup](#setup)
      * [Create a reference file](#create-a-reference-file)
      * [Running](#running)
      * [Access methods](#access-methods)
      * [Output](#output)
   * [Config file](#config-file)
   * [Adding context](#adding-context)
      * [Application-level context](#application-level-context)
      * [String-specific context](#string-specific-context)
   * [Display language](#display-language)
   * [Usage](#usage)
   * [Examples](#examples)
      * [Example I: ALT's localized display strings](#example-i-alts-localized-display-strings)
      * [Example II](#example-ii)
      * [Example III](#example-iii)
      * [Example IV](#example-iv)
   * [Formatting](#formatting)
   * [Translation rules](#translation-rules)
   * [Removing stale keys](#removing-stale-keys)
   * [Additional notes](#additional-notes)
      * [Yes, you should commit your .localization.cache.json](#yes-you-should-commit-your-localizationcachejson)
      * [Hand-edited target values](#hand-edited-target-values)
      * [Delayed vs. realtime writes](#delayed-vs-realtime-writes)
      * [CI](#ci)
   * [Contributing](#contributing)
   * [Feedback](#feedback)

<!-- Created by https://github.com/ekalinin/github-markdown-toc -->
<!-- Added by: jonl, at: Fri Aug 21 07:38:06 PM CEST 2026 -->

<!--te-->

# AI Localization Tool
Translates all source strings in a reference (`js`,`mjs`,`json`,`jsonc`) file to all target languages using AI.

## Features
* Loads source/reference key/value pairs from a file 
* Localizes using AI as needed, writing to a .json file per language
* App-level context can be specified [`appContextMessage`]
* Additional context can be specified per string [`--contextPrefix`, `--contextSuffix`]
* Supports Claude, Gemini, OpenAI [`--provider`]
* Two ways to reach a provider: its HTTP API with your own key, or its CLI tool with that tool's own auth [`--access`]
* Many keys per request, and several languages at once, where the access method supports it [`--batch-size`, `--concurrency`]
* User-modifications to output files are safe and will not be overwritten
* Removes keys from your target files once they leave the reference file [`alt prune`]
* Languages are specified using BCP47 tags

## Installation
```bash
npm install -g @drone1/alt
```
## Setup
### Create a reference file
This will house your source strings via key/value pairs in your preferred language.

Here's an example ``reference.js``:
```javascript
export default {
	'error-msg': `Sorry, we don't know how to do anything`,
	'success-msg': `A massive "achievement"`,
	'_context:success-msg': `This text is for a button when a user completes a task`
}
```
Use whatever filename you prefer. `js`,`mjs`,`json`,`jsonc` extensions are supported.

For `.js` and `.mjs` files, you can specify the name of an exported variable instead of using `default`, via `--reference-exported-var-name`.

### Running
```bash
ANTHROPIC_API_KEY=<secret>
alt translate --reference-file ./reference.js --reference-language en --target-languages aa,bo,es-MX,hi,zh-Hans --provider anthropic
```
This command would iterate across all key/value pairs defined in `./reference.js` and translate if needed.

Here are all supported providers and their required environment variables:

| `-p`, `--provider` | <span style="font-weight: normal;">environment variable</span> |
|-------------------|----------------------------------------------------------------|
| anthropic         | ANTHROPIC_API_KEY                                              |
| google            | GOOGLE_API_KEY                                                 |
| openai            | OPENAI_API_KEY                                                 |

### Access methods
`--provider` says _whose_ model to use; `--access` says _how_ to reach it.

| `-a`, `--access` | how it authenticates | providers |
|------------------|----------------------|-----------|
| `api` (default)  | the vendor's HTTP API, using the API key in the environment variable above | anthropic, google, openai |
| `harness`        | the vendor's own CLI tool, using whatever that tool is already logged in as — no API key | anthropic (via [Claude Code](https://github.com/anthropics/claude-code)) |

```bash
alt translate --provider anthropic --access harness
```

With `harness`, ALT shells out to the `claude` executable on your `PATH`, so a Claude subscription
covers the translation instead of API billing. The CLI has to be installed and signed in first.

`harness` also translates in batches: one call carries `--batch-size` keys (25 by default) rather than
one key, and `--concurrency` languages can be in flight at once (1 by default). Bigger batches amortize
the CLI's startup cost better, but a batch that comes back empty costs that much more rework. Whatever
fails is retried up to `--max-retries` times, and if two attempts in a row translate nothing at all ALT
drops to one key per call, so a single unanswerable string stops blocking the rest of its batch.

### Output
The example above would write `aa.json`, `bo.json`, etc., to the current working directory.

Sample output:
```json
{
	"error-msg": "དགོངས་དག་ང་ཚོས་ག་རེ་བྱེད་དགོས་མིན་ཤེས་ཀྱི་མི་འདུག",
	"success-msg": "གྲུབ་འབྲས་\"ཆེན་པོ་\"ཞིག"
}
```

Note that output files can be lower-cased if you pass the ``--normalize-output-filenames`` option, so `fr-FR` translations would write to `fr-fr.json`

## Config file
[_optional_] For convenience, a config file is supported. You can use a config file in conjunction with command-line arguments.

Command-line arguments override config file values.

If no explicit config file is specified via `--config-file`, ALT will search for a file with the name `alt.config.json` in the current working directory.

If no config is loaded, you'll need to specify `--reference-file` and `--provider`, otherwise ALT will fail.

Here's an example `alt.config.json` file you might keep in your project's root directory:

```
{
	"appContextMessage": "This is a description of my app",
	"referenceLanguage": "ar",
	"provider": "google",
	"access": "api",
	"lookForContextData": true,
	"contextPrefix": "_context:",
	"contextSuffix": "",
	"outputDir": "localization",
	"referenceFile": "localization/reference.js",
	"normalizeOutputFilenames": false,
	"batchSize": 25,
	"concurrency": 1,
	"trackTargetEdits": true,
	"targetLanguages": [
		"es-MX", "zh-SG"
	]
}
```

Since in most cases these arguments will not change often, a config file is recommended.

Any of the above settings can be specified using command-line arguments, but note the mapping from _camelCase_ to _kebab-case_ (`appContextMessage` => `--app-context-message`, `referenceLanguage` => `--reference-language`, etc.).

## Adding context
Sometimes a string isn't enough to give context to the AI, and as a result, it may give an undesirable translation. ALT allows you to specify additional context for this reason.

### Application-level context
A global, application description can be specified `--app-context-message` (or `appContextMessage` in a [config](#config)).
For example, your config may include something like:
```json
	"appContextMessage": "Voided is a MMORPG game based on outer space."
```

### String-specific context
Context can be added for any reference key/value pairs by passing `--look-for-context-data` (or setting `lookForContextData: true` in a [config](#config)).

For example, given the following reference key/value pair:

```json
	"editor-add-component": '+ Star',
```
This may not translate as desired, so ALT allows you to specify additional context in the form of another key/value pair. For example:
```json
	"_context:editor-add-component": "This is text for a button the galaxy UI, where a user can create a star"
```
`_context:` can be whatever you prefer here. It's specified via `--context-prefix`, or `contextPrefix` in a [config](#config).

A suffix can be specified instead of (or in conjunction with) a prefix, with `--context-suffix`, or `contextSuffix` in a [config](#config). Example:
```json
	"editor-add-component[context]": "This is text for a button the graph editor"
```
In this case, `[context]` would be specified by passing `--context-suffix '[context]'` or setting `"contextSuffix": "[context]"` in a [config](#config).

Further examples can be found [here](#examples).

## Display language
ALT CLI itself has been localized so you can use it many languages. You can optionally set the display language with the `ALT_LANGUAGE` environment variable. Please feel free to submit
an issue if you do not see your preferred language.

## Usage
```
Usage: alt [options] [command]

An AI-powered localization tool

Options:
  -V, --version          output the version number
  -h, --help             display help for command

Commands:
  translate [options]
  list-models [options]
  prune [options]        Remove keys from target files that no longer exist in
                         the reference file
  help [command]         display help for command

Environment variables:
  ANTHROPIC_API_KEY                     Your Anthropic API key (for --provider anthropic --access api)
  OPENAI_API_KEY                        Your OpenAI API key
  GOOGLE_API_KEY                        Your Google Gemini API key
  ALT_LANGUAGE                          BCP47 language tag used for display

---

Usage: alt translate [options]

Options:
  -c, --config-file <path>                      Path to config file; defaults to "alt.config.json" in the current working directory if not specified
  -r, --reference-file <path>                   Path to reference file of source strings to be translated. This file can be in .js, .mjs, .json, or .jsonc formats and is presumed to be in the reference language specified by --reference-language; overrides any 'referenceFile' config setting
  -o, --output-dir <path>                       Output directory for localized files; overrides any 'outputDir' config setting
  -rl, --reference-language <language>          The reference file's language; overrides any 'referenceLanguage' config setting
  -tl, --target-languages <list>                Comma-separated list of language codes; overrides any 'targetLanguages' config setting
  -k, --keys <list>                             Comma-separated list of keys to process; if none are processed, all keys in the reference file will be processed
  -R, --reference-exported-var-name <var name>  For .js or .mjs reference files only, this will be the exported variable, e.g. for 'export default = {...}' you'd use 'default' here, or 'data' for 'export const data = { ... }'. For .json or .jsonc reference files, this value is ignored. (default: "default")
  -m, --app-context-message <message>           Description of your app, to be passed along to the AI, per translation request; overrides any 'appContextMessage' config setting
  -f, --force                                   Force regeneration of all keys; if no '--keys' argument is specified, all keys will be processed (default: false)
  -rtw, --realtime-writes                       Write updates to disk immediately, rather than on shutdown (default: false)
  -y, --tty                                     Use tty/simple renderer; useful for CI (default: false)
  -M, --model <name>                            LLM model name to use; defaults per provider/access: anthropic/api="claude-haiku-4-5-20251001", anthropic/harness="haiku", google/api="gemini-2.0-flash", openai/api="gpt-4.1-mini"; use the 'list-models' command to view all models
  -x, --max-retries <integer>                   Maximum retries on failure (default: 3)
  -bs, --batch-size <integer>                   When the access method supports batched translation (currently only 'harness'), translate this many keys per call. Larger batches amortize CLI cold-start better but lose more work on a failed batch. Defaults to 25; overrides any 'batchSize' config setting
  -C, --concurrency <integer>                   When the access method supports batched translation, run this many language batches in parallel. Defaults to 1; overrides any 'concurrency' config setting
  -n, --normalize-output-filenames              Normalizes output filenames (to all lower-case); overrides any 'normalizeOutputFilenames' in config setting (default: false)
  --no-track-target-edits                       Stop recording a hash of every translated string. That record exists only to avoid overwriting hand-edited target values, and is roughly half the cache by size; disable it if you never hand-edit target files
  -N, --no-logo                                 Suppress logo printout
  -cp, --context-prefix <value>                 String to be prefixed to all keys to search for additional context, which are passed along to the AI for context
  -cs, --context-suffix <value>                 String to be suffixed to all keys to search for additional context, which are passed along to the AI for context
  -L, --look-for-context-data                   If specified, ALT will pass any context data specified in the reference file to the AI provider for translation. At least one of --contextPrefix or --contextSuffix must be specified (default: false)
  -v, --verbose                                 Enables verbose spew; forces --tty mode (default: false)
  -d, --debug                                   Enables debug spew; forces --tty mode (default: false)
  -t, --trace                                   Enables trace spew; forces --tty mode (default: false)
  --dev                                         Enable dev mode, which prints stack traces with errors (default: false)
  -p, --provider <name>                         AI provider vendor to use for translations (anthropic, google, openai); overrides any 'provider' config setting
  -a, --access <method>                         Access method for the provider. `api` uses the vendor's HTTP API with an API key (env: <PROVIDER>_API_KEY). `harness` uses the vendor's own CLI tool with that tool's own auth — currently only supported by anthropic via Claude Code. Per-provider support: anthropic: api|harness; google: api; openai: api. Defaults to "api"; overrides any 'access' config setting
  -h, --help                                    display help for command

---

Usage: alt prune [options]

Remove keys from target files that no longer exist in the reference file

Options:
  -c, --config-file <path>                      Path to config file; defaults to "alt.config.json" in the current working directory if not specified
  -r, --reference-file <path>                   Path to reference file of source strings. This file can be in .js, .mjs, .json, or .jsonc formats; overrides any 'referenceFile' config setting
  -o, --output-dir <path>                       Output directory for localized files; overrides any 'outputDir' config setting
  -tl, --target-languages <list>                Comma-separated list of language codes; overrides any 'targetLanguages' config setting
  -R, --reference-exported-var-name <var name>  For .js or .mjs reference files only, this will be the exported variable, e.g. for 'export default = {...}' you'd use 'default' here, or 'data' for 'export const data = { ... }'. For .json or .jsonc reference files, this value is ignored. (default: "default")
  -n, --normalize-output-filenames              Normalizes output filenames (to all lower-case); overrides any 'normalizeOutputFilenames' in config setting (default: false)
  --dry-run                                     Show what would be removed without actually modifying files (default: false)
  -N, --no-logo                                 Suppress logo printout
  -v, --verbose                                 Enables verbose spew (default: false)
  -d, --debug                                   Enables debug spew (default: false)
  -t, --trace                                   Enables trace spew (default: false)
  --dev                                         Enable dev mode, which prints stack traces with errors (default: false)
  -h, --help                                    display help for command

---

Usage: alt list-models [options]

Options:
  -p, --provider <name>  AI provider vendor to use for translations (anthropic,
                         google, openai); overrides any 'provider' config
                         setting
  -a, --access <method>  Access method for the provider. `api` uses the
                         vendor's HTTP API with an API key (env:
                         <PROVIDER>_API_KEY). `harness` uses the vendor's own
                         CLI tool with that tool's own auth — currently only
                         supported by anthropic via Claude Code. Per-provider
                         support: anthropic: api|harness; google: api; openai:
                         api. Defaults to "api"; overrides any 'access' config
                         setting
  -h, --help             display help for command
```

## Examples
### Example I: ALT's localized display strings
The best example is probably the localization for ALT's own display strings.

See [alt.config.json](alt.config.json), the config used for the tool's own display strings, and the [localization](localization) directory it writes to.

Generated with `npm run localize-display-strings`


### Example II
```bash
alt translate --reference-file loc.js
--reference-exported-var-name data
--provider anthropic
--look-for-context-data
--context-prefix _context:
```
* Imports reference strings from ``loc.js``
* Looks for exported variable ``data`` (if `loc.js` has `export data = { ... } `)
* Translates with Claude
* Looks for context keys starting with `_context:`
* Writes output files to the current working directory

### Example III
```bash
alt translate --config-file ./localization-config.json
  --reference-file loc.js
  --output-dir localization
  --provider openai
  --look-for-context-data
  --context-suffix "[context]"
```
* Imports config from `./localization-config.json`
* Imports reference strings from ``loc.js``
* Looks for exported ``default`` value
* Translates with ChatGPT
* Looks for context keys ending with `[context]`
* Writes files to `./localization`

### Example IV
```bash
alt translate --config-file config.json
  --reference-file localization/reference/source.js
  --output-dir localization/output
  --provider openai
  --target-languages vi,aa
  --keys error-msg,title-hero,button-text-send
```
* Overrides any target languages specified in the config
* Only processes the specified keys (`error-msg`, etc.)

## Formatting
If your reference values include formatting information like this:

```javascript
"error-msg": "The server returned an error: %%details%%"
```
or
```javascript
"error-msg": "The server returned an error: {{details}}"
```
...or whatever syntax your app may use for formatting, the AI's consistently smart enough not to translate `%%details%%` or `{{details}}` into the target language, and will leave it untouched.

Internally, there is currently nothing in the prompt about this. I've tested with `%%var%%` syntax, and it hasn't failed yet.

Please submit an issue if it causes you any trouble.

## Translation rules
Under what conditions will ALT translate a given source string?

Translation will occur for a given target language & reference key/value if any of the following are true:

* The output file does not exist
  * Example: You're translating to target language _zh-Hans_ and `zh-Hans.json` doesn't exist
* The output file is missing the reference key
  * Example: You're translating reference key _error-msg_ to target language _zh-Hant.jso_ and `zh-Hans.json` does not have a key/value pair for key _error-msg_
* The reference value was modified
  * Example: You change the value of _some-key_ in your reference file
* A context value for the given target language/key is found and has been modified
  * Example: You modify the value of _context:error-msg_ in your reference file. _error-msg_ will be re-translated for all target languages.
* `-f` or `--force` are specified
* The cache file (`.localization.cache.json`) is not present

NOTE: Translation will _not_ occur if ALT detects that the given value in the target language file has been manually modified. If you modify an output value manually and want it to be re-translated
later, you can just delete that key/value pair from the given file. That protection is what `--no-track-target-edits` turns off &ndash; see [Hand-edited target values](#hand-edited-target-values).

There is one more case where a key is deliberately left alone: if the provider hands back the source
string unchanged for a value that plainly should have been translated &ndash; usually a model that doesn't
speak that target language and just echoes the source &ndash; ALT records the pair as untranslatable and
drops the key from the output file, so your app falls back to the source language rather than shipping
an English string inside a non-English file. The record is keyed by the source string's hash, so editing
the reference value asks the question again.

## Removing stale keys
Deleting a key from your reference file doesn't remove it from the target files &ndash; nothing translates it
any more, but the old translation sits there. `alt prune` cleans that up:

```bash
alt prune --dry-run
alt prune
```

`--dry-run` reports what it would remove without touching anything.

## Additional notes
### Yes, you should commit your .localization.cache.json
If you do not do this, you'll lose important state and need to re-translate everything.

It is a machine-readable file, not one to review by hand: it's written without indentation, and its
per-key reference hashes are stored once and shared across languages instead of repeated per language.
ALT also maintains it as it goes &ndash; a language you remove from `targetLanguages` in your config has its
entries dropped on the next run, rather than being carried (and re-committed) forever.

Eviction follows your **config**, not whatever `--target-languages` a single invocation passes. Narrowing
one run (`alt translate --target-languages en`, say, as a source-language parity check) translates only
that language but leaves every other language's cache entries intact.

### Hand-edited target values
Alongside the reference hashes, ALT records a hash of every value it writes. That record exists for one
purpose: noticing that _you_ changed a target value afterwards, so it never overwrites your edit. It is
also roughly half the cache by size.

If you never hand-edit your target files &ndash; if they're purely generated &ndash; pass `--no-track-target-edits`
(or set `"trackTargetEdits": false` in your config) and ALT stops recording it, discarding anything a
previous tracked run left behind so the space is actually reclaimed. Everything else still
works: a key missing from a target file is still translated, and a changed reference value still triggers
a re-translation. The only thing you give up is the "don't clobber my manual edit" guarantee.

### Delayed vs. realtime writes
By default, ALT will not write to disk until the tool is shutting down (including SIGTERM &ndash; yes, `Ctrl+C` is safe).

This behavior is useful if your application is monitoring the output directory and you don't want your server 
constantly restarting, for example.

If you prefer to write updates to disk in real-time (anytime any output data changes, due to translation, etc), you can pass `--realtime-writes`.

### CI
You may want to use `--tty` for more useful output.

Commit the updated output files and `.localization.cache.json` as part of the job; without the cache, the
next run re-translates everything from scratch.

If you're running `--access harness`, the `claude` CLI has to be installed on the runner and already
authenticated there &ndash; ALT does not log it in for you.

## Contributing
Feel free to fix existing issues and submit a PR, or submit a new issue.

## Feedback
Feedback is more than welcome. Please feel free to create an issue.

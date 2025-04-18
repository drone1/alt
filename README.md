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
      * [Output](#output)
   * [Config file](#config-file)
   * [Adding context](#adding-context)
      * [Application-level context](#application-level-context)
      * [String-specific context](#string-specific-context)
   * [Display language](#display-language)
   * [Usage](#usage)
   * [Examples](#examples)
      * [Example I](#example-i)
      * [Example II](#example-ii)
      * [Example III](#example-iii)
      * [Example: ALT's localized display strings](#example-alts-localized-display-strings)
   * [Formatting](#formatting)
   * [Translation rules](#translation-rules)
   * [Additional notes](#additional-notes)
      * [Delayed vs. realtime writes](#delayed-vs-realtime-writes)
      * [CI](#ci)
   * [PR](#pr)

<!-- Created by https://github.com/ekalinin/github-markdown-toc -->
<!-- Added by: jonl, at: Wed Apr 16 11:56:33 AM CEST 2025 -->

<!--te-->

# AI Localization Tool
Translates all source strings in a reference (`js`,`mjs`,`json`,`jsonc`) file to all target languages using AI.

## Features
* Loads source/reference key/value pairs from a file 
* Localizes using AI as needed, writing to a .json file per language
* App-level context can be specified [`appContextMessage`]
* Additional context can be specified per string [`--contextPrefix`, `--contextSuffix`]
* Supports Claude, Gemini, OpenAI [`--provider`]
* User-modifications to output files are safe and will not be overwritten
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

For `.js` and `.mjs` files, you can specify the name of an exported variable instead of using `default`, via `--referenceVarName`.

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
[_optional_] You can create a config file. By default, ALT will search the output directory for `config.json`, but you can specify a path directly using 
`--config-file`. 
Example 
config:

```
{
	"appContextMessage": "This is a description of my app",
	"referenceLanguage": "ar",
	"provider": "google",
	"lookForContextData": true,
	"contextPrefix": "_context:",
	"contextSuffix": "",
	"targetLanguages": [
		"es-MX", "zh-SG"
	]
}
```

Any of the above settings can be specified using command-line arguments (`--app-context-message`, `--reference-language`, `--provider`, `--target-languages`). Command-line arguments take precedence.

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
  help [command]         display help for command

Environment variables:
  ANTHROPIC_API_KEY                     Your Anthropic API key
  OPENAI_API_KEY                        Your OpenAI API key
  GOOGLE_API_KEY                        Your Google Gemini API key
  ALT_LANGUAGE                          BCP47 language tag used for display

---

Usage: alt translate [options]

Options:
  -r, --reference-file <path>                   Path to reference file of source strings to be translated. This file can be in .js, .mjs, .json, or .jsonc formats and is presumed to be in the reference language specified by --reference-language
  -c, --config-file <path>                      Path to config file; defaults to <output dir>/config.json
  -rl, --reference-language <language>          The reference file's language; overrides any 'referenceLanguage' config setting
  -o, --output-dir <path>                       Output directory for localized files
  -tl, --target-languages <list>                Comma-separated list of language codes; overrides any 'targetLanguages' config setting
  -k, --keys <list>                             Comma-separated list of keys to process
  -R, --reference-exported-var-name <var name>  For .js or .mjs reference files, this will be the exported variable, e.g. for 'export default = {...}' you'd use 'default' here, or 'data' for 'export const data = { ... }'. For .json or .jsonc reference files, this value is ignored. (default: "default")
  -m, --app-context-message <message>           Description of your app to give context. Passed with each translation request; overrides any 'appContextMessage' config setting
  -f, --force                                   Force regeneration of all translations (default: false)
  -rtw, --realtime-writes                       Write updates to disk immediately, rather than on shutdown (default: false)
  -y, --tty                                     Use tty/simple renderer; useful for CI (default: false)
  -M, --model <name>                            LLM model name to use; defaults are: for "anthropic": "claude-3-7-sonnet-20250219", for "google": "gemini-2.0-flash", for "openai": "gpt-4-turbo"; use the 'list-models' command to view all models
  -x, --max-retries <integer>                   Maximum retries on failure (default: 3)
  -n, --normalize-output-filenames              Normalizes output filenames (to all lower-case); overrides any 'normalizeOutputFilenames' in config setting (default: false)
  -N, --no-logo                                 Suppress logo printout
  -cp, --context-prefix <value>                 String to be prefixed to all keys to search for additional context, which are passed along to the AI for context
  -cs, --context-suffix <value>                 String to be suffixed to all keys to search for additional context, which are passed along to the AI for context
  -L, --look-for-context-data                   If specified, ALT will pass any context data specified in the reference file to the AI provider for translation. At least one of --contextPrefix or --contextSuffix must be specified (default: false)
  -v, --verbose                                 Enables verbose spew; forces --tty mode (default: false)
  -d, --debug                                   Enables debug spew; forces --tty mode (default: false)
  -t, --trace                                   Enables trace spew; forces --tty mode (default: false)
  --dev                                         Enable dev mode, which prints stack traces with errors (default: false)
  -p, --provider <name>                         AI provider to use for translations (anthropic, openai); overrides any 'provider' config setting
  -h, --help                                    display help for command

---

Usage: alt list-models [options]

Options:
  -p, --provider <name>  AI provider to use for translations (anthropic,
                         openai); overrides any 'provider' config setting
  -h, --help             display help for command
```

## Examples
### Example I
* Import from ``loc.js``
* Look for exported variable ``data``
* Translate with Claude
* Look for context keys starting with `_context:`
* Write output files to the current working directory
```bash
alt translate --reference-file loc.js
  --reference-var-name data
  --provider anthropic
  --look-for-context-data
  --context-prefix _context:
```

### Example II
* Import config from `./localization-config.json`
* Import from ``loc.js``
* Look for exported ``default`` value
* Translate with ChatGPT
* Look for context keys ending with `[context]`
* Write to disk repeatedly, as changes are processed
* Write files to `./localization`
```bash
alt translate --config-file ./localization-config.json
  --reference-file loc.js
  --output-dir localization
  --provider openai
  --look-for-context-data
  --context-suffix "[context]"
```
### Example III
* Overrides any config's languages
* Only process the specified strings
```bash
alt translate --config-file config.json
  --reference-file reference.js
  --output-dir localization
  --provider openai
  --look-for-context-data
  --context-suffix "[context]"
  --target-languages vi,aa
  --keys error-msg,title-hero,button-text-send
```
### Example: ALT's localized display strings
See `/localization`, which contains a `config.js` file and localization files used for the tool's own display strings.

Generated with `npm run localize-display-strings`

## Formatting
If your reference values include formatting information like this:
```javascript
"error-msg": "The server returned an error: %%details%%"
```
or
```javascript
"error-msg": "The server returned an error: {{details}}"
```
...or whatever syntax your app may use, I've found the AI's consistently smart enough not to translate `%%details%%` or `{{details}}` into the target language, and will leave it untouched.

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
later, you can just delete that key/value pair from the given file.

## Additional notes
### Delayed vs. realtime writes
By default, ALT will not write to disk until the tool is shutting down (including SIGTERM &ndash; yes, `Ctrl+C` is safe).

This behavior is useful if your application is monitoring the output directory and you don't want your server 
constantly restarting, for example.

If you prefer to write updates to disk in real-time (anytime any output data changes, due to translation, etc), you can pass `--realtime-writes`.

### CI
You may want to use `--tty` for more useful output.

## PR
Feel free to fix existing issues and submit a PR, or submit a new issue.

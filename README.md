```
 ▄▀▀█▄   ▄▀▀▀▀▄      ▄▀▀▀█▀▀▄ 
▐ ▄▀ ▀▄ █    █      █    █  ▐ 
  █▄▄▄█ ▐    █      ▐   █     
 ▄▀   █     █          █      
█   ▄▀    ▄▀▄▄▄▄▄▄▀  ▄▀       
▐   ▐     █         █         
          ▐         ▐        
```
![Anthropic](https://img.shields.io/badge/Anthropic-black?logo=anthropic&logoColor=white)
![ChatGPT](https://img.shields.io/badge/ChatGPT-74aa9c?logo=openai&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-339933?logo=nodedotjs&logoColor=white)
![Contributions Welcome](https://img.shields.io/badge/contributions-welcome-brightgreen)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

# AI Localization Tool
Translates all strings in a reference `.js` file to all target languages using AI.

## Features
* Loads reference key/value pairs from a reference file 
* Localizes using AI as needed, writing to a .json file per language
* App-level context can be specified [`appContextMessage`]
* Additional context can be specified per string [`--contextPrefix`, `--contextSuffix`]
* Supports multiple AI providers: Claude, OpenAI [`--provider`]
* User-modifications to output files are safe and will not be overwritten
* Languages are specified using BCP47 tags

## Installation
```bash
npm install -g github:drone1/alt
```
or
```bash
npm install -g https://github.com/drone1/alt.git
```
## Setup
Create a reference file for your reference data. For example, ``reference.js``:
```javascript
export default {
	'error-msg': `Sorry, we don't know how to do anything`,
	'success-msg': `A massive "achievement"`,
	'_context:success-msg': `This text is for a button when a user completes a task`
}
```
Use whatever filename you prefer, but currently a .js extension is required.
You can specify an exported variable instead of using `default`. See `--referenceVarName`.

2. Running
```bash
ANTHROPIC_API_KEY=<secret>
alt --reference-file ./reference.js --reference-language en --target-languages aa,bo,es-MX,hi,zh-SG --provider anthropic
```
or
```bash
OPENAI_API_KEY=<secret>
alt --reference-file ./reference.js --reference-language en --target-languages aa,bo,es-MX,hi,zh-SG --provider openai
```
These commands would iterate across all key/value pairs in the variable exported from `./reference.js` and if needed, translate.

The examples above would write `aa.json`, `bo.json`, etc., to the current working directory.

Sample output:
```json
{
	"error-msg": "དགོངས་དག་ང་ཚོས་ག་རེ་བྱེད་དགོས་མིན་ཤེས་ཀྱི་མི་འདུག",
	"success-msg": "གྲུབ་འབྲས་\"ཆེན་པོ་\"ཞིག"
}
```

Note that output files can be lower-cased if you pass the ``--normalize-output-filenames`` option, so `fr-FR` translations would write to `fr-fr.json`

## Display language
ALT CLI itself has been localized so you can use it many languages. For non-English languages, you can set the display language with the `ALT_LANGUAGE` environment variable. Please feel free to submit 
an issue or a PR if you'd like to add another language.

## Rules
Translation will occur for a given target language & key if any of the following are true:
* The reference value was modified and translation has not yet occurred for the given language/key
* If a context value for the given target language/key is found and has been modified. 
* The `--force` flag is used

Translation will _not_ occur if `alt` detects that the given value in the target language file has been manually modified. If you modify an output value manually and want it to be re-translated 
later, you can just delete that key/value pair from the given file.

## Config file
[_optional_] You can create a config file. By default, `ALT` will search the output directory for `config.json`, but you can specify a path directly using 
`--config-file`. 
Example 
config:

```
{
	"appContextMessage": "This is a description of my app",
	"referenceLanguage": "ar",
	"provider": "anthropic",
	"lookForContextData": true,
	"contextPrefix": "_context:",
	"contextSuffix": "",
	"targetLanguages": [
		"es-MX", "zh-SG"
	]
}
```

Any of the above settings can be specified using command-line arguments (`--app-context-message`, `--reference-language`, `--provider`, `--target-languages`). Command-line arguments take precedence.

## Usage
```
alt [options] [command]

Options:
  -V, --version                         output the version number
  -r, --reference-file <path>           Path to reference JSONC file (default language)
  -rl, --reference-language <language>  The reference file's language; overrides any
                                        'referenceLanguage' config setting
  -p, --provider <name>                 AI provider to use for translations (anthropic,
                                        openai); overrides any 'provider' config setting
  -o, --output-dir <path>               Output directory for localized files
  -l, --target-languages <list>         Comma-separated list of language codes; overrides
                                        any 'targetLanguages' config setting
  -k, --keys <list>                     Comma-separated list of keys to process
  -j, --reference-var-name <var name>   The exported variable in the reference file, e.g.
                                        export default = {...} you'd use 'default'
                                        (default: "default")
  -f, --force                           Force regeneration of all translations (default:
                                        false)
  -rtw, --realtime-writes               Write updates to disk immediately, rather than on
                                        shutdown (default: false)
  -m, --app-context-message <message>   Description of your app to give context. Passed
                                        with each translation request; overrides any
                                        'appContextMessage' config setting
  -y, --tty                             Use tty/simple renderer; useful for CI (default:
                                        false)
  -c, --config-file <path>              Path to config file; defaults to <output
                                        dir>/config.json
  -x, --max-retries <integer>           Maximum retries on failure (default: 3)
  -n, --normalize-output-filenames      Normalizes output filenames (to all lower-case);
                                        overrides any 'normalizeOutputFilenames' in config
                                        setting (default: false)
  -v, --verbose                         Enables verbose spew (default: false)
  -d, --debug                           Enables debug spew (default: false)
  -t, --trace                           Enables trace spew (default: false)
  --context-prefix <value>              String to be prefixed to all keys to search for
                                        additional context, which are passed along to the
                                        AI for context
  --context-suffix <value>              String to be suffixed to all keys to search for
                                        additional context, which are passed along to the
                                        AI for context
  --look-for-context-data               If specified, ALT will pass any context data
                                        specified in the reference file to the AI provider
                                        for translation. At least one of --contextPrefix
                                        or --contextSuffix must be specified (default:
                                        false)
  -h, --help                            display help for command

Commands:
  translate

Environment variables:
  ANTHROPIC_API_KEY                     Your Anthropic API key
  OPENAI_API_KEY                        Your OpenAI API key
  ALT_LANGUAGE                          CLI display language
``` 

## Examples
### Example I
* Import from ``loc.js``
* Look for exported variable ``data``
* Translate with Claude
* Look for context keys starting with `_context:`
* Write output files to the current working directory
```bash
alt --reference-file loc.js
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
alt --config-file ./localization-config.json
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
alt --config-file config.json
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

## Additional notes
### Delayed vs. realtime writes
By default, `alt` will not write to disk until the tool is shutting down (including SIGTERM &ndash; yes, `Ctrl+C` is safe).

This behavior is useful if your application is monitoring the output directory and you don't want your server 
constantly restarting, for example.

If you prefer to write updates to disk in real-time (anytime any output data changes, due to translation, etc), you can pass `--realtime-writes`.

### CI
You may want to use `--tty` for more useful output.

## Next steps
- Add Google provider.
- Add support for reference files in JSON format
- It'd be nice to rely on $LANG in POSIX, but I didn't find a clean and reliable conversion from POSIX to BCP47 when I did a cursory search, which includes edge cases
- Bug: If a user modifies a reference value, then runs and cancels, then runs again, any language/key values which would have been affected by the change will no longer be modified. The tool needs to detect these types of changes at a higher level than it is currently so that key/values can be deleted for all languages and written to disk, so that they're effectively missing and will have to be re-translated. The state that a reference value changed would be lost across runs of the tool, however, but at least the result would be a fix, with this approach.
- Tests :]

Feel free to submit a PR.

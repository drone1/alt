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
* Additional context can be given per string [`--contextPrefix`, `--contextSuffix`]
* Supports multiple AI providers: Claude, OpenAI [`--provider`]
* User-modifications to output files are safe

## Installation
```bash
npm install -g github:drone1/ai-localization-tool
```
or
```bash
npm install -g https://github.com/drone1/ai-localization-tool.git
```
## Setup
1. Create a config file, ``config.json``:
```
{
	"appContextMessage": "Optional app-level context for the AI",
	"referenceLanguage": "en",
	"languages": [
		"en", "es-MX", "zh-SG"
	]
}
```
``languages`` is optional and can be specified with ``--languages``
2. Create a reference file for your reference data, ``reference.js``. Example data:
```javascript
export default {
	'error-msg': `Sorry, we don't know how to do anything`,
	'success-msg': `A massive achievement`,
}
```
Use whatever filename you prefer, but currently a .js extension is required.
You can specify an exported variable instead. See `--referenceVarName`.

3. Localize
```bash
ANTHROPIC_API_KEY=<secret> alt --config config.js --reference reference.js --provider anthropic
```
or
```bash
OPENAI_API_KEY=<secret> alt --config config.js --reference reference.js --provider openai
```
This will iterate across all key/value pairs in the variable exported from `./reference.js`. For each key/value pair, and for each language specified in `config.json`/``languages``, `ALT` will translate (if needed) and output files for each language (e.g. `./en.json`, `./es-MX.json`, `zh-SG.json`, etc.). Note that output files can be lower-cased if you pass the ``--normalize-output-filenames`` option. You can override the languages specified in the `config` with the ``--languages`` flag. You can process specific keys by passing a comma-delimited list of keys.

## Usage
```
alt [options]

Options:
  -V, --version                        output the version number
  -r, --reference <path>               Path to reference JSONC file (default language)
  -p, --provider <name>                AI provider to use for translations (anthropic,
                                       openai)
  -o, --output-dir <path>              Output directory for localized files (default:
                                       "/home/jonl/dev/alt")
  -l, --languages <list>               Comma-separated list of language codes
  -k, --keys <list>                    Comma-separated list of keys to process
  -g, --reference-language <language>  The reference file's language (default: "en")
  -j, --reference-var-name <var name>  The exported variable in the reference file, e.g.
                                       export default = {...} you'd use 'default' (default:
                                       "default")
  -f, --force                          Force regeneration of all translations (default:
                                       false)
  -y, --tty                            Use tty/simple renderer; useful for CI (default:
                                       false)
  -c, --config <path>                  Path to config file; defaults to <output
                                       dir>/config.json (default: null)
  -x, --max-retries <integer>          Maximum retries on failure (default: 100)
  -e, --concurrent <integer>           Maximum # of concurrent tasks (default: 5)
  -n, --normalize-output-filenames     Normalizes output filenames (to all lower-case)
                                       (default: false)
  --context-prefix <value>             String to be prefixed to all keys to search for
                                       additional context, which are passed along to the AI
                                       for context (default: "")
  --context-suffix <value>             String to be suffixed to all keys to search for
                                       additional context, which are passed along to the AI
                                       for context (default: "")
  --look-for-context-data              If specified, ALT will pass any context data
                                       specified in the reference file to the AI provider
                                       for translation. At least one of --contextPrefix or
                                       --contextSuffix must be specified (default: false)
  -w, --write-on-quit                  Write files to disk only on quit (including SIGTERM);
                                       useful if running ALT causes your server to restart
                                       constantly (default: false)
  -v, --verbose                        Enables verbose spew (default: false)
  -d, --debug                          Enables debug spew (default: false)
  -t, --trace                          Enables trace spew (default: false)
  -h, --help                           display help for command
``` 

## Examples
### Example I
* Import from ``loc.js``
* Look for exported variable ``data``
* Translate with Claude
* Look for context keys starting with `_context:`
* Write to disk on quit or SIGTERM only
* Write output files to the current working directory
```bash
alt --reference loc.js
  --reference-var-name data
  --provider anthropic
  --look-for-context-data
  --context-prefix _context:
  --write-on-quit
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
alt --config ./localization-config.json
  --reference loc.js
  --output-dir localization
  --provider openai
  --look-for-context-data
  --context-suffix "[context]"
```
### Example III
* Overrides any config's languages
* Only process the specified strings
```bash
alt --config config.json
  --reference reference.js
  --output-dir localization
  --provider openai
  --look-for-context-data
  --context-suffix "[context]"
  --languages vi,aa
  --keys error-msg,title-hero,button-text-send
```

## Notes
- `--write-on-quit` is useful for writing on shutdown (including `SIGTERM`, so yes, you can `Ctrl+C` safely). This can be useful if your server is constantly reloading due to `ALT` writing localization files to disk.

## Next steps
- Add Google provider.
- No need to translate the reference language; just write it directly
- Rather than adding tasks for each lang/key, only add a key task if it actually needs to be updated; otherwise spew in verbose the 'No update needed'; it's too cluttered now with all this spew and feels unnecessary
- Add support for reference files in JSON format
- Less dumb backoff algorithm. Currently, any rate-limiting response from a provider will cause all Listr tasks to back off and then hammer again and see what sticks. Going for reduced code complexity here and I have higher priority tasks to work on at the moment. It's working well enough for my use case, but feel free to submit a PR if you can improve on it.
- Bug: If a user modifies a reference value, then runs and cancels, then runs again, any language/key values which would have been affected by the change will no longer be modified. The tool needs to detect these types of changes at a higher level than it is currently so that key/values can be deleted for all languages and written to disk, so that they're effectively missing and will have to be re-translated. The state that a reference value changed would be lost across runs of the tool, however, but at least the result would be a fix, with this approach.
- Tests :]

Feel free to submit a PR.

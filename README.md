```
 ▄▀▀█▄   ▄▀▀▀▀▄      ▄▀▀▀█▀▀▄ 
▐ ▄▀ ▀▄ █    █      █    █  ▐ 
  █▄▄▄█ ▐    █      ▐   █     
 ▄▀   █     █          █      
█   ▄▀    ▄▀▄▄▄▄▄▄▀  ▄▀       
▐   ▐     █         █         
          ▐         ▐        
```
# AI Localization Tool
* Generates and synchronizes your app's localization strings from a reference file, for all specified languages
* Reads a .js reference file for strings
* Localizes using AI as needed, writing to a .json file per language
* User-modifications to output files are safe
* Supports multiple AI providers: Claude, OpenAI

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
  "referenceLanguage": "en",
  "languages": [
	"en", "es-MX", "zh-SG"
  ]
}
```
``languages`` is optional and can be specified with ``--languages``
2. Create a reference file, e.g. ``reference.json``:
```javascript
export default {
    'error-msg': `Sorry, we don't know how to do anything`,
    'success-msg': `A massive achievement`,
}
```
You can specify an exported variable instead. See `--referenceVarName`.

3. Localize
```bash
ANTHROPIC_API_KEY=<secret> alt --reference reference.js --provider anthropic
```
or
```bash
OPENAI_API_KEY=<secret> alt --reference reference.js --provider openai
```
This will generate all tokens in `./reference.js` for all languages specified in `config.json`/``languages``, and output to `./en.json`, `./es-mx.json`, `zh-sg.json`.
Note that output files are all normalized to lower-case.

## Usage
```
alt [options]

Options:
  -V, --version                       output the version number
  -r, --reference <path>              Path to reference JSONC file (default language)
  -p, --provider <name>               AI provider to use for translations (anthropic, openai)
  -o, --output-dir <path>             Output directory for localized files (default:
                                      "/home/jonl/dev/lightwall/private/localization")
  -l, --languages <list>              Comma-separated list of language codes
  -k, --keys <list>                   Comma-separated list of keys to process
  -g, --referenceLanguage <language>  The reference file's language (default: "en")
  -j, --referenceVarName <var name>   The exported variable in the reference file, e.g. export default
                                      = {...} you'd use 'default' (default: "default")
  -f, --force                         Force regeneration of all translations (default: false)
  -y, --tty                           Use tty/simple renderer; useful for CI (default: false)
  -c, --config <path>                 Path to config file (default: null)
  -t, --maxRetries <integer>          Maximum retries on failure (default: 100)
  -e, --concurrent <integer>          Maximum # of concurrent tasks (default: 5)
  -n, --normalize                     Normalizes output filenames (to all lower-case) (default: false)
  --contextPrefix <value>             String to be prefixed to all keys to search for additional
                                      context, which are passed along to the AI for context (default:
                                      "")
  --contextSuffix <value>             String to be suffixed to all keys to search for additional
                                      context, which are passed along to the AI for context (default:
                                      "")
  --lookForContextData                If specified, ALT will pass any context data specified in the
                                      reference file to the AI provider for translation. At least one
                                      of --contextPrefix or --contextSuffix must be specified (default:
                                      false)
  --verbose                           Enables verbose spew (default: false)
  --debug                             Enables debug spew (default: false)
  --trace                             Enables trace spew (
```

## Next steps
1. This project could use hints, to be passed along with each token, if present, to give context for a given token.
2. Less dumb backoff algorithm.
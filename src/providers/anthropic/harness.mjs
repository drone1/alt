import { spawn } from 'child_process'
import * as os from 'os'

// Claude Code translation provider.
//
// Instead of going through Anthropic's HTTP API (which requires an API key),
// this provider shells out to the `claude` CLI in -p/--print mode. Auth comes
// from the existing Claude Code OAuth session, so no API key is needed. The
// trade-off is per-call cold-start latency (~1.5–2s of Node + settings load),
// which is why we batch many translations into one call.

export const requiresApiKey = false

export function name() {
	return 'Claude Code'
}

// claude CLI accepts both short aliases (haiku/sonnet/opus) and full model ids.
// Aliases keep the provider auto-updating to the latest model of each tier.
export async function listModels() {
	return [
		{ id: 'haiku', description: 'Latest Claude Haiku (fast, cheap; default for translation)' },
		{ id: 'sonnet', description: 'Latest Claude Sonnet (balanced)' },
		{ id: 'opus', description: 'Latest Claude Opus (most capable, slowest)' },
	]
}

// Spawn-time timeout per call. A 25-item batch runs in ~8–10s on haiku; pad
// generously so a sluggish API call doesn't kill us mid-batch.
//
// Overridable via ALT_HARNESS_TIMEOUT_MS — slow output scripts (km, my, am,
// ka, ti) emit many more output tokens per word and routinely brush 120s on
// 25-item batches.
const SPAWN_TIMEOUT_MS = (() => {
	const raw = process.env.ALT_HARNESS_TIMEOUT_MS
	const parsed = raw ? Number(raw) : NaN
	return Number.isFinite(parsed) && parsed > 0 ? parsed : 120 * 1000
})()

// Backoff hint passed back to the orchestrator when the CLI signals an overloaded
// or rate-limited state.
const DEFAULT_BACKOFF_MS = 30 * 1000

// Translate one batch of items. The orchestrator in translate.js handles the
// retry-on-partial-success and per-key fallback cascade — this function just
// does one round-trip.
//
// items: Array<{ key: string, text: string, context: string|null }>
//
// Returns: {
//   translations: { [key]: string },  // succeeded translations; may be partial
//   error: string|null,               // non-null on call-level failure
//   backoffInterval: number,          // ms to sleep before next attempt
//   hardFail: boolean,                // true => abort whole run (auth, quota)
//   cost: number,                     // USD billed by this call
// }
export async function translateBatch({ items, sourceLang, targetLang, model, appContextMessage, log }) {
	const result = { translations: {}, error: null, backoffInterval: 0, hardFail: false, cost: 0 }

	if (!items?.length) return result

	// Build the source-text map and matching JSON schema in lockstep so the
	// schema's required[] list is exactly the keys we sent.
	const sourceMap = {}
	const contextLines = []
	for (const item of items) {
		sourceMap[item.key] = item.text
		if (item.context) contextLines.push(`${item.key}: ${item.context}`)
	}
	const keys = Object.keys(sourceMap)

	const schema = {
		type: 'object',
		properties: Object.fromEntries(keys.map(k => [k, { type: 'string' }])),
		required: keys,
		additionalProperties: false,
	}

	// System prompt is stable across batches for the same lang pair — keeps
	// instruction set tight and benefits from any Anthropic prompt caching.
	const systemPromptParts = [
		`You are a professional translator. Translate each value in the input JSON object from ${sourceLang} to ${targetLang}.`,
		`Return a JSON object with the SAME keys as the input, where each value is the translated text.`,
		`Preserve formatting placeholders like %%var%%, {{var}}, %s, {0} EXACTLY as-is — do not translate them.`,
		`If a value is empty, contains only an emoji, contains only a placeholder, or is already in a non-Latin script, return it unchanged.`,
		`Do not add explanations, comments, or extra keys.`,
	]
	if (appContextMessage?.length) {
		systemPromptParts.push(`Application context: ${appContextMessage}`)
	}
	const systemPrompt = systemPromptParts.join(' ')

	const userPromptParts = [
		`Translate each value from ${sourceLang} to ${targetLang}.`,
		``,
		`Sources:`,
		JSON.stringify(sourceMap, null, 2),
	]
	if (contextLines.length) {
		userPromptParts.push(``, `Per-key context (use this to inform the translation; do not include in output):`, ...contextLines)
	}
	const userPrompt = userPromptParts.join('\n')

	const args = [
		'-p',
		'--output-format', 'json',
		'--model', model,
		'--no-session-persistence',
		'--tools', '',
		'--disable-slash-commands',
		'--setting-sources', 'project,local',
		'--json-schema', JSON.stringify(schema),
		'--system-prompt', systemPrompt,
		userPrompt,
	]

	// Strip CLAUDECODE / CLAUDE_CODE_* env vars from the child — when ALT is run
	// from inside a Claude Code session, those inherited vars confuse the child
	// and produce "Not logged in" even when auth is otherwise valid. Pass through
	// only what we need: HOME (auth file lookup), PATH, NVM_DIR, and the OAuth
	// token if it lives in env on this machine.
	const childEnv = {
		HOME: process.env.HOME,
		PATH: process.env.PATH,
	}
	if (process.env.NVM_DIR) childEnv.NVM_DIR = process.env.NVM_DIR
	if (process.env.CLAUDE_CODE_OAUTH_TOKEN) {
		childEnv.CLAUDE_CODE_OAUTH_TOKEN = process.env.CLAUDE_CODE_OAUTH_TOKEN
	}

	// cwd = tmpdir so claude doesn't auto-discover the consuming project's
	// CLAUDE.md (which would pollute the prompt and bias translations).
	const spawnOptions = {
		env: childEnv,
		cwd: os.tmpdir(),
		stdio: ['ignore', 'pipe', 'pipe'],
	}

	let stdout = ''
	let stderr = ''
	let exitCode = null
	let timedOut = false
	const startedAtMs = Date.now()

	try {
		await new Promise((resolve, reject) => {
			const child = spawn('claude', args, spawnOptions)
			const timer = setTimeout(() => {
				timedOut = true
				try { child.kill('SIGTERM') } catch {}
				setTimeout(() => { try { child.kill('SIGKILL') } catch {} }, 2000)
			}, SPAWN_TIMEOUT_MS)
			child.stdout.on('data', d => stdout += d)
			child.stderr.on('data', d => stderr += d)
			child.on('error', err => { clearTimeout(timer); reject(err) })
			child.on('exit', code => { clearTimeout(timer); exitCode = code; resolve() })
		})
	} catch (err) {
		result.error = `claude spawn failed: ${err.message}`
		log.W(result.error)
		return result
	}

	const elapsedMs = Date.now() - startedAtMs

	// Failure-path diagnostics: always surface stderr (or its absence), stdout
	// shape, and wall-clock elapsed time. Without these, "claude call timed out"
	// and "claude exited with code 1" are unactionable — the operator can't tell
	// whether the CLI hung in auth, mid-stream, on a network call, or never
	// printed anything at all.
	const dumpFailureDiagnostics = (label) => {
		const stderrTrimmed = stderr?.trim() || ''
		const stderrPart = stderrTrimmed.length
			? `stderr (${stderrTrimmed.length} bytes): ${stderrTrimmed.slice(0, 800)}`
			: 'stderr: <empty>'
		const stdoutTrimmed = stdout?.trim() || ''
		const stdoutPart = stdoutTrimmed.length
			? `stdout head: ${stdoutTrimmed.slice(0, 200)}`
			: 'stdout: <empty>'
		log.W(`${label} — elapsed=${elapsedMs}ms, ${stderrPart}, ${stdoutPart}`)
	}

	if (timedOut) {
		result.error = `claude call timed out after ${SPAWN_TIMEOUT_MS / 1000}s`
		dumpFailureDiagnostics(result.error)
		return result
	}

	if (exitCode !== 0) {
		result.error = `claude exited with code ${exitCode}`
		dumpFailureDiagnostics(result.error)
		// "Not logged in" on a fresh box is a hard failure — retrying won't help.
		if (/not logged in/i.test(stderr) || /unauthor/i.test(stderr)) {
			result.hardFail = true
			result.error = `Claude Code is not authenticated on this machine. Run \`claude\` interactively once to log in, then retry.`
		}
		return result
	}

	let parsed
	try {
		parsed = JSON.parse(stdout)
	} catch (err) {
		result.error = `failed to parse claude JSON output: ${err.message}`
		log.W(`stdout head: ${stdout.slice(0, 200)}`)
		return result
	}

	if (typeof parsed.total_cost_usd === 'number') result.cost = parsed.total_cost_usd

	if (parsed.is_error) {
		const subtype = parsed.subtype || 'unknown'
		// Subscription quota / usage limits are a hard fail — back off the whole
		// run and tell the user to switch provider.
		if (/usage|limit|quota/i.test(subtype) || /usage|limit|quota/i.test(parsed.result || '')) {
			result.hardFail = true
			result.error = `Claude Code subscription limit hit (subtype=${subtype}). Fall back to --provider anthropic with an API key for bulk work.`
			return result
		}
		// Other transient errors — let the orchestrator retry.
		result.error = `claude returned is_error=true (subtype=${subtype})`
		if (parsed.result) log.W(`claude error message: ${parsed.result.slice(0, 300)}`)
		result.backoffInterval = DEFAULT_BACKOFF_MS
		return result
	}

	// Schema mode puts the structured response in `structured_output`, not `result`.
	// `result` in that mode is a natural-language confirmation message.
	const structured = parsed.structured_output
	if (!structured || typeof structured !== 'object') {
		result.error = `claude response missing structured_output (schema enforcement failed)`
		log.W(`response shape: ${Object.keys(parsed).join(',')}`)
		return result
	}

	// Pull out per-key translations. Empty / whitespace results are filtered so
	// the orchestrator can mark them as failed and retry.
	for (const key of keys) {
		const v = structured[key]
		if (typeof v === 'string' && v.trim().length > 0) {
			result.translations[key] = v
		}
	}

	return result
}

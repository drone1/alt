export function assert(b, msg) {
	if (!b) {
		debugger
		throw new Error(msg || `Assertion failed`)
	}
}

export function assertIsNonEmptyString(s, msg) {
	assert(s?.length, msg || `parameter was not a non-empty string`)
}

export function assertValidPath(path, msg) {
	assertIsNonEmptyString(path, msg || `parameter was not a valid path`)
}

export function assertIsObj(x, msg) {
	assert(typeof x === 'object', msg || `parameter was not an object`)
}


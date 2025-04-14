export function createLog() {
	return {
		// T/D/V blackholed until program options are parsed
		T: () => { },
		D: () => { },
		V: () => { },

		E: function(...args) {
			console.error(...args)
		},
		W: function(...args) {
			console.warn(...args)
		},
		I: function(...args) {
			console.log(...args)
		},
	}
}

export function initLogFromOptions({ options, log }) {
	// Init optional logging functions
	log.V = (options.trace || options.debug || options.verbose) ? function(...args) {
		console.log(...args)
	} : () => {
	}
	log.D = (options.trace || options.debug) ? function(...args) {
		console.debug(...args)
	} : () => {
	}
	log.T = options.trace ? function(...args) {
		console.debug(...args)
	} : () => {
	}
}


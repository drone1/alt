import { expect } from 'chai'
import { extractPlaceholders, validateTranslation } from '../src/lib/translation-validation.js'

describe('translation validation', () => {
	it('extracts and sorts supported placeholders', () => {
		expect(extractPlaceholders('Hi %%name%%, {{count}} {0} %s')).to.deep.equal([
			'%%name%%',
			'%s',
			'{{count}}',
			'{0}',
		].sort())
	})

	it('accepts a normal translation with preserved placeholders', () => {
		const result = validateTranslation({
			source: 'Failed to load %%count%% tracks',
			translated: 'Impossible de charger %%count%% pistes',
		})
		expect(result.valid).to.equal(true)
	})

	it('rejects missing, duplicated, and translated placeholders', () => {
		for (const translated of [
			'Impossible de charger les pistes',
			'Impossible %%count%% %%count%%',
			'Impossible de charger %%nombre%% pistes',
		]) {
			expect(validateTranslation({ source: 'Failed %%count%%', translated }).valid).to.equal(false)
		}
	})

	it('rejects model refusals and commentary', () => {
		for (const translated of [
			'I cannot provide an accurate translation without a native speaker.',
			'Texte traduit\n\nNote: this term is normally kept in English.',
			'AI: Human, here is your translation.',
		]) {
			expect(validateTranslation({ source: 'Account', translated }).valid).to.equal(false)
		}
	})

	it('rejects implausibly long output', () => {
		const translated = 'x'.repeat(501)
		expect(validateTranslation({ source: 'Copy', translated }).valid).to.equal(false)
	})
})

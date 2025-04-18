import { execa } from 'execa'
import { expect } from 'chai'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { dirname } from 'path'
import crypto from 'crypto'
import { SRC_DATA_DIR, cleanupFile, cleanupCacheFile } from './common.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

describe('translate command', () => {
	it('should translate content to a target language', async function() {
		this.timeout(10000) // Set timeout to 10s as translation might take time

		// Generate a random ID for the reference file
		const randomId = crypto.randomBytes(4).toString('hex')
		const refFileName = `ref-${randomId}.js`
		const refFilePath = path.join(SRC_DATA_DIR, refFileName)

		try {
			// Copy the reference file
			const originalRefPath = path.join(SRC_DATA_DIR, 'reference.js')
			fs.copyFileSync(originalRefPath, refFilePath)

			expect(fs.existsSync(refFilePath)).to.be.true

			// Run the translation command
			const result = await execa('node', [
				path.resolve(__dirname, '../alt.mjs'),
				'translate',
				'-r',
				refFilePath,
				'-p',
				'anthropic',
				'-rl',
				'en',
				'-tl',
				'fr-FR',
				'-k',
				'msg-test',
				'-d'
			], {
				cwd: 'test'
			})

			// Check command executed successfully
			expect(result.exitCode).to.equal(0)

			// Check output file was created
			const outputPath = path.join(SRC_DATA_DIR, 'fr-FR.json')
			expect(
				fs.existsSync(outputPath),
				`${outputPath} didn't exist`
			).to.be.true

			// Verify the translation file contents
			const outputContent = JSON.parse(fs.readFileSync(outputPath, 'utf8'))
			expect(outputContent).to.have.property('msg-test')
			expect(outputContent['msg-test']).to.be.a('string')
			expect(outputContent['msg-test'].length).to.be.greaterThan(0)

			// Clean up output file
			cleanupFile(outputPath)
		} finally {
			// Clean up reference file
			cleanupFile(refFilePath)
			cleanupCacheFile(SRC_DATA_DIR)
		}
	})

	it('should handle multiple target languages', async function() {
		this.timeout(15000) // Higher timeout for multiple translations

		// Generate a random ID for the reference file
		const randomId = crypto.randomBytes(4).toString('hex')
		const refFileName = `ref-${randomId}.js`
		const refFilePath = path.join(SRC_DATA_DIR, refFileName)

		try {
			// Copy the reference file
			const originalRefPath = path.join(SRC_DATA_DIR, 'reference.js')
			fs.copyFileSync(originalRefPath, refFilePath)

			// Run the translation command with multiple languages
			const result = await execa('node', [
				path.resolve(__dirname, '../alt.mjs'),
				'translate',
				'-p',
				'anthropic',
				'-r',
				refFilePath,
				'-rl',
				'en',
				'-tl',
				'fr-FR,es-ES',
				'-k',
				'msg-test'
			], {
				cwd: 'test'
			})

			console.log(result.command)


			// Check command executed successfully
			expect(result.exitCode).to.equal(0)

			// Check output files were created
			const frOutputPath = path.join(SRC_DATA_DIR, 'fr-FR.json')
			const esOutputPath = path.join(SRC_DATA_DIR, 'es-ES.json')

			expect(fs.existsSync(frOutputPath)).to.be.true
			expect(fs.existsSync(esOutputPath)).to.be.true

			// Clean up output files
			cleanupFile(frOutputPath)
			cleanupFile(esOutputPath)
		} finally {
			// Clean up reference file
			cleanupFile(refFilePath)
			cleanupCacheFile(SRC_DATA_DIR)
		}
	})
})

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

describe('prune command', () => {
	it('should remove obsolete keys from target files', async function() {
		this.timeout(10000)

		// Generate a random ID for the reference file
		const randomId = crypto.randomBytes(4).toString('hex')
		const refFileName = `ref-${randomId}.json`
		const refFilePath = path.join(SRC_DATA_DIR, refFileName)

		try {
			// Create a reference file with only 2 keys
			const referenceData = {
				'msg-test': 'Nothing to do',
				'error-finished': 'Finished with %%errorsEncountered%% error%%s%%'
			}
			fs.writeFileSync(refFilePath, JSON.stringify(referenceData, null, 2), 'utf8')

			// Create a target file with 3 keys (one obsolete)
			const targetFilePath = path.join(SRC_DATA_DIR, 'fr-FR.json')
			const targetData = {
				'msg-test': 'Rien à faire',
				'error-finished': 'Terminé avec %%errorsEncountered%% erreur%%s%%',
				'obsolete-key': 'This should be removed'
			}
			fs.writeFileSync(targetFilePath, JSON.stringify(targetData, null, 2), 'utf8')

			// Run the prune command
			const result = await execa('node', [
				path.resolve(__dirname, '../alt.mjs'),
				'prune',
				'-r',
				refFilePath,
				'-tl',
				'fr-FR',
				'-d'
			], {
				cwd: 'test'
			})

			// Check command executed successfully
			expect(result.exitCode).to.equal(0)

			// Verify the target file was pruned
			const prunedContent = JSON.parse(fs.readFileSync(targetFilePath, 'utf8'))
			expect(prunedContent).to.have.property('msg-test')
			expect(prunedContent).to.have.property('error-finished')
			expect(prunedContent).to.not.have.property('obsolete-key')

			// Clean up
			cleanupFile(targetFilePath)
		} finally {
			cleanupFile(refFilePath)
		}
	})

	it('should handle multiple target languages', async function() {
		this.timeout(10000)

		const randomId = crypto.randomBytes(4).toString('hex')
		const refFileName = `ref-${randomId}.json`
		const refFilePath = path.join(SRC_DATA_DIR, refFileName)

		try {
			// Create reference file
			const referenceData = {
				'msg-test': 'Nothing to do'
			}
			fs.writeFileSync(refFilePath, JSON.stringify(referenceData, null, 2), 'utf8')

			// Create multiple target files with obsolete keys
			const frFilePath = path.join(SRC_DATA_DIR, 'fr-FR.json')
			const esFilePath = path.join(SRC_DATA_DIR, 'es-ES.json')

			const frData = {
				'msg-test': 'Rien à faire',
				'obsolete-fr': 'Obsolete French key'
			}
			const esData = {
				'msg-test': 'Nada que hacer',
				'obsolete-es': 'Obsolete Spanish key'
			}

			fs.writeFileSync(frFilePath, JSON.stringify(frData, null, 2), 'utf8')
			fs.writeFileSync(esFilePath, JSON.stringify(esData, null, 2), 'utf8')

			// Run the prune command
			const result = await execa('node', [
				path.resolve(__dirname, '../alt.mjs'),
				'prune',
				'-r',
				refFilePath,
				'-tl',
				'fr-FR,es-ES'
			], {
				cwd: 'test'
			})

			// Check command executed successfully
			expect(result.exitCode).to.equal(0)

			// Verify both files were pruned
			const prunedFrContent = JSON.parse(fs.readFileSync(frFilePath, 'utf8'))
			const prunedEsContent = JSON.parse(fs.readFileSync(esFilePath, 'utf8'))

			expect(prunedFrContent).to.have.property('msg-test')
			expect(prunedFrContent).to.not.have.property('obsolete-fr')

			expect(prunedEsContent).to.have.property('msg-test')
			expect(prunedEsContent).to.not.have.property('obsolete-es')

			// Clean up
			cleanupFile(frFilePath)
			cleanupFile(esFilePath)
		} finally {
			cleanupFile(refFilePath)
		}
	})

	it('should support dry-run mode without modifying files', async function() {
		this.timeout(10000)

		const randomId = crypto.randomBytes(4).toString('hex')
		const refFileName = `ref-${randomId}.json`
		const refFilePath = path.join(SRC_DATA_DIR, refFileName)

		try {
			// Create reference file with 1 key
			const referenceData = {
				'msg-test': 'Nothing to do'
			}
			fs.writeFileSync(refFilePath, JSON.stringify(referenceData, null, 2), 'utf8')

			// Create target file with 2 keys (one obsolete)
			const targetFilePath = path.join(SRC_DATA_DIR, 'fr-FR.json')
			const targetData = {
				'msg-test': 'Rien à faire',
				'obsolete-key': 'This should NOT be removed in dry-run'
			}
			fs.writeFileSync(targetFilePath, JSON.stringify(targetData, null, 2), 'utf8')

			// Run the prune command with --dry-run
			const result = await execa('node', [
				path.resolve(__dirname, '../alt.mjs'),
				'prune',
				'-r',
				refFilePath,
				'-tl',
				'fr-FR',
				'--dry-run'
			], {
				cwd: 'test'
			})

			// Check command executed successfully
			expect(result.exitCode).to.equal(0)

			// Verify the target file was NOT modified
			const unchangedContent = JSON.parse(fs.readFileSync(targetFilePath, 'utf8'))
			expect(unchangedContent).to.have.property('msg-test')
			expect(unchangedContent).to.have.property('obsolete-key', 'This should NOT be removed in dry-run')

			// Clean up
			cleanupFile(targetFilePath)
		} finally {
			cleanupFile(refFilePath)
		}
	})

	it('should handle non-existent target files gracefully', async function() {
		this.timeout(10000)

		const randomId = crypto.randomBytes(4).toString('hex')
		const refFileName = `ref-${randomId}.json`
		const refFilePath = path.join(SRC_DATA_DIR, refFileName)

		try {
			// Create reference file
			const referenceData = {
				'msg-test': 'Nothing to do'
			}
			fs.writeFileSync(refFilePath, JSON.stringify(referenceData, null, 2), 'utf8')

			// Don't create any target files

			// Run the prune command
			const result = await execa('node', [
				path.resolve(__dirname, '../alt.mjs'),
				'prune',
				'-r',
				refFilePath,
				'-tl',
				'fr-FR'
			], {
				cwd: 'test'
			})

			// Check command executed successfully
			expect(result.exitCode).to.equal(0)
		} finally {
			cleanupFile(refFilePath)
		}
	})

	it('should keep all keys when no obsolete keys exist', async function() {
		this.timeout(10000)

		const randomId = crypto.randomBytes(4).toString('hex')
		const refFileName = `ref-${randomId}.json`
		const refFilePath = path.join(SRC_DATA_DIR, refFileName)

		try {
			// Create reference file with 2 keys
			const referenceData = {
				'msg-test': 'Nothing to do',
				'error-finished': 'Finished with %%errorsEncountered%% error%%s%%'
			}
			fs.writeFileSync(refFilePath, JSON.stringify(referenceData, null, 2), 'utf8')

			// Create target file with same keys (no obsolete keys)
			const targetFilePath = path.join(SRC_DATA_DIR, 'fr-FR.json')
			const targetData = {
				'msg-test': 'Rien à faire',
				'error-finished': 'Terminé avec %%errorsEncountered%% erreur%%s%%'
			}
			fs.writeFileSync(targetFilePath, JSON.stringify(targetData, null, 2), 'utf8')

			// Run the prune command
			const result = await execa('node', [
				path.resolve(__dirname, '../alt.mjs'),
				'prune',
				'-r',
				refFilePath,
				'-tl',
				'fr-FR'
			], {
				cwd: 'test'
			})

			// Check command executed successfully
			expect(result.exitCode).to.equal(0)

			// Verify all keys are still present
			const unchangedContent = JSON.parse(fs.readFileSync(targetFilePath, 'utf8'))
			expect(unchangedContent).to.have.property('msg-test')
			expect(unchangedContent).to.have.property('error-finished')
			expect(Object.keys(unchangedContent).length).to.equal(2)

			// Clean up
			cleanupFile(targetFilePath)
		} finally {
			cleanupFile(refFilePath)
		}
	})

	it('should work with .js reference files', async function() {
		this.timeout(10000)

		const randomId = crypto.randomBytes(4).toString('hex')
		const refFileName = `ref-${randomId}.js`
		const refFilePath = path.join(SRC_DATA_DIR, refFileName)

		try {
			// Create a .js reference file
			const refContent = `export default {
	'msg-test': 'Nothing to do',
	'error-finished': 'Finished with errors'
}`
			fs.writeFileSync(refFilePath, refContent, 'utf8')

			// Create target file with an obsolete key
			const targetFilePath = path.join(SRC_DATA_DIR, 'fr-FR.json')
			const targetData = {
				'msg-test': 'Rien à faire',
				'error-finished': 'Terminé avec erreurs',
				'obsolete-key': 'Should be removed'
			}
			fs.writeFileSync(targetFilePath, JSON.stringify(targetData, null, 2), 'utf8')

			// Run the prune command
			const result = await execa('node', [
				path.resolve(__dirname, '../alt.mjs'),
				'prune',
				'-r',
				refFilePath,
				'-tl',
				'fr-FR',
				'-R',
				'default'
			], {
				cwd: 'test'
			})

			// Check command executed successfully
			expect(result.exitCode).to.equal(0)

			// Verify the obsolete key was removed
			const prunedContent = JSON.parse(fs.readFileSync(targetFilePath, 'utf8'))
			expect(prunedContent).to.have.property('msg-test')
			expect(prunedContent).to.have.property('error-finished')
			expect(prunedContent).to.not.have.property('obsolete-key')

			// Clean up
			cleanupFile(targetFilePath)
		} finally {
			cleanupFile(refFilePath)
		}
	})
})

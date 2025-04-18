import { expect } from 'chai'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { dirname } from 'path'
import { execa } from 'execa'
import { cleanupCacheFile, cleanupDir, cleanupFile, ensureDir, SRC_DATA_DIR } from './common.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const TEST_CONFIG_DIR = path.join(__dirname, 'test-config')

describe('config functionality', () => {
  before(() => {
    // Create test directory if it doesn't exist
    ensureDir(TEST_CONFIG_DIR)
  })

  afterEach(() => {
    // Clean up test config file after each test
    const configPath = path.join(TEST_CONFIG_DIR, 'config.json')
    cleanupFile(configPath)
  })

  after(() => {
    cleanupDir(TEST_CONFIG_DIR)
    cleanupCacheFile(SRC_DATA_DIR)
  })

  it('should use custom config file when specified', async function() {
    this.timeout(5000)

    // Create a custom config file
    const configPath = path.join(TEST_CONFIG_DIR, 'config.json')
    const configContent = {
      provider: 'anthropic',
      targetLanguages: [
        'fr-FR',
        'es-ES'
      ],
      lookForContextData: true,
      contextPrefix: 'TEST_PREFIX',
      contextSuffix: 'TEST_SUFFIX',
      referenceLanguage: 'en',
      normalizeOutputFilenames: true
    }

    fs.writeFileSync(configPath, JSON.stringify(configContent, null, 2))

    // Create a simple reference file for testing
    const refPath = path.join(TEST_CONFIG_DIR, 'reference.js')
    fs.writeFileSync(refPath, 'export default { "test-key": "This is a test" }')

    try {
      // Run the CLI with the custom config
      const result = await execa('node', [
        path.resolve(__dirname, '../alt.mjs'),
        'translate',
        '-r',
        refPath,
        '--config-file',
        configPath,
        '--debug'
      ])

      // Command should succeed
      expect(result.exitCode).to.equal(0)

      // Output should include info from our config
      expect(result.stdout).to.include('anthropic')
      expect(result.stdout).to.include('fr-FR')
      expect(result.stdout).to.include('es-ES')
    } finally {
      // Clean up reference file
      cleanupFile(refPath)
    }
  })
})

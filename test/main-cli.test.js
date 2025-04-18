import { execa } from 'execa'
import { expect } from 'chai'
import { fileURLToPath } from 'url'
import { dirname } from 'path'
import { cleanupCacheFile, SRC_DATA_DIR } from './common.mjs'
import path from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

describe('main CLI functionality', () => {
  after(() => cleanupCacheFile(SRC_DATA_DIR))

  it('should display help information', async () => {
    // Run the help command
    const result = await execa('node', [
      path.resolve(__dirname, '../alt.mjs'),
      '--help'
    ])

    // Check the command executed successfully
    expect(result.exitCode).to.equal(0)

    // Output should contain expected help information
    expect(result.stdout).to.include('Usage:')
    expect(result.stdout).to.include('Options:')
    expect(result.stdout).to.include('Commands:')
    expect(result.stdout).to.include('Environment variables:')
  })

  it('should display version information', async () => {
    // Run the version command
    const result = await execa('node', [
      path.resolve(__dirname, '../alt.mjs'),
      '--version'
    ])

    // Check the command executed successfully
    expect(result.exitCode).to.equal(0)

    // Output should contain version number
    expect(result.stdout).to.match(/\d+\.\d+\.\d+/)
  })

  it('should display command-specific help', async () => {
    // Run the help command for translate
    const result = await execa('node', [
      path.resolve(__dirname, '../alt.mjs'),
      'help',
      'translate'
    ])

    // Check the command executed successfully
    expect(result.exitCode).to.equal(0)

    // Output should contain expected help information for translate command
    expect(result.stdout).to.include('Usage: alt translate')
    expect(result.stdout).to.include('-r, --reference-file')
    expect(result.stdout).to.include('-tl, --target-languages')
  })

  it('should return error for missing required options', async () => {
    try {
      // Run translate command without required options
      await execa('node', [
        path.resolve(__dirname, '../alt.mjs'),
        'translate'
      ])
      // Should not reach here as the command should fail
      expect.fail('Command should have failed with missing required options')
    } catch (error) {
      // Check that the command failed
      expect(error.exitCode).to.not.equal(0)

      // Error should mention missing required option
      expect(error.stderr).to.include('required option')
    }
  })
})

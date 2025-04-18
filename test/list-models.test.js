import { execa } from 'execa'
import { expect } from 'chai'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { dirname } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

describe('list-models command', () => {
  it('should display models from a specific provider when specified', async () => {
    // Run with specific provider (using anthropic as example)
    const result = await execa('node', [
      path.resolve(__dirname, '../alt.mjs'),
      'list-models',
      '-p',
      'anthropic'
    ])

    // Check the command executed successfully
    expect(result.exitCode).to.equal(0)

    // Output should include provider-specific information
    expect(result.stdout).to.include('Available models')
  })
})

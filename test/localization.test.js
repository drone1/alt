import { expect } from 'chai'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { dirname } from 'path'
import { isBcp47LanguageTagValid, isDefaultLanguage, initLocalizer } from '../src/localizer/localize.js'
import { LANGTAG_DEFAULT } from '../src/lib/consts.js'
import { ensureDir, cleanupDir } from './common.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const TEST_LOCALIZATION_DIR = path.join(__dirname, 'test-localization')

describe('localization functionality', () => {
  before(() => {
    // Create test directory if it doesn't exist
    ensureDir(TEST_LOCALIZATION_DIR)

    // Create a simple English localization file
    const enContent = {
      "test_key": "This is a test",
      "hello_world": "Hello, World!",
      "formatted_string": "Hello, %%name%%!"
    }
    fs.writeFileSync(path.join(TEST_LOCALIZATION_DIR, 'en.json'), JSON.stringify(enContent, null, 2))

    // Create a simple French localization file
    const frContent = {
      "test_key": "C'est un test",
      "hello_world": "Bonjour, Monde!",
      "formatted_string": "Bonjour, %%name%%!"
    }
    fs.writeFileSync(path.join(TEST_LOCALIZATION_DIR, 'fr-FR.json'), JSON.stringify(frContent, null, 2))
  })

  after(() => {
    cleanupDir(TEST_LOCALIZATION_DIR)
  })

  describe('isBcp47LanguageTagValid', () => {
    it('should validate valid BCP47 language tags', () => {
      expect(isBcp47LanguageTagValid('en')).to.be.an('object')
      expect(isBcp47LanguageTagValid('fr-FR')).to.be.an('object')
      expect(isBcp47LanguageTagValid('de-DE')).to.be.an('object')
      expect(isBcp47LanguageTagValid('zh-Hans')).to.be.an('object')
    })

    it('should reject invalid BCP47 language tags', () => {
      expect(isBcp47LanguageTagValid('not-a-language')).to.be.undefined
      expect(isBcp47LanguageTagValid('xx-XX')).to.be.undefined
      expect(isBcp47LanguageTagValid('')).to.be.undefined
    })
  })

  describe('isDefaultLanguage', () => {
    it('should identify the default language', () => {
      expect(isDefaultLanguage(LANGTAG_DEFAULT)).to.be.true
    })

    it('should reject non-default languages', () => {
      expect(isDefaultLanguage('fr-FR')).to.be.false
      expect(isDefaultLanguage('es-ES')).to.be.false
    })
  })

  describe('initLocalizer', () => {
    it('should initialize with the default language', async () => {
      const mockLog = {
        D: () => {},
        W: () => {},
        E: () => {},
        I: () => {},
        V: () => {}
      }

      const lang = await initLocalizer({
        defaultAppLanguage: 'en',
        appLanguage: null,
        srcDir: TEST_LOCALIZATION_DIR,
        log: mockLog
      })

      expect(lang).to.equal('en')
    })

    it('should initialize with a specified language', async () => {
      const mockLog = {
        D: () => {},
        W: () => {},
        E: () => {},
        I: () => {},
        V: () => {}
      }

      const lang = await initLocalizer({
        defaultAppLanguage: 'en',
        appLanguage: 'fr-FR',
        srcDir: TEST_LOCALIZATION_DIR,
        log: mockLog
      })

      expect(lang).to.equal('fr-FR')
    })

    it('should fall back to default language when invalid language specified', async () => {
      const mockLog = {
        D: () => {},
        W: () => {},
        E: () => {},
        I: () => {},
        V: () => {}
      }

      const lang = await initLocalizer({
        defaultAppLanguage: 'en',
        appLanguage: 'invalid-language',
        srcDir: TEST_LOCALIZATION_DIR,
        log: mockLog
      })

      expect(lang).to.equal('en')
    })
  })
})

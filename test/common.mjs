import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { DEFAULT_CACHE_FILENAME } from '../src/lib/consts.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
export const SRC_DATA_DIR = path.join(__dirname, 'fixtures')

export function cleanupCacheFile(dir) {
	cleanupFile(path.resolve(dir, DEFAULT_CACHE_FILENAME))
}

export function ensureDir(dir) {
	if (fs.existsSync(dir)) return
	fs.mkdirSync(dir, { recursive: true })
}

export function cleanupFile(file) {
	if (!fs.existsSync(file)) return
	fs.unlinkSync(file)
}

export function cleanupDir(dir) {
	if (!fs.existsSync(dir)) return
	fs.rmdirSync(dir, { recursive: true })
}



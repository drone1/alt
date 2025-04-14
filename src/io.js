import * as os from 'os'
import * as fs from 'fs'
import * as fsp from 'fs/promises'
import * as path from 'path'
import stripJsonComments from 'strip-json-comments'
import { ensureExtension, normalizeKey } from './utils.js'
import { assertIsObj, assertValidPath } from './assert.js'
import { pathToFileURL } from 'url'
import { CWD } from './consts.js'

export async function mkTmpDir() {
	return await fsp.mkdtemp(path.join(os.tmpdir(), 'alt-'))
}

export function parseJson(s) {
	try {
		return JSON.parse(s)
	} catch (e) {
		return null
	}
}

export async function readFileAsText(filePath) {
	try {
		return await fsp.readFile(filePath, 'utf8')
	} catch (error) {
		if (error.code === 'ENOENT') {
			return null
		}
		throw error
	}
}

export async function readJsonFile(filePath, isJSONComments = false) {
	let content = await readFileAsText(filePath)
	if (isJSONComments) content = stripJsonComments.stripJsonComments(content)
	return parseJson(content)
}

export async function fileExists(path) {
	try {
		await fsp.access(path)
		return true
	} catch {
		return false
	}
}

export function rmDir(dir, log) {
	try {
		fs.rmSync(dir, { recursive: true, force: true })
		log.D(`Removed dir ${dir}`)
	} catch (error) {
		log.E(`Error cleaning up temp directory "${dir}": ${error.message}`)
		throw error
	}
}

// This is basically so that we can dynamically import .js files by copying them to temp .mjs files, to avoid errors from node
export async function copyFileToTempAndEnsureExtension({ filePath, tmpDir, ext }) {
	try {
		const fileName = ensureExtension(path.basename(filePath), ext)
		const destPath = path.join(tmpDir, fileName)
		await fsp.copyFile(filePath, destPath)
		return destPath
	} catch (error) {
		log.E(`Error copying file to temp directory: ${error.message}`)
		throw error
	}
}

// Dynamically imports the javascript file at filePath, which can be relative or absolute
export async function importJsFile(filePath) {
	if (!path.isAbsolute(filePath)) {
		filePath = path.resolve(CWD, filePath)
	}
	// Convert the file path to a proper URL
	const fileUrl = pathToFileURL(filePath)
	return await import(fileUrl)
}

export function normalizeOutputPath({ dir, filename, normalize }) {
	return path.join(dir, normalize ? filename.toLowerCase() : filename)
}

export function writeJsonFile(filePath, data, log) {
	assertValidPath(filePath)
	assertIsObj(data)
	log.V(`Preparing to write ${filePath}...`)

	// Create normalized version of data with consistent key encoding
	log.D(`Normalizing data...`)
	const normalizedData = {}
	for (const [ key, value ] of Object.entries(data)) {
		normalizedData[normalizeKey(key)] = value
	}
	log.D(`Done.`)

	try {
		const dir = path.dirname(filePath)
		log.D(`Ensuring directory ${dir} exists...`)
		if (!dirExists(dir, log)) {
			log.D(`Directory ${dir} did not exist; creating...`)
			fs.mkdirSync(dir, { recursive: true })
		}
		log.D(`Done.`)
	} catch (err) {
		log.E(err)
	}

	log.V(`Writing ${filePath}...`)
	try {
		fs.writeFileSync(filePath, JSON.stringify(normalizedData, null, 2), 'utf8')
	} catch (err) {
		log.E(err)
	}
	log.D(`Done.`)
}

export function dirExists(dir, log) {
	try {
		log.D(`fetching stats for ${dir}...`)
		return fs.statSync(dir).isDirectory()
	} catch (error) {
		log.E(error)
		return false
	}
}


import figlet from 'figlet'
import gradient from 'gradient-string'
import * as path from 'path'
import * as fsp from 'fs/promises'

export async function printLogo({ fontsSrcDir, tagline, log }) {
	const fontName = 'THIS.flf'
	const fontPath = path.resolve(fontsSrcDir, fontName)
	const fontData = await fsp.readFile(fontPath, 'utf8')
	figlet.parseFont(fontName, fontData)
	const asciiTitle = figlet.textSync('ALT', {
		font: fontName,
		horizontalLayout: 'full',
		verticalLayout: 'default',
	})

	log.I(`\n${gradient([
		'#000FFF',
		'#ed00b1'
	])(asciiTitle)}\n`)
}


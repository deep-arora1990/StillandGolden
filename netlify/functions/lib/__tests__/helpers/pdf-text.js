// Records every drawText call made while a PDF renders, so tests can check
// what the agreement PDF says and where, without parsing the PDF bytes.
// Spies on the CommonJS pdf-lib (the one agreement-pdf.js requires); the ESM
// build is a different class and would see nothing.
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

export async function drawnText(render) {
  const { PDFPage, PDFDocument } = require('pdf-lib')
  const original = PDFPage.prototype.drawText
  const calls = []
  PDFPage.prototype.drawText = function (text, options = {}) {
    calls.push({ text, x: options.x, y: options.y, size: options.size })
    return original.call(this, text, options)
  }
  let bytes
  try {
    bytes = await render()
  } finally {
    PDFPage.prototype.drawText = original
  }
  const pages = (await PDFDocument.load(bytes)).getPageCount()
  return { calls, pages }
}

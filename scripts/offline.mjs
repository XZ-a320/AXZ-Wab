/* ==========================================================================
   Two small tools for the 1.0 offline edition, with no dependencies.

   inlineModules: a browser will not load an ES module file from file://, so
   a page opened from disk cannot run the 1.0 engine as it ships online. The
   engine's modules only ever use named imports from sibling files, `import *
   as`, and `export` on declarations or in a list, so each module becomes a
   function scope that returns its exports, in dependency order. Anything
   outside those forms stops the build rather than shipping a broken page.

   zip: a deterministic archive (fixed timestamps, deflate), so an unchanged
   engine produces byte-identical output and the page's stated size holds.
   ========================================================================== */
import { deflateRawSync, crc32 } from 'node:zlib'

const IMPORT_NAMED = /^import\s*\{([^}]*)\}\s*from\s*'\.\/([\w-]+)\.js'\s*;?[ \t]*$/gm
const IMPORT_STAR = /^import\s*\*\s*as\s+(\w+)\s+from\s*'\.\/([\w-]+)\.js'\s*;?[ \t]*$/gm
const EXPORT_DECL = /^export\s+((?:async\s+)?function\s*\*?|class|const|let|var)\s+([\w$]+)/gm
const EXPORT_LIST = /^export\s*\{([^}]*)\}\s*;?[ \t]*$/gm

/**
 * @param {Array<[string, string]>} modules [name, source] pairs, dependencies first
 * @param {string} entry name of the module whose exports are returned
 * @returns {string} one expression evaluating to the entry module's exports
 */
export function inlineModules(modules, entry) {
  const done = new Set()
  const out = []
  for (const [name, src] of modules) {
    const exported = []
    let body = src
      .replace(IMPORT_NAMED, (_, list, from) => {
        if (!done.has(from)) throw new Error(`${name}.js imports ${from}.js before it is defined`)
        const names = list.split(',').map(s => s.trim()).filter(Boolean)
          .map(s => { const [a, b] = s.split(/\s+as\s+/); return b ? `${a}: ${b}` : a })
        return `const { ${names.join(', ')} } = __m[${JSON.stringify(from)}];`
      })
      .replace(IMPORT_STAR, (_, local, from) => {
        if (!done.has(from)) throw new Error(`${name}.js imports ${from}.js before it is defined`)
        return `const ${local} = __m[${JSON.stringify(from)}];`
      })
      .replace(EXPORT_DECL, (_, kind, id) => { exported.push(id); return `${kind} ${id}` })
      .replace(EXPORT_LIST, (_, list) => {
        for (const s of list.split(',').map(x => x.trim()).filter(Boolean)) {
          const [local, as] = s.split(/\s+as\s+/)
          exported.push(as ? `${as}: ${local}` : local)
        }
        return ''
      })
    const left = body.match(/^\s*(import|export)\b[^\n]*/m)
    if (left) throw new Error(`${name}.js: unsupported module syntax: ${left[0].trim()}`)
    out.push(`__m[${JSON.stringify(name)}] = (function () {\n'use strict';\n${body}\nreturn { ${exported.join(', ')} };\n})();`)
    done.add(name)
  }
  if (!done.has(entry)) throw new Error(`entry ${entry} not among the modules`)
  return `(function () {\nconst __m = {};\n${out.join('\n')}\nreturn __m[${JSON.stringify(entry)}];\n})()`
}

/* 2026-01-01 00:00 in DOS date/time: fixed, so the archive is reproducible. */
const DOS_TIME = 0
const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1

/**
 * @param {Array<{ name: string, data: Buffer }>} files ASCII names
 * @returns {Buffer}
 */
export function zip(files) {
  const locals = [], centrals = []
  let offset = 0
  for (const { name, data } of files) {
    if (!/^[\x20-\x7e]+$/.test(name)) throw new Error(`zip: keep entry names ASCII (${name})`)
    const nameBuf = Buffer.from(name, 'ascii')
    const packed = deflateRawSync(data, { level: 9 })
    const crc = crc32(data)
    const head = Buffer.alloc(30)
    head.writeUInt32LE(0x04034b50, 0); head.writeUInt16LE(20, 4); head.writeUInt16LE(0, 6); head.writeUInt16LE(8, 8)
    head.writeUInt16LE(DOS_TIME, 10); head.writeUInt16LE(DOS_DATE, 12); head.writeUInt32LE(crc, 14)
    head.writeUInt32LE(packed.length, 18); head.writeUInt32LE(data.length, 22); head.writeUInt16LE(nameBuf.length, 26); head.writeUInt16LE(0, 28)
    const cen = Buffer.alloc(46)
    cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6); cen.writeUInt16LE(0, 8); cen.writeUInt16LE(8, 10)
    cen.writeUInt16LE(DOS_TIME, 12); cen.writeUInt16LE(DOS_DATE, 14); cen.writeUInt32LE(crc, 16)
    cen.writeUInt32LE(packed.length, 20); cen.writeUInt32LE(data.length, 24); cen.writeUInt16LE(nameBuf.length, 28)
    cen.writeUInt32LE(offset, 42)
    locals.push(head, nameBuf, packed)
    centrals.push(cen, nameBuf)
    offset += head.length + nameBuf.length + packed.length
  }
  const cd = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10)
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, cd, end])
}

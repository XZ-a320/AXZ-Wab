import { createServer } from 'node:http'
import { readFileSync, existsSync, statSync } from 'node:fs'
import { join, extname } from 'node:path'
const ROOT = process.env.AXZ_ASSETS ? join(process.env.AXZ_ASSETS, 'public') : '/Users/brookxiao/New/Xiao/axz-assets/public'
const T = { '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.webp': 'image/webp', '.glb': 'model/gltf-binary', '.ktx2': 'image/ktx2', '.wasm': 'application/wasm', '.js': 'text/javascript; charset=utf-8' }
createServer((req, res) => {
  const p = decodeURIComponent(req.url.split('?')[0])
  const f = join(ROOT, p)
  const cors = { 'access-control-allow-origin': '*', 'cross-origin-resource-policy': 'cross-origin' }
  if (!existsSync(f) || statSync(f).isDirectory()) { res.writeHead(404, { 'content-type': 'text/plain', ...cors }); return res.end('404 ' + p) }
  res.writeHead(200, { 'content-type': T[extname(f)] || 'application/octet-stream', ...cors })
  res.end(readFileSync(f))
}).listen(4790, () => console.log(`axz assets on http://localhost:4790/  (${ROOT})`))

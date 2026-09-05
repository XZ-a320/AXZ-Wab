/* ==========================================================================
   AXZ sim 3.0 — the asset hub.

   One place that knows where the data lives and how much of it has come
   down. The index is fetched once; every file after that is fetched by id,
   counted against the first-interactive budget, and kept so a second ask
   costs nothing. An origin that cannot be reached leaves the hub OFFLINE
   rather than throwing: the engine still runs, it just says so.

   No Three.js in this file, so the accounting can be tested in Node.
   ========================================================================== */

export const FIRST_INTERACTIVE_BUDGET = 15 * 1024 * 1024

export class AssetHub {
  constructor({ origin, fetchImpl, budgetBytes = FIRST_INTERACTIVE_BUDGET } = {}) {
    this.origin = String(origin || '').replace(/\/+$/, '')
    this.fetchImpl = fetchImpl || ((...a) => globalThis.fetch(...a))
    this.budgetBytes = budgetBytes
    this.index = null
    this.online = false
    this.error = null
    this.transferred = 0
    this.cache = new Map()
  }

  async load() {
    try {
      const res = await this.fetchImpl(`${this.origin}/index.json`, { cache: 'no-cache' })
      if (!res.ok) throw new Error(`index.json ${res.status}`)
      this.index = await res.json()
      this.online = true
      this.error = null
    } catch (err) {
      this.index = null
      this.online = false
      this.error = String((err && err.message) || err)
    }
    return this.index
  }

  url(id) {
    const a = this.index && this.index.assets && this.index.assets[id]
    if (!a) throw new Error(`unknown asset: ${id}`)
    return `${this.origin}/${a.url}`
  }

  async bytesOf(id) {
    if (this.cache.has(id)) return this.cache.get(id)
    const res = await this.fetchImpl(this.url(id))
    if (!res.ok) throw new Error(`${id}: ${res.status}`)
    const buf = await res.arrayBuffer()
    this.transferred += buf.byteLength
    this.cache.set(id, buf)
    return buf
  }

  get overBudget() { return this.transferred > this.budgetBytes }

  /** The published model that flies as fleet type `type`, or null. Exterior
      rows win over cockpit-only rows; the first fetched row in index order wins ties. */
  modelFor(type, part = 'exterior') {
    const all = this.index && this.index.assets ? Object.entries(this.index.assets) : []
    const hits = all.filter(([, a]) => a.kind === 'model' && Array.isArray(a.types) && a.types.includes(type))
    const withPart = hits.find(([, a]) => (a.part || '').includes(part))
    const pick = withPart || (part === 'exterior' ? null : hits[0])
    return pick ? { id: pick[0], ...pick[1] } : null
  }

  credits() {
    const list = this.index && Array.isArray(this.index.credits) ? [...this.index.credits] : []
    return list.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  }
}

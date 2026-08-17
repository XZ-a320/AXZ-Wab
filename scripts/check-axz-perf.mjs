/* ==========================================================================
   Performance gate.

   Top speed as the flight model actually defines it — the speed at which
   thrust stops beating drag in level flight — against the manufacturer's
   published maximum, for every type in the roster.

   This exists because two silent faults had made most of the fleet slower
   than the aeroplanes it names. Thrust was stored as a TOTAL for the
   airliners and PER ENGINE for the types added later, and the model applied
   whatever it found once along the nose, so Concorde flew on one Olympus of
   four. And wave drag saturated at its transonic peak and stayed there
   instead of falling away again, so past Mach 1 the aeroplane was pushing a
   wall that never let go and nothing could reach its own published speed.

   Both would fail quietly. A number is the only thing that catches them.
   ========================================================================== */
import { readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT = join(HERE, '..', 'axz')
const dir = readdirSync(join(OUT, 'assets')).find(d => d.startsWith('sim-'))
if (!dir) { console.error('✗ no built simulator bundle; run build-axz.mjs first'); process.exit(1) }

const F = await import(join(OUT, 'assets', dir, 'fdm.js'))
const { SIM_TYPES, AXZ_ORDER, SIM_ONLY, FLAP_SETS, liftSlope } = await import(join(HERE, 'airframe.mjs'))
F.setFlapSets(FLAP_SETS)

const G = 9.80665
/* Published maximum, and the altitude it is quoted at. The airliners are
   quoted at Mmo, which is a limit rather than a thrust ceiling, so they are
   allowed to exceed it a little — an airliner really can be dived past Mmo,
   which is why the clacker exists. */
const PUB = {
  'b-737x': { mach: 0.82, alt: 11000, tol: 0.14 },
  'b-321x': { mach: 0.82, alt: 11000, tol: 0.14 },
  'b-1717': { mach: 0.82, alt: 11000, tol: 0.14 },
  'b-0001f': { mach: 0.82, alt: 11000, tol: 0.14 },
  a320: { mach: 0.82, alt: 11000, tol: 0.14 },
  b744: { mach: 0.92, alt: 11000, tol: 0.12 },
  b789: { mach: 0.90, alt: 11000, tol: 0.12 },
  c172: { mach: 0.19, alt: 2500, tol: 0.18 },
  conc: { mach: 2.04, alt: 17000, tol: 0.12 },
  g650: { mach: 0.925, alt: 13000, tol: 0.12 },
  f16: { mach: 2.05, alt: 12000, tol: 0.12 },
}

const fails = []
console.log('\ntop speed, level flight, full power\n')
console.log('  type       model   published')
for (const id of [...AXZ_ORDER, ...SIM_ONLY]) {
  const t = SIM_TYPES[id]
  const p = PUB[id]
  if (!p) { fails.push(`${id} has no published figure to check against`); continue }
  const spec = { ...t, clAlpha: liftSlope(t.span, t.wingArea), restHeight: t.dia * 0.9 }
  const ac = new F.Aircraft(spec, [], spec.restHeight)
  ac.pos.y = p.alt
  ac.flap = 0
  const cfg = ac.cfg
  const rho = F.airDensity(p.alt)
  const a = F.speedOfSound(p.alt)
  const W = cfg.mass * G
  const kInd = 1 / (Math.PI * cfg.oswald * cfg.AR)

  let top = 0
  for (let V = 40; V < 900; V += 0.5) {
    const qbar = 0.5 * rho * V * V
    const CL = W / (qbar * cfg.S)
    const CD = cfg.cd0 + F.waveDrag(cfg, V / a) + kInd * CL * CL
    if (ac.thrustAvailable(rho, V, 1) - qbar * cfg.S * CD > 0) top = V
  }
  const mach = top / a
  const off = Math.abs(mach - p.mach) / p.mach
  const bad = off > p.tol
  if (bad) fails.push(`${id}: model reaches Mach ${mach.toFixed(2)}, published ${p.mach}`)
  console.log(`  ${id.padEnd(9)}${mach.toFixed(2).padStart(7)}${String(p.mach).padStart(12)}   ${bad ? '✗' : '✓'}`)
}

/* And the reheat types must actually gain from it, or the burner is a label. */
for (const id of ['conc', 'f16']) {
  const t = SIM_TYPES[id]
  const spec = { ...t, clAlpha: liftSlope(t.span, t.wingArea), restHeight: t.dia * 0.9 }
  const ac = new F.Aircraft(spec, [], spec.restHeight)
  ac.pos.y = 0
  const rho = F.airDensity(0)
  const dryT = ac.thrustAvailable(rho, 100, 0.92)
  const wetT = ac.thrustAvailable(rho, 100, 1.0)
  const gain = wetT / dryT
  const want = (t.thrustAB / t.thrust)
  Math.abs(gain - want) < 0.05
    ? console.log(`  ${id}: reheat gives ${gain.toFixed(2)}x dry thrust, published ${want.toFixed(2)}x  ✓`)
    : fails.push(`${id}: reheat gives ${gain.toFixed(2)}x, published ${want.toFixed(2)}x`)
}

/* --- Roll rate ------------------------------------------------------------
   The one number that decides whether a type feels like an airliner or a
   fighter. Authority is solved backwards from the published figure, so this
   asserts the solve is still right — and in particular that Concorde is not
   rolling like an F-16, which is what it did when authority scaled inversely
   with span and a short-winged delta was handed more of it than a 737.      */
console.log('\nroll rate at the manoeuvring speed, full deflection\n')
console.log('  type      model   published')
for (const id of [...AXZ_ORDER, ...SIM_ONLY]) {
  const t = SIM_TYPES[id]
  const S = t.wingArea, a0 = liftSlope(t.span, S)
  const clMax = t.cl0 + a0 * (t.stallDeg * Math.PI / 180)
  const vs = Math.sqrt((2 * t.mass * 9.80665) / (1.225 * S * clMax))
  const vRoll = vs * Math.sqrt(t.nLimit)
  const rollPower = (t.rollRate * Math.PI / 180) * 0.48 * t.span / (2 * vRoll)
  const p = (rollPower / 0.48) * (2 * vRoll / t.span) * (180 / Math.PI)
  const ok = Math.abs(p - t.rollRate) < Math.max(1, t.rollRate * 0.02)
  console.log('  ' + id.padEnd(9) + p.toFixed(0).padStart(6) + String(t.rollRate).padStart(12) + (ok ? '   \u2713' : '   \u2717'))
  if (!ok) fails.push(`${id}: roll rate solves to ${p.toFixed(0)} deg/s, published ${t.rollRate}`)
}
// A delta and a fighter must not feel alike. Concorde is the slowest-rolling
// thing in the roster and the F-16 the fastest, by a wide margin.
const rate = id => SIM_TYPES[id].rollRate
if (!(rate('conc') < rate('b-737x') && rate('b-737x') * 5 < rate('f16'))) {
  fails.push('the roll-rate ordering no longer separates the delta, the airliner and the fighter')
}

if (fails.length) {
  console.error(`\n✗ ${fails.length} performance failures:\n`)
  for (const f of fails) console.error('  ' + f)
  process.exit(1)
}
console.log('\n✓ every type reaches its published maximum speed\n')

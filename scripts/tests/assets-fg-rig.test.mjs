import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { parseXml, readAnimation, resolveInclude, buildRig } from '../assets/fg-rig.mjs'

const GEAR = `<?xml version="1.0"?>
<PropertyList>
 <path>nosegear.ac</path>
 <!-- a comment -->
 <animation>
  <type>rotate</type>
  <object-name>rhngdoor</object-name>
  <object-name>lhngdoor</object-name>
  <property>gear/gear[0]/position-norm</property>
  <interpolation><entry><ind>0</ind><dep>0</dep></entry><entry><ind>1</ind><dep>90</dep></entry></interpolation>
  <axis><x>1</x><y>0</y><z>-0.1</z></axis>
  <center><x-m>-16.55</x-m><y-m>0.48</y-m><z-m>-1.09</z-m></center>
 </animation>
 <animation>
  <type>translate</type>
  <object-name>noseaxle</object-name>
  <property>gear/gear[0]/compression-norm</property>
  <factor>0.3048</factor>
  <axis><x>0</x><y>0</y><z>1</z></axis>
 </animation>
 <animation>
  <type>rotate</type>
  <object-name>wheel</object-name>
  <property>x</property>
  <axis><x1-m>1</x1-m><y1-m>2</y1-m><z1-m>3</z1-m><x2-m>1</x2-m><y2-m>4</y2-m><z2-m>3</z2-m></axis>
 </animation>
 <animation><type>material</type><object-name>rim</object-name><condition><equals/></condition></animation>
</PropertyList>`
const ROOT = `<PropertyList>
 <path>fuselage.ac</path>
 <model><path>Aircraft/737-800/Models/NoseGear.xml</path><offsets><x-m>0</x-m><y-m>0</y-m><z-m>0</z-m></offsets></model>
 <model><name>light</name><path>lights/Green.xml</path><offsets><x-m>3.62</x-m><y-m>17.03</y-m><z-m>1.06</z-m></offsets></model>
 <animation><type>spin</type><object-name>fan</object-name><property>engines/engine[0]/n1</property><factor>10</factor><axis><x>1</x><y>0</y><z>0</z></axis><center><x-m>1</x-m><y-m>2</y-m><z-m>3</z-m></center></animation>
</PropertyList>`

test('parseXml reads nested tags, comments and attributes', () => {
  const d = parseXml('<a n="1"><b>x</b><!-- c --><d/></a>')
  const a = d.children[0]; assert.equal(a.name, 'a'); assert.equal(a.attrs.n, '1'); assert.equal(a.children.length, 2); assert.equal(a.children[0].text, 'x')
})

test('readAnimation reads rotate with a table and a centre, translate with a factor, and a two-point axis', () => {
  const pl = parseXml(GEAR).children[0]
  const [rot, tr, two, mat] = pl.children.filter(c => c.name === 'animation').map(readAnimation)
  assert.deepEqual(rot.objects, ['rhngdoor', 'lhngdoor']); assert.equal(rot.property, 'gear/gear[0]/position-norm')
  assert.deepEqual(rot.axis, [1, 0, -0.1]); assert.deepEqual(rot.center, [-16.55, 0.48, -1.09]); assert.deepEqual(rot.table, [[0, 0], [1, 90]])
  assert.equal(tr.type, 'translate'); assert.equal(tr.factor, 0.3048); assert.deepEqual(tr.axis, [0, 0, 1])
  assert.deepEqual(two.axis, [0, 1, 0]); assert.deepEqual(two.center, [1, 2, 3])
  assert.equal(mat.type, 'material'); assert.equal(mat.condition, true)
})

test('resolveInclude maps Aircraft/<name>/… to the package root and the rest to the XML directory', () => {
  assert.equal(resolveInclude('Aircraft/737-800/Models/NoseGear.xml', { xmlDir: '/pkg/Models', packageRoot: '/pkg' }), '/pkg/Models/NoseGear.xml')
  assert.equal(resolveInclude('lights/Green.xml', { xmlDir: '/pkg/Models', packageRoot: '/pkg' }), '/pkg/Models/lights/Green.xml')
})

test('buildRig walks includes, keeps offsets, and summarises properties', () => {
  const pkg = mkdtempSync(join(tmpdir(), 'axz-rig-')); mkdirSync(join(pkg, 'Models', 'lights'), { recursive: true })
  writeFileSync(join(pkg, 'Models', '737.xml'), ROOT); writeFileSync(join(pkg, 'Models', 'NoseGear.xml'), GEAR)
  writeFileSync(join(pkg, 'Models', 'lights', 'Green.xml'), '<PropertyList><path>green.ac</path></PropertyList>')
  const rig = buildRig('b738-fg', join(pkg, 'Models', '737.xml'), pkg)
  assert.equal(rig.summary.parts, 3); assert.equal(rig.summary.withGeometry, 3); assert.equal(rig.summary.animations, 4)
  assert.deepEqual(rig.summary.properties, ['engines/engine[0]/n1', 'gear/gear[0]/compression-norm', 'gear/gear[0]/position-norm', 'x'])
  const light = rig.parts.find(p => p.xml === 'Green.xml'); assert.deepEqual(light.offset, { x: 3.62, y: 17.03, z: 1.06, pitch: 0, roll: 0, heading: 0 }); assert.equal(light.placedBy, '737.xml')
  assert.equal(rig.parts.find(p => p.xml === 'NoseGear.xml').glb, 'nosegear.glb')
})

test('a PropertyList include= merges the included file, with local n-indexed models winning', () => {
  const pkg = mkdtempSync(join(tmpdir(), 'axz-rig-inc-')); mkdirSync(join(pkg, 'Models'), { recursive: true })
  writeFileSync(join(pkg, 'Models', 'common.xml'), `<PropertyList>
    <model n="100"><path>Aircraft/x/Models/NoseGear.xml</path></model>
    <animation><type>rotate</type><object-name>fan</object-name><property>n1</property><axis><x>1</x><y>0</y><z>0</z></axis></animation>
  </PropertyList>`)
  writeFileSync(join(pkg, 'Models', '738.xml'), `<PropertyList include="common.xml"><path>737.ac</path><model n="100"><offsets><x-m>-1</x-m><y-m>0</y-m><z-m>0</z-m></offsets></model></PropertyList>`)
  writeFileSync(join(pkg, 'Models', 'NoseGear.xml'), GEAR)
  const rig = buildRig('t', join(pkg, 'Models', '738.xml'), pkg)
  assert.equal(rig.parts[0].ac, '737.ac'); assert.equal(rig.parts[0].animations.length, 1)
  const gear = rig.parts.find(p => p.xml === 'NoseGear.xml'); assert.ok(gear); assert.equal(gear.offset.x, -1); assert.equal(gear.animations.length, 3)
})

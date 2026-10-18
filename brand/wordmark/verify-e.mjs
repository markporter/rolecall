// Geometry verification for wordmark-e.svg (text-only, no rendering).
// Round-2 gates (task spec) — supersedes verify-d's gates where they conflict:
//   E letter (monoline family match):
//     1. ring walls >= 7u everywhere; wall contrast (max/min) <= 1.2
//     2. no stroke in the e lighter than 7u; bar >= 5u (prefer 6u)
//     3. eye >= 6u tall (NOT d-era >=60% of o counter — that rule is DEAD)
//        AND <= 55% of the o counter height (16u)
//     4. lower counter >= 5u at its widest
//     5. aperture: terminal cut face >= 7u; bar overhang past the cut <= 5u;
//        mouth vertical opening >= 6u and <= 11u
//   C letter:
//     6. BOTH adjacent gaps measured INK-to-INK from drawn path extremes
//        (arc extremes honouring sweep/large-arc flags — never bbox):
//        e->C <= 11u, C->a <= 11u, |L-R| <= 2u
//     7. mouth >= 22u (45% of the ~50u C height)
//     8. visible ink aspect (width/height) >= 0.65
//     9. wall 9u monoline; cap y7..57 preserved
//  10. retained safety: every counter opening still >= 1px at 24px nav scale
// House rules frozen: R verbatim (v5 seam fix, translate -8.5 only), +1u
// overshoot on rounds, x-height 32, l-l tighter than a-l, o-R clearance.
import { readFileSync } from 'node:fs';

const svg = readFileSync(new URL('./wordmark-e.svg', import.meta.url), 'utf8');
const src = [...svg.matchAll(/<path[^>]*\bd="([^"]+)"/g)].map((m) => m[1]);
if (src.length !== 10) { console.error(`FAIL: expected 10 paths, got ${src.length}`); process.exit(1); }
const [rBowl, rStem, rLeg, oP, l1P, eP, cP, aP, l2P, l3P] = src;
const viewBox = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/).slice(1).map(Number);

// ---- minimal SVG path parser -> subpaths with resolved absolute commands ----
function parsePath(d) {
  const tok = d.match(/[MLACZHVZ]|-?\d*\.?\d+(?:[eE]-?\d+)?/g);
  const nargs = { M: 2, L: 2, H: 1, V: 1, A: 7, C: 6, Z: 0 };
  const subs = []; let cur = null; let i = 0; let cmd = null;
  while (i < tok.length) {
    if (/^[MLACZHVZ]$/i.test(tok[i])) {
      cmd = tok[i++].toUpperCase();
      if (cmd === 'Z') { cur.cmds.push({ cmd: 'Z', args: [] }); continue; }
      if (cmd === 'M') { cur = { cmds: [], pts: [], start: null }; subs.push(cur); }
    }
    const args = tok.slice(i, i + nargs[cmd]).map(Number); i += nargs[cmd];
    cur.cmds.push({ cmd, args });
  }
  let x = 0, y = 0;
  for (const s of subs) {
    s.pts = []; let sx = 0, sy = 0;
    for (const { cmd, args } of s.cmds) {
      if (cmd === 'M') { x = args[0]; y = args[1]; sx = x; sy = y; s.pts.push([x, y]); }
      else if (cmd === 'L') { x = args[0]; y = args[1]; s.pts.push([x, y]); }
      else if (cmd === 'H') { x = args[0]; s.pts.push([x, y]); }
      else if (cmd === 'V') { y = args[0]; s.pts.push([x, y]); }
      else if (cmd === 'C') { x = args[4]; y = args[5]; s.pts.push([x, y]); }
      else if (cmd === 'A') { x = args[5]; y = args[6]; s.pts.push([x, y]); }
    }
    s.start = [sx, sy];
  }
  return subs;
}

// ---- ink extents from DRAWN geometry (arc extremes honour sweep flags) ----
const TAU = Math.PI * 2, EPS = 1e-9;
function arcParams(x1, y1, rx, ry, large, sweep, x2, y2) {
  // SVG spec endpoint->centre parameterisation (rotation 0 only; all our arcs).
  const dx2 = (x1 - x2) / 2, dy2 = (y1 - y2) / 2;
  let rrx = rx, rry = ry;
  const lam = (dx2 * dx2) / (rx * rx) + (dy2 * dy2) / (ry * ry);
  if (lam > 1) { const s = Math.sqrt(lam); rrx *= s; rry *= s; }
  const num = rrx * rrx * rry * rry - rrx * rrx * dy2 * dy2 - rry * rry * dx2 * dx2;
  const den = rrx * rrx * dy2 * dy2 + rry * rry * dx2 * dx2;
  let coef = Math.sqrt(Math.max(0, num / den));
  if (large === sweep) coef = -coef;
  const cx = (x1 + x2) / 2 + (coef * rrx * dy2) / rry;
  const cy = (y1 + y2) / 2 - (coef * rry * dx2) / rrx;
  const t1 = Math.atan2((y1 - cy) / rry, (x1 - cx) / rrx);
  let dt = Math.atan2((y2 - cy) / rry, (x2 - cx) / rrx) - t1;
  if (sweep === 0 && dt > 0) dt -= TAU;
  if (sweep === 1 && dt < 0) dt += TAU;
  const start = sweep === 1 ? t1 : t1 + dt, span = Math.abs(dt);
  return { cx, cy, rrx, rry, start, span };
}
function covered(t, start, span) {
  let d = (t - start) % TAU; if (d < 0) d += TAU;
  return d <= span + EPS;
}
// Every point of the drawn arc, incl. parametric extremes 0/pi/2/3pi/2 in range.
function arcPoints(x1, y1, rx, ry, large, sweep, x2, y2) {
  const a = arcParams(x1, y1, rx, ry, large, sweep, x2, y2);
  const pts = [[x1, y1], [x2, y2]];
  for (const t of [0, Math.PI / 2, Math.PI, 3 * Math.PI / 2]) {
    if (covered(t, a.start, a.span)) pts.push([a.cx + a.rrx * Math.cos(t), a.cy + a.rry * Math.sin(t)]);
  }
  return { pts, arc: a };
}
// Ink (min/max x, y) actually drawn by one path string. Cubics are sampled.
function inkOf(d) {
  let x = 0, y = 0, minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  const put = (px, py) => { minX = Math.min(minX, px); maxX = Math.max(maxX, px); minY = Math.min(minY, py); maxY = Math.max(maxY, py); };
  for (const s of parsePath(d)) {
    x = s.start[0]; y = s.start[1]; put(x, y);
    for (const { cmd, args } of s.cmds) {
      if (cmd === 'M' || cmd === 'L') { x = args[0]; y = args[1]; put(x, y); }
      else if (cmd === 'H') { x = args[0]; put(x, y); }
      else if (cmd === 'V') { y = args[0]; put(x, y); }
      else if (cmd === 'C') {
        const [x0, y0] = [x, y];
        for (let k = 1; k <= 32; k++) {
          const t = k / 32, u = 1 - t;
          put(
            u * u * u * x0 + 3 * u * u * t * args[0] + 3 * u * t * t * args[2] + t * t * t * args[4],
            u * u * u * y0 + 3 * u * u * t * args[1] + 3 * u * t * t * args[3] + t * t * t * args[5],
          );
        }
        x = args[4]; y = args[5];
      }       else if (cmd === 'A') {
        // args = [rx, ry, xRot, large, sweep, x, y]; xRot is 0 on every arc here.
        const { pts } = arcPoints(x, y, args[0], args[1], args[3], args[4], args[5], args[6]);
        for (const [px, py] of pts) put(px, py);
        x = args[5]; y = args[6];
      }
    }
  }
  return { minX, maxX, minY, maxY };
}

const SCALE = 24 / 48;                       // 24px nav render of a 48u cap
const px = (u) => u * SCALE;
const ge = (a, b, tol = 1e-9) => a >= b - tol;
let fail = 0;

// ---------- o: circle r17 / counter r8 (frozen from d) ----------
const o = parsePath(oP);
const oRoA = o[0].cmds.find((c) => c.cmd === 'A').args;
const oRiA = o[1].cmds.find((c) => c.cmd === 'A').args;
const oCx = (o[0].pts[0][0] + o[0].pts[1][0]) / 2, oCy = o[0].pts[0][1];
const oRo = oRoA[0], oRi = oRiA[0];
const oOpen = 2 * oRi, oWall = oRo - oRi;
const oTop = oCy - oRo, oBottom = oCy + oRo;

// ---------- e: outer r17, counter rx9/ry10, bar y36.1..42.1, ANGLED cut ----------
const e = parsePath(eP);
const eArcs = e[0].cmds.filter((c) => c.cmd === 'A').map((c) => c.args);
const eLs = e[0].cmds.filter((c) => c.cmd === 'L').map((c) => c.args);
const eTipXY = e[0].pts[0];                   // bar underside tip on outer circle
const eCutXY = e[0].pts[1];                   // outer arc end = cut OUTER point
const eCutInXY = eLs[0];                      // cut INNER point (on counter)
const eBInXY = e[0].pts[3];                   // counter arc end at bar-underside height (left)
const [eEyeR, eEyeL] = [e[1].pts[0], e[1].pts[1]];
const eRo = eArcs[0][0], eRx = eArcs[1][0], eRy = eArcs[1][1];
const eCx = (eEyeR[0] + eEyeL[0]) / 2, eCy = 40;
const eyeFloorY = eEyeR[1], ceilY = eBInXY[1];
const counterTop = eCy - eRy, counterBottom = eCy + eRy;
const eyeH = eyeFloorY - counterTop;
const eyeW = 2 * eRx * Math.sqrt(1 - ((eCy - eyeFloorY) / eRy) ** 2);
const barT = ceilY - eyeFloorY;
const lowerH = counterBottom - ceilY;
const cutFace = Math.hypot(eCutXY[0] - eCutInXY[0], eCutXY[1] - eCutInXY[1]);
const overhang = eTipXY[0] - eCutXY[0];       // bar underside past the cut outer point
const mouth = eCutInXY[1] - ceilY;            // vertical opening at the inner tip
const eWallTop = counterTop - (eCy - eRo), eWallBottom = (eCy + eRo) - counterBottom;
const eWallSide = eRo - eRx;
const eTop = eCy - eRo, eBottom = eCy + eRo;
// endpoint-on-shape checks (rounded path literals)
const onCircle = (p) => Math.abs(Math.hypot(p[0] - eCx, p[1] - eCy) - eRo) < 0.02;
const onEll = (p) => Math.abs(((p[0] - eCx) / eRx) ** 2 + ((p[1] - eCy) / eRy) ** 2 - 1) < 0.005;
const eEndpointsOK = onCircle(eTipXY) && onCircle(eCutXY) && onEll(eCutInXY) && onEll(eBInXY)
  && onEll(eEyeR) && onEll(eEyeL);

// ---------- C: outer rx22/ry25, inner rx13/ry16, ANGLED radial cuts at +-45 ----------
const c = parsePath(cP);
const cOA = c[0].cmds.find((k) => k.cmd === 'A').args;
const cIA = c[0].cmds.filter((k) => k.cmd === 'A')[1].args;
const [cOutU, cOutL, cInL, cInU] = c[0].pts;
const cRxOut = cOA[0], cRyOut = cOA[1], cRxIn = cIA[0], cRyIn = cIA[1];
const cCy = (cOutU[1] + cOutL[1]) / 2;
const cCx = cInL[0] - cRxIn * Math.sqrt(1 - ((cInL[1] - cCy) / cRyIn) ** 2);
const cMouth = cInL[1] - cInU[1];
const cWallH = cRxOut - cRxIn, cWallV = cRyOut - cRyIn;
const cTop = cCy - cRyOut, cBottom = cCy + cRyOut;
const cFaceTop = Math.hypot(cOutU[0] - cInU[0], cOutU[1] - cInU[1]);
const cFaceBot = Math.hypot(cOutL[0] - cInL[0], cOutL[1] - cInL[1]);
// cuts must be parametric-radial: same parametric angle on outer and inner
const ang = (px, py, rx, ry) => Math.atan2((py - cCy) / ry, (px - cCx) / rx);
const cRadialU = Math.abs(ang(cOutU[0], cOutU[1], cRxOut, cRyOut) - ang(cInU[0], cInU[1], cRxIn, cRyIn)) < 0.02
  && Math.abs(ang(cOutL[0], cOutL[1], cRxOut, cRyOut) - ang(cInL[0], cInL[1], cRxIn, cRyIn)) < 0.02;

// ---------- a: semicircular bowl r17 + 9u stem (frozen from d) ----------
const a = parsePath(aP);
const aArc = a[0].cmds.find((k) => k.cmd === 'A').args;
const aArcI = a[1].cmds.find((k) => k.cmd === 'A').args;
const aTop = a[0].pts[0][1], aBottom = a[0].pts[3][1];
const aStemL = a[0].pts[0][0], aStemR = a[0].pts[1][0];
const aR = aArc[0];
const aCTop = a[1].pts[0][1], aCBottom = a[1].pts[3][1], aThroatR = a[1].pts[1][0];
const aOpen = aCBottom - aCTop;
const aWalls = Math.min(aCTop - aTop, aBottom - aCBottom, aR - aArcI[0], aStemR - aThroatR);

// ---------- R (frozen): horn counter ----------
const rb = parsePath(rBowl);
const horn = rb[1];
const hornThroat = Math.abs(horn.pts[horn.pts.length - 1][1] - horn.pts[0][1]);
const hornMouth = Math.abs(horn.pts[2][1] - horn.pts[1][1]);

// ---------- INK-TO-INK tracking (drawn extremes, honouring arc sweeps) ----------
const rInk = (() => {                          // R bowl/stem/leg, translate -8.5
  const i1 = inkOf(rBowl), i2 = inkOf(rStem), i3 = inkOf(rLeg);
  return { minX: Math.min(i1.minX, i2.minX, i3.minX) - 8.5, maxX: Math.max(i1.maxX, i2.maxX, i3.maxX) - 8.5 };
})();
const oInk = inkOf(oP), l1Ink = inkOf(l1P), eInk = inkOf(eP), cInk = inkOf(cP), aInk = inkOf(aP), l2Ink = inkOf(l2P), l3Ink = inkOf(l3P);
const gap = (x, y) => y - x;
const gRo = gap(rInk.maxX, oInk.minX), gOl = gap(oInk.maxX, l1Ink.minX), gLe = gap(l1Ink.maxX, eInk.minX),
      gEc = gap(eInk.maxX, cInk.minX), gCa = gap(cInk.maxX, aInk.minX),
      gAl = gap(aInk.maxX, l2Ink.minX), gLl = gap(l2Ink.maxX, l3Ink.minX);
const cInkW = cInk.maxX - cInk.minX, cInkH = cInk.maxY - cInk.minY;
const cAspect = cInkW / cInkH;
// o -> R leg clearance (leg right edge after the v5 seam fix: (28.5,33)->(36.5,56))
const oCx65 = 67.5; // o centre after the round-2 reflow (+2u right)
const legDist = Math.abs(23 * oCx65 - 8 * oCy - 391.5) / Math.hypot(23, 8);
const legGap = legDist - oRo;

// ---------- frozen R literals (v5 seam fix included) ----------
const R_FROZEN = [
  'M13 8H40C48 8 53 13 53 21C53 29 48 34 40 34H13ZM26 17C33.5 16.5 39 13 43 13L43 29C39 28.5 33.5 25.5 26 25Z',
  'M13 8H22V56H13Z',
  'M26 33L37 33L45 56L34 56Z',
];
const rVerbatim = rBowl === R_FROZEN[0] && rStem === R_FROZEN[1] && rLeg === R_FROZEN[2];

// ================= REPORT =================
console.log('wordmark-e geometry verification (24px nav: scale 24/48 = 0.5 -> px = u * 0.5)\n');

console.log('E LETTER — monoline family match');
console.log('  metric                                 value      gate            result');
const eGates = [
  ['e wall top (counter top -> circle)', eWallTop, eWallTop >= 7 - 1e-9, '>= 7u'],
  ['e wall bottom (circle -> counter bottom)', eWallBottom, eWallBottom >= 7 - 1e-9, '>= 7u'],
  ['e wall sides (r17 - rx9)', eWallSide, eWallSide >= 7 - 1e-9, '>= 7u'],
  ['e wall contrast (max/min)', Math.max(eWallTop, eWallBottom, eWallSide) / Math.min(eWallTop, eWallBottom, eWallSide),
    Math.max(eWallTop, eWallBottom, eWallSide) / Math.min(eWallTop, eWallBottom, eWallSide) <= 1.2 + 1e-9, '<= 1.2'],
  ['e bar (eye floor -> underside)', barT, barT >= 5 - 1e-9, '>= 5u'],
  ['e eye height', eyeH, eyeH >= 6 - 1e-9 && eyeH <= 0.55 * oOpen + 1e-9, '>= 6u and <= 55% of o counter'],
  ['e eye / o counter', eyeH / oOpen, eyeH / oOpen <= 0.55 + 1e-9, '<= 55%'],
  ['e lower counter (widest)', lowerH, lowerH >= 5 - 1e-9, '>= 5u'],
  ['e cut face', cutFace, cutFace >= 7 - 1e-9, '>= 7u'],
  ['e bar overhang past cut', overhang, overhang <= 5 + 1e-9, '<= 5u'],
  ['e mouth vertical opening', mouth, mouth >= 6 - 1e-9 && mouth <= 11 + 1e-9, '>= 6u and <= 11u'],
];
for (const [name, v, ok, gate] of eGates) {
  if (!ok) fail++;
  console.log(`  ${name.padEnd(40)} ${v.toFixed(3).padStart(8)}  ${gate.padEnd(24)} ${ok ? 'PASS' : 'FAIL'}`);
}
{ const ok = eEndpointsOK; if (!ok) fail++;
  console.log(`  ${'e endpoints on shapes'.padEnd(40)} ${''.padStart(8)}  ${'tip/cut on r17, inner/eye on ellipse'.padEnd(24)} ${ok ? 'PASS' : 'FAIL'}`); }

console.log('\nC LETTER — ink width, mouth, gaps (ink-to-ink from drawn path extremes)');
console.log('  metric                                 value      gate            result');
const cGates = [
  ['C mouth (inner tip separation)', cMouth, cMouth >= 22 - 1e-9, '>= 22u (45% of ~50u)'],
  ['C ink width (drawn extremes)', cInkW, cInkW >= 0.65 * cInkH - 1e-9, 'aspect >= 0.65'],
  ['C ink aspect (w/h)', cAspect, cAspect >= 0.65 - 1e-9, '>= 0.65'],
  ['C wall horizontal (22-13)', cWallH, Math.abs(cWallH - 9) < 1e-9, '= 9u monoline'],
  ['C wall vertical (25-16)', cWallV, Math.abs(cWallV - 9) < 1e-9, '= 9u monoline'],
  ['C terminal face top', cFaceTop, cFaceTop >= 7 - 1e-9, '>= 7u'],
  ['C terminal face bottom', cFaceBot, cFaceBot >= 7 - 1e-9, '>= 7u'],
  ['gap e -> C (ink-to-ink)', gEc, gEc <= 11 + 1e-9, '<= 11u'],
  ['gap C -> a (ink-to-ink)', gCa, gCa <= 11 + 1e-9, '<= 11u'],
  ['gap balance |L-R|', Math.abs(gEc - gCa), Math.abs(gEc - gCa) <= 2 + 1e-9, '<= 2u'],
];
for (const [name, v, ok, gate] of cGates) {
  if (!ok) fail++;
  console.log(`  ${name.padEnd(40)} ${v.toFixed(3).padStart(8)}  ${gate.padEnd(24)} ${ok ? 'PASS' : 'FAIL'}`);
}
{ const ok = cRadialU && Math.abs(ang(cOutU[0], cOutU[1], cRxOut, cRyOut) * 180 / Math.PI + 45) < 0.6
    && Math.abs(ang(cOutL[0], cOutL[1], cRxOut, cRyOut) * 180 / Math.PI - 45) < 0.6;
  if (!ok) fail++;
  console.log(`  ${'C terminal language'.padEnd(40)} ${''.padStart(8)}  ${'parametric-radial angled cuts +-45'.padEnd(24)} ${ok ? 'PASS' : 'FAIL'}`); }

console.log('\nCOUNTER OPENINGS (retained safety: >= 1px @24px == >= 2u)');
console.log('  counter              opening(u)  @24px(px)  result   note');
const counters = [
  ['o counter', oOpen, `circle r${oRi}`],
  ['e eye', eyeH, `flat lens ${eyeW.toFixed(2)}u wide`],
  ['e lower counter', lowerH, `mouth to aperture ${mouth.toFixed(2)}u`],
  ['a counter', aOpen, `semicircle r${aArcI[0]} + throat`],
  ['C aperture mouth', cMouth, `angled radial cuts +-45`],
  ['R horn (frozen)', hornThroat, `mouth ${hornMouth}u`],
];
for (const [name, open, note] of counters) {
  const ok = px(open) >= 1; if (!ok) fail++;
  console.log(`  ${name.padEnd(20)} ${open.toFixed(2).padStart(8)}  ${px(open).toFixed(2).padStart(9)}  ${ok ? 'PASS' : 'FAIL'}    ${note}`);
}

console.log('\nTRACKING (ink-to-ink from drawn extremes; arc extremes honour sweep flags)');
console.log(`  R ${rInk.minX.toFixed(2)}..${rInk.maxX.toFixed(2)} | o ${oInk.minX.toFixed(2)}..${oInk.maxX.toFixed(2)} | l ${l1Ink.minX.toFixed(2)}..${l1Ink.maxX.toFixed(2)} | e ${eInk.minX.toFixed(2)}..${eInk.maxX.toFixed(2)} | C ${cInk.minX.toFixed(2)}..${cInk.maxX.toFixed(2)} | a ${aInk.minX.toFixed(2)}..${aInk.maxX.toFixed(2)} | l ${l2Ink.minX.toFixed(2)}..${l2Ink.maxX.toFixed(2)} | l ${l3Ink.minX.toFixed(2)}..${l3Ink.maxX.toFixed(2)}`);
{ const ok = gLl <= gAl - 1; if (!ok) fail++;
  console.log(`  gaps: R-o ${gRo.toFixed(2)} | o-l ${gOl.toFixed(2)} | l-e ${gLe.toFixed(2)} | e-C ${gEc.toFixed(2)} | C-a ${gCa.toFixed(2)} | a-l ${gAl.toFixed(2)} | l-l ${gLl.toFixed(2)}  ${ok ? 'PASS' : 'FAIL'} (l-l >= 1u tighter than a-l)`); }
{ const gaps = [['R-o', gRo], ['o-l', gOl], ['l-e', gLe], ['e-C', gEc], ['C-a', gCa], ['a-l', gAl], ['l-l', gLl]];
  const bad = gaps.filter(([, v]) => v < 3 - 1e-9 || v > 11 + 1e-9);
  const ok = bad.length === 0; if (!ok) fail++;
  console.log(`  every gap in [3,11]u         ${ok ? 'PASS' : 'FAIL'}${ok ? '' : ' — out of range: ' + bad.map(([n, v]) => `${n}=${v.toFixed(2)}`).join(', ')}`); }

console.log('\nMERGE-RECIPE / HOUSE-RULE INVARIANTS');
const invariants = [
  ['overshoot o top', 24 - oTop, 1], ['overshoot o bottom', oBottom - 56, 1],
  ['overshoot e top', 24 - eTop, 1], ['overshoot e bottom', eBottom - 56, 1],
  ['overshoot C top', 8 - cTop, 1], ['overshoot C bottom', cBottom - 56, 1],
  ['overshoot a top', 24 - aTop, 1], ['overshoot a bottom', aBottom - 56, 1],
];
for (const [label, val, want] of invariants) {
  const ok = Math.abs(val - want) < 0.05; if (!ok) fail++;
  console.log(`  ${label.padEnd(24)} ${val.toFixed(3).padStart(6)}u (want ${want})  ${ok ? 'PASS' : 'FAIL'}`);
}
{ const ok = rVerbatim; if (!ok) fail++;
  console.log(`  R verbatim (v5 seam fix)     ${ok ? 'PASS' : 'FAIL'} (3 paths byte-identical, translate -8.5 only)`); }
{ const ok = Math.abs(oRo - 17) < 1e-9 && Math.abs(oRi - 8) < 1e-9 && Math.abs(oCx - 67.5) < 1e-9
    && Math.abs(oInk.minX - 50.5) < 0.02 && Math.abs(oInk.maxX - 84.5) < 0.02; if (!ok) fail++;
  console.log(`  o frozen r17/r8 c(67.5,40)   ${ok ? 'PASS' : 'FAIL'} (ink ${oInk.minX.toFixed(2)}..${oInk.maxX.toFixed(2)})`); }
{ const ok = Math.abs(l1Ink.minX - 89.5) < 1e-9 && Math.abs(l1Ink.maxX - 98.5) < 1e-9
    && Math.abs(l2Ink.minX - 226) < 1e-9 && Math.abs(l3Ink.maxX - 247.5) < 1e-9; if (!ok) fail++;
  console.log(`  l stems frozen positions     ${ok ? 'PASS' : 'FAIL'}`); }
{ const ok = Math.abs(aR - 17) < 1e-9 && Math.abs(aStemL - 203) < 1e-9 && Math.abs(aStemR - 221) < 1e-9 && Math.abs(aArcI[0] - 8) < 1e-9
    && Math.abs(aInk.minX - 186) < 0.02 && Math.abs(aInk.maxX - 221) < 0.02; if (!ok) fail++;
  console.log(`  a frozen bowl r17 stem 9u    ${ok ? 'PASS' : 'FAIL'} (ink ${aInk.minX.toFixed(2)}..${aInk.maxX.toFixed(2)})`); }
{ const ok = Math.abs(eRo - 17) < 1e-9 && Math.abs((eInk.maxX - eInk.minX) - 34) < 0.02; if (!ok) fail++;
  console.log(`  e outer circle r17           ${ok ? 'PASS' : 'FAIL'} (ink width ${(eInk.maxX - eInk.minX).toFixed(2)}u)`); }
{ const ok = legGap >= 12; if (!ok) fail++;
  console.log(`  o -> R leg clearance   ${legGap.toFixed(2)}u (frozen; A ~15.7)  ${ok ? 'PASS' : 'FAIL'}`); }
{ const ok = viewBox[0] === 252 && l3Ink.maxX <= viewBox[0] - 4; if (!ok) fail++;
  console.log(`  viewBox                ${viewBox.join(' x ')}; ink ${rInk.minX.toFixed(1)}..${l3Ink.maxX}  ${ok ? 'PASS' : 'FAIL'}`); }

console.log('\n' + (fail === 0 ? 'ALL CHECKS PASS' : `${fail} CHECK(S) FAIL`));
process.exit(fail === 0 ? 0 : 1);

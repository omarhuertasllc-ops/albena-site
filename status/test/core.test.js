import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyResults, overall, renderPage, series, uptime, isOut } from '../src/core.js';

const t0 = new Date('2026-10-11T12:00:00Z');
const at = (m) => new Date(t0.getTime() + m * 60000);
const up = { site: true, portal: true };

test('first run is operational', () => {
  const r = applyResults(null, null, up, t0);
  assert.equal(overall(r.state).key, 'ok');
  assert.deepEqual(r.hist.days['2026-10-11'].site, [1, 1]);
});

test('one failed check is not an outage; two are; recovery closes the incident', () => {
  let r = applyResults(null, null, up, t0);
  r = applyResults(r.state, r.hist, { site: false, portal: true }, at(5));
  assert.equal(isOut(r.state, 'site'), false);
  r = applyResults(r.state, r.hist, { site: false, portal: true }, at(10));
  assert.equal(overall(r.state).key, 'warn');
  assert.equal(r.state.incidents.length, 1);
  assert.equal(r.state.incidents[0].end, null);
  r = applyResults(r.state, r.hist, up, at(15));
  assert.equal(overall(r.state).key, 'ok');
  assert.ok(r.state.incidents[0].end);
});

test('both down is a major outage', () => {
  let r = applyResults(null, null, { site: false, portal: false }, t0);
  r = applyResults(r.state, r.hist, { site: false, portal: false }, at(5));
  assert.equal(overall(r.state).key, 'bad');
});

test('history is capped at 90 days and uptime computed', () => {
  let r = { state: null, hist: null };
  for (let d = 0; d < 100; d++) r = applyResults(r.state, r.hist, up, new Date(t0.getTime() + d * 86400000));
  assert.equal(Object.keys(r.hist.days).length, 90);
  assert.equal(uptime(r.hist, 'site'), 100);
  assert.equal(series(r.hist, 'site', new Date(t0.getTime() + 99 * 86400000)).length, 90);
});

test('page renders public components only and escapes', () => {
  const r = applyResults(null, null, up, t0);
  const html = renderPage(r.state, r.hist, t0);
  assert.match(html, /All systems operational/);
  assert.match(html, /Customer portal/);
  assert.doesNotMatch(html, /dbaomarhuertasllc|ai5080|127\.0\.0\.1|https:\/\/account\.albena\.ai\/login/);
});

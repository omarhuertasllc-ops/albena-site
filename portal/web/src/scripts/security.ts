import './shell';
import { startRegistration } from '@simplewebauthn/browser';
import { api, MOCK } from '../lib/api';
import { h, must, panel, chip, ago, fmtDateTime, failInto, run, toast, confirmDialog, empty, table } from '../lib/ui';
import type { Passkey, Session, SignIn, SecurityOverview, SecurityHub } from '../lib/types';

const root = must('#root');
let passkeys: Passkey[] = [];
let sessions: Session[] = [];
let history: SignIn[] = [];
let overview: SecurityOverview = { hubs: [], tiers: [] };
let isOwner = false;

function passkeyPanel() {
  const add = h('button', { class: 'btn btn-primary btn-sm', type: 'button' }, 'Add a passkey');
  add.addEventListener('click', async () => {
    const ok = await run(add, async () => {
      if (MOCK) { passkeys = [...passkeys, { id: `pk${Date.now()}`, createdAt: new Date().toISOString() }]; return true; }
      const opts = await api.passkeyRegisterOptions();
      let response;
      try { response = await startRegistration({ optionsJSON: opts as unknown as Parameters<typeof startRegistration>[0]['optionsJSON'] }); }
      catch (e) { if (e instanceof Error && e.name === 'NotAllowedError') return false; throw e; }
      await api.passkeyRegisterVerify(response);
      passkeys = await api.passkeys();
      return true;
    }, undefined);
    if (ok) { toast('Passkey added'); render(); }
  });
  const body = passkeys.length ? h('ul', { class: 'list' }, ...passkeys.map((k) => {
    const label = `Passkey added ${fmtDateTime(k.createdAt)}`;
    const rm = h('button', { class: 'btn btn-danger btn-sm', type: 'button', 'aria-label': `Remove ${label}` }, 'Remove');
    rm.addEventListener('click', async () => {
      if (passkeys.length === 1 && !await confirmDialog('Remove your only passkey?', 'You will still be able to sign in with an email link.', 'Remove', { danger: true })) return;
      else if (passkeys.length > 1 && !await confirmDialog('Remove this passkey?', 'This device will no longer be able to sign in with it.', 'Remove', { danger: true })) return;
      if (await run(rm, () => api.passkeyRemove(k.id), 'Passkey removed') !== undefined) { passkeys = passkeys.filter((x) => x.id !== k.id); render(); }
    });
    return h('li', {}, h('div', { class: 'main' }, h('span', { class: 'name' }, 'Passkey'), h('span', { class: 'sub' }, `Added ${fmtDateTime(k.createdAt)}`)), rm);
  })) : empty('No passkeys yet. Passkeys let you sign in with Touch ID, Face ID or a security key; nothing to type or remember.');
  const p = panel('Passkeys', h('div', {}, body), add);
  if (passkeys.length) p.querySelector('.panel-body')?.classList.add('flush');
  return p;
}
function sessionsPanel() {
  const ul = h('ul', { class: 'list' }, ...sessions.map((s) => {
    const kids: Node[] = [h('div', { class: 'main' }, h('span', { class: 'name' }, s.current ? 'This session' : 'Signed-in session', s.current && chip('This device', 'indigo')),
      h('span', { class: 'sub' }, `signed in ${fmtDateTime(s.createdAt)} · active ${ago(s.lastSeenAt)}`))];
    if (!s.current) {
      const b = h('button', { class: 'btn btn-sm', type: 'button', 'aria-label': `Revoke session started ${fmtDateTime(s.createdAt)}` }, 'Revoke');
      b.addEventListener('click', async () => { if (await run(b, () => api.revokeSession(s.id), 'Session revoked') !== undefined) { sessions = sessions.filter((x) => x.id !== s.id); render(); } });
      kids.push(b);
    }
    return h('li', {}, ...kids);
  }));
  const p = panel('Active sessions', h('div', {}, ul));
  p.querySelector('.panel-body')?.classList.add('flush');
  return p;
}
function historyPanel() {
  if (!history.length) return panel('Sign-in history', empty('No sign-in history to show.'));
  const p = panel('Sign-in history', table('Sign-in history', ['When', 'Method'], history.map((x) => [
    document.createTextNode(fmtDateTime(x.at)), document.createTextNode(x.method === 'passkey' ? 'Passkey' : x.method === 'microsoft' ? 'Microsoft' : 'Email link')])));
  p.querySelector('.panel-body')?.classList.add('flush');
  return p;
}
const EVENT_LABEL: Record<string, string> = { denial: 'Request denied', approval: 'Approved on the Hub', trust_revoke: 'Earned trust revoked', chain_break: 'Audit chain break found', chain_ack: 'Chain break acknowledged', mode_change: 'AgentGate mode changed', unlock: 'Hub unlocked', proposal: 'Action proposed' };
const hubHead = (x: SecurityHub) => h('div', { class: 'main' }, h('span', { class: 'name' }, x.name, x.online ? null : chip('Offline', 'grey')));
const isPending = (x: SecurityHub, kind: string) => x.pending.some((p) => p.kind === kind);
const noReport = () => h('span', { class: 'sub' }, 'This Hub has not reported security details yet.');

function approvalsPanel() {
  const rows = overview.hubs.map((x) => {
    const n = x.security?.approvals_pending;
    return h('li', {}, hubHead(x), n === undefined ? noReport() : chip(n === 0 ? 'Nothing waiting' : `${n} waiting`, n === 0 ? 'green' : 'amber'));
  });
  return panel("Your Hub's approvals", h('div', {},
    h('p', { class: 'empty-note' }, 'When Albena wants to do something that needs your say-so, you decide on the Hub\u2019s own screen, with your owner PIN for anything serious. This page only shows how many are waiting. The portal never approves anything on the AI\u2019s behalf.'),
    rows.length ? h('ul', { class: 'list' }, ...rows) : empty('No Hubs are paired yet.')));
}
function trustPanel() {
  const rows = overview.hubs.map((x) => {
    const n = x.security?.trust_grants;
    const kids: Node[] = [hubHead(x), n === undefined ? noReport() : chip(n === 1 ? '1 earned trust' : `${n} earned trusts`, n ? 'indigo' : 'grey')];
    if (isOwner && n) {
      if (isPending(x, 'revoke_trust')) kids.push(chip('Revoke sent, applies on the next check-in', 'amber'));
      else {
        const b = h('button', { class: 'btn btn-danger btn-sm', type: 'button', 'aria-label': `Revoke all earned trust on ${x.name}` }, 'Revoke all earned trust');
        b.addEventListener('click', async () => {
          if (!await confirmDialog('Revoke all earned trust?', `${x.name} will ask you again for every action it had learned to do on its own. This applies the next time the Hub checks in.`, 'Revoke', { danger: true })) return;
          if (await run(b, () => api.revokeTrust(x.id), 'Revoke sent to your Hub') !== undefined) { await reload(); }
        });
        kids.push(b);
      }
    }
    return h('li', {}, ...kids);
  });
  return panel('Trust and devices', h('div', {},
    h('p', { class: 'empty-note' }, 'Trust is earned for small, repeatable things and only after you approved them on the Hub. You can take it all back at any time. Passkeys and signed-in sessions are managed below.'),
    rows.length ? h('ul', { class: 'list' }, ...rows) : empty('No Hubs are paired yet.')));
}
function chainPanel() {
  const rows = overview.hubs.map((x) => {
    const s = x.security;
    const kids: Node[] = [hubHead(x)];
    if (!s?.chain) { kids.push(noReport()); return h('li', {}, ...kids); }
    const broken = s.chain === 'broken' && !!s.break_sig;
    const acked = broken && s.acked_sig === s.break_sig;
    const label = s.chain === 'verified' ? 'Intact' : s.chain === 'broken' ? (acked ? 'Break acknowledged' : 'Break found') : s.chain === 'absent' ? 'No log yet' : 'Could not be read';
    kids.push(chip(label, s.chain === 'verified' ? 'green' : s.chain === 'broken' ? (acked ? 'amber' : 'red') : 'grey'));
    if (s.chain_rows !== undefined) kids.push(h('span', { class: 'sub' }, `${s.chain_rows.toLocaleString('en-US')} entries`));
    if (broken && !acked && isOwner) {
      if (isPending(x, 'chain_ack')) kids.push(chip('Sent, applies on the next check-in', 'amber'));
      else {
        const note = h('input', { class: 'input', id: `ack-note-${x.id}`, maxlength: '200', autocomplete: 'off', 'aria-label': `Optional note for ${x.name}` });
        note.placeholder = 'Optional note (what you checked)';
        const b = h('button', { class: 'btn btn-sm', type: 'button', 'aria-label': `Acknowledge the audit chain break on ${x.name}` }, 'Acknowledge');
        b.addEventListener('click', async () => {
          if (!await confirmDialog('Acknowledge this break?', 'This tells the Hub you have looked at the broken audit log and want it to carry on. It does not repair or hide anything, and a different break will ask you again.', 'Acknowledge')) return;
          if (await run(b, () => api.chainAck(x.id, s.break_sig as string, note.value.trim() || undefined), 'Acknowledgement sent to your Hub') !== undefined) { await reload(); }
        });
        kids.push(note, b);
      }
    }
    return h('li', {}, ...kids);
  });
  return panel('Audit chain', h('div', {},
    h('p', { class: 'empty-note' }, 'Every decision your Hub makes is written to a tamper-evident log. If the log stops adding up, risky actions pause until you have looked at it.'),
    rows.length ? h('ul', { class: 'list' }, ...rows) : empty('No Hubs are paired yet.')));
}
function eventsPanel() {
  const flat = overview.hubs.flatMap((x) => (x.security?.events ?? []).map((ev) => ({ hub: x.name, ...ev }))).sort((a, b) => b.at - a.at);
  if (!flat.length) return panel('Security events', empty('No recent security events.'));
  const multi = overview.hubs.length > 1;
  const p = panel('Security events', table('Security events', multi ? ['When', 'Hub', 'Event', 'Tool'] : ['When', 'Event', 'Tool'], flat.map((ev) => [
    document.createTextNode(fmtDateTime(new Date(ev.at * 1000).toISOString())), ...(multi ? [document.createTextNode(ev.hub)] : []),
    document.createTextNode(EVENT_LABEL[ev.kind] ?? ev.kind), document.createTextNode(ev.tool ?? '')])));
  p.querySelector('.panel-body')?.classList.add('flush');
  return p;
}
function tiersPanel() {
  return panel('Risk tiers in plain language', h('div', {},
    h('ul', { class: 'list' }, ...overview.tiers.map((t) => h('li', {}, h('div', { class: 'main' }, h('span', { class: 'name' }, chip(t.id, t.id === 'R4' ? 'red' : t.id === 'R3' ? 'amber' : ''), ' ', t.name), h('span', { class: 'sub' }, t.summary)))))));
}
async function reload() { overview = await api.securityOverview(); render(); }
function render() {
  root.replaceChildren(h('div', { class: 'stack' }, approvalsPanel(), trustPanel(), chainPanel(), eventsPanel(), tiersPanel(), passkeyPanel(), sessionsPanel(), historyPanel()));
  root.setAttribute('aria-busy', 'false');
}

Promise.all([api.passkeys(), api.sessions(), api.history(), api.securityOverview(), api.me()]).then(([pk, s, hi, ov, me]) => { passkeys = pk; sessions = s; history = hi; overview = ov; isOwner = me.role === 'owner'; render(); }).catch((e) => failInto(root, e));

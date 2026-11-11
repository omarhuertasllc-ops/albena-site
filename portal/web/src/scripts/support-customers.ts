// Staff-only list (Cloudflare Access gates this page and /api/support/*). No customer session needed.
import { h, must, chip, fmtDate, failInto, empty, table, run, toast } from '../lib/ui';
import { field, planFields, PLAN_NAMES } from '../lib/forms';
import { staff, startViewAs, integrity, type AccountRow } from '../lib/staff';

document.documentElement.classList.add('js');
const root = must('#root');
const q = must<HTMLInputElement>('#q');
const count = must('#count');

const tone = (s: string) => (s === 'active' || s === 'trialing' ? 'green' : s === 'past_due' || s === 'suspended' ? 'red' : s === 'expired' ? 'amber' : 'grey');
const planLabel = (a: AccountRow) => (a.comp ? `${PLAN_NAMES[a.plan] ?? a.plan} (comp)` : PLAN_NAMES[a.plan] ?? a.plan);

function buildNewForm() {
  const email = field('Email', 'input', { type: 'email', placeholder: 'person@example.com', required: true, autocomplete: 'email' });
  const name = field('Name (optional)', 'input', { autocomplete: 'name' });
  const plans = planFields({ allowEmpty: true });
  const go = h('button', { class: 'btn btn-primary', type: 'submit' }, 'Create customer');
  const status = h('p', { class: 'form-status', role: 'status', 'aria-live': 'polite' });
  const form = h('form', { class: 'stack', novalidate: true },
    h('p', { class: 'mut' }, 'Creates the account now. There is no email and no login: the person signs in later with this address and finds the plan in place.'),
    h('div', { class: 'form-grid' }, email.wrap, name.wrap), ...plans.nodes, h('div', { class: 'row' }, go), status);
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const fragment = plans.value();
    if (typeof fragment === 'string') { status.textContent = fragment; status.className = 'form-status is-error'; return; }
    const r = await run(go, () => staff.createAccount({ email: email.el.value.trim(), ...(name.el.value.trim() ? { name: name.el.value.trim() } : {}), ...fragment }));
    if (r) location.assign(`/support/customers/${encodeURIComponent(r.accountId)}`);
  });
  must('#new-body').append(form);
}

staff.accounts().then(({ me, accounts }) => {
  root.setAttribute('aria-busy', 'false');
  const render = () => {
    const term = q.value.trim().toLowerCase();
    const rows = accounts.filter((a) => !term || [a.email, a.id, a.plan, a.status, a.source].some((v) => v.toLowerCase().includes(term)));
    count.textContent = `${rows.length} of ${accounts.length}`;
    if (!rows.length) { root.replaceChildren(empty('No matching customers.')); return; }
    const t = table('Customers', ['Email', 'Plan', 'Status', 'Source', 'Ends', 'Hubs', 'Created', ''], rows.map((a) => [
      h('a', { class: 'tlink', href: `/support/customers/${encodeURIComponent(a.id)}` }, a.email, a.email.toLowerCase() === me ? ' (you)' : ''),
      document.createTextNode(planLabel(a)), chip(a.status, tone(a.status)), chip(a.source, a.source === 'manual' ? 'indigo' : 'grey'),
      document.createTextNode(a.endsAt ? fmtDate(new Date(a.endsAt * 1000).toISOString()) : ''),
      h('span', { class: 'num' }, String(a.hubs)), document.createTextNode(fmtDate(new Date(a.created * 1000).toISOString())),
      viewAsButton(a.id, `View as ${a.email}`),
    ]));
    t.querySelectorAll('tbody tr').forEach((tr, i) => { if (rows[i].email.toLowerCase() === me) tr.classList.add('cust-me'); });
    root.replaceChildren(t);
  };
  q.addEventListener('input', render);
  render();
  buildNewForm();
}).catch((e) => { failInto(root, e); toast('Could not load customers.', true); });

function viewAsButton(accountId: string, label: string) {
  const b = h('button', { class: 'btn btn-sm', type: 'button', 'aria-label': label }, 'View as');
  b.addEventListener('click', () => void run(b, () => startViewAs(accountId)));
  return b;
}

// ALB-SEC-1: show the high-risk hold (audit chain break) with an Acknowledge action. Nothing is shown while the chain is intact.
integrity.get().then(({ chain, integrity: g }) => {
  const held = g.status === 'broken' && g.acked_sig !== g.broken_sig;
  if (!held) return;
  const box = must('#integrity');
  const note = h('input', { class: 'input', placeholder: 'What you checked (required)', 'aria-label': 'Acknowledgement note' }) as HTMLInputElement;
  const go = h('button', { class: 'btn btn-primary', type: 'button' }, 'Acknowledge break');
  go.addEventListener('click', async () => {
    if (note.value.trim().length < 5) { toast('Add a short note first.', true); return; }
    const r = await run(go, () => integrity.ack(g.broken_sig ?? '', note.value.trim()), 'Acknowledged; high-risk actions are allowed again.');
    if (r) box.hidden = true;
  });
  box.replaceChildren(h('section', { class: 'panel' }, h('div', { class: 'panel-body stack' },
    h('p', {}, chip('Audit chain broken', 'red'), ` ${chain.reason ?? g.broken_sig} at entry #${chain.brokenAtId ?? '?'}. High-risk actions (deletes, billing, licences, view-as) are paused until you acknowledge. Acknowledging is logged; it does not repair the chain.`),
    h('div', { class: 'row' }, note, go))));
  box.hidden = false;
}).catch(() => {});

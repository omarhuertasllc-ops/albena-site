// Staff invites: one person (optionally prefilled from the waitlist: ?email=), a pasted list, and the invite table.
import { h, must, chip, fmtDateTime, failInto, empty, table, run, confirmDialog } from '../lib/ui';
import { field, planFields } from '../lib/forms';
import { staff, type Invite } from '../lib/staff';

document.documentElement.classList.add('js');
const root = must('#root');
const say = (el: HTMLElement, m: string, kind: '' | 'is-error' | 'is-ok' = '') => { el.textContent = m; el.className = `form-status ${kind}`.trim(); };
const when = (s: number | null) => (s ? fmtDateTime(new Date(s * 1000).toISOString()) : '');
const tone = (s: Invite['status']) => (s === 'pending' ? 'amber' : s === 'accepted' ? 'green' : s === 'expired' ? 'grey' : 'red');
const ERR: Record<string, string> = {
  invalid_email: 'Not a valid email address.', already_customer: 'Already has an account.', invite_pending: 'An invite is already pending.',
  mail_failed: 'Email could not be sent.', invalid_plan: 'Pick a plan.', base_plan_required: 'Pick the plan to mirror.',
};

async function load() {
  try {
    const { invites } = await staff.invites();
    root.setAttribute('aria-busy', 'false');
    if (!invites.length) { root.replaceChildren(empty('No invites yet.')); return; }
    const t = table('Invites', ['Email', 'Plan', 'Status', 'Sent', 'Expires', 'By', ''], invites.map((i) => {
      const acts: Node[] = [];
      if (i.accountId) acts.push(h('a', { class: 'btn btn-sm', href: `/support/customers/${encodeURIComponent(i.accountId)}` }, 'Open customer'));
      if (i.status === 'pending' || i.status === 'expired') {
        const resend = h('button', { class: 'btn btn-sm', type: 'button', 'aria-label': `Resend invite to ${i.email}` }, 'Resend');
        resend.addEventListener('click', async () => { if (await run(resend, () => staff.resendInvite(i.id), 'Invite sent again.')) load(); });
        acts.push(resend);
      }
      if (i.status === 'pending') {
        const revoke = h('button', { class: 'btn btn-sm btn-danger', type: 'button', 'aria-label': `Revoke invite for ${i.email}` }, 'Revoke');
        revoke.addEventListener('click', async () => {
          if (!(await confirmDialog('Revoke this invite?', `${i.email} will no longer be able to use the link.`, 'Revoke', { danger: true }))) return;
          if (await run(revoke, () => staff.revokeInvite(i.id), 'Invite revoked.')) load();
        });
        acts.push(revoke);
      }
      return [document.createTextNode(i.email), document.createTextNode(i.plan ?? 'none'), chip(i.status, tone(i.status)),
        document.createTextNode(`${when(i.createdAt)}${i.sendCount > 1 ? ` (x${i.sendCount})` : ''}`), document.createTextNode(when(i.expiresAt)),
        document.createTextNode(i.invitedBy.replace('support:', '')), h('div', { class: 'row' }, ...acts)];
    }));
    root.replaceChildren(t);
  } catch (e) { failInto(root, e); }
}

function oneForm() {
  const email = field('Email', 'input', { type: 'email', required: true, autocomplete: 'email', value: new URLSearchParams(location.search).get('email') ?? '', placeholder: 'person@example.com' });
  const plans = planFields({ allowEmpty: true });
  const note = field('Staff note', 'input', { placeholder: 'Where they came from (staff only)' });
  const go = h('button', { class: 'btn btn-primary', type: 'submit' }, 'Send invite');
  const status = h('p', { class: 'form-status', role: 'status', 'aria-live': 'polite' });
  const form = h('form', { class: 'stack', novalidate: true }, email.wrap, ...plans.nodes.slice(0, 3), note.wrap, h('div', { class: 'row' }, go), status);
  // the plan fragment includes its own note field; the invite note is the one above
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const fragment = plans.value();
    if (typeof fragment === 'string') { say(status, fragment, 'is-error'); return; }
    delete fragment.maxHubs; delete fragment.note;
    say(status, 'Sending…');
    try {
      await staff.invite({ email: email.el.value.trim(), ...fragment, ...(note.el.value.trim() ? { note: note.el.value.trim() } : {}) });
      say(status, `Invite sent to ${email.el.value.trim()}.`, 'is-ok'); email.el.value = ''; load();
    } catch (e) { say(status, ERR[(e as { code?: string }).code ?? ''] ?? ((e as Error).message || 'Failed').replace(/_/g, ' '), 'is-error'); }
  });
  must('#one').append(form);
}

function bulkForm() {
  const list = field('Emails (one per line, or separated by commas or spaces)', 'textarea', { rows: '6', placeholder: 'a@example.com\nb@example.com' });
  const plans = planFields({ allowEmpty: true });
  const go = h('button', { class: 'btn btn-primary', type: 'submit' }, 'Send invites');
  const out = h('ul', { class: 'notes', 'aria-live': 'polite' });
  const form = h('form', { class: 'stack', novalidate: true }, list.wrap, ...plans.nodes.slice(0, 3), h('div', { class: 'row' }, go), out);
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const fragment = plans.value();
    const emails = list.el.value.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean);
    if (typeof fragment === 'string') { out.replaceChildren(h('li', { class: 'res-bad' }, fragment)); return; }
    if (!emails.length || emails.length > 50) { out.replaceChildren(h('li', { class: 'res-bad' }, 'Paste between 1 and 50 addresses.')); return; }
    delete fragment.maxHubs; delete fragment.note;
    const r = await run(go, () => staff.bulkInvite({ emails, ...fragment }));
    if (!r) return;
    out.replaceChildren(...r.results.map((x) => h('li', { class: x.ok ? 'res-ok' : 'res-bad' }, `${x.email}: ${x.ok ? 'invited' : ERR[x.error ?? ''] ?? x.error ?? 'failed'}`)));
    load();
  });
  must('#bulk').append(form);
}

oneForm(); bulkForm(); load();

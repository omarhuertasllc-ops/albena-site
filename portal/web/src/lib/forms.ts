// Form building blocks for the staff pages. DOM is built with createElement/textContent only (no innerHTML, no inline handlers).
import { ApiError, errMsg } from './api';
import { h, toast, type Child } from './ui';

let seq = 0;
export interface Control { wrap: HTMLElement; el: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement }

/** `autocomplete` takes a WCAG 1.3.5 token (name, email, tel, ...). Omit it only for identifiers and one-time secrets, which stay 'off'. */
export function field(label: string, kind: 'input' | 'select' | 'textarea', opts: { type?: string; value?: string; placeholder?: string; hint?: string; autocomplete?: string; options?: [string, string][]; required?: boolean; rows?: string; min?: string; max?: string } = {}): Control {
  const id = `f${++seq}`;
  const el = kind === 'select'
    ? h('select', { class: 'select', id }, ...(opts.options ?? []).map(([v, t]) => h('option', { value: v }, t)))
    : kind === 'textarea' ? h('textarea', { class: 'input ta', id, rows: opts.rows ?? '4' })
    : h('input', { class: 'input', id, type: opts.type ?? 'text', autocomplete: opts.autocomplete ?? 'off', min: opts.min, max: opts.max });
  if (opts.placeholder) el.setAttribute('placeholder', opts.placeholder);
  if (opts.required) el.setAttribute('required', '');
  if (opts.value !== undefined) el.value = opts.value;
  const hintId = `${id}h`;
  if (opts.hint) el.setAttribute('aria-describedby', hintId);
  const wrap = h('div', { class: 'field' }, h('label', { for: id }, label), el, opts.hint ? h('p', { class: 'hint', id: hintId }, opts.hint) : null);
  return { wrap, el: el as Control['el'] };
}

export const PLAN_OPTIONS: [string, string][] = [
  ['byo', 'Bring your own'], ['hub_mac', 'Hub for Mac'], ['hub_nvidia', 'Hub for NVIDIA'], ['estate', 'Estate'],
  ['pilot', 'Pilot (time-boxed)'], ['comp', 'Complimentary (mirrors a paid plan)'],
];
export const PLAN_NAMES: Record<string, string> = { none: 'No plan', byo: 'Bring your own', hub_mac: 'Hub for Mac', hub_nvidia: 'Hub for NVIDIA', estate: 'Estate', pilot: 'Pilot' };

/** Plan picker with the extra fields a manual grant needs. `value()` returns the request body fragment, or an error message. */
export function planFields(opts: { allowEmpty?: boolean; defaultPlan?: string } = {}) {
  const plan = field('Plan', 'select', { options: [...(opts.allowEmpty ? [['', 'No plan yet'] as [string, string]] : []), ...PLAN_OPTIONS], value: opts.defaultPlan ?? (opts.allowEmpty ? '' : 'pilot') });
  const base = field('Mirrors plan', 'select', { options: PLAN_OPTIONS.slice(0, 4), hint: 'Complimentary plans behave exactly like this paid plan.' });
  const days = field('Length in days', 'input', { type: 'number', min: '1', max: '730', placeholder: 'Pilot default 30; empty = no end date', hint: 'The plan switches off by itself when the time is up.' });
  const hubs = field('Hub allowance', 'input', { type: 'number', min: '1', max: '50', placeholder: 'Plan default (pilot: 1)' });
  const note = field('Staff note', 'input', { placeholder: 'Why this grant (staff only)' });
  const sync = () => {
    base.wrap.hidden = plan.el.value !== 'comp';
    const none = plan.el.value === '';
    for (const f of [days, hubs, note]) f.wrap.hidden = none;
  };
  plan.el.addEventListener('change', sync); sync();
  const value = (): Record<string, unknown> | string => {
    if (plan.el.value === '') return {};
    const b: Record<string, unknown> = { plan: plan.el.value };
    if (plan.el.value === 'comp') b.basePlan = base.el.value;
    if (days.el.value.trim()) { const n = Number(days.el.value); if (!Number.isInteger(n) || n < 1 || n > 730) return 'Length must be a whole number of days from 1 to 730.'; b.days = n; }
    if (hubs.el.value.trim()) { const n = Number(hubs.el.value); if (!Number.isInteger(n) || n < 1 || n > 50) return 'Hub allowance must be 1 to 50.'; b.maxHubs = n; }
    if (note.el.value.trim()) b.note = note.el.value.trim();
    return b;
  };
  return { nodes: [plan.wrap, base.wrap, days.wrap, hubs.wrap, note.wrap], value };
}

/** Modal form. `submit` returns normally to close the dialog, or throws / returns a string to show an error and stay open. */
export function formDialog(title: string, intro: string | null, nodes: Child[], okLabel: string, submit: () => Promise<string | void>): Promise<boolean> {
  return new Promise((resolve) => {
    const dlg = h('dialog', { class: 'confirm wide', 'aria-labelledby': 'fd-t' });
    const err = h('p', { class: 'err', role: 'alert' });
    const cancel = h('button', { class: 'btn btn-ghost', type: 'button' }, 'Cancel');
    const ok = h('button', { class: 'btn btn-primary', type: 'submit' }, okLabel);
    const form = h('form', { class: 'stack', novalidate: true }, ...(intro ? [h('p', {}, intro)] : []), ...nodes, err, h('div', { class: 'actions' }, cancel, ok));
    let done = false;
    cancel.addEventListener('click', () => dlg.close());
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      err.textContent = ''; ok.disabled = true;
      try {
        const msg = await submit();
        if (typeof msg === 'string' && msg) { err.textContent = msg; return; }
        done = true; dlg.close();
      } catch (e) {
        if (!(e instanceof ApiError && e.status === 401)) err.textContent = errMsg(e);
      } finally { ok.disabled = false; }
    });
    dlg.append(h('h2', { id: 'fd-t' }, title), form);
    dlg.addEventListener('close', () => { dlg.remove(); resolve(done); });
    document.body.append(dlg);
    dlg.showModal();
    (dlg.querySelector<HTMLElement>('input, select, textarea') ?? cancel).focus();
  });
}

/** Shows a secret exactly once (license keys). The caller never stores it. */
export function secretDialog(title: string, secret: string, note: string): Promise<void> {
  return new Promise((resolve) => {
    const dlg = h('dialog', { class: 'confirm wide', 'aria-labelledby': 'sd-t' });
    const copy = h('button', { class: 'btn', type: 'button' }, 'Copy');
    const close = h('button', { class: 'btn btn-primary', type: 'button' }, 'I stored it');
    copy.addEventListener('click', async () => { try { await navigator.clipboard.writeText(secret); toast('Copied.'); } catch { toast('Copy failed. Select the key and copy it by hand.', true); } });
    close.addEventListener('click', () => dlg.close());
    dlg.append(h('h2', { id: 'sd-t' }, title), h('p', {}, note), h('p', { class: 'code small-code', tabindex: '0' }, secret), h('div', { class: 'actions' }, copy, close));
    dlg.addEventListener('close', () => { dlg.remove(); resolve(); });
    document.body.append(dlg);
    dlg.showModal();
    close.focus();
  });
}

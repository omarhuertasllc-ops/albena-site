import './shell';
import { req } from '../lib/api';
import { h, must, panel, failInto } from '../lib/ui';

interface EarlyAccess { status: 'granted' | 'waitlist' | 'unavailable'; email: string; apps: { id: string; name: string; href: string }[] }
const root = must('#root');
const WAITLIST = 'https://albena.ai/waitlist';

(async () => {
  const r = await req<EarlyAccess>('GET', '/api/early-access');
  let body: HTMLElement;
  if (r.status === 'granted') {
    body = panel('Welcome to Albena', [
      h('p', {}, `You have early access as ${r.email}. Open Albena below. Chat and console ask you to confirm your email once more (Cloudflare Access).`),
      h('div', { class: 'row' }, ...r.apps.map((a, i) => h('a', { class: i === 0 ? 'btn btn-primary' : 'btn', href: a.href, 'data-app': a.id }, a.name))),
    ]);
  } else if (r.status === 'waitlist') {
    body = panel("You're on the list", [
      h('p', {}, `Thanks for signing in, ${r.email}. Albena is in early access, and this account isn't on the early-access list yet.`),
      h('p', { class: 'mut' }, "We're letting people in a few at a time. If you haven't already, request early access and we'll email you when your spot opens."),
      h('div', { class: 'row' }, h('a', { class: 'btn btn-primary', href: WAITLIST }, 'Request early access'), h('a', { class: 'btn', href: '/' }, 'Go to your account')),
    ]);
  } else {
    body = panel("We couldn't check your access", [
      h('p', {}, 'Something went wrong on our side while checking early access. Please try again in a minute.'),
      h('div', { class: 'row' }, h('a', { class: 'btn', href: '/albena' }, 'Try again')),
    ]);
  }
  body.dataset.status = r.status;
  root.replaceChildren(body);
  root.setAttribute('aria-busy', 'false');
})().catch((e) => failInto(root, e));

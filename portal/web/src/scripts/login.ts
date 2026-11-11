import { startAuthentication } from '@simplewebauthn/browser';
import { api, MOCK, errMsg } from '../lib/api';
import { must } from '../lib/ui';

declare global {
  interface Window { turnstile?: { render: (el: HTMLElement, o: Record<string, unknown>) => string; reset: (id?: string) => void } }
}
document.documentElement.classList.add('js');
const form = must<HTMLFormElement>('#login-form');
const email = must<HTMLInputElement>('#email');
const emailErr = must('#email-err');
const status = must('#status');
const submit = must<HTMLButtonElement>('#send');
const pk = must<HTMLButtonElement>('#passkey');
const ms = must<HTMLAnchorElement>('#microsoft');
const widget = must('[data-turnstile]');
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
let token = MOCK ? 'mock' : '';
let widgetId: string | undefined;

const say = (m: string, kind: '' | 'is-error' | 'is-ok' = '') => { status.textContent = m; status.className = `form-status ${kind}`.trim(); };

if (!MOCK) {
  const s = document.createElement('script');
  s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
  s.async = true; s.defer = true;
  s.onload = () => {
    widgetId = window.turnstile?.render(widget, {
      sitekey: widget.dataset.sitekey, action: widget.dataset.action, theme: 'dark',
      size: widget.clientWidth < 300 ? 'compact' : 'normal', // 300px normal widget would overflow a 320px viewport
      callback: (t: string) => { token = t; },
      'expired-callback': () => { token = ''; },
      'error-callback': () => { token = ''; say('Verification could not load. Reload the page and try again.', 'is-error'); },
    });
  };
  s.onerror = () => say('Verification could not load. Check your connection and reload.', 'is-error');
  document.head.append(s);
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const v = email.value.trim();
  if (!EMAIL.test(v)) { emailErr.textContent = 'Enter a valid email address.'; email.setAttribute('aria-invalid', 'true'); email.focus(); return; }
  emailErr.textContent = ''; email.removeAttribute('aria-invalid');
  if (!token) { say('Please complete the verification first.', 'is-error'); return; }
  submit.disabled = true; say('Sending…');
  try {
    await api.magicStart(v, token);
    try { sessionStorage.setItem('albena_login_email', v); } catch { /* optional */ }
    location.assign(MOCK ? '/check-email?mock=1' : '/check-email');
  } catch (err) {
    say(errMsg(err), 'is-error');
    submit.disabled = false;
    if (widgetId) window.turnstile?.reset(widgetId);
    token = '';
  }
});

pk.addEventListener('click', async () => {
  if (MOCK) { location.assign('/?mock=1'); return; }
  pk.disabled = true; say('Waiting for your passkey…');
  try {
    const o = await api.passkeyLoginOptions();
    const response = await startAuthentication({ optionsJSON: o as unknown as Parameters<typeof startAuthentication>[0]['optionsJSON'] });
    await api.passkeyLoginVerify(response);
    location.assign('/');
  } catch (err) {
    say(err instanceof Error && err.name === 'NotAllowedError' ? 'Passkey sign-in was canceled.' : errMsg(err), 'is-error');
    pk.disabled = false;
  }
});

// Optional SSO: the button appears only when the worker has Microsoft sign-in configured.
api.providers().then((p) => { ms.hidden = !p.microsoft; }).catch(() => { /* SSO is optional */ });
if (new URLSearchParams(location.search).get('sso') === 'failed') say('Microsoft sign-in did not work. Please try again, or use another sign-in method.', 'is-error');

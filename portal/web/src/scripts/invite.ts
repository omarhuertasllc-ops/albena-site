// Invite redemption. The token comes from the emailed link; it is removed from the address bar right away and kept only in memory.
import { api, ApiError, MOCK, errMsg } from '../lib/api';
import { must } from '../lib/ui';

declare global {
  interface Window { turnstile?: { render: (el: HTMLElement, o: Record<string, unknown>) => string; reset: (id?: string) => void } }
}
document.documentElement.classList.add('js');
const token = new URLSearchParams(location.search).get('token') ?? '';
try { history.replaceState(null, '', location.pathname); } catch { /* optional */ }

const form = must<HTMLFormElement>('#invite-form');
const email = must<HTMLInputElement>('#email');
const emailErr = must('#email-err');
const status = must('#status');
const submit = must<HTMLButtonElement>('#accept');
const widget = must('[data-turnstile]');
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
let challenge = MOCK ? 'mock' : '';
let widgetId: string | undefined;
const say = (m: string, kind: '' | 'is-error' | 'is-ok' = '') => { status.textContent = m; status.className = `form-status ${kind}`.trim(); };

if (!token) { say('This invitation link is incomplete. Open it again from your email.', 'is-error'); submit.disabled = true; }

if (!MOCK) {
  const s = document.createElement('script');
  s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
  s.async = true; s.defer = true;
  s.onload = () => {
    widgetId = window.turnstile?.render(widget, {
      sitekey: widget.dataset.sitekey, action: widget.dataset.action, theme: 'dark',
      size: widget.clientWidth < 300 ? 'compact' : 'normal', // 300px normal widget would overflow a 320px viewport
      callback: (t: string) => { challenge = t; },
      'expired-callback': () => { challenge = ''; },
      'error-callback': () => { challenge = ''; say('Verification could not load. Reload the page and try again.', 'is-error'); },
    });
  };
  s.onerror = () => say('Verification could not load. Check your connection and reload.', 'is-error');
  document.head.append(s);
}

const MESSAGES: Record<string, string> = {
  email_mismatch: 'That is not the address this invitation was sent to.',
  invalid_or_expired_invite: 'This invitation has expired or was already used. Ask for a new one, or sign in if you already have an account.',
  invite_locked: 'Too many wrong addresses. Ask for the invitation to be sent again.',
  challenge_failed: 'Verification failed. Try again.',
};

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const v = email.value.trim();
  if (!EMAIL.test(v)) { emailErr.textContent = 'Enter a valid email address.'; email.setAttribute('aria-invalid', 'true'); email.focus(); return; }
  emailErr.textContent = ''; email.removeAttribute('aria-invalid');
  if (!challenge) { say('Please complete the verification first.', 'is-error'); return; }
  submit.disabled = true; say('Checking…');
  try {
    await api.inviteAccept(token, v, challenge);
    try { sessionStorage.setItem('albena_login_email', v); } catch { /* optional */ }
    location.assign(MOCK ? '/check-email?mock=1' : '/check-email'); // same screen as a normal sign-in: enter the code from the email
  } catch (err) {
    say(err instanceof ApiError && MESSAGES[err.code] ? MESSAGES[err.code] : errMsg(err), 'is-error');
    submit.disabled = err instanceof ApiError && (err.code === 'invalid_or_expired_invite' || err.code === 'invite_locked');
    if (widgetId) window.turnstile?.reset(widgetId);
    challenge = '';
  }
});

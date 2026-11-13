import { api, ApiError, MOCK, errMsg } from '../lib/api';
import { must } from '../lib/ui';
let mail = '';
try { mail = sessionStorage.getItem('albena_login_email') ?? ''; } catch { /* optional */ }
if (mail) { must('#sent-to').textContent = mail; must('#sent-line').hidden = false; }

const form = must<HTMLFormElement>('#code-form');
const input = must<HTMLInputElement>('#code');
const err = must('#code-err');
const send = must<HTMLButtonElement>('#code-send');
const fail = (m: string) => { err.textContent = m; input.setAttribute('aria-invalid', 'true'); input.focus(); input.select(); };
const digits = () => input.value.replace(/\D/g, '');
input.addEventListener('input', () => {
  input.value = digits().slice(0, 6); // also covers paste of "123 456"
  err.textContent = ''; input.removeAttribute('aria-invalid');
});
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const code = digits();
  if (code.length !== 6) { fail('Enter the 6 digits from the email.'); return; }
  send.disabled = true; err.textContent = '';
  try {
    await api.magicCode(code);
    location.assign(MOCK ? '/?mock=1' : '/albena');
  } catch (ex) {
    send.disabled = false;
    const c = ex instanceof ApiError ? ex.code : '';
    if (c === 'wrong_code') fail('That code is not right. Check the email and try again.');
    else if (c === 'too_many_attempts') { fail('Too many wrong attempts. Request a new link from the sign-in page.'); send.disabled = true; }
    else if (c === 'invalid_or_expired_code') fail('That code has expired or was already used. Request a new link from the sign-in page.');
    else fail(errMsg(ex));
  }
});

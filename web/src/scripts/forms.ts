// Progressive-enhancement form handler: validation, honeypot, Turnstile, JSON POST.
declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: Record<string, unknown>) => string;
      reset: (id?: string) => void;
    };
  }
}

const TS_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
let tsPromise: Promise<void> | null = null;
function loadTurnstile(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  tsPromise ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = TS_SRC; s.async = true; s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('turnstile'));
    document.head.appendChild(s);
  });
  return tsPromise;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function initForm(form: HTMLFormElement) {
  const endpoint = form.dataset.endpoint!;
  const status = form.querySelector<HTMLElement>('[data-status]')!;
  const widget = form.querySelector<HTMLElement>('[data-turnstile]');
  const submit = form.querySelector<HTMLButtonElement>('button[type=submit]')!;
  const done = form.parentElement?.querySelector<HTMLElement>('[data-done]');
  const interest = form.querySelector<HTMLSelectElement>('[data-interest]');
  const wanted = new URLSearchParams(location.search).get('edition');
  if (interest && wanted && [...interest.options].some((o) => o.value === wanted)) interest.value = wanted;
  let token = '';
  let widgetId: string | undefined;
  let widgetFailed = false;

  const mountWidget = () => {
    if (!widget || widgetId) return;
    loadTurnstile().then(() => {
      if (!window.turnstile || widgetId) return;
      widgetId = window.turnstile.render(widget, {
        sitekey: widget.dataset.sitekey,
        action: widget.dataset.action,
        theme: 'dark',
        // The normal widget is 300px wide; use the compact one when the form is narrower (320px reflow).
        size: widget.clientWidth < 300 ? 'compact' : 'normal',
        callback: (t: string) => { token = t; },
        'expired-callback': () => { token = ''; },
        'error-callback': () => { token = ''; widgetFailed = true; },
      });
    }).catch(() => { widgetFailed = true; });
  };
  // Load the third-party script only when the visitor engages with or approaches the form.
  form.addEventListener('focusin', mountWidget, { once: true });
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((en) => {
      if (en.some((e) => e.isIntersecting)) { mountWidget(); io.disconnect(); }
    }, { rootMargin: '200px' });
    io.observe(form);
  } else mountWidget();

  const setStatus = (msg: string, kind: '' | 'is-error' | 'is-ok' = '') => {
    status.textContent = msg;
    status.className = `form-status ${kind}`.trim();
  };
  const fieldErr = (el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, msg: string) => {
    const err = form.querySelector<HTMLElement>(`#${el.id}-err`);
    if (err) err.textContent = msg;
    if (msg) el.setAttribute('aria-invalid', 'true'); else el.removeAttribute('aria-invalid');
  };

  const validate = (): HTMLElement | null => {
    let first: HTMLElement | null = null;
    form.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('[data-validate]').forEach((el) => {
      const v = el.value.trim();
      let m = '';
      if (el.required && !v) m = 'This field is required.';
      else if (el.type === 'email' && v && !EMAIL.test(v)) m = 'Enter a valid email address.';
      else if (el.dataset.min && v.length < Number(el.dataset.min)) m = `Please write at least ${el.dataset.min} characters.`;
      fieldErr(el, m);
      if (m && !first) first = el;
    });
    return first;
  };
  form.querySelectorAll<HTMLElement>('[data-validate]').forEach((el) => {
    el.addEventListener('input', () => { if (el.getAttribute('aria-invalid')) validate(); });
  });

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    setStatus('');
    const bad = validate();
    if (bad) { setStatus('Please fix the highlighted fields.', 'is-error'); bad.focus(); return; }

    const data = Object.fromEntries(new FormData(form).entries()) as Record<string, string>;
    // Honeypot: bots fill it. Pretend success, send nothing.
    if (data.website) { showDone(); return; }
    delete data.website;
    if (!data.interest) delete data.interest;
    delete data['cf-turnstile-response'];

    if (!token) {
      mountWidget();
      setStatus(widgetFailed
        ? 'The verification could not load. Check your connection or email us instead.'
        : 'Please complete the verification check below, then submit again.', 'is-error');
      return;
    }

    submit.disabled = true;
    setStatus('Sending…');
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ ...data, turnstileToken: token }),
      });
      if (!res.ok) {
        let msg = '';
        try { msg = (await res.json()).error ?? ''; } catch { /* ignore */ }
        throw new Error(msg || `status ${res.status}`);
      }
      showDone();
    } catch (e) {
      setStatus(`We could not send that${e instanceof Error && e.message && !/^status|Failed|Load|network/i.test(e.message) ? ` (${e.message})` : ''}. Please try again, or email omar@dbaomarhuertasllc.com.`, 'is-error');
      token = '';
      if (widgetId) window.turnstile?.reset(widgetId);
    } finally {
      submit.disabled = false;
    }
  });

  function showDone() {
    form.hidden = true;
    if (done) { done.hidden = false; done.focus(); }
  }
}

document.querySelectorAll<HTMLFormElement>('form[data-endpoint]').forEach(initForm);
export {};

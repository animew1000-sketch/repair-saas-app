/* Motivo v22: keeps existing registration HTML, handlers, and APIs intact.
 * Adds a truthful minimum-age acknowledgement and password guidance to the
 * signup form, and forwards the explicit acknowledgement to the server.
 * The backend enforces the policy independently of this script. */
(function () {
  'use strict';
  function install() {
    const section = document.getElementById('registerSection');
    if (!section) return;
    const form = section.querySelector('form.auth-form');
    const notice = document.getElementById('reg_notice_ack');
    const password = document.getElementById('reg_password');
    if (!form || !notice || !password) return;
    password.minLength = 12;
    password.maxLength = 128;
    password.setAttribute('aria-describedby','motivo-password-hint-v22');
    if (!document.getElementById('motivo-password-hint-v22')) {
      const hint = document.createElement('p');
      hint.id = 'motivo-password-hint-v22';
      hint.className = 'motivo-signup-policy-hint';
      hint.textContent = 'Use at least 12 characters. Avoid common passwords.';
      password.parentElement.appendChild(hint);
    }
    if (!document.getElementById('reg_age_confirmed')) {
      const label = document.createElement('label');
      label.className = 'auth-check-row';
      label.setAttribute('for','reg_age_confirmed');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.id = 'reg_age_confirmed';
      checkbox.required = true;
      const span = document.createElement('span');
      span.textContent = 'I confirm that I am at least 13 years old.';
      label.append(checkbox,span);
      const acknowledgement = notice.closest('label');
      if (acknowledgement) acknowledgement.before(label);
      else form.appendChild(label);
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',install,{once:true});
  else install();

  // The current SPA constructs the payload in public/app.js. Augment only the
  // existing registration request; leave all other fetches/auth/session logic.
  const originalFetch = window.fetch;
  if (typeof originalFetch !== 'function' || originalFetch.__motivoSignupV22) return;
  const wrappedFetch = function (input, options) {
    if (typeof input === 'string' && input === '/api/register' &&
        options && String(options.method || 'GET').toUpperCase() === 'POST' &&
        typeof options.body === 'string') {
      try {
        const body = JSON.parse(options.body);
        if (body && typeof body === 'object' && !Array.isArray(body)) {
          body.age_confirmed = document.getElementById('reg_age_confirmed')?.checked === true;
          options = {...options,body:JSON.stringify(body)};
        }
      } catch (_) { /* malformed JSON remains server-rejected */ }
    }
    return originalFetch.call(this,input,options);
  };
  wrappedFetch.__motivoSignupV22 = true;
  window.fetch = wrappedFetch;
})();

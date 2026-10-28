'use strict';
(() => {
  const form = document.getElementById('motivoContactForm');
  if (!form) return;
  const status = document.getElementById('contactFormStatus');
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const button = form.querySelector('button[type="submit"]'); button.disabled = true;
    status.textContent = 'Submitting your message…';
    const fields = Object.fromEntries(new FormData(form).entries());
    const payload = {name: fields.name, email: fields.email, category: fields.category, subject: fields.subject, message: fields.message, website: fields.website || '', privacy_ack: !!fields.privacy_ack};
    try {
      const response = await fetch('/api/contact',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),credentials:'same-origin',cache:'no-store'});
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Your message could not be sent.');
      form.reset(); status.textContent = `Message received. Reference: ${data.reference || 'submitted'}.`;
    } catch(err) { status.textContent = err.message || 'Message failed. Please try again.'; }
    finally {button.disabled = false;}
  });
})();

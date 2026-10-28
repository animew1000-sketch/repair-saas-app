'use strict';
// Runs only on the protected developer console; APIs enforce server-side MFA session.
(() => {
  const $ = id => document.getElementById(id);
  const list = $('contactInboxList');
  if (!list) return;
  const tag = (kind, cls, value) => {const el=document.createElement(kind);if(cls)el.className=cls;if(value!==undefined)el.textContent=String(value);return el;};
  async function call(path, options={}) {
    const r=await fetch('/api/platform/contact'+path,{credentials:'same-origin',cache:'no-store',...options,headers:{...(options.body?{'Content-Type':'application/json'}:{}),...(options.headers||{})}});
    let result={};try{result=await r.json();}catch{}if(!r.ok)throw new Error(result.error||'Unable to load messages');return result;
  }
  async function refreshInbox() {
    list.replaceChildren(tag('p','','Loading messages…'));
    try {
      const status=$('contactInboxStatus').value;
      const search=$('contactInboxSearch').value.trim();
      const q=new URLSearchParams();if(status!=='all')q.set('status',status);if(search)q.set('q',search.slice(0,120));
      const result=await call('/messages?'+q.toString());
      $('contactInboxCount').textContent=`${result.messages.length} message(s) displayed`;
      list.replaceChildren();
      if(!result.messages.length)list.append(tag('p','','No messages match this filter.'));
      result.messages.forEach(m=>{
        const card=tag('article','contact-inbox-item');const header=tag('div','meta',`MC-${String(m.id).padStart(6,'0')} · ${m.category} · ${new Date(m.created_at).toLocaleString()} · ${m.status}`);
        const subject=tag('h3','',m.subject);const from=tag('p','meta',`${m.name} · ${m.email}`);const body=tag('p','',m.message);
        const controls=tag('div','inbox-actions');const select=tag('select');select.setAttribute('aria-label','Message status');['new','in_progress','resolved','archived'].forEach(value=>{const opt=tag('option','',value.replace('_',' '));opt.value=value;opt.selected=value===m.status;select.append(opt);});
        const note=tag('textarea');note.value=m.internal_note||'';note.maxLength=5000;note.setAttribute('aria-label','Internal note');note.placeholder='Private note (visible to platform administrators only)';
        const save=tag('button','sm','Save changes');save.type='button';
        save.addEventListener('click',async()=>{save.disabled=true;try{await call('/messages/'+m.id,{method:'PATCH',body:JSON.stringify({status:select.value,internal_note:note.value})});$('contactInboxFeedback').textContent='Message updated.';await refreshInbox();}catch(e){$('contactInboxFeedback').textContent=e.message;}finally{save.disabled=false;}});
        controls.append(select,save);card.append(header,subject,from,body,note,controls);list.append(card);
      });
    }catch(e){list.replaceChildren(tag('p','',e.message));}
  }
  $('contactInboxRefresh').addEventListener('click',refreshInbox);
  $('contactInboxStatus').addEventListener('change',refreshInbox);
  $('contactInboxSearch').addEventListener('keydown',e=>{if(e.key==='Enter')refreshInbox();});
  const tabs=document.querySelectorAll('[data-page]');tabs.forEach(b=>b.addEventListener('click',()=>{if(b.dataset.page==='contact')refreshInbox();}));
})();

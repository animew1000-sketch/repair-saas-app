/* Motivo MOT-028 Phase 1: manager scheduling configuration and disruption notices.
 * Rename to scheduling-manager.js. Load after operations-dashboard.js.
 * Existing booking flow is NOT availability checked by this phase.
 */
(() => {
  'use strict';
  const API = '/api/manager/scheduling';
  const $ = id => document.getElementById(id);
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  let loaded = false;
  let previewKey = null;
  let busy = false;
  let active = false;
  function scheduler() { return !!localStorage.getItem('token') && ['manager', 'service_advisor'].includes(localStorage.getItem('role')); }
  function status(message, bad=false) { const e=$('motivoScheduleStatus'); if(e) {e.textContent=message;e.classList.toggle('error',bad);} }
  async function api(path, method='GET', body) {
    const token=localStorage.getItem('token');
    const res=await fetch(`${API}${path}`,{method,headers:{Authorization:`Bearer ${token}`,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
    const data=await res.json().catch(()=>({}));
    if(!res.ok) throw new Error(data.error || `Server responded ${res.status}`);
    return data;
  }
  function html() {
    return `<div class="motivo-sched-heading"><div><span>SCHEDULING OPERATIONS</span><h3>Scheduling &amp; Availability</h3><p>Manage shop hours, service bays, technician shifts and urgent rescheduling alerts.</p></div></div>
    <div class="motivo-sched-warning" role="note"><strong>Configuration stage only:</strong> Current customer appointment requests do not yet use availability checks. Selecting automatic confirmation saves a preference but does not enable auto-booking. The conflict-safe booking engine comes in Phase 2.</div>
    <div id="motivoScheduleStatus" class="motivo-sched-status" role="status" aria-live="polite"></div>
    <section class="motivo-sched-card"><h4>Shop settings &amp; regular hours</h4><form id="motivoSchedConfigForm">
      <div class="motivo-sched-row"><label>Shop time zone<input id="motivoSchedTimezone" value="America/Los_Angeles" autocomplete="off" required></label>
      <label>Appointment slot length<select id="motivoSchedSlot"><option value="15">15 minutes</option><option value="30">30 minutes</option><option value="60">60 minutes</option></select></label>
      <label>Confirmation policy<select id="motivoSchedPolicy"><option value="manager_approval">Manager approval</option><option value="automatic">Automatic (future phase)</option></select></label></div>
      <div class="motivo-sched-days" id="motivoSchedDays"></div><button class="motivo-sched-primary" type="submit">Save shop schedule</button></form></section>
    <div class="motivo-sched-two"><section class="motivo-sched-card"><h4>Service bays</h4><form id="motivoSchedBayForm" class="motivo-sched-inline"><label>New service bay<input id="motivoSchedBayName" maxlength="80" placeholder="Bay 1" required></label><button type="submit">Add bay</button></form><div id="motivoSchedBays" class="motivo-sched-list"></div></section>
    <section class="motivo-sched-card"><h4>Technician shifts</h4><form id="motivoSchedShiftForm" class="motivo-sched-stack"><label>Technician<select id="motivoSchedTech"></select></label><div class="motivo-sched-row"><label>Day<select id="motivoSchedShiftDay">${days.map((d,i)=>`<option value="${i}">${d}</option>`).join('')}</select></label><label>Start<input id="motivoSchedShiftStart" type="time" value="08:00" required></label><label>End<input id="motivoSchedShiftEnd" type="time" value="17:00" required></label></div><button type="submit">Add shift</button></form><div id="motivoSchedShifts" class="motivo-sched-list"></div></section></div>
    <section class="motivo-sched-card"><h4>Shop closures</h4><p>Add an exception to your shop's regular hours. Existing appointments are <strong>not</strong> automatically cancelled or emailed.</p><form id="motivoSchedClosureForm" class="motivo-sched-stack"><div class="motivo-sched-row"><label>Start<input id="motivoSchedClosureStart" type="datetime-local" required></label><label>End<input id="motivoSchedClosureEnd" type="datetime-local" required></label><label>Reason<input id="motivoSchedClosureReason" maxlength="160" placeholder="Unexpected closure" required></label></div><button type="submit">Add closure</button></form><div id="motivoSchedClosures" class="motivo-sched-list"></div></section>
    <section class="motivo-sched-card motivo-sched-disruption"><h4>Notify customers about schedule disruptions</h4><p>Preview the appointments affected by a shop closure or a technician absence. A separate confirmation is required to send <strong>real emails</strong>. The original appointments will not be cancelled or rescheduled.</p>
      <form id="motivoSchedNoticeForm" class="motivo-sched-stack"><div class="motivo-sched-row"><label>Issue<select id="motivoSchedKind"><option value="closure">Unexpected shop closure</option><option value="technician_absence">Technician absence</option></select></label><label id="motivoSchedAffectedTechWrap" hidden>Affected technician<select id="motivoSchedAffectedTech"></select></label></div>
      <div class="motivo-sched-row"><label>From<input id="motivoSchedNoticeStart" type="datetime-local" required></label><label>Until<input id="motivoSchedNoticeEnd" type="datetime-local" required></label><label>Internal reason<input id="motivoSchedNoticeReason" maxlength="200" minlength="4" placeholder="Unexpected shop closure" required></label></div>
      <div class="motivo-sched-actions"><button type="submit">Preview affected appointments</button></div></form>
      <div id="motivoSchedPreview" class="motivo-sched-preview" hidden></div>
      <label class="motivo-sched-confirm"><input id="motivoSchedConfirm" type="checkbox" disabled> I reviewed this preview and authorize sending real rescheduling emails.</label>
      <button id="motivoSchedNotify" class="motivo-sched-danger" type="button" disabled>Notify Affected Customers</button>
      <p class="motivo-sched-footnote">Customers without an email address and failed delivery attempts require manual follow-up. Sending notices doesn't block additional bookings.</p>
    </section>`;
  }
  function clearPreview() { previewKey=null; $('motivoSchedPreview').hidden=true; $('motivoSchedConfirm').checked=false; $('motivoSchedConfirm').disabled=true; $('motivoSchedNotify').disabled=true; }
  function bodyForNotice() {
    const body={kind:$('motivoSchedKind').value,start_at:$('motivoSchedNoticeStart').value,end_at:$('motivoSchedNoticeEnd').value,reason:$('motivoSchedNoticeReason').value.trim()};
    if(body.kind==='technician_absence')body.technician_id=Number($('motivoSchedAffectedTech').value);
    return body;
  }
  function setBusy(value) {busy=value;document.querySelectorAll('#motivoSchedPanel button').forEach(b=>{ if(value)b.disabled=true; });if(!value){document.querySelectorAll('#motivoSchedPanel button').forEach(b=>b.disabled=false);$('motivoSchedNotify').disabled=!previewKey || !$('motivoSchedConfirm').checked;$('motivoSchedConfirm').disabled=!previewKey;}}
  async function run(work, success) { if(busy)return;setBusy(true);try{await work();status(success||'Changes saved.');}catch(err){status(err.message,true);}finally{setBusy(false);} }
  async function refresh() {
    const data=await api('/config');
    $('motivoSchedTimezone').value=data.settings.timezone;
    $('motivoSchedSlot').value=String(data.settings.slot_minutes);
    $('motivoSchedPolicy').value=data.settings.confirmation_policy;
    const hours=data.hours||[];
    $('motivoSchedDays').innerHTML=days.map((name,weekday)=>{
      const h=hours.find(x=>Number(x.weekday)===weekday)||{is_open:0,opens_at:'08:00',closes_at:'17:00'};
      return `<div class="motivo-sched-day" data-weekday="${weekday}"><label class="motivo-sched-check"><input type="checkbox" class="sched-open" ${h.is_open?'checked':''}>${name}</label><input type="time" class="sched-start" aria-label="${name} opening time" value="${esc(h.opens_at||'08:00')}"><span>to</span><input type="time" class="sched-end" aria-label="${name} closing time" value="${esc(h.closes_at||'17:00')}"></div>`;
    }).join('');
    const technicians=data.technicians||[];
    const techOptions=technicians.map(t=>`<option value="${Number(t.id)}">${esc(t.username)}</option>`).join('');
    $('motivoSchedTech').innerHTML=techOptions;
    $('motivoSchedAffectedTech').innerHTML=techOptions;
    $('motivoSchedBays').innerHTML=(data.bays||[]).map(b=>`<div><span>${esc(b.name)} · ${b.is_active?'Active':'Unavailable'}</span><button data-bay="${Number(b.id)}" data-active="${b.is_active?0:1}" type="button">${b.is_active?'Deactivate':'Activate'}</button></div>`).join('') || '<p>No service bays configured.</p>';
    $('motivoSchedShifts').innerHTML=(data.shifts||[]).map(s=>`<div><span>${esc(technicians.find(t=>Number(t.id)===Number(s.technician_id))?.username||'Technician')} · ${days[Number(s.weekday)]} ${esc(s.starts_at)}–${esc(s.ends_at)}</span><button data-shift="${Number(s.id)}" type="button">Remove</button></div>`).join('') || '<p>No shifts configured.</p>';
    $('motivoSchedClosures').innerHTML=(data.closures||[]).map(c=>`<div><span>${esc(c.start_at)} → ${esc(c.end_at)} · ${esc(c.reason)}</span><button data-closure="${Number(c.id)}" type="button">Remove</button></div>`).join('') || '<p>No closures configured.</p>';
  }
  async function show() {
    if(!scheduler())return;
    active=true;
    const original=window.openStaffView;
    if(typeof original==='function')original('overview');
    $('motivoOpsOverview')?.classList.add('hidden');
    const panel=$('motivoSchedPanel');panel.classList.remove('hidden');
    document.querySelectorAll('[data-motivo-ops-view]').forEach(b=>{b.classList.remove('is-active');b.removeAttribute('aria-current');});
    const nav=$('motivoSchedNav');nav?.classList.add('is-active');nav?.setAttribute('aria-current','page');
    status('Loading scheduling settings...');
    try{await refresh();status('Shop scheduling settings loaded. Booking availability is not yet enforced.');loaded=true;}catch(e){status(e.message,true);}
  }
  function install() {
    const dashboard=$('employeeDashboard'),sidebar=$('motivoOpsSidebar');if(!dashboard||!sidebar)return;
    const nav=document.createElement('button');nav.type='button';nav.id='motivoSchedNav';nav.textContent='▦  Scheduling & Availability';nav.hidden=true;
    sidebar.querySelector('nav')?.append(nav);
    const panel=document.createElement('section');panel.id='motivoSchedPanel';panel.className='motivo-sched-panel hidden';panel.innerHTML=html();dashboard.append(panel);
    nav.addEventListener('click',show);
    const sync=()=>{nav.hidden=!scheduler();if(!scheduler()){panel.classList.add('hidden');active=false;}const badge=$('userRoleBadge');if(badge && localStorage.getItem('role')==='service_advisor')badge.textContent='Service Advisor / Front Desk';};
    const originalOpen=window.openStaffView;
    if(typeof originalOpen==='function')window.openStaffView=function(which){if(which!=='scheduling'){panel.classList.add('hidden');active=false;}return originalOpen.apply(this,arguments);};
    const originalRender=window.renderDashboard;
    if(typeof originalRender==='function')window.renderDashboard=function(...args){const result=originalRender.apply(this,args);sync();return result;};
    const originalHeader=window.updateHeaderAuthButtons;
    if(typeof originalHeader==='function')window.updateHeaderAuthButtons=function(...args){const result=originalHeader.apply(this,args);sync();return result;};
    window.addEventListener('storage',e=>{if(['token','role'].includes(e.key))sync();});sync();
    $('motivoSchedConfigForm').addEventListener('submit',e=>{e.preventDefault();run(async()=>{
      const hours=[...document.querySelectorAll('#motivoSchedDays .motivo-sched-day')].map(row=>({weekday:Number(row.dataset.weekday),is_open:row.querySelector('.sched-open').checked,opens_at:row.querySelector('.sched-start').value,closes_at:row.querySelector('.sched-end').value}));
      await api('/config','PUT',{timezone:$('motivoSchedTimezone').value.trim(),confirmation_policy:$('motivoSchedPolicy').value,slot_minutes:Number($('motivoSchedSlot').value),hours});await refresh();
    },'Shop schedule saved. Existing customer bookings are not affected.');});
    $('motivoSchedBayForm').addEventListener('submit',e=>{e.preventDefault();run(async()=>{await api('/bays','POST',{name:$('motivoSchedBayName').value.trim()});$('motivoSchedBayName').value='';await refresh();},'Service bay added.');});
    $('motivoSchedShiftForm').addEventListener('submit',e=>{e.preventDefault();run(async()=>{await api('/shifts','POST',{technician_id:Number($('motivoSchedTech').value),weekday:Number($('motivoSchedShiftDay').value),starts_at:$('motivoSchedShiftStart').value,ends_at:$('motivoSchedShiftEnd').value});await refresh();},'Technician shift added.');});
    $('motivoSchedClosureForm').addEventListener('submit',e=>{e.preventDefault();run(async()=>{await api('/closures','POST',{start_at:$('motivoSchedClosureStart').value,end_at:$('motivoSchedClosureEnd').value,reason:$('motivoSchedClosureReason').value.trim()});await refresh();},'Closure saved. Existing appointments were not cancelled.');});
    panel.addEventListener('click',e=>{const btn=e.target.closest('button');if(!btn||busy)return;
      if(btn.dataset.bay){run(async()=>{await api(`/bays/${Number(btn.dataset.bay)}`,'PATCH',{is_active:btn.dataset.active==='1'});await refresh();},'Bay availability updated.');}
      if(btn.dataset.shift){run(async()=>{await api(`/shifts/${Number(btn.dataset.shift)}`,'DELETE');await refresh();},'Shift removed.');}
      if(btn.dataset.closure){run(async()=>{await api(`/closures/${Number(btn.dataset.closure)}`,'DELETE');await refresh();},'Closure removed.');}
    });
    $('motivoSchedKind').addEventListener('change',()=>{$('motivoSchedAffectedTechWrap').hidden=$('motivoSchedKind').value!=='technician_absence';clearPreview();});
    $('motivoSchedNoticeForm').addEventListener('input',clearPreview);
    $('motivoSchedNoticeForm').addEventListener('change',clearPreview);
    $('motivoSchedNoticeForm').addEventListener('submit',e=>{e.preventDefault();run(async()=>{
      const body=bodyForNotice();const result=await api('/disruptions/preview','POST',body);
      previewKey=JSON.stringify(body);
      $('motivoSchedPreview').hidden=false;
      $('motivoSchedPreview').textContent=`${result.count} affected appointment(s); ${result.with_email} have email addresses. Review before notifying.`;
      $('motivoSchedConfirm').disabled=result.count===0;
      if(result.count===0){previewKey=null;}
    },'Affected appointments previewed. No emails sent.');});
    $('motivoSchedConfirm').addEventListener('change',()=>{$('motivoSchedNotify').disabled=!previewKey||!$('motivoSchedConfirm').checked;});
    $('motivoSchedNotify').addEventListener('click',()=>{
      if(!previewKey||!$('motivoSchedConfirm').checked||JSON.stringify(bodyForNotice())!==previewKey||busy)return;
      const approved=JSON.parse(previewKey);clearPreview();run(async()=>{
        const result=await api('/disruptions/notify','POST',{...approved,confirm:true});
        $('motivoSchedPreview').hidden=false;
        $('motivoSchedPreview').textContent=`Sent: ${result.sent}; failed: ${result.failed}; already processed: ${result.already_processed}; without email: ${result.without_email}. Follow up manually where needed.`;
      },'Notification operation finished. Review results for any failed or missing-email deliveries.');
    });
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
})();

/* MOT-028 customer intake and Service Desk queue. API is authoritative. */
(()=>{'use strict';
const $=id=>document.getElementById(id);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const canSchedule=()=>localStorage.getItem('token')&&(typeof window.motivoPermissionAllowed==='function'?window.motivoPermissionAllowed('scheduling.manage'):['manager','service_advisor'].includes(localStorage.getItem('role')));
async function api(path,options={}){const r=await fetch('/api/mot028'+path,{...options,headers:{Authorization:'Bearer '+localStorage.getItem('token'),'Content-Type':'application/json',...(options.headers||{})}});const d=await r.json().catch(()=>({}));if(!r.ok)throw Error(d.error||`HTTP ${r.status}`);return d;}
function initCustomer(){
 const date=$('book_date'),time=$('book_time');
 const group=date?.closest('fieldset');if(group)group.hidden=true;
 if(date)date.required=false;if(time)time.required=false;
 window.handleBookAppointment=async function(event){
  event.preventDefault();const form=event.target;const btn=form.querySelector('[type=submit]');
  const payload={vin:$('book_vin')?.value.trim(),make:$('book_make')?.value.trim(),model:$('book_model')?.value.trim(),year:Number($('book_year')?.value),issue_description:$('book_issue')?.value.trim()};
  if(!payload.issue_description){window.showToast?.('Describe the service you need.','error');return;}
  if(btn)btn.disabled=true;
  try{const data=await api('/customer/request-appointment',{method:'POST',body:JSON.stringify(payload)});window.showToast?.(data.message,'success');window.switchCustomerTab?.('view-requests');window.loadCustomerProfile?.();loadMyAppointments();}
  catch(e){window.showToast?.(e.message,'error');}
  finally{if(btn)btn.disabled=false;}
 };
 const host=$('customerTab-view-requests')||$('customerTab-create-request');
 if(host&&!$('mot028MyAppointments')){const box=document.createElement('section');box.id='mot028MyAppointments';box.className='mot028-card';box.innerHTML='<h3>My appointment requests</h3><div id="mot028CustomerList" role="status">Loading...</div>';host.prepend(box);}
 loadMyAppointments();
}
async function loadMyAppointments(){const target=$('mot028CustomerList');if(!target||localStorage.getItem('role')!=='customer')return;try{const {appointments}=await api('/customer/appointments');target.innerHTML=appointments.length?appointments.map(a=>`<div class="mot028-request"><strong>Request #${Number(a.id)}</strong><span>${esc(a.booking_status)}</span><span>${a.scheduled_datetime?esc(a.scheduled_datetime.replace('T',' ')):'Awaiting Service Desk scheduling'}</span></div>`).join(''):'No appointment requests yet.';}catch(e){target.textContent='Appointments unavailable: '+e.message;}}
let selected=null;
async function refreshQueue(){const box=$('mot028Queue');if(!box||!canSchedule())return;box.textContent='Loading service requests...';try{const {requests}=await api('/desk/requests');box.innerHTML=requests.length?requests.map(r=>`<button type="button" class="mot028-request mot028-pick" data-id="${Number(r.id)}"><strong>#${Number(r.id)} · ${esc([r.first_name,r.last_name].filter(Boolean).join(' ')||'Customer')}</strong><span>${esc([r.year,r.make,r.model].filter(Boolean).join(' '))}</span><span>${esc(String(r.issue_description||'').slice(0,170))}</span></button>`).join(''):'No pending service requests.';box.querySelectorAll('[data-id]').forEach(b=>b.addEventListener('click',()=>{selected=Number(b.dataset.id);$('mot028Selected').textContent=`Request #${selected} selected`;refreshSlots();}));}catch(e){box.textContent=e.message;}}
async function refreshSlots(){const sel=$('mot028Slots'),date=$('mot028Date')?.value;if(!sel||!date)return;sel.innerHTML='<option value="">Loading availability...</option>';try{const data=await api('/desk/availability?date='+encodeURIComponent(date));sel.innerHTML='<option value="">Select an available 15-minute window</option>'+data.slots.map(s=>`<option value="${esc(s.time)}" ${s.available? '':'disabled'}>${esc(s.time)} · ${s.available}/${s.capacity} available</option>`).join('');}catch(e){sel.innerHTML='<option value="">Unavailable</option>';$('mot028DeskStatus').textContent=e.message;}}
function initDesk(){const panel=$('motivoSchedPanel');if(!panel||$('mot028Desk'))return;const section=document.createElement('section');section.id='mot028Desk';section.className='mot028-card';section.innerHTML=`<div class="mot028-head"><div><span class="mot028-eyebrow">SERVICE DESK</span><h3>Appointment requests</h3></div><button id="mot028Refresh" type="button">Refresh requests</button></div><div class="mot028-columns"><div><h4>Pending requests</h4><div id="mot028Queue" aria-live="polite"></div></div><form id="mot028Form"><h4>Schedule appointment</h4><p id="mot028Selected">Select a request on the left.</p><label>Date <input type="date" id="mot028Date" required></label><label>15-minute window <select id="mot028Slots" required><option value="">Choose a date</option></select></label><button type="submit">Confirm appointment</button><p id="mot028DeskStatus" role="status" aria-live="polite"></p></form></div>`;
 panel.prepend(section);
 $('mot028Refresh').addEventListener('click',refreshQueue);$('mot028Date').addEventListener('change',refreshSlots);
 $('mot028Form').addEventListener('submit',async e=>{e.preventDefault();const status=$('mot028DeskStatus');if(!selected){status.textContent='Select a pending request first.';return;}const date=$('mot028Date').value,time=$('mot028Slots').value;if(!date||!time)return;const btn=e.target.querySelector('[type=submit]');btn.disabled=true;try{const result=await api('/desk/requests/'+selected+'/confirm',{method:'POST',body:JSON.stringify({date,time})});status.textContent=result.email_status==='sent'?'Appointment confirmed. Confirmation email sent.':result.email_status==='missing_address'?'Appointment confirmed. Customer has no email address; contact manually.':'Appointment confirmed, but confirmation email was not delivered. Contact the customer manually.';selected=null;$('mot028Selected').textContent='Select a request on the left.';await Promise.all([refreshQueue(),refreshSlots()]);}catch(err){status.textContent=err.message;await refreshSlots();}finally{btn.disabled=false;}});
 document.querySelector('#motivoSchedNav')?.addEventListener('click',()=>{if(canSchedule())refreshQueue();});
 if(canSchedule())refreshQueue();
}
function start(){initCustomer();initDesk();window.addEventListener('motivo-permissions-updated',()=>{if(canSchedule())refreshQueue();});document.addEventListener('visibilitychange',()=>{if(!document.hidden){loadMyAppointments();if(canSchedule())refreshQueue();}});}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();

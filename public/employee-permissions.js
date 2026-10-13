/* MOT-029: individual employee permission editor. Backend remains authoritative. */
(() => {
'use strict';
const $=id=>document.getElementById(id);
const KEYS=[['customer','Customer'],['vehicle','Vehicle'],['appointment','Appointment'],['repair_order','Repair order'],['parts_labor','Parts & labor'],['estimate','Estimate'],['repair','Repair execution'],['invoice','Invoice'],['scheduling.manage','Scheduling & availability'],['notices.send','Send rescheduling emails']];
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const DEFAULTS={manager:KEYS.map(k=>k[0]),service_advisor:['customer','vehicle','appointment','repair_order','estimate','scheduling.manage','notices.send'],technician:['parts_labor','repair'],parts_manager:['parts_labor'],billing:['estimate','invoice']};
const mgr=()=>!!localStorage.getItem('token')&&localStorage.getItem('role')==='manager';
let effective=null,currentIdentity='',staff=null,selection=null;
window.motivoPermissionAllowed=k=>{
 if(!localStorage.getItem('token'))return false;
 if(effective&&currentIdentity===`${localStorage.getItem('company_id')}:${localStorage.getItem('user_id')}:${localStorage.getItem('role')}`)return effective[k]===true;
 return (DEFAULTS[localStorage.getItem('role')]||[]).includes(k);
};
async function request(path,method='GET',body){
 const r=await fetch('/api/employee-permissions'+path,{method,headers:{Authorization:`Bearer ${localStorage.getItem('token')}`,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
 const d=await r.json().catch(()=>({}));if(!r.ok)throw Error(d.error||'Request failed');return d;
}
async function sync(){
 const identity=`${localStorage.getItem('company_id')}:${localStorage.getItem('user_id')}:${localStorage.getItem('role')}`;
 if(!localStorage.getItem('token')){effective=null;currentIdentity='';return;}
 if(currentIdentity!==identity){effective=null;currentIdentity='';}
 try{
  const data=await request('/me');
  if(identity!==`${localStorage.getItem('company_id')}:${localStorage.getItem('user_id')}:${localStorage.getItem('role')}`)return;
  effective=data.permissions;currentIdentity=identity;
  if(typeof ROLE_MAP!=='undefined' && ROLE_MAP[data.role]){
   ROLE_MAP[data.role]=KEYS.filter(([key])=>!key.includes('.')&&effective[key]).map(([key])=>key);
   if(typeof window.applyRolePermissions==='function')window.applyRolePermissions(data.role);
  }
  window.dispatchEvent(new Event('motivo-permissions-updated'));
 }catch(e){console.warn('Could not refresh effective employee permissions.');}
}
function mount(){
 const host=$('motivoRolePermissions');if(!host)return;
 const box=document.createElement('section');box.id='motivoEmployeePermissions';box.className='mep-editor';
 // Keep individual editor AFTER Add Employee / Employee Roster, with Access Overview above them.
 const grid=document.querySelector('#managerControlPanel .staff-manager-grid');
 if(grid)grid.insertAdjacentElement('afterend',box);else host.insertAdjacentElement('afterend',box);
 box.innerHTML='<div class="mep-title"><h4>Employee permissions</h4></div><label>Employee <select id="mepEmployee"></select></label><div id="mepSettings"></div><div class="mep-actions"><button id="mepSave" type="button">Save employee permissions</button><button id="mepReset" type="button">Restore role defaults</button></div><p id="mepStatus" role="status" aria-live="polite"></p><div id="mepAudit"></div>';
 const status=t=>{$('mepStatus').textContent=t;};
 async function loadRoster(){
  if(!mgr()){box.hidden=true;return;}box.hidden=false;
  try{
   const r=await fetch('/api/manager/employees',{headers:{Authorization:`Bearer ${localStorage.getItem('token')}`}});if(!r.ok)throw Error('Could not load staff');
   staff=await r.json();const options=staff.filter(x=>x.role!=='manager');
   const select=$('mepEmployee');const previous=select.value;
   select.innerHTML=options.map(x=>`<option value="${Number(x.id)}">${esc(x.username)} (${esc(x.role)})</option>`).join('');
   if(options.some(x=>String(x.id)===previous))select.value=previous;
   if(options.length)await loadEmployee();else status('No non-manager employees to configure.');
  }catch(e){status(e.message);}
 }
 async function loadEmployee(){
  const id=Number($('mepEmployee').value);if(!id){selection=null;return;}
  try{
   const next=await request('/employees/'+id);
   if(Number($('mepEmployee').value)!==id)return;
   selection=next;renderSettings();
   const audit=await request('/employees/'+id+'/audit');
   $('mepAudit').textContent=`Recent permission changes: ${audit.entries.length}`;
   status('Loaded permissions for '+selection.employee.username+'.');
  }catch(e){status(e.message);}
 }
 function renderSettings(){
  $('mepSettings').innerHTML=KEYS.map(([k,label])=>{
   const value=selection.effective[k],base=selection.defaults[k],overridden=selection.overrides.find(x=>x.permission_key===k);
   return `<label class="mep-item"><span><strong>${esc(label)}</strong><small>Role default: ${base?'Allowed':'Denied'}${overridden?' · Custom':''}</small></span><input type="checkbox" data-permission="${esc(k)}" ${value?'checked':''}></label>`;
  }).join('');
 }
 async function save(reset=false){
  if(!selection)return;
  const id=selection.employee.id;const overrides={};
  if(!reset)for(const el of $('mepSettings').querySelectorAll('input[data-permission]')){
   const key=el.dataset.permission;if(el.checked!==selection.defaults[key])overrides[key]=el.checked;
  }
  $('mepSave').disabled=true;$('mepReset').disabled=true;
  try{
   await request('/employees/'+id,'PUT',{overrides});
   await loadEmployee();
   status('Permissions saved.');
   document.dispatchEvent(new CustomEvent('motivo-employee-permissions-saved',{detail:{employeeId:id}}));
  }catch(e){status(e.message);}finally{$('mepSave').disabled=false;$('mepReset').disabled=false;}
 }
 $('mepEmployee').addEventListener('change',loadEmployee);
 $('mepSave').addEventListener('click',()=>save(false));$('mepReset').addEventListener('click',()=>save(true));
 document.querySelector('[data-motivo-ops-view="team"]')?.addEventListener('click',loadRoster);
 const original=window.openStaffView;
 if(typeof original==='function')window.openStaffView=function(view,...rest){const result=original.call(this,view,...rest);if(view==='team')loadRoster();return result;};
 if(mgr())loadRoster();else box.hidden=true;
 window.addEventListener('storage',()=>{box.hidden=!mgr();if(mgr())loadRoster();sync();});
 window.addEventListener('motivo-employee-view-refresh',()=>{if(mgr())loadRoster();else box.hidden=true;});
}
const start=()=>{
 mount();sync();
 const original=window.renderDashboard;
 if(typeof original==='function')window.renderDashboard=function(...args){const result=original.apply(this,args);sync();window.dispatchEvent(new Event('motivo-employee-view-refresh'));return result;};
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)sync();});
};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();

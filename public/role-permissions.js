/* Motivo Team Access: shop-scoped effective employee permissions overview. */
(() => {
  'use strict';
  const byId = id => document.getElementById(id);
  const KEYS = [
    ['customer','Customers'], ['vehicle','Vehicles'], ['appointment','Appointments'],
    ['repair_order','Repair orders'], ['parts_labor','Parts / labor'],
    ['estimate','Estimates'], ['repair','Repairs'], ['invoice','Invoices'],
    ['scheduling.manage','Scheduling'], ['notices.send','Reschedule emails']
  ];
  const DEFAULTS = {
    manager: KEYS.map(([key])=>key),
    service_advisor:['customer','vehicle','appointment','repair_order','estimate','scheduling.manage','notices.send'],
    technician:['parts_labor','repair'], parts_manager:['parts_labor'], billing:['estimate','invoice']
  };
  const NAMES = {manager:'Manager',service_advisor:'Service Advisor / Front Desk',technician:'Technician',parts_manager:'Parts Manager',billing:'Billing'};
  const isManager = () => Boolean(localStorage.getItem('token')) && localStorage.getItem('role') === 'manager';
  const esc = value => String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const permitted = yes => yes ? '<span class="rp-yes" aria-label="Allowed" title="Allowed">&#10003;</span>' : '<span class="rp-no" aria-label="Not allowed" title="Not allowed">&mdash;</span>';
  const request = async path => {
    const res = await fetch(path,{headers:{Authorization:`Bearer ${localStorage.getItem('token')}`}});
    if(!res.ok) throw new Error(`Unable to load employee access (HTTP ${res.status}).`);
    return res.json();
  };
  let generation = 0;
  let busy = false;
  let rerun = false;
  function moveOverview() {
    const root=byId('motivoRolePermissions');
    const grid=document.querySelector('#managerControlPanel .staff-manager-grid');
    if(root && grid && root.nextElementSibling!==grid) grid.parentNode.insertBefore(root,grid);
  }
  function renderShell() {
    const root=byId('motivoRolePermissions');
    if(!root || !isManager()) return;
    moveOverview();
    root.innerHTML=`<header class="rp-toolbar"><div class="rp-toolbar-title"><span class="rp-kicker">TEAM ACCESS</span><h4>Access Overview</h4></div><button id="rp-refresh" type="button" aria-label="Refresh employee access">&#8635; Refresh</button></header>
      <div class="rp-stats"><div class="rp-stat"><span>Team members</span><strong id="rp-total">&mdash;</strong></div><div class="rp-stat"><span>Roles in use</span><strong id="rp-active">&mdash;</strong></div><div class="rp-stat"><span>Custom access profiles</span><strong id="rp-custom">&mdash;</strong></div></div>
      <div class="rp-matrix-header"><h5>Employee Access</h5><span class="rp-legend">&#10003; Allowed <span class="rp-no">&mdash; Denied</span></span></div>
      <div class="rp-table-scroll"><table><thead><tr><th scope="col">Employee</th>${KEYS.map(([,label])=>`<th scope="col">${esc(label)}</th>`).join('')}</tr></thead><tbody id="rp-employee-rows"><tr><td colspan="11">Loading employee access...</td></tr></tbody></table></div>
      <p class="rp-status" id="rp-status" role="status" aria-live="polite" hidden></p>`;
    byId('rp-refresh')?.addEventListener('click', refresh);
    refresh();
  }
  async function refresh(){
    if(!isManager()) return;
    if(busy){rerun=true;return;}
    const tbody=byId('rp-employee-rows');
    if(!tbody) return;
    busy=true;
    const seq=++generation;
    const refreshButton=byId('rp-refresh');
    const status=byId('rp-status');
    if(refreshButton) refreshButton.disabled=true;
    if(status){status.hidden=true;status.textContent='';}
    try{
      const staff=await request('/api/manager/employees');
      if(!Array.isArray(staff)) throw new Error('Unexpected employee roster response.');
      const employees=staff.filter(u=>Object.hasOwn(NAMES,u.role));
      // Managers always have all grants; only non-managers need override lookups.
      // For small/mid-size shops, request individual effective permissions in parallel.
      const details=await Promise.all(employees.map(async employee=>{
        if(employee.role==='manager') return {employee,effective:Object.fromEntries(KEYS.map(([k])=>[k,true])),custom:false};
        try {
          const entry=await request(`/api/employee-permissions/employees/${encodeURIComponent(employee.id)}`);
          return {employee,effective:entry.effective,custom:Array.isArray(entry.overrides)&&entry.overrides.length>0};
        } catch(error){return {employee,error};}
      }));
      if(seq!==generation||!isManager()||!byId('rp-employee-rows'))return;
      byId('rp-total').textContent=String(employees.length);
      byId('rp-active').textContent=String(new Set(employees.map(u=>u.role)).size);
      byId('rp-custom').textContent=String(details.filter(d=>d.custom).length);
      tbody.innerHTML=details.length?details.map(d=>{
        const u=d.employee;
        const role=NAMES[u.role]||u.role;
        return `<tr><th scope="row"><span class="rp-role-name">${esc(u.username)}</span><small class="rp-role-count">${esc(role)}</small>${d.custom?'<small class="rp-role-count">Custom access</small>':''}</th>${KEYS.map(([key])=>`<td>${d.error?'<span class="rp-no" title="Access unavailable">?</span>':permitted(Boolean(d.effective?.[key]))}</td>`).join('')}</tr>`;
      }).join(''):'<tr><td colspan="11">No employees found.</td></tr>';
      if(details.some(d=>d.error)&&status){status.hidden=false;status.textContent='Some employee permissions could not be loaded. Select Refresh to retry.';}
    }catch(error){
      if(status){status.hidden=false;status.textContent=error.message;}
      if(tbody)tbody.innerHTML='<tr><td colspan="11">Unable to load access data. Use Refresh to retry.</td></tr>';
    }finally{
      busy=false;
      if(refreshButton)refreshButton.disabled=false;
      if(rerun){rerun=false;refresh();}
    }
  }
  function install(){
    if(!byId('motivoRolePermissions'))return;
    moveOverview();
    renderShell();
    document.querySelector('[data-motivo-ops-view="team"]')?.addEventListener('click',()=>{if(isManager())refresh();});
    document.addEventListener('click',event=>{
      if(event.target.closest('[onclick*="openStaffView(\'team\')"]')&&isManager())refresh();
    });
    document.addEventListener('motivo-employee-permissions-saved',()=>{if(isManager())refresh();});
    document.addEventListener('motivo-employee-view-refresh',()=>{if(isManager())refresh();});
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
})();

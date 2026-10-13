/* Motivo Team Access dashboard: role defaults and shop-scoped staff counts.
 * Display only. Effective employee access is edited in MOT-029 below.
 */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const roles = [
    {key:'manager',name:'Manager',short:'Manager',workflow:['customer','vehicle','appointment','repair_order','parts_labor','estimate','repair','invoice'],scheduling:true,team:true},
    {key:'service_advisor',name:'Service Advisor / Front Desk',short:'Front Desk',workflow:['customer','vehicle','appointment','repair_order','estimate'],scheduling:true,team:false},
    {key:'technician',name:'Technician',short:'Technician',workflow:['parts_labor','repair'],scheduling:false,team:false},
    {key:'parts_manager',name:'Parts Manager',short:'Parts Manager',workflow:['parts_labor'],scheduling:false,team:false},
    {key:'billing',name:'Billing',short:'Billing',workflow:['estimate','invoice'],scheduling:false,team:false}
  ];
  const columns = [
    ['customer','Customers'], ['vehicle','Vehicles'], ['appointment','Appointments'],
    ['repair_order','Repair orders'], ['parts_labor','Parts / labor'], ['estimate','Estimates'],
    ['repair','Repairs'], ['invoice','Invoices'], ['scheduling','Scheduling'], ['team','Manage staff']
  ];
  const esc = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const isManager = () => Boolean(localStorage.getItem('token')) && localStorage.getItem('role') === 'manager';
  const permitted = (r,key) => key==='scheduling' ? r.scheduling : key==='team' ? r.team : r.workflow.includes(key);
  const mark = allowed => allowed
    ? '<span class="rp-yes" aria-label="Included in role defaults" title="Included in role defaults">&#10003;</span>'
    : '<span class="rp-no" aria-label="Not included in role defaults" title="Not included in role defaults">&mdash;</span>';
  let refreshId = 0;
  function render() {
    const root = $('motivoRolePermissions');
    if (!root || !isManager()) return;
    const head = '<thead><tr><th scope="col">Role</th>' + columns.map(c=>`<th scope="col">${esc(c[1])}</th>`).join('') + '</tr></thead>';
    const body = '<tbody>' + roles.map(role=>`<tr><th scope="row"><span class="rp-role-name">${esc(role.name)}</span><span class="rp-role-count" id="rp-count-${role.key}">0 employees</span></th>${columns.map(c=>`<td>${mark(permitted(role,c[0]))}</td>`).join('')}</tr>`).join('') + '</tbody>';
    root.innerHTML = `
      <div class="rp-toolbar">
        <div class="rp-toolbar-title"><span class="rp-kicker">TEAM ACCESS</span><h4>Access Overview</h4></div>
        <button id="rp-refresh" type="button" aria-label="Refresh team access dashboard" title="Refresh team access dashboard">&#8635; <span>Refresh</span></button>
      </div>
      <div class="rp-stats" aria-label="Shop staff overview">
        <div class="rp-stat"><span>Team members</span><strong id="rp-total">&mdash;</strong></div>
        <div class="rp-stat"><span>Roles in use</span><strong id="rp-active">&mdash;</strong></div>
        <div class="rp-stat"><span>Staff roles</span><strong>${roles.length}</strong></div>
      </div>
      <div class="rp-matrix-header"><h5>Role Defaults</h5><span class="rp-legend"><span class="rp-yes" aria-hidden="true">&#10003;</span> Included <span class="rp-no" aria-hidden="true">&mdash;</span> Not included</span></div>
      <div class="rp-table-scroll" role="region" aria-label="Default access by staff role" tabindex="0"><table>${head}${body}</table></div>
      <p class="rp-status" id="rp-status" role="status" aria-live="polite" hidden></p>`;
    $('rp-refresh').addEventListener('click', refreshCounts);
    refreshCounts();
  }
  async function refreshCounts() {
    if (!isManager() || !$('motivoRolePermissions')) return;
    const seq = ++refreshId;
    const status = $('rp-status');
    const button = $('rp-refresh');
    if (status) { status.hidden = true; status.textContent = ''; }
    if (button) button.disabled = true;
    try {
      const response = await fetch('/api/manager/employees', {headers:{Authorization:`Bearer ${localStorage.getItem('token')}`}});
      if (!response.ok) throw new Error('Unable to load team counts. Try Refresh.');
      const rows = await response.json();
      if (!Array.isArray(rows)) throw new Error('Unexpected employee roster response.');
      if (seq !== refreshId || !isManager()) return;
      const counts = new Map(roles.map(r=>[r.key,0]));
      for (const employee of rows) if (counts.has(employee.role)) counts.set(employee.role,counts.get(employee.role)+1);
      for (const role of roles) {
        const el = $(`rp-count-${role.key}`);
        const count = counts.get(role.key);
        if (el) el.textContent = `${count} ${count === 1 ? 'employee' : 'employees'}`;
      }
      if ($('rp-total')) $('rp-total').textContent = String(rows.filter(u=>counts.has(u.role)).length);
      if ($('rp-active')) $('rp-active').textContent = String([...counts.values()].filter(n=>n>0).length);
    } catch (err) {
      if (seq === refreshId && status) { status.textContent = err.message; status.hidden = false; }
    } finally {
      if (seq === refreshId && button) button.disabled = false;
    }
  }
  function install() {
    if (!$('motivoRolePermissions')) return;
    render();
    document.querySelector('[data-motivo-ops-view="team"]')?.addEventListener('click',()=>{if(isManager()) render();});
    document.addEventListener('click', event=>{
      if (event.target.closest('#motivoRolePermissions')) return;
      if (event.target.closest('[onclick*="openStaffView(\'team\')"]') && isManager()) render();
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, {once:true});
  else install();
})();

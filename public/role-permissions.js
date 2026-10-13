/* Motivo read-only access reference, release RP-1.
 * Mirrors reviewed backend rules at GitHub main b2a9d207 (2026-10-13).
 * The API remains the only authority; this file does not grant permissions.
 */
(() => {
  'use strict';
  const el = id => document.getElementById(id);
  const roles = [
    {key:'manager',name:'Manager',workflow:['customer','vehicle','appointment','repair_order','parts_labor','estimate','repair','invoice'],scheduling:true,team:true},
    {key:'service_advisor',name:'Service Advisor / Front Desk',workflow:['customer','vehicle','appointment','repair_order','estimate'],scheduling:true,team:false},
    {key:'technician',name:'Technician',workflow:['parts_labor','repair'],scheduling:false,team:false},
    {key:'parts_manager',name:'Parts Manager',workflow:['parts_labor'],scheduling:false,team:false},
    {key:'billing',name:'Billing',workflow:['estimate','invoice'],scheduling:false,team:false}
  ];
  const cols = [
    ['customer','Customer'],['vehicle','Vehicle'],['appointment','Appointment'],
    ['repair_order','Repair Order'],['parts_labor','Parts & Labor'],
    ['estimate','Estimate'],['repair','Repair'],['invoice','Invoice'],
    ['scheduling','Scheduling'],['team','Employee Management']
  ];
  const escapeHtml = input => String(input).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const check = permitted => permitted ? '<span class="rp-yes" aria-label="Allowed">Yes</span>' : '<span class="rp-no" aria-label="Not allowed">—</span>';
  const manager = () => Boolean(localStorage.getItem('token')) && localStorage.getItem('role')==='manager';
  function render() {
    const root=el('motivoRolePermissions');
    if(!root || !manager()) return;
    const table = '<div class="rp-table-scroll"><table><thead><tr><th scope="col">Role</th>'+cols.map(c=>`<th scope="col">${escapeHtml(c[1])}</th>`).join('')+'</tr></thead><tbody>'+
      roles.map(role=>`<tr><th scope="row">${escapeHtml(role.name)} <small id="rp-count-${role.key}"></small></th>`+cols.map(c=>`<td>${check(c[0]==='scheduling'?role.scheduling:c[0]==='team'?role.team:role.workflow.includes(c[0]))}</td>`).join('')+'</tr>').join('')+'</tbody></table></div>';
    root.innerHTML=`<header class="rp-heading"><div><span class="rp-kicker">ACCESS REFERENCE</span><h4>Roles &amp; Permissions</h4><p>Current predefined role access for this shop. This is a reference, not an editor.</p></div><button id="rp-refresh" type="button">Refresh staff counts</button></header>`+
      '<div class="rp-note"><strong>Important:</strong> Workflow columns describe department editing permissions. Scheduling and employee management are separate API protections. Other actions (such as job visibility or job claiming) may use additional route-specific rules.</div>'+table+
      '<p class="rp-foot">Permissions are defined in backend code, not in the MySQL users table. Role counts come from this shop only. Changes to backend permissions must be reflected in this reference.</p><p class="rp-status" id="rp-status" role="status" aria-live="polite"></p>';
    el('rp-refresh').addEventListener('click',refreshCounts);
    refreshCounts();
  }
  async function refreshCounts(){
    if(!manager()) return;
    const status=el('rp-status'); if(status) status.textContent='Loading this shop’s employee counts…';
    try {
      const res=await fetch('/api/manager/employees',{headers:{Authorization:`Bearer ${localStorage.getItem('token')}`}});
      if(!res.ok) throw new Error(`Employee roster unavailable (HTTP ${res.status})`);
      const rows=await res.json();if(!Array.isArray(rows))throw new Error('Unexpected roster response');
      for (const role of roles) {
        const target=el(`rp-count-${role.key}`);
        if(target)target.textContent=`(${rows.filter(u=>u.role===role.key).length})`;
      }
      if(status)status.textContent='Showing employee counts for your shop.';
    } catch(err) {if(status)status.textContent=`Unable to refresh counts: ${err.message}`;}
  }
  const install=()=>{
    const root=el('motivoRolePermissions');if(!root)return;
    render();
    // Team Access may be opened after login; refresh only when a manager opens it.
    document.querySelector('[data-motivo-ops-view="team"]')?.addEventListener('click',()=>{if(manager())render();});
    document.addEventListener('click',e=>{if(e.target.closest('#motivoRolePermissions'))return; if(e.target.closest('[onclick*="openStaffView(\'team\')"]') && manager())render();});
  };
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
})();

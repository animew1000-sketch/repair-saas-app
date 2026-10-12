/* Motivo staff operations dashboard: frontend-only, sourced from permitted job API results. */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const colors = ['#173c3b','#e86642','#86a79b','#e0ad67','#637a8f','#b9c9b4'];
  const staff = () => Boolean(localStorage.getItem('token')) && localStorage.getItem('role') !== 'customer';
  const manager = () => localStorage.getItem('role') === 'manager';
  let current = 'overview';
  let mobileOpen = false;
  const records = () => Array.isArray(window.staffJobs) ? window.staffJobs : (typeof staffJobs !== 'undefined' && Array.isArray(staffJobs) ? staffJobs : []);
  function permittedJobs() {
    const jobs = records();
    const role = localStorage.getItem('role');
    const uid = Number(localStorage.getItem('user_id'));
    return role === 'technician' ? jobs.filter(j => Number(j.assigned_staff_id) === uid) : jobs;
  }
  function make(tag, cls, value) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (value !== undefined) e.textContent = String(value);
    return e;
  }
  function chart(host, entries, emptyText) {
    host.replaceChildren();
    const total = entries.reduce((s, e) => s + e.count, 0);
    if (!total) { host.append(make('p','motivo-ops-empty',emptyText)); return; }
    const chartBox = make('div','motivo-ops-chart-wrap');
    const circle = make('div','motivo-ops-pie');
    circle.setAttribute('role','img');
    circle.setAttribute('aria-label', entries.map(e => `${e.name}: ${e.count}`).join(', '));
    let at = 0;
    const slices = entries.map((e,i) => {
      const next = at + (e.count/total)*100;
      const piece = `${colors[i % colors.length]} ${at.toFixed(3)}% ${next.toFixed(3)}%`;
      at = next;
      return piece;
    });
    circle.style.background = `conic-gradient(${slices.join(', ')})`;
    circle.append(make('span','motivo-ops-pie-center',String(total)));
    const legend = make('ul','motivo-ops-legend');
    entries.forEach((entry, i) => {
      const li = make('li');
      const swatch = make('span','motivo-ops-swatch');
      swatch.style.backgroundColor = colors[i % colors.length];
      swatch.setAttribute('aria-hidden','true');
      li.append(swatch,make('span','',entry.name),make('strong','',entry.count));
      legend.append(li);
    });
    chartBox.append(circle, legend);
    host.append(chartBox);
  }
  function categories(jobs, getLabel) {
    const counts = new Map();
    jobs.forEach(j => {
      const s = getLabel(j);
      counts.set(s, (counts.get(s) || 0) + 1);
    });
    const ranked = [...counts].map(([name,count]) => ({name,count})).sort((a,b) => b.count-a.count);
    if (ranked.length <= 6) return ranked;
    return [...ranked.slice(0,5),{name:'Other',count:ranked.slice(5).reduce((n,e)=>n+e.count,0)}];
  }
  function render() {
    if (!staff() || !$('motivoOpsOverview')) return;
    const jobs = permittedJobs();
    const active = jobs.filter(j => String(j.status || '').toLowerCase() !== 'completed');
    const completed = jobs.length - active.length;
    const unassigned = jobs.filter(j => !j.assigned_staff_id && String(j.status || '').toLowerCase() !== 'completed').length;
    const summary = $('motivoOpsSummary');
    summary.replaceChildren();
    [['Visible jobs',jobs.length],['Active jobs',active.length],['Completed',completed],['Unassigned',unassigned]].forEach(([name,count]) => {
      const card=make('div','motivo-ops-stat');
      card.append(make('span','',name),make('strong','',count));
      summary.append(card);
    });
    chart($('motivoOpsStatusChart'),categories(jobs,j => String(j.status||'Unknown')),'No repair jobs to chart yet.');
    const workloadCard = $('motivoOpsWorkloadCard');
    workloadCard.hidden = !manager();
    if (manager()) chart($('motivoOpsWorkloadChart'), categories(jobs,j => String(j.assigned_staff_name || 'Unassigned')),'No technician assignments available yet.');
    const recent = $('motivoOpsRecent');
    recent.replaceChildren();
    const sorted = [...jobs].sort((a,b) => {
      const da=Date.parse(a.created_at||a.scheduled_datetime||'')||0;
      const db=Date.parse(b.created_at||b.scheduled_datetime||'')||0;
      return db-da || Number(b.id||0)-Number(a.id||0);
    }).slice(0,5);
    if (!sorted.length) recent.append(make('p','motivo-ops-empty','No jobs are available in your account yet.'));
    sorted.forEach(j => {
      const button = make('button','motivo-ops-recent-row');
      button.type='button';
      const left=make('span','motivo-ops-recent-info');
      left.append(make('strong','',`#${j.job_number || j.id} · ${[j.year,j.make,j.model].filter(Boolean).join(' ') || 'Repair job'}`),make('small','',String(j.status || 'Unknown')));
      button.append(left,make('span','motivo-ops-recent-arrow','Open →'));
      button.addEventListener('click',() => window.openStaffJob?.(Number(j.id)));
      recent.append(button);
    });
    $('motivoOpsScope').textContent = manager() ? 'Shop-wide records you can access' : localStorage.getItem('role') === 'technician' ? 'Your assigned repair records' : 'Records available to your account';
  }
  function view(which) {
    if (!staff()) return;
    if (which === 'team' && !manager()) return;
    if (which === 'workflow' && !$('activeJobId')?.value) which = 'jobs';
    current = which;
    $('motivoOpsOverview')?.classList.toggle('hidden',which !== 'overview');
    document.querySelectorAll('[data-motivo-ops-view]').forEach(b => {
      const selected=b.dataset.motivoOpsView === which;
      b.classList.toggle('is-active',selected);
      if (selected) b.setAttribute('aria-current','page'); else b.removeAttribute('aria-current');
    });
    if (which === 'overview') {
      $('staffJobsSection')?.classList.add('hidden');
      $('staffWorkflowSection')?.classList.add('hidden');
      $('managerControlPanel')?.classList.add('hidden');
      render();
    }
    if (mobileOpen) toggleMenu(false);
  }
  function toggleMenu(force) {
    mobileOpen = typeof force === 'boolean' ? force : !mobileOpen;
    $('motivoOpsSidebar')?.classList.toggle('is-open',mobileOpen);
    $('motivoOpsMenuToggle')?.setAttribute('aria-expanded',String(mobileOpen));
  }
  function syncAuthenticatedNavigation() {
    const loggedIn = Boolean(localStorage.getItem('token'));
    document.body.classList.toggle('motivo-authenticated', loggedIn);
    if (loggedIn) {
      document.body.classList.remove('motivo-menu-open');
      const oldToggle = document.querySelector('.motivo-menu-toggle');
      if (oldToggle) oldToggle.setAttribute('aria-expanded', 'false');
    }
  }
  function install() {
    syncAuthenticatedNavigation();
    const originalUpdateHeader = window.updateHeaderAuthButtons;
    if (typeof originalUpdateHeader === 'function') {
      window.updateHeaderAuthButtons = function(...args) {
        const result = originalUpdateHeader.apply(this, args);
        syncAuthenticatedNavigation();
        return result;
      };
    }
    const dash=$('employeeDashboard');
    if (!dash) return;
    const nav=$('motivoOpsSidebar');
    nav?.querySelectorAll('[data-motivo-ops-view]').forEach(b=>b.addEventListener('click',()=>window.openStaffView(b.dataset.motivoOpsView)));
    $('motivoOpsMenuToggle')?.addEventListener('click',()=>toggleMenu());
    $('motivoOpsBrowseJobs')?.addEventListener('click',()=>window.openStaffView('jobs'));
    $('motivoOpsRecentAll')?.addEventListener('click',()=>window.openStaffView('jobs'));
    const originalView=window.openStaffView;
    if (typeof originalView === 'function') {
      window.openStaffView=function(which) {
        if (which === 'overview') { view('overview'); return; }
        if (which === 'team' && !manager()) return originalView('team');
        originalView(which);
        view(which);
      };
    }
    const originalLoad=window.loadStaffJobs;
    if (typeof originalLoad === 'function') {
      window.loadStaffJobs=async function(...args) {
        const result=await originalLoad.apply(this,args);
        render();
        return result;
      };
    }
    const originalRender=window.renderDashboard;
    if (typeof originalRender === 'function') {
      window.renderDashboard=function(...args) {
        const result=originalRender.apply(this,args);
        if (staff()) window.openStaffView?.('overview');
        return result;
      };
    }
    const originalShow=window.showScreen;
    if (typeof originalShow === 'function') {
      window.showScreen=function(...args) {
        const result=originalShow.apply(this,args);
        syncAuthenticatedNavigation();
        if (args[0] === 'employeeDashboard' && staff()) {
          nav?.classList.toggle('motivo-ops-manager',manager());
          render();
        }
        return result;
      };
    }
    window.addEventListener('storage', event => { if (event.key === 'token') syncAuthenticatedNavigation(); });
    if (staff() && !dash.classList.contains('hidden')) {
      nav?.classList.toggle('motivo-ops-manager',manager());
      window.openStaffView?.('overview');
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',install,{once:true}); else install();
})();

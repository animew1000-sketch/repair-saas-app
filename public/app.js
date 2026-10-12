// MOT-001: 30-minute idle sessions with short-lived access JWT renewal.
// Access JWTs remain in the existing storage until the separate CSP/storage hardening task.
const MOTIVO_IDLE_MS = 30 * 60 * 1000;
const MOTIVO_ACTIVITY_KEY = 'motivo_last_active_at';
const motivoNativeFetch = window.fetch.bind(window);
let motivoRenewPromise = null;
let motivoLastActivityWrite = 0;
const MOTIVO_WARNING_MS = 60 * 1000;
let motivoSessionDialog = null;
let motivoDialogBusy = false;
let motivoDialogReturnFocus = null;

function motivoIdleAge() {
  const timestamp = Number(localStorage.getItem(MOTIVO_ACTIVITY_KEY));
  return timestamp ? Date.now() - timestamp : Infinity;
}
function motivoRecordActivity() {
  if (!localStorage.getItem('token')) return;
  if (motivoSessionDialog && !motivoSessionDialog.hidden) return; // Only the explicit Stay Signed In action renews a warned session.
  if (motivoIdleAge() >= MOTIVO_IDLE_MS) return; // Expired sessions cannot be revived by a click.
  if (Date.now() - motivoLastActivityWrite < 15000) return;
  motivoLastActivityWrite = Date.now();
  localStorage.setItem(MOTIVO_ACTIVITY_KEY, String(motivoLastActivityWrite));
  // Record meaningful activity on the server; background polling never extends idle time.
  motivoNativeFetch('/api/session/activity',{method:'POST',credentials:'same-origin',cache:'no-store'})
    .then(res => { if (res.status === 401) motivoEndSession('Your session expired. Please sign in again.'); })
    .catch(() => {});
}
for (const eventName of ['pointerdown','keydown','scroll','touchstart']) {
  window.addEventListener(eventName, motivoRecordActivity, {passive:true});
}
function motivoJwtExpiresSoon(token) {
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));
    return !Number.isFinite(payload.exp) || payload.exp * 1000 < Date.now() + 90000;
  } catch (_) { return true; }
}
async function motivoRenewAccess() {
  if (motivoRenewPromise) return motivoRenewPromise;
  motivoRenewPromise = (async () => {
    const res = await motivoNativeFetch('/api/session/renew', {method:'POST',credentials:'same-origin',cache:'no-store'});
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (res.status === 401) motivoEndSession('Your session expired. Please sign in again.');
      throw new Error(data.error || 'Session renewal temporarily unavailable.');
    }
    localStorage.setItem('token',data.token);
    return data.token;
  })();
  try { return await motivoRenewPromise; }
  finally { motivoRenewPromise = null; }
}
function motivoEndSession(message) {
  if (!localStorage.getItem('token')) return;
  clearAuthSession();
  if (message) showToast(message,'error');
  showScreen('loginSection');
  updateHeaderAuthButtons();
}
window.fetch = async function motivoAuthenticatedFetch(resource, options = {}) {
  const url = typeof resource === 'string' ? resource : resource?.url || '';
  const isApi = /^\/api\//.test(url);
  const skip = /^\/api\/(login|register|session\/|health)/.test(url);
  if (isApi && !skip && localStorage.getItem('token')) {
    if (motivoIdleAge() >= MOTIVO_IDLE_MS) {
      motivoEndSession('You were signed out after 30 minutes of inactivity.');
      throw new Error('Session inactive');
    }
    const current = localStorage.getItem('token');
    if (motivoJwtExpiresSoon(current)) await motivoRenewAccess();
    // Rebuild only the Authorization header; keep all existing request options.
    const headers = new Headers(options.headers || (resource instanceof Request ? resource.headers : undefined));
    if (headers.has('Authorization')) headers.set('Authorization',`Bearer ${localStorage.getItem('token')}`);
    options = {...options,headers};
  }
  return motivoNativeFetch(resource,options);
};
// A focused, accessible inactivity warning. The server remains authoritative.
function motivoEnsureSessionDialog() {
  if (motivoSessionDialog) return motivoSessionDialog;
  const root = document.createElement('div');
  root.id = 'motivo-session-dialog';
  root.className = 'motivo-session-dialog';
  root.hidden = true;
  root.innerHTML = `
    <div class="motivo-session-panel" role="alertdialog" aria-modal="true"
      aria-labelledby="motivo-session-title" aria-describedby="motivo-session-description">
      <div class="motivo-session-icon" aria-hidden="true">&#9203;</div>
      <h2 id="motivo-session-title">Your session is about to expire</h2>
      <p id="motivo-session-description">You have been inactive. For your security, Motivo will sign you out shortly.</p>
      <div class="motivo-session-timer" aria-label="Time remaining">
        <span class="motivo-session-timer-label">TIME REMAINING</span>
        <strong id="motivo-session-countdown" role="timer" aria-live="off">01:00</strong>
      </div>
      <p id="motivo-session-error" class="motivo-session-error" role="alert" hidden></p>
      <div class="motivo-session-actions">
        <button type="button" id="motivo-session-signout">Sign Out</button>
        <button type="button" id="motivo-session-stay">Stay Signed In</button>
      </div>
    </div>`;
  document.body.appendChild(root);
  const stay = root.querySelector('#motivo-session-stay');
  const signout = root.querySelector('#motivo-session-signout');
  stay.addEventListener('click', motivoStaySignedIn);
  signout.addEventListener('click', () => { if (!motivoDialogBusy) logout(); });
  root.addEventListener('keydown', event => {
    if (event.key === 'Escape') event.preventDefault();
    if (event.key !== 'Tab') return;
    const focused = document.activeElement;
    if (event.shiftKey && focused === signout) { event.preventDefault(); stay.focus(); }
    else if (!event.shiftKey && focused === stay) { event.preventDefault(); signout.focus(); }
  });
  motivoSessionDialog = root;
  return root;
}
function motivoCloseSessionDialog() {
  if (!motivoSessionDialog || motivoSessionDialog.hidden) return;
  motivoSessionDialog.hidden = true;
  document.body.classList.remove('motivo-session-modal-open');
  if (motivoDialogReturnFocus?.isConnected) motivoDialogReturnFocus.focus();
  motivoDialogReturnFocus = null;
}
function motivoShowSessionDialog() {
  const dialog = motivoEnsureSessionDialog();
  if (!dialog.hidden) return;
  motivoDialogReturnFocus = document.activeElement;
  dialog.hidden = false;
  dialog.querySelector('#motivo-session-error').hidden = true;
  document.body.classList.add('motivo-session-modal-open');
  dialog.querySelector('#motivo-session-stay').focus();
}
function motivoSessionTick() {
  if (!localStorage.getItem('token')) { motivoCloseSessionDialog(); return; }
  const remaining = MOTIVO_IDLE_MS - motivoIdleAge();
  if (remaining <= 0) {
    motivoCloseSessionDialog();
    motivoEndSession('You were signed out after 30 minutes of inactivity.');
    return;
  }
  if (remaining <= MOTIVO_WARNING_MS) {
    motivoShowSessionDialog();
    const seconds = Math.ceil(remaining / 1000);
    const counter = motivoSessionDialog.querySelector('#motivo-session-countdown');
    counter.textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  } else {
    motivoCloseSessionDialog();
  }
}
async function motivoStaySignedIn() {
  if (motivoDialogBusy || !localStorage.getItem('token')) return;
  if (motivoIdleAge() >= MOTIVO_IDLE_MS) { motivoSessionTick(); return; }
  const dialog = motivoEnsureSessionDialog();
  const stay = dialog.querySelector('#motivo-session-stay');
  const signout = dialog.querySelector('#motivo-session-signout');
  const errorBox = dialog.querySelector('#motivo-session-error');
  motivoDialogBusy = true;
  stay.disabled = true;
  signout.disabled = true;
  stay.textContent = 'Renewing...';
  errorBox.hidden = true;
  try {
    const res = await motivoNativeFetch('/api/session/activity', {
      method: 'POST', credentials: 'same-origin', cache: 'no-store'
    });
    if (res.status === 401) {
      motivoEndSession('Your session expired. Please sign in again.');
      return;
    }
    if (!res.ok) throw new Error('Could not contact the session server.');
    // Refresh the short-lived access JWT without extending the 12-hour absolute session limit.
    await motivoRenewAccess();
    const now = Date.now();
    motivoLastActivityWrite = now;
    localStorage.setItem(MOTIVO_ACTIVITY_KEY, String(now));
    motivoCloseSessionDialog();
    motivoSessionTick();
  } catch (_) {
    if (localStorage.getItem('token')) {
      errorBox.textContent = 'Could not renew your session. Check your connection and try again.';
      errorBox.hidden = false;
    }
  } finally {
    motivoDialogBusy = false;
    stay.disabled = false;
    signout.disabled = false;
    stay.textContent = 'Stay Signed In';
  }
}
window.setInterval(() => {
  motivoSessionTick();
  // Renewal does not count as activity, and should never extend the idle timeout.
  if (localStorage.getItem('token') && motivoIdleAge() < MOTIVO_IDLE_MS - MOTIVO_WARNING_MS
      && motivoIdleAge() <= 4 * 60 * 1000 && document.visibilityState === 'visible'
      && motivoJwtExpiresSoon(localStorage.getItem('token'))) {
    motivoRenewAccess().catch(() => {});
  }
}, 1000);
window.addEventListener('visibilitychange',async () => {
  if (document.visibilityState === 'visible' && localStorage.getItem('token') && motivoIdleAge()<MOTIVO_IDLE_MS && motivoJwtExpiresSoon(localStorage.getItem('token'))) {
    try { await motivoRenewAccess(); } catch(_) {}
  }
});

let activeDept = 'customer';
let staffJobs = [];
let activeStaffJobFilter = 'current';
let staffJobSearchTerm = '';
let loadedCustomerList = [];
let currentShop = null;
let activeWorkflowRecord = null;
let activeRepairSection = 'overview';
const REPAIR_SECTIONS = {
  overview: { title: 'Job overview', detail: 'Customer, vehicle and appointment details together.', departments: ['customer','vehicle','appointment'] },
  inspection: { title: 'Inspection & diagnosis', detail: 'Review the reported concern and document the repair order. Structured inspection checklists will require a future backend update.', departments: ['repair_order'] },
  estimate: { title: 'Estimate & parts', detail: 'Review saved parts and labor line items, then edit the estimate. Customer authorization is not recorded by this screen.', departments: ['parts_labor','estimate'] },
  repair: { title: 'Repair execution', detail: 'Review and record the work performed.', departments: ['repair'] },
  checkout: { title: 'Invoice & pickup', detail: 'Review invoice records and handle final customer notifications.', departments: ['invoice'] }
};
const DEPT_LABELS = {customer:'Customer details',vehicle:'Vehicle',appointment:'Appointment',repair_order:'Repair order',parts_labor:'Parts & labor',estimate:'Estimate',repair:'Repair notes',invoice:'Invoice'};



function showToast(message, type = 'info') {
  let container = document.getElementById('toastContainer');

  if (!container) {
    container = document.createElement('div');
    container.id = 'toastContainer';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = `app-toast app-toast-${type}`;
  toast.setAttribute('role', type === 'error' ? 'alert' : 'status');

  toast.innerHTML = `
    <div class="app-toast-message"></div>
    <button
      class="app-toast-close"
      type="button"
      aria-label="Close notification"
    >
      ×
    </button>
  `;

  toast.querySelector('.app-toast-message').textContent = message;

  toast
    .querySelector('.app-toast-close')
    .addEventListener('click', () => {
      toast.remove();
    });

  container.appendChild(toast);

  requestAnimationFrame(() => {
    toast.classList.add('show');
  });

  setTimeout(() => {
    toast.classList.remove('show');

    setTimeout(() => {
      toast.remove();
    }, 250);
  }, 4500);
}

function clearAuthFormFields() {
  const fieldIds = [
    'login_input',
    'password',
    'reg_first_name',
    'reg_last_name',
    'reg_phone',
    'reg_email',
    'reg_username',
    'reg_password',
    'reg_notice_ack'
  ];

  fieldIds.forEach((id) => {
    const field = document.getElementById(id);

    if (!field) {
      return;
    }

    if (field.type === 'checkbox') {
      field.checked = false;
    } else {
      field.value = '';
    }
  });
}


function clearAuthSession() {
  motivoCloseSessionDialog();
  clearAuthFormFields();
  localStorage.removeItem('token');
  localStorage.removeItem('user_id');
  localStorage.removeItem('role');
  localStorage.removeItem('username');
  localStorage.removeItem('company_name');
  localStorage.removeItem('company_id');
  localStorage.removeItem('primary_color');
  localStorage.removeItem(MOTIVO_ACTIVITY_KEY);
}

function handleExpiredSession(res, data = {}) {
  const message =
    String(data?.error || '');

  const expired = res.status === 401 && ['SESSION_EXPIRED','TOKEN_INVALID','AUTH_REQUIRED'].includes(data?.code);

  if (!expired) {
    return false;
  }

  clearAuthSession();

  showToast(
    'Your session has expired. Please sign in again.',
    'error'
  );

  showScreen('loginSection');

  return true;
}

const ROLE_MAP = {
  service_advisor: [
    'customer',
    'vehicle',
    'appointment',
    'repair_order',
    'estimate'
  ],
  technician: ['parts_labor', 'repair'],
  parts_manager: ['parts_labor'],
  billing: ['estimate', 'invoice'],
  manager: [
    'customer',
    'vehicle',
    'appointment',
    'repair_order',
    'parts_labor',
    'estimate',
    'repair',
    'invoice'
  ]
};

const DEPT_FIELDS = {
  customer:
    '<input name="first_name" id="field_first_name" maxlength="100" placeholder="First Name" required />' +
    '<input name="last_name" id="field_last_name" maxlength="100" placeholder="Last Name" required />' +
    '<input name="phone" id="field_phone" type="tel" maxlength="20" data-input-type="phone" placeholder="Phone Number" required />',

  vehicle:
    '<input name="vin" id="field_vin" maxlength="17" minlength="17" data-input-type="vin" placeholder="17-Digit VIN" required />' +
    '<button type="button" onclick="lookupVinOnline()" style="margin-bottom:8px;">Search / Decode Any VIN Online</button>' +
    '<input name="make" id="field_make" maxlength="100" placeholder="Make" required />' +
    '<input name="model" id="field_model" maxlength="100" placeholder="Model" required />' +
    '<input name="year" id="field_year" type="number" min="1886" max="2100" step="1" data-input-type="year" placeholder="Year" required />',

  appointment:
    '<input name="scheduled_datetime" type="datetime-local" required />' +
    '<input name="service_advisor" maxlength="100" placeholder="Service Advisor" />',

  repair_order:
    '<input name="ro_number" maxlength="100" placeholder="RO Number" required />' +
    '<textarea name="issue_description" maxlength="5000" placeholder="Issue Description" required></textarea>',

  parts_labor:
    '<select name="item_type" required>' +
    '<option value="Part">Part</option>' +
    '<option value="Labor">Labor</option>' +
    '</select>' +
    '<select id="part_desc_select" onchange="autoFillPartName()">' +
    '<option value="">-- Choose Common Vehicle Replacement Part --</option>' +
    '<option value="Front Brake Rotors & Pads">Front Brake Rotors & Pads</option>' +
    '<option value="Engine Spark Plugs Set">Engine Spark Plugs Set</option>' +
    '<option value="High Performance Alternator">High Performance Alternator</option>' +
    '<option value="Synthetic Oil Filter">Synthetic Oil Filter</option>' +
    '</select>' +
    '<input name="description" id="part_desc" maxlength="255" placeholder="Part Description" required />' +
    '<input name="unit_cost" id="part_cost" type="number" min="0" max="99999999.99" step="0.01" data-input-type="money" placeholder="Cost ($)" required />',

  estimate:
    '<input name="estimated_total" type="number" min="0" max="99999999.99" step="0.01" data-input-type="money" placeholder="Estimated Total ($)" required />',

  repair:
    '<textarea name="work_summary" maxlength="5000" placeholder="Summary of performed repairs" required></textarea>',

  invoice:
    '<input name="invoice_number" maxlength="100" placeholder="Invoice #" required />' +
    '<input name="subtotal" type="number" min="0" max="99999999.99" step="0.01" data-input-type="money" placeholder="Subtotal ($)" required />' +
    '<input name="total_amount" type="number" min="0" max="99999999.99" step="0.01" data-input-type="money" placeholder="Total ($)" required />'
};


// ======================================================
// CLIENT-SIDE INPUT GUARDS
// ======================================================
function guardMoneyInput(input) {
  const value = input.value;

  if (value === '') {
    input.dataset.lastValid = '';
    return;
  }

  const validFormat =
    /^\d{0,8}(\.\d{0,2})?$/.test(value);

  if (!validFormat) {
    input.value =
      input.dataset.lastValid || '';
    return;
  }

  const numberValue = Number(value);

  if (
    !Number.isFinite(numberValue) ||
    numberValue < 0 ||
    numberValue > 99999999.99
  ) {
    input.value =
      input.dataset.lastValid || '';
    return;
  }

  input.dataset.lastValid = value;
}

function guardYearInput(input) {
  const value =
    input.value.replace(/\D/g, '').slice(0, 4);

  input.value = value;

  if (!value) {
    return;
  }

  const year = Number(value);

  if (year > 2100) {
    input.value = '2100';
  }
}

function guardVinInput(input) {
  input.value =
    input.value
      .toUpperCase()
      .replace(/[^A-HJ-NPR-Z0-9]/g, '')
      .slice(0, 17);
}

function guardPhoneInput(input) {
  input.value =
    input.value
      .replace(/[^0-9+\-() .]/g, '')
      .slice(0, 20);
}

document.addEventListener(
  'input',
  (event) => {
    const input = event.target;

    if (!(input instanceof HTMLInputElement)) {
      return;
    }

    const inputType =
      input.dataset.inputType;

    if (inputType === 'money') {
      guardMoneyInput(input);
    }

    if (inputType === 'year') {
      guardYearInput(input);
    }

    if (inputType === 'vin') {
      guardVinInput(input);
    }

    if (inputType === 'phone') {
      guardPhoneInput(input);
    }
  }
);

document.addEventListener(
  'keydown',
  (event) => {
    const input = event.target;

    if (!(input instanceof HTMLInputElement)) {
      return;
    }

    const inputType =
      input.dataset.inputType;

    if (
      inputType === 'money' &&
      ['e', 'E', '+', '-'].includes(event.key)
    ) {
      event.preventDefault();
    }

    if (
      inputType === 'year' &&
      ['e', 'E', '+', '-', '.'].includes(event.key)
    ) {
      event.preventDefault();
    }
  }
);

function applyShopThemeColor(colorHex) {
  const allowedGreen =
    ['#2e7d32', '#1b5e20', '#66bb6a', '#81c784'];

  const safeColor =
    allowedGreen.includes(String(colorHex).toLowerCase())
      ? String(colorHex).toLowerCase()
      : '#2e7d32';

  document.documentElement.style.setProperty('--primary', safeColor);
  document.documentElement.style.setProperty('--primary-hover', '#1b5e20');
}

async function loadShopLandingContext() {
  const slug = window.location.pathname.replace('/', '').trim();

  if (!slug) {
    return loadCompaniesDropdown();
  }

  const res = await fetch(`/api/companies/${slug}`);

  if (!res.ok) {
    return loadCompaniesDropdown();
  }

  currentShop = await res.json();

  document.getElementById('brandName').textContent =
    currentShop.company_name;

  document.getElementById('heroTitle').innerHTML =
    `${escapeHtml(currentShop.company_name)} <span>Portal</span>`;

  document.getElementById('heroSubtitle').textContent =
    currentShop.hero_text || currentShop.tagline;

  applyShopThemeColor(currentShop.primary_color);

  await loadCompaniesDropdown();

  if (currentShop) {
    document.getElementById('reg_company_id').value =
      currentShop.id;

    document.getElementById('login_company_id').value =
      currentShop.id;
  }
}

async function loadCompaniesDropdown() {
  const res = await fetch('/api/companies');

  if (!res.ok) {
    return;
  }

  const companies = await res.json();

  window.motivoCompanies = companies;

  const shopSearch =
    document.getElementById('motivo-shop-search');

  const shopSelect =
    document.getElementById('motivo-shop-select');

  function renderMotivoShopOptions(searchTerm = '') {
    if (!shopSelect) {
      return;
    }

    const normalizedSearch = searchTerm.trim().toLowerCase();
    const filteredCompanies = companies.filter((company) =>
      company.company_name.toLowerCase().includes(normalizedSearch)
    );

    shopSelect.innerHTML = filteredCompanies.length
      ? '<option value="">Select your shop...</option>' +
        filteredCompanies
          .map(
            (company) =>
              `<option value="${escapeHtml(company.id)}">${escapeHtml(company.company_name)}</option>`
          )
          .join('')
      : '<option value="">No shops found</option>';
  }

  renderMotivoShopOptions();

  if (shopSearch && !shopSearch.dataset.bound) {
    shopSearch.addEventListener('input', () => {
      renderMotivoShopOptions(shopSearch.value);
    });
    shopSearch.dataset.bound = 'true';
  }

  const regSelect =
    document.getElementById('reg_company_id');

  const loginSelect =
    document.getElementById('login_company_id');

  const optionsHtml = companies
    .map(
      (c) =>
        `<option value="${escapeHtml(c.id)}">${escapeHtml(c.company_name)}</option>`
    )
    .join('');

  if (regSelect) {
    regSelect.innerHTML = optionsHtml;
  }

  if (loginSelect) {
    loginSelect.innerHTML =
      '<option value="">-- Auto-Detect Shop by PIN/Account --</option>' +
      optionsHtml;
  }

  if (currentShop) {
    if (regSelect) {
      regSelect.value = currentShop.id;
    }

    if (loginSelect) {
      loginSelect.value = currentShop.id;
    }
  }
}

function startMotivoSignup() {
  const shopSelect =
    document.getElementById('motivo-shop-select');

  const selectedShopId = shopSelect?.value;

  if (!selectedShopId) {
    showToast('Choose your repair shop to continue.', 'error');
    shopSelect?.focus();
    return;
  }

  const registrationShop =
    document.getElementById('reg_company_id');

  if (registrationShop) {
    registrationShop.value = selectedShopId;
  }

  showScreen('registerSection');
}

function showScreen(screenId) {
  const token =
    localStorage.getItem('token');

  const role =
    localStorage.getItem('role');

  const protectedScreens = [
    'customerDashboard',
    'employeeDashboard'
  ];

  // ==================================================
  // BLOCK PROTECTED SCREENS WITHOUT LOGIN
  // ==================================================
  if (
    protectedScreens.includes(screenId) &&
    !token
  ) {
    showToast(
      'Please sign in to access the portal.',
      'error'
    );

    screenId = 'landingSection';
  }

  // ==================================================
  // BLOCK CUSTOMERS FROM EMPLOYEE DASHBOARD
  // ==================================================
  if (
    screenId === 'employeeDashboard' &&
    role === 'customer'
  ) {
    showToast(
      'You do not have permission to access the staff portal.',
      'error'
    );

    screenId = 'customerDashboard';
  }

  // ==================================================
  // BLOCK STAFF FROM CUSTOMER DASHBOARD
  // ==================================================
  if (
    screenId === 'customerDashboard' &&
    token &&
    role !== 'customer'
  ) {
    screenId = 'employeeDashboard';
  }

  if (
    ['landingSection', 'registerSection', 'loginSection']
      .includes(screenId)
  ) {
    clearAuthFormFields();
  }

  document
    .getElementById('landingSection')
    .classList.add('hidden');

  document
    .getElementById('registerSection')
    .classList.add('hidden');

  document
    .getElementById('loginSection')
    .classList.add('hidden');

  document
    .getElementById('customerDashboard')
    .classList.add('hidden');

  document
    .getElementById('employeeDashboard')
    .classList.add('hidden');

  document
    .getElementById(screenId)
    .classList.remove('hidden');
}

function switchCustomerTab(tabName) {
  const panels = [
    'home',
    'view-requests',
    'create-request',
    'contact-us',
    'settings'
  ];

  panels.forEach((name) => {
    const panel =
      document.getElementById(`customerTab-${name}`);

    if (panel) {
      panel.classList.add('hidden');
    }
  });

  document
    .querySelectorAll('.portal-tab')
    .forEach((el) => el.classList.remove('active'));

  document
    .querySelectorAll('[data-customer-nav]')
    .forEach((el) => {
      el.classList.toggle(
        'active',
        el.dataset.customerNav === tabName
      );
    });

  const activePanel =
    document.getElementById(`customerTab-${tabName}`);

  if (activePanel) {
    activePanel.classList.remove('hidden');
  }

  const legacyTab =
    document.getElementById(`tab-${tabName}`);

  if (legacyTab) {
    legacyTab.classList.add('active');
  }
}

function openCustomerPortalTab(tabName) {
  const token = localStorage.getItem('token');
  const role = localStorage.getItem('role');

  if (!token || role !== 'customer') {
    showScreen('landingSection');
    return;
  }

  showScreen('customerDashboard');
  switchCustomerTab(tabName);
}

function handleHomeNavigation() {
  const token = localStorage.getItem('token');
  const role = localStorage.getItem('role');

  if (token && role === 'customer') {
    openCustomerPortalTab('home');
    return;
  }

  if (token && role && role !== 'customer') {
    showScreen('employeeDashboard');
    return;
  }

  showScreen('landingSection');

  if (window.location.search) {
    window.history.replaceState({}, '', window.location.pathname);
  }
}

function toggleMotivoMenu(forceOpen) {
  const menu = document.getElementById('motivo-side-menu');
  const toggle = document.querySelector('.motivo-menu-toggle');

  if (!menu || !toggle) {
    return;
  }

  const shouldOpen =
    typeof forceOpen === 'boolean'
      ? forceOpen
      : !document.body.classList.contains('motivo-menu-open');

  document.body.classList.toggle('motivo-menu-open', shouldOpen);
  toggle.setAttribute('aria-expanded', String(shouldOpen));
  toggle.setAttribute(
    'aria-label',
    shouldOpen ? 'Close navigation menu' : 'Open navigation menu'
  );
}

document.addEventListener('click', (event) => {
  if (!document.body.classList.contains('motivo-menu-open')) {
    return;
  }

  if (!event.target.closest('.header')) {
    toggleMotivoMenu(false);
  }
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    toggleMotivoMenu(false);
  }
});

async function handleLogin(e) {
  e.preventDefault();

  const company_id =
    document.getElementById('login_company_id').value;

  const login_input =
    document.getElementById('login_input').value;

  const password =
    document.getElementById('password').value;

  const form = e.target;

  const loginButton =
    form.querySelector('button[type="submit"]');

  const originalButtonText =
    loginButton.innerHTML;

  // Show loading state
  loginButton.disabled = true;
  loginButton.innerHTML = `
    <span class="login-spinner"></span>
    Signing in...
  `;

  try {
    const res = await fetch('/api/login', {
      method: 'POST',

      headers: {
        'Content-Type': 'application/json'
      },

      body: JSON.stringify({
        company_id,
        login_input,
        password
      })
    });

    const data = await res.json();

    if (!res.ok) {
      showToast(data.error, 'error');
      return;
    }

    localStorage.setItem(
      'token',
      data.token
    );
    localStorage.setItem(MOTIVO_ACTIVITY_KEY, String(Date.now()));

    localStorage.setItem(
      'user_id',
      String(data.user_id || '')
    );

    localStorage.setItem(
      'role',
      data.role
    );

    localStorage.setItem(
      'username',
      data.username
    );

    localStorage.setItem(
      'company_name',
      data.company_name
    );

    localStorage.setItem(
      'company_id',
      String(data.company_id)
    );

    localStorage.setItem(
      'primary_color',
      data.primary_color || '#2e7d32'
    );

    renderDashboard();
  } catch (err) {
    console.error(
      'Login request error:',
      err
    );

    showToast(
      'Unable to connect to the server. Please try again.',
      'error'
    );
  } finally {
    // Restore button
    loginButton.disabled = false;
    loginButton.innerHTML =
      originalButtonText;
  }
}
function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

async function loadManagerStaffTable() {
  const res = await fetch('/api/manager/employees', {
    headers: {
      Authorization:
        `Bearer ${localStorage.getItem('token')}`
    }
  });

  if (!res.ok) {
    let errorData = {};

    try {
      errorData = await res.json();
    } catch (err) {
      // Ignore malformed error responses.
    }

    if (handleExpiredSession(res, errorData)) {
      return;
    }

    showToast(
      errorData.error ||
      'Unable to load the employee roster.',
      'error'
    );

    return;
  }

  const employees = await res.json();

  const tbody =
    document.getElementById('employeeRosterBody');

  tbody.innerHTML = employees
    .map(
      (emp) => `
        <tr>
          <td>${escapeHtml(emp.id)}</td>
          <td><strong>${escapeHtml(emp.username)}</strong></td>
          <td>${escapeHtml(emp.email || 'N/A')}</td>
          <td>
            <input
              type="password"
              id="pin_${emp.id}"
              inputmode="numeric"
              pattern="[0-9]{6}"
              maxlength="6"
              autocomplete="new-password"
              placeholder="New 6-digit PIN"
              style="width:145px; padding:6px;"
            />
          </td>
          <td>
            <select
              id="role_${emp.id}"
              style="padding:6px;"
            >
              <option value="manager" ${emp.role === 'manager' ? 'selected' : ''}>Manager</option>
              <option value="service_advisor" ${emp.role === 'service_advisor' ? 'selected' : ''}>Service Advisor</option>
              <option value="technician" ${emp.role === 'technician' ? 'selected' : ''}>Technician</option>
              <option value="parts_manager" ${emp.role === 'parts_manager' ? 'selected' : ''}>Parts Manager</option>
              <option value="billing" ${emp.role === 'billing' ? 'selected' : ''}>Billing Clerk</option>
            </select>
          </td>
          <td>
            <button
              type="button"
              onclick="saveEmployeeChanges(${Number(emp.id)})"
              style="margin:0; padding:6px 12px; font-size:0.8rem;"
            >
              Save Changes
            </button>
          </td>
        </tr>
      `
    )
    .join('');
}

async function handleCreateEmployee(e) {
  e.preventDefault();

  const payload = {
    username:
      document.getElementById('new_emp_username').value,

    email:
      document.getElementById('new_emp_email').value,

    pin_code:
      document.getElementById('new_emp_pin').value,

    role:
      document.getElementById('new_emp_role').value
  };

  const res = await fetch(
    '/api/manager/create-employee',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization:
          `Bearer ${localStorage.getItem('token')}`
      },
      body: JSON.stringify(payload)
    }
  );

  const data = await res.json();

  if (handleExpiredSession(res, data)) {
    return;
  }

  if (res.ok) {
    showToast(data.message, 'success');
    e.target.reset();
    loadManagerStaffTable();
  } else {
    showToast(data.error, 'error');
  }
}

async function saveEmployeeChanges(empId) {
  const pinInput =
    document.getElementById(`pin_${empId}`);

  const pin_code =
    pinInput.value.trim();

  const role =
    document.getElementById(`role_${empId}`).value;

  if (
    pin_code &&
    !/^\d{6}$/.test(pin_code)
  ) {
    showToast(
      'The new PIN must be exactly 6 digits.',
      'error'
    );

    pinInput.focus();
    return;
  }

  const res = await fetch(
    '/api/manager/update-employee',
    {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization:
          `Bearer ${localStorage.getItem('token')}`
      },
      body: JSON.stringify({
        id: empId,
        pin_code,
        role
      })
    }
  );

  const data = await res.json();

  if (handleExpiredSession(res, data)) {
    return;
  }

  if (res.ok) {
    showToast(
      data.message ||
      'Employee updated successfully.',
      'success'
    );

    pinInput.value = '';
    loadManagerStaffTable();
  } else {
    showToast(
      data.error ||
      'Unable to update employee.',
      'error'
    );
  }
}

// Shared VIN helper for staff and customer vehicle forms.
// VIN lookup is opt-in: users can always enter details manually.
async function decodeVinForFields(vinId, makeId, modelId, yearId, button) {
  const vinField = document.getElementById(vinId);
  const vin = String(vinField?.value || '').trim().toUpperCase();
  const vinPattern = /^[A-HJ-NPR-Z0-9]{17}$/;
  if (!vinPattern.test(vin)) {
    showToast('Enter a valid 17-character VIN (without I, O, or Q).', 'error');
    return;
  }

  const makeField = document.getElementById(makeId);
  const modelField = document.getElementById(modelId);
  const yearField = document.getElementById(yearId);
  if (!makeField || !modelField || !yearField) return;

  vinField.value = vin;
  const buttonToDisable = button || null;
  if (buttonToDisable) buttonToDisable.disabled = true;
  try {
    const res = await fetch(`/api/vehicle/vin-lookup/${encodeURIComponent(vin)}`, {
      headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
    });
    const data = await res.json();
    if (handleExpiredSession(res, data)) return;
    if (!res.ok) {
      showToast(data.error || 'VIN lookup failed. Enter vehicle details manually.', 'error');
      return;
    }

    // Only populate results if the user has not switched to a different VIN.
    if (vinField.value.trim().toUpperCase() !== vin) return;
    makeField.value = data.make || '';
    modelField.value = data.model || '';
    yearField.value = data.year || '';
    if (data.warning) {
      showToast(`NHTSA warning: ${data.warning} Verify the VIN and vehicle details.`, 'error');
    } else {
      showToast(`NHTSA decoded: ${data.year} ${data.make} ${data.model}`, 'success');
    }
  } catch (error) {
    showToast('VIN lookup unavailable. Enter vehicle details manually.', 'error');
  } finally {
    if (buttonToDisable) buttonToDisable.disabled = false;
  }
}

async function lookupVinOnline() {
  // Existing staff button retains its original handler.
  return decodeVinForFields('field_vin', 'field_make', 'field_model', 'field_year');
}

function autoFillPartName() {
  const val =
    document.getElementById('part_desc_select').value;

  if (val) {
    document.getElementById('part_desc').value = val;
  }
}

async function checkLivePartsPrice() {
  const desc =
    document.getElementById('part_desc').value;

  const jobId =
    document.getElementById('activeJobId').value;

  if (!desc) {
    showToast('Enter a part description first', 'error');
    return;
  }

  const res = await fetch(
    `/api/parts/catalog-lookup?jobId=${jobId}&partName=${encodeURIComponent(desc)}`,
    {
      headers: {
        Authorization:
          `Bearer ${localStorage.getItem('token')}`
      }
    }
  );

  const data = await res.json();

  if (handleExpiredSession(res, data)) {
    return;
  }

  if (res.ok) {
    document.getElementById('part_cost').value =
      data.market_price;

    showToast(
      `Online Price for ${data.vehicle}: $${data.market_price}`,
      'success'
    );
  }
}

async function handleRegister(e) {
  e.preventDefault();

  const payload = {
    company_id:
      document.getElementById('reg_company_id').value,

    first_name:
      document.getElementById('reg_first_name').value,

    last_name:
      document.getElementById('reg_last_name').value,

    phone:
      document.getElementById('reg_phone').value,

    email:
      document.getElementById('reg_email').value,

    username:
      document.getElementById('reg_username').value,

    password:
      document.getElementById('reg_password').value
  };

  const res = await fetch('/api/register', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  const data = await res.json();

  if (res.ok) {
    showToast(data.message, 'success');
    showScreen('loginSection');
  } else {
    showToast(data.error, 'error');
  }
}

async function handleBookAppointment(e) {
  e.preventDefault();

  const vin =
    document.getElementById('book_vin').value;

  if (vin.length !== 17) {
    showToast('VIN must be exactly 17 digits', 'error');
    return;
  }

  const appointmentDate =
    document.getElementById('book_date').value;

  const appointmentTime =
    document.getElementById('book_time').value;

  if (!appointmentDate || !appointmentTime) {
    showToast('Choose an appointment date and time.', 'error');
    return;
  }

  const payload = {
    vin,

    make:
      document.getElementById('book_make').value,

    model:
      document.getElementById('book_model').value,

    year:
      document.getElementById('book_year').value,

    scheduled_datetime:
      `${appointmentDate}T${appointmentTime}`,

    issue_description:
      document.getElementById('book_issue').value
  };

  const res = await fetch(
    '/api/customer/request-appointment',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization:
          `Bearer ${localStorage.getItem('token')}`
      },
      body: JSON.stringify(payload)
    }
  );

  const data = await res.json();

  if (handleExpiredSession(res, data)) {
    return;
  }

  if (res.ok) {
    showToast(data.message, 'success');
    switchCustomerTab('view-requests');
    loadCustomerProfile();
  } else {
    showToast(data.error, 'error');
  }
}

async function loadCustomerShopHome() {
  const shopName =
    localStorage.getItem('company_name') || 'Your Repair Shop';

  const shopNameEl =
    document.getElementById('customerHomeShopName');

  const shopHeadingEl =
    document.getElementById('customerHomeShopHeading');

  const shopTextEl =
    document.getElementById('customerHomeShopText');

  if (shopNameEl) {
    shopNameEl.textContent = shopName;
  }

  if (shopHeadingEl) {
    shopHeadingEl.textContent = shopName;
  }

  try {
    const companyId =
      Number(localStorage.getItem('company_id'));

    const res = await fetch('/api/companies');

    if (!res.ok) {
      return;
    }

    const companies = await res.json();

    const shop = companies.find(
      (company) => Number(company.id) === companyId
    );

    if (!shop) {
      return;
    }

    if (shopTextEl) {
      shopTextEl.textContent =
        shop.hero_text ||
        shop.tagline ||
        `Welcome to the ${shop.company_name} customer portal.`;
    }
  } catch (err) {
    console.error(
      'Unable to load customer shop home:',
      err
    );
  }
}

async function loadCustomerProfile() {
  const res = await fetch(
    '/api/customer/my-repair',
    {
      headers: {
        Authorization:
          `Bearer ${localStorage.getItem('token')}`
      }
    }
  );

  const data = await res.json();

  if (handleExpiredSession(res, data)) {
    return;
  }

  document.getElementById(
    'clientShopBanner'
  ).textContent =
    `Shop: ${localStorage.getItem('company_name') || ''}`;

  document.getElementById(
    'clientWelcomeName'
  ).textContent =
    data.customer.first_name
      ? `${data.customer.first_name} ${data.customer.last_name}`
      : localStorage.getItem('username');

  document.getElementById(
    'statusBadge'
  ).innerHTML =
    `Current Service Status: <span class="badge">${escapeHtml(data.status)}</span>`;

  document.getElementById('cust_first_name').value =
    data.customer.first_name || '';

  document.getElementById('cust_last_name').value =
    data.customer.last_name || '';

  document.getElementById('cust_phone').value =
    data.customer.phone || '';

  document.getElementById('cust_email').value =
    data.customer.email || '';

  document.getElementById('cust_vin').value =
    data.vehicle.vin || '';

  document.getElementById('cust_make').value =
    data.vehicle.make || '';

  document.getElementById('cust_model').value =
    data.vehicle.model || '';

  document.getElementById('cust_year').value =
    data.vehicle.year || '';

  document.getElementById('cust_issue').value =
    data.repairOrder.issue_description || '';

  const apptText =
    data.appointment.scheduled_datetime
      ? new Date(
          data.appointment.scheduled_datetime
        ).toLocaleString()
      : 'No appointment scheduled yet.';

  const safeApptText =
    escapeHtml(apptText);

  const homeStatus =
    document.getElementById('customerHomeStatus');

  const homeAppointment =
    document.getElementById('customerHomeAppointment');

  const homeVehicle =
    document.getElementById('customerHomeVehicle');

  const homeInvoice =
    document.getElementById('customerHomeInvoice');

  if (homeStatus) {
    homeStatus.textContent =
      data.status || 'No active status';
  }

  if (homeAppointment) {
    homeAppointment.textContent = apptText;
  }

  if (homeVehicle) {
    const vehicleParts = [
      data.vehicle?.year,
      data.vehicle?.make,
      data.vehicle?.model
    ].filter(Boolean);

    homeVehicle.textContent =
      vehicleParts.length
        ? vehicleParts.join(' ')
        : 'No vehicle on file';
  }

  if (homeInvoice) {
    const amount =
      Number(data.invoice?.total_amount);

    homeInvoice.textContent =
      data.invoice
        ? `$${Number.isFinite(amount) ? amount.toFixed(2) : '0.00'}`
        : 'Not generated yet';
  }

  if (data.invoice) {
    const safeInvoiceNumber =
      escapeHtml(
        data.invoice.invoice_number || ''
      );

    const safeWorkSummary =
      escapeHtml(
        data.repairExec?.work_summary ||
        'Service in progress.'
      );

    const safePaymentStatus =
      escapeHtml(
        data.invoice.payment_status ||
        'Unpaid'
      );

    const totalAmount =
      Number(data.invoice.total_amount);

    const safeTotal =
      Number.isFinite(totalAmount)
        ? totalAmount.toFixed(2)
        : '0.00';

    const subtotalAmount =
      Number(data.invoice.subtotal);

    const safeSubtotal =
      Number.isFinite(subtotalAmount)
        ? subtotalAmount.toFixed(2)
        : '0.00';

    const invoiceItems =
      Array.isArray(data.partsLabor) && data.partsLabor.length
        ? data.partsLabor
            .map((item) => `
              <div class="customer-invoice-line">
                <span>${escapeHtml(item.description || item.item_type || 'Service')}</span>
                <strong>$${Number(item.unit_cost || 0).toFixed(2)}</strong>
              </div>
            `)
            .join('')
        : '<div class="customer-invoice-empty">Repair services and labor</div>';

    document.getElementById(
      'invoiceContent'
    ).innerHTML = `
      <div class="customer-invoice-head">
        <div>
          <span class="customer-invoice-kicker">SERVICE INVOICE</span>
          <h3>Invoice ${safeInvoiceNumber}</h3>
        </div>
        <span class="badge">${safePaymentStatus}</span>
      </div>
      <div class="customer-invoice-meta">
        <span>Appointment</span><strong>${safeApptText}</strong>
        <span>Work completed</span><strong>${safeWorkSummary}</strong>
      </div>
      <div class="customer-invoice-lines">
        <div class="customer-invoice-line customer-invoice-line-heading"><span>Service or item</span><strong>Amount</strong></div>
        ${invoiceItems}
      </div>
      <div class="customer-invoice-total"><span>Subtotal</span><strong>$${safeSubtotal}</strong><span>Total due</span><strong>$${safeTotal}</strong></div>
      <p class="customer-invoice-note">Please have a payment method ready when you arrive at the shop.</p>
    `;
  } else {
    document.getElementById(
      'invoiceContent'
    ).innerHTML = `
      <p>
        <strong>Scheduled Appointment:</strong>
        ${safeApptText}
      </p>

      <p style="color:var(--text-muted);">
        No invoice generated yet.
      </p>
    `;
  }
}

async function handleUpdateCustomerProfile(e) {
  e.preventDefault();

  const vin =
    document.getElementById('cust_vin').value;

  if (vin.length !== 17) {
    showToast('VIN must be exactly 17 digits', 'error');
    return;
  }

  const payload = {
    first_name:
      document.getElementById('cust_first_name').value,

    last_name:
      document.getElementById('cust_last_name').value,

    phone:
      document.getElementById('cust_phone').value,

    email:
      document.getElementById('cust_email').value,

    vin,

    make:
      document.getElementById('cust_make').value,

    model:
      document.getElementById('cust_model').value,

    year:
      document.getElementById('cust_year').value,

    issue_description:
      document.getElementById('cust_issue').value
  };

  const res = await fetch(
    '/api/customer/update-profile',
    {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization:
          `Bearer ${localStorage.getItem('token')}`
      },
      body: JSON.stringify(payload)
    }
  );

  const data = await res.json();

  if (handleExpiredSession(res, data)) {
    return;
  }

  if (res.ok) {
    showToast(data.message, 'success');
  } else {
    showToast(data.error, 'error');
  }
}

async function fetchCustomerList() {
  const res = await fetch(
    '/api/customer/list',
    {
      headers: {
        Authorization:
          `Bearer ${localStorage.getItem('token')}`
      }
    }
  );

  if (!res.ok) {
    let errorData = {};

    try {
      errorData = await res.json();
    } catch (err) {
      // Ignore malformed error responses.
    }

    if (handleExpiredSession(res, errorData)) {
      return;
    }

    return;
  }

  loadedCustomerList = await res.json();

  const select =
    document.getElementById('customerSelector');

  select.innerHTML =
    '<option value="">-- Choose Existing Customer Record --</option>' +
    loadedCustomerList
      .map(
        (c) => {
          const jobId =
            escapeHtml(c.repair_job_id);

          const firstName =
            escapeHtml(c.first_name || '');

          const lastName =
            escapeHtml(c.last_name || '');

          const year =
            escapeHtml(c.year || '');

          const make =
            escapeHtml(c.make || '');

          const model =
            escapeHtml(c.model || '');

          return (
            `<option value="${jobId}">` +
            `Job #${jobId} - ${firstName} ${lastName} ` +
            `(${year} ${make} ${model})` +
            `</option>`
          );
        }
      )
      .join('');
}

function setWorkflowField(name, value) {
  const field = document.querySelector(
    `#formFields [name="${name}"], #formFields #field_${name}`
  );

  if (field) {
    field.value = value ?? '';
  }
}

function populateWorkflowDepartment() {
  const record = activeWorkflowRecord;

  if (!record) {
    return;
  }

  const data = record[activeDept];

  if (activeDept === 'parts_labor') {
    const firstLine = Array.isArray(data) ? data[0] || {} : {};
    setWorkflowField('item_type', firstLine.item_type);
    setWorkflowField('description', firstLine.description);
    setWorkflowField('unit_cost', firstLine.unit_cost);
    return;
  }

  if (!data) {
    return;
  }

  Object.entries(data).forEach(([name, value]) => {
    setWorkflowField(name, value);
  });
}

async function loadWorkflowRecord(jobId) {
  if (!jobId) {
    activeWorkflowRecord = null;
    return;
  }

  const res = await fetch(
    `/api/department/job/${encodeURIComponent(jobId)}`,
    {
      headers: {
        Authorization:
          `Bearer ${localStorage.getItem('token')}`
      }
    }
  );

  const data = await res.json();

  if (handleExpiredSession(res, data)) {
    return;
  }

  if (!res.ok) {
    showToast(data.error || 'Unable to load this repair job.', 'error');
    return;
  }

  if (String(document.getElementById('activeJobId')?.value) !== String(jobId)) return;
  activeWorkflowRecord = data;
  if (!document.getElementById('motivoPartsEditor')?.classList.contains('hidden')) motivoPartsEditorSync();
  populateWorkflowDepartment();
  renderRepairWorkspaceSummary();
}

async function autoFillCustomerData() {
  const jobId =
    document.getElementById('customerSelector').value;

  if (!jobId) {
    return;
  }

  document.getElementById('activeJobId').value =
    jobId;
  const job = staffJobs.find(item => String(item.id) === String(jobId));
  const context = document.getElementById('activeJobContext');
  if (context && job) context.textContent = `Job #${job.job_number || job.id} • ${[job.year, job.make, job.model].filter(Boolean).join(' ')} • ${job.status || 'Current'}`;

  const customer =
    loadedCustomerList.find(
      (c) => c.repair_job_id == jobId
    );

  if (!customer) {
    return;
  }

  if (activeDept === 'customer') {
    if (document.getElementById('field_first_name')) {
      document.getElementById(
        'field_first_name'
      ).value = customer.first_name || '';
    }

    if (document.getElementById('field_last_name')) {
      document.getElementById(
        'field_last_name'
      ).value = customer.last_name || '';
    }

    if (document.getElementById('field_phone')) {
      document.getElementById(
        'field_phone'
      ).value = customer.phone || '';
    }
  } else if (activeDept === 'vehicle') {
    if (document.getElementById('field_vin')) {
      document.getElementById(
        'field_vin'
      ).value = customer.vin || '';
    }

    if (document.getElementById('field_make')) {
      document.getElementById(
        'field_make'
      ).value = customer.make || '';
    }

    if (document.getElementById('field_model')) {
      document.getElementById(
        'field_model'
      ).value = customer.model || '';
    }

    if (document.getElementById('field_year')) {
      document.getElementById(
        'field_year'
      ).value = customer.year || '';
    }
  }

  activeWorkflowRecord = null;
  updateMotivoJobHero(jobId);
  openRepairSection(REPAIR_SECTIONS[activeRepairSection].departments.some(d => (ROLE_MAP[localStorage.getItem('role')] || []).includes(d)) ? activeRepairSection : Object.keys(REPAIR_SECTIONS).find(k => REPAIR_SECTIONS[k].departments.some(d => (ROLE_MAP[localStorage.getItem('role')] || []).includes(d))));
  await loadWorkflowRecord(jobId);
}

function applyRolePermissions(role) {
  const allowed = ROLE_MAP[role] || [];
  Object.entries(REPAIR_SECTIONS).forEach(([key, section]) => {
    const button = document.getElementById(`section-${key}`);
    if (button) button.classList.toggle('hidden', !section.departments.some(dept => allowed.includes(dept)));
  });
  const firstSection = Object.keys(REPAIR_SECTIONS).find(key =>
    REPAIR_SECTIONS[key].departments.some(dept => allowed.includes(dept)));
  if (firstSection) openRepairSection(firstSection);
}

function updateHeaderAuthButtons() {
  const token = localStorage.getItem('token');
  const role = localStorage.getItem('role');

  const isLoggedIn = Boolean(token);
  const isCustomer = isLoggedIn && role === 'customer';
  const isStaff = isLoggedIn && !isCustomer;

  document
    .querySelectorAll('.header-signup, .auth-signup')
    .forEach((el) => {
      el.classList.toggle('hidden', isLoggedIn);
    });

  document
    .querySelectorAll('.header-login, .auth-login')
    .forEach((el) => {
      el.classList.toggle('hidden', isLoggedIn);
    });

  document
    .querySelectorAll('.signed-in-logout')
    .forEach((el) => {
      el.classList.toggle('hidden', !isLoggedIn);
    });

  document
    .querySelectorAll('.public-nav-link')
    .forEach((el) => {
      el.classList.toggle('hidden', isCustomer || isStaff);
    });

  document
    .querySelectorAll('.customer-nav-link')
    .forEach((el) => {
      el.classList.toggle('hidden', !isCustomer);
    });
  document
    .querySelectorAll('.staff-nav-link')
    .forEach((el) => {
      el.classList.toggle('hidden', !isLoggedIn || isCustomer);
    });
  document
    .querySelectorAll('.staff-manager-nav')
    .forEach((el) => {
      el.classList.toggle(
        'hidden',
        !isLoggedIn || role !== 'manager'
      );
    });
}

function renderDashboard() {
  updateHeaderAuthButtons();

  const token =
    localStorage.getItem('token');

  const role =
    localStorage.getItem('role');

  const primaryColor =
    localStorage.getItem('primary_color');

  if (primaryColor) {
    applyShopThemeColor(primaryColor);
  }

  if (!token) {
    showScreen('landingSection');
    loadShopLandingContext();
    return;
  }

  if (role === 'customer') {
    showScreen('customerDashboard');
    switchCustomerTab('home');
    loadCustomerShopHome();
    loadCustomerProfile();
  } else {
    showScreen('employeeDashboard');

    document.getElementById(
      'empShopBanner'
    ).textContent =
      `Shop: ${localStorage.getItem('company_name') || ''}`;

    document.getElementById(
      'userRoleBadge'
    ).textContent =
      `${localStorage.getItem('username')} (${role})`;

    if (role === 'manager') {
      document
        .getElementById('managerControlPanel')
        .classList.remove('hidden');

      loadManagerStaffTable();
    } else {
      document
        .getElementById('managerControlPanel')
        .classList.add('hidden');
    }

    fetchCustomerList();
    loadStaffJobs();
    applyRolePermissions(role);
    openStaffView(role === 'technician' ? 'jobs' : 'workflow');
  }
}

async function loadStaffJobs() {
  const res = await fetch('/api/department/jobs', {
    headers: {
      Authorization:
        `Bearer ${localStorage.getItem('token')}`
    }
  });

  const data = await res.json();

  if (handleExpiredSession(res, data)) {
    return;
  }

  if (!res.ok) {
    showToast(data.error || 'Unable to load staff jobs.', 'error');
    return;
  }

  staffJobs = data.jobs || [];
  renderStaffJobs();
}

function filterStaffJobs(filter) {
  activeStaffJobFilter = filter;

  document
    .querySelectorAll('.staff-job-filters button')
    .forEach((button) => {
      button.classList.toggle(
        'active',
        button.textContent.trim().toLowerCase() === filter
      );
    });

  renderStaffJobs();
}

function searchStaffJobs(value) {
  staffJobSearchTerm = String(value || '').toLowerCase().trim();
  renderStaffJobs();
}

async function openStaffJob(jobId) {
  const job = staffJobs.find((item) => Number(item.id) === Number(jobId));
  if (!job) {
    showToast('This job is no longer in the current queue. Refresh the jobs list.', 'error');
    return;
  }

  const role = localStorage.getItem('role');
  if (role === 'technician' && job.assigned_staff_id &&
      Number(job.assigned_staff_id) !== Number(localStorage.getItem('user_id'))) {
    showToast('This job is assigned to another technician.', 'error');
    return;
  }

  const jobIdField = document.getElementById('activeJobId');
  if (jobIdField) jobIdField.value = String(job.id);
  const customerSelect = document.getElementById('customerSelector');
  if (customerSelect) customerSelect.value = String(job.id);

  const context = document.getElementById('activeJobContext');
  if (context) {
    const customer = [job.first_name, job.last_name].filter(Boolean).join(' ') || 'Customer not recorded';
    const vehicle = [job.year, job.make, job.model].filter(Boolean).join(' ') || 'Vehicle not recorded';
    context.textContent = `Job #${job.job_number || job.id} • ${vehicle} • ${customer} • ${job.status || 'Current'}`;
  }

  openStaffView('workflow');
  const allowed = ROLE_MAP[role] || [];
  if (!allowed.length) {
    showToast('Your role does not have access to repair workflow fields.', 'error');
    return;
  }
  activeWorkflowRecord = null;
  updateMotivoJobHero(job.id);
  const preferred = REPAIR_SECTIONS.overview.departments.some(d => allowed.includes(d)) ? 'overview' : Object.keys(REPAIR_SECTIONS).find(k => REPAIR_SECTIONS[k].departments.some(d => allowed.includes(d)));
  openRepairSection(preferred);
  await loadWorkflowRecord(job.id);
  document.getElementById('staffWorkflowSection')?.scrollIntoView({behavior:'smooth',block:'start'});
}

function renderStaffJobs() {
  const tbody = document.getElementById('staffJobsBody');

  if (!tbody) {
    return;
  }

  const userId = Number(localStorage.getItem('user_id'));
  const jobs = staffJobs.filter((job) => {
    const completed = job.status === 'Completed';
    const unassigned = !job.assigned_staff_id;

    if (activeStaffJobFilter === 'previous') {
      return completed;
    }

    if (activeStaffJobFilter === 'available') {
      return unassigned && !completed;
    }

    if (localStorage.getItem('role') === 'technician') {
      return Number(job.assigned_staff_id) === userId && !completed;
    }

    return !completed;
  });

  const filteredJobs = jobs.filter((job) => {
    if (!staffJobSearchTerm) return true;
    const searchable = [job.id, job.job_number, job.first_name, job.last_name,
      job.year, job.make, job.model, job.status, job.assigned_staff_name]
      .filter((value) => value !== null && value !== undefined).join(' ').toLowerCase();
    return searchable.includes(staffJobSearchTerm);
  });

  if (filteredJobs.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7">No matching jobs in this view.</td></tr>';
    return;
  }

  tbody.innerHTML = filteredJobs.map((job) => {
    const customer = `${job.first_name || ''} ${job.last_name || ''}`.trim() || 'Customer';
    const vehicle = `${job.year || ''} ${job.make || ''} ${job.model || ''}`.trim() || 'Vehicle';
    const appointment = job.scheduled_datetime
      ? new Date(job.scheduled_datetime).toLocaleString()
      : 'Not scheduled';
    const canClaim = localStorage.getItem('role') === 'technician' && !job.assigned_staff_id;

    return `<tr>
      <td>#${escapeHtml(job.id)}</td>
      <td>${escapeHtml(customer)}</td>
      <td>${escapeHtml(vehicle)}</td>
      <td>${escapeHtml(appointment)}</td>
      <td>${escapeHtml(job.status)}</td>
      <td>${escapeHtml(job.assigned_staff_name || 'Unassigned')}</td>
      <td><div class="motivo-job-actions"><button class="staff-inline-action motivo-open-job" type="button" onclick="openStaffJob(${Number(job.id)})" aria-label="Open repair job ${Number(job.id)}">Open Job</button>${canClaim ? `<button class="staff-inline-action" type="button" onclick="claimStaffJob(${Number(job.id)})">Claim</button>` : ''}</div></td>
    </tr>`;
  }).join('');
}

async function claimStaffJob(jobId) {
  const res = await fetch(`/api/department/jobs/${jobId}/claim`, {
    method: 'POST',
    headers: {
      Authorization:
        `Bearer ${localStorage.getItem('token')}`
    }
  });

  const data = await res.json();

  if (handleExpiredSession(res, data)) {
    return;
  }

  if (!res.ok) {
    showToast(data.error || 'Unable to claim this job.', 'error');
    return;
  }

  showToast('Job claimed.', 'success');
  await loadStaffJobs();
}

function openStaffView(view) {
  const jobsSection = document.getElementById('staffJobsSection');
  const workflowSection = document.getElementById('staffWorkflowSection');
  const managerPanel = document.getElementById('managerControlPanel');

  if (!jobsSection || !workflowSection || !managerPanel) {
    return;
  }

  const isManager = localStorage.getItem('role') === 'manager';

  if (view === 'team' && !isManager) {
    showToast('Manager access is required.', 'error');
    return;
  }

  jobsSection.classList.toggle('hidden', view !== 'jobs');
  workflowSection.classList.toggle('hidden', view !== 'workflow');
  if (view === 'workflow' && !document.getElementById('activeJobId')?.value) {
    document.getElementById('activeJobContext').textContent = 'Select a repair from My Jobs to begin.';
  }
  managerPanel.classList.toggle('hidden', view !== 'team' || !isManager);

  if (view === 'jobs') {
    loadStaffJobs();
  }
}

function formatMotivoValue(value) {
  if (value === null || value === undefined || String(value).trim() === '') return 'Not recorded';
  return String(value);
}

function motivoSummaryCard(label, rows) {
  return `<article class="motivo-summary-card"><h4>${escapeHtml(label)}</h4><dl>${rows.map(([key,value]) =>
    `<div><dt>${escapeHtml(key)}</dt><dd>${escapeHtml(formatMotivoValue(value))}</dd></div>`).join('')}</dl></article>`;
}

// Parts & Labor v2: quantity and hourly-rate values are stored server-side.
let motivoPartsDraft = [];
let motivoPartsSaving = false;
const motivoLineMoney = n => `$${Number(n || 0).toFixed(2)}`;
function motivoPartsExistingLines() {
  return (activeWorkflowRecord?.parts_labor || []).map(line => ({
    item_type: line.item_type === 'Labor' ? 'Labor' : 'Part',
    description: String(line.description || ''),
    quantity: Number(line.quantity ?? 1),
    unit_price: Number(line.unit_price ?? line.unit_cost ?? 0),
    source_url: String(line.source_url || '')
  }));
}
function motivoPartsTotal(lines) {
  return lines.reduce((sum, line) => sum + Math.round(Number(line.quantity) * Number(line.unit_price) * 100), 0) / 100;
}
function motivoPartsEditorSync() {
  const root = document.getElementById('motivoPartsEditor');
  if (!root) return;
  motivoPartsDraft = motivoPartsExistingLines();
  motivoRenderPartsDraft();
}
function motivoPartsField(index, field, value) {
  const line = motivoPartsDraft[index];
  if (!line) return;
  line[field] = value;
  if (field === 'item_type') line.quantity = 1;
  motivoRenderPartsDraft();
}
function motivoAddPartLine(type = 'Part') {
  motivoPartsDraft.push({ item_type: type, description: '', quantity: 1, unit_price: 0, source_url: '' });
  motivoRenderPartsDraft();
}
function motivoRemovePartLine(index) {
  motivoPartsDraft.splice(index, 1);
  motivoRenderPartsDraft();
}
function motivoRenderPartsDraft() {
  const holder = document.getElementById('motivoPartsRows');
  if (!holder) return;
  holder.innerHTML = motivoPartsDraft.length ? motivoPartsDraft.map((line, i) => {
    const type = line.item_type === 'Labor' ? 'Labor' : 'Part';
    const qty = Number(line.quantity);
    const price = Number(line.unit_price);
    const valid = Number.isFinite(qty) && Number.isFinite(price) && qty > 0 && price >= 0;
    const sum = valid ? motivoLineMoney(Math.round(qty * price * 100) / 100) : '—';
    return `<div class="motivo-parts-line" data-line="${i}">
      <label>Type<select data-field="item_type"><option value="Part" ${type === 'Part' ? 'selected' : ''}>Part</option><option value="Labor" ${type === 'Labor' ? 'selected' : ''}>Labor</option></select></label>
      <label>Description<input data-field="description" maxlength="255" value="${escapeHtml(line.description)}" placeholder="${type === 'Labor' ? 'Labor operation' : 'Part name / number'}" /></label>
      <label>${type === 'Labor' ? 'Hours' : 'Qty'}<input data-field="quantity" type="number" min="${type === 'Labor' ? '0.25' : '1'}" step="${type === 'Labor' ? '0.25' : '1'}" value="${escapeHtml(String(line.quantity))}" /></label>
      <label>${type === 'Labor' ? 'Hourly rate ($)' : 'Unit price ($)'}<input data-field="unit_price" type="number" min="0" step="0.01" value="${escapeHtml(String(line.unit_price))}" /></label>
      ${type === 'Part' ? `<label class="motivo-part-link-field">Selected listing URL<input data-field="source_url" type="url" maxlength="2048" value="${escapeHtml(line.source_url || '')}" placeholder="https://seller.example/part" autocomplete="off" /></label><button class="btn-secondary motivo-use-query" type="button" data-action="use-query">Search this part ↗</button>${/^https?:\/\//i.test(line.source_url || '') ? `<a class="motivo-seller-link" href="${escapeHtml(line.source_url)}" target="_blank" rel="noopener noreferrer">Review selected listing ↗</a>` : ''}` : ''}
      <div class="motivo-parts-line-total"><small>Line total</small><strong>${sum}</strong></div>
      <button class="motivo-parts-remove" type="button" data-action="remove" aria-label="Remove line ${i + 1}">×</button>
    </div>`;
  }).join('') : '<p class="motivo-parts-empty">No line items yet. Add a part or a labor operation.</p>';
  holder.querySelectorAll('[data-field]').forEach(el => {
    el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', event => {
      const idx = Number(event.target.closest('[data-line]').dataset.line);
      const field = event.target.dataset.field;
      motivoPartsDraft[idx][field] = event.target.value;
      if (field === 'item_type') {
        motivoPartsDraft[idx].quantity = 1;
        motivoRenderPartsDraft();
      } else {
        const lineNode = event.target.closest('[data-line]');
        const l = motivoPartsDraft[idx];
        const extended = Number(l.quantity) * Number(l.unit_price);
        lineNode.querySelector('.motivo-parts-line-total strong').textContent = Number.isFinite(extended) ? motivoLineMoney(Math.round(extended * 100) / 100) : '—';
        motivoUpdatePartsTotal();
      }
    });
  });
  holder.querySelectorAll('[data-action="remove"]').forEach(btn => btn.addEventListener('click', () => motivoRemovePartLine(Number(btn.closest('[data-line]').dataset.line))));
  holder.querySelectorAll('[data-action="use-query"]').forEach(btn => btn.addEventListener('click', () => motivoUsePartQuery(Number(btn.closest('[data-line]').dataset.line))));
  motivoUpdatePartsTotal();
}
function motivoUpdatePartsTotal() {
  const el = document.getElementById('motivoPartsCalculatedTotal');
  if (el) el.textContent = motivoLineMoney(motivoPartsTotal(motivoPartsDraft));
}
function motivoOpenPartsEditor() {
  const jobId = document.getElementById('activeJobId')?.value;
  if (!jobId) return showToast('Open a repair job first.', 'error');
  if (!(ROLE_MAP[localStorage.getItem('role')] || []).includes('parts_labor')) return showToast('Your role cannot edit parts and labor.', 'error');
  const panel = document.getElementById('motivoPartsEditor');
  if (!panel) return;
  panel.classList.remove('hidden');
  motivoPartsEditorSync();
  panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
function motivoClosePartsEditor() {
  document.getElementById('motivoPartsEditor')?.classList.add('hidden');
}
async function motivoSavePartsLines() {
  if (motivoPartsSaving) return;
  const jobId = document.getElementById('activeJobId')?.value;
  if (!jobId) return showToast('Open a repair job first.', 'error');
  const lines = motivoPartsDraft.map(line => ({item_type:line.item_type,description:String(line.description).trim(),quantity:Number(line.quantity),unit_price:Number(line.unit_price),source_url:line.item_type === 'Part' ? String(line.source_url || '').trim() : ''}));
  for (const line of lines) {
    if (!['Part','Labor'].includes(line.item_type) || !line.description || line.description.length > 255 ||
        !Number.isFinite(line.quantity) || line.quantity <= 0 || (line.item_type === 'Part' && !Number.isInteger(line.quantity)) ||
        (line.item_type === 'Labor' && Math.round(line.quantity * 4) !== line.quantity * 4) ||
        !Number.isFinite(line.unit_price) || line.unit_price < 0) {
      return showToast('Check each line: description, whole-number part quantity, quarter-hour labor, and price.', 'error');
    }
  }
  for (const line of lines) {
    if (line.source_url) {
      try {
        const u = new URL(line.source_url);
        if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || line.source_url.length > 2048) throw new Error('Invalid link');
      } catch (_) { return showToast('Selected listing links must be valid http(s) URLs without embedded credentials.', 'error'); }
    }
  }
  if (lines.length > 100 || motivoPartsTotal(lines) > 99999999.99) return showToast('Too many items or the total is too large.', 'error');
  const button = document.getElementById('motivoPartsSave');
  motivoPartsSaving = true;
  if (button) button.disabled = true;
  try {
    const res = await fetch(`/api/department/job/${encodeURIComponent(jobId)}/line-items`, {
      method:'PUT', headers:{'Content-Type':'application/json',Authorization:`Bearer ${localStorage.getItem('token')}`},
      body:JSON.stringify({lines})
    });
    const data = await res.json();
    if (handleExpiredSession(res,data)) return;
    if (!res.ok) throw new Error(data.error || 'Unable to save parts and labor.');
    showToast('Parts and labor saved. Review the estimate separately before sending it.', 'success');
    if (String(document.getElementById('activeJobId')?.value) === String(jobId)) {
      await loadWorkflowRecord(jobId);
      motivoPartsEditorSync();
    }
  } catch (error) { showToast(error.message || 'Unable to save parts and labor.', 'error'); }
  finally { motivoPartsSaving = false; if(button) button.disabled = false; }
}
// Free, direct retailer searches. These are outbound discovery links, not API imports.
const MOTIVO_PART_SEARCH = [
  {id:'google',label:'Google Shopping',base:'https://www.google.com/search?tbm=shop&q='},
  {id:'amazon',label:'Amazon',base:'https://www.amazon.com/s?k='},
  {id:'ebay',label:'eBay',base:'https://www.ebay.com/sch/i.html?_nkw='},
  {id:'rockauto',label:'RockAuto results',base:'https://www.google.com/search?q='}
];
function motivoPartsSearchTerm() {
  const vehicle = activeWorkflowRecord?.vehicle || {};
  const vehicleText = [vehicle.year,vehicle.make,vehicle.model].filter(Boolean).join(' ');
  const part = document.getElementById('motivoPartQuery')?.value.trim() || '';
  return {vehicleText,part};
}
function motivoSearchPartSuppliers(providerId) {
  const {vehicleText,part} = motivoPartsSearchTerm();
  if (!part) return showToast('Enter a part name to search.', 'error');
  if (!vehicleText) return showToast('Add the vehicle year, make and model first.', 'error');
  const provider = MOTIVO_PART_SEARCH.find(p => p.id === providerId);
  if (!provider) return;
  const phrase = `${vehicleText} ${part} auto part`;
  const q = providerId === 'rockauto' ? `site:rockauto.com ${phrase}` : phrase;
  const url = provider.base + encodeURIComponent(q);
  window.open(url, '_blank', 'noopener,noreferrer');
}
function motivoUsePartQuery(index) {
  const line = motivoPartsDraft[index];
  if (!line || line.item_type !== 'Part') return;
  const input = document.getElementById('motivoPartQuery');
  if (input) input.value = line.description || '';
  document.getElementById('motivoPartsResearch')?.scrollIntoView({behavior:'smooth',block:'nearest'});
}

function renderRepairWorkspaceSummary() {
  const holder = document.getElementById('motivoJobSummary');
  if (!holder) return;
  const rec = activeWorkflowRecord;
  const jobId = document.getElementById('activeJobId')?.value;
  if (!jobId || !rec) {
    holder.textContent = 'Open a repair from My Jobs to see its saved details.';
    return;
  }
  const c = rec.customer || {}, v = rec.vehicle || {}, a = rec.appointment || {};
  const ro = rec.repair_order || {}, e = rec.estimate || {}, r = rec.repair || {}, inv = rec.invoice || {};
  const lines = Array.isArray(rec.parts_labor) ? rec.parts_labor : [];
  const money = value => Number.isFinite(Number(value)) ? `$${Number(value).toFixed(2)}` : 'Not recorded';
  let cards = [];
  if (activeRepairSection === 'overview') {
    cards = [motivoSummaryCard('Customer', [['Name',[c.first_name,c.last_name].filter(Boolean).join(' ')],['Phone',c.phone]]),
      motivoSummaryCard('Vehicle', [['Year',v.year],['Make',v.make],['Model',v.model],['VIN',v.vin]]),
      motivoSummaryCard('Appointment', [['Scheduled',a.scheduled_datetime ? new Date(a.scheduled_datetime).toLocaleString() : 'Not scheduled'], ['Service advisor',a.service_advisor]])];
  } else if (activeRepairSection === 'inspection') {
    cards = [motivoSummaryCard('Customer concern / repair order', [['RO number',ro.ro_number],['Reported problem',ro.issue_description]])];
  } else if (activeRepairSection === 'estimate') {
    cards = [motivoSummaryCard('Estimate', [['Estimated total',e.estimated_total === undefined ? 'Not recorded' : money(e.estimated_total)],['Customer authorization','Not tracked in the current database']]),
      motivoSummaryCard('Saved parts & labor',lines.length ? lines.map((item,i) => [`${i+1}. ${item.item_type || 'Item'} — ${item.description || 'No description'} (${item.quantity ?? 1} × ${money(item.unit_price ?? item.unit_cost)})`,money(item.unit_cost)]) : [['Items','No parts or labor entries saved']])];
  } else if (activeRepairSection === 'repair') {
    cards = [motivoSummaryCard('Work performed', [['Repair notes',r.work_summary]])];
  } else {
    cards = [motivoSummaryCard('Invoice', [['Invoice number',inv.invoice_number],['Subtotal',inv.subtotal === undefined ? 'Not recorded' : money(inv.subtotal)],['Total',inv.total_amount === undefined ? 'Not recorded' : money(inv.total_amount)]])];
  }
  holder.innerHTML = cards.join('');
  if (activeRepairSection === 'estimate') {
    const links = lines.filter(x => x.item_type === 'Part' && /^https?:\/\//i.test(x.source_url || ''));
    if (links.length) {
      const box = document.createElement('article'); box.className = 'motivo-summary-card';
      const title = document.createElement('h4'); title.textContent = 'Selected product listings'; box.appendChild(title);
      links.forEach(item => { try { const u = new URL(item.source_url); if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password) return; const anchor = document.createElement('a'); anchor.href = u.href; anchor.target = '_blank'; anchor.rel = 'noopener noreferrer'; anchor.textContent = `${item.description} — Review seller ↗`; box.appendChild(anchor); } catch (_) {} });
      holder.appendChild(box);
    }
  }
}

function updateMotivoJobHero(jobId) {
  const job = staffJobs.find(item => String(item.id) === String(jobId));
  const value = (id,text) => {const el=document.getElementById(id);if(el) el.textContent=text;};
  if (!job) {
    value('motivoJobVehicle',jobId ? `Repair job #${jobId}` : 'Open a job to begin');
    value('motivoJobCustomer','Review saved repair details below.');
    value('motivoJobStatus',jobId ? 'Selected' : 'No job selected');
    value('motivoJobNumber',jobId ? `#${jobId}` : '—');
    return;
  }
  value('motivoJobVehicle',[job.year,job.make,job.model].filter(Boolean).join(' ') || 'Vehicle not recorded');
  value('motivoJobCustomer',[job.first_name,job.last_name].filter(Boolean).join(' ') || 'Customer not recorded');
  value('motivoJobStatus',job.status || 'Current');
  value('motivoJobNumber',`#${job.job_number || job.id}`);
}

function openRepairSection(sectionKey) {
  const section = REPAIR_SECTIONS[sectionKey];
  if (!section) return;
  const allowed = ROLE_MAP[localStorage.getItem('role')] || [];
  const tools = section.departments.filter(dept => allowed.includes(dept));
  if (!tools.length) {
    showToast('Your role cannot access this section.', 'error');
    return;
  }
  activeRepairSection = sectionKey;
  motivoClosePartsEditor();
  const keys = Object.keys(REPAIR_SECTIONS);
  const idx = keys.indexOf(sectionKey);
  const set = (id,text) => { const el=document.getElementById(id); if(el) el.textContent=text; };
  set('workflowProgressKicker',`SECTION ${idx+1} OF ${keys.length}`);
  set('workflowProgressTitle',section.title);
  set('motivoSectionKicker',`${String(idx+1).padStart(2,'0')} / ${sectionKey.toUpperCase()}`);
  set('motivoSectionHeading',section.title);
  set('motivoSectionDescription',section.detail);
  const progress=document.getElementById('workflowProgressFill');
  if(progress) progress.style.width=`${((idx+1)/keys.length)*100}%`;
  document.querySelectorAll('.motivo-main-sections .step-card').forEach(button => {
    const isActive=button.id===`section-${sectionKey}`;
    button.classList.toggle('active',isActive);
    if(isActive) button.setAttribute('aria-current','page');
    else button.removeAttribute('aria-current');
  });
  const toolBar=document.getElementById('motivoDepartmentTools');
  if(toolBar) toolBar.innerHTML=tools.filter(dept=>dept!=='parts_labor').map(dept=>`<button type="button" class="motivo-tool-btn" data-dept="${dept}" onclick="showDept('${dept}')">${escapeHtml(DEPT_LABELS[dept] || dept)}</button>`).join('');
  const form=document.getElementById('deptForm');
  if(form) form.classList.add('hidden');
  document.getElementById('markReadyBtn')?.classList.add('hidden');
  const partsActions = document.getElementById('motivoPartsActions');
  if (partsActions) partsActions.classList.toggle('hidden', sectionKey !== 'estimate' || !allowed.includes('parts_labor'));
  renderRepairWorkspaceSummary();
}

async function showDept(dept) {
  const role = localStorage.getItem('role');
  if (dept === 'parts_labor') { motivoOpenPartsEditor(); return; }
  if (!(ROLE_MAP[role] || []).includes(dept)) {
    showToast('Your role cannot access this repair tool.', 'error');
    return;
  }
  const jobId = document.getElementById('activeJobId')?.value;
  if(!jobId) {showToast('Open a repair from My Jobs before editing.', 'error');return;}
  const sectionKey=Object.keys(REPAIR_SECTIONS).find(key=>REPAIR_SECTIONS[key].departments.includes(dept));
  if(sectionKey && sectionKey!==activeRepairSection) openRepairSection(sectionKey);
  activeDept=dept;
  document.querySelectorAll('.motivo-tool-btn').forEach(button=>button.classList.toggle('active',button.dataset.dept===dept));
  const form=document.getElementById('deptForm');
  if(form) form.classList.remove('hidden');
  const readyButton=document.getElementById('markReadyBtn');
  if(readyButton) readyButton.classList.toggle('hidden',dept!=='invoice');
  const saveButton=document.querySelector('.staff-save-record-btn');
  if(saveButton) saveButton.textContent=dept==='invoice'?'Generate Invoice & Email Customer':'Save Record';
  const title=document.getElementById('deptTitle');
  if(title) title.textContent=`Edit ${DEPT_LABELS[dept] || dept}`;
  const fields=document.getElementById('formFields');
  if(fields) fields.innerHTML=DEPT_FIELDS[dept] || '';
  await loadWorkflowRecord(jobId);
}

async function submitDepartment(e) {
  e.preventDefault();

  const jobId =
    document.getElementById('activeJobId').value;

  if (!jobId) {
    showToast('Open a repair from My Jobs before saving.', 'error');
    return;
  }

  const formData =
    new FormData(e.target);

  const payload = {
    repair_job_id: jobId
  };

  formData.forEach((val, key) => {
    payload[key] = val;
  });

  const res = await fetch(
    `/api/department/${activeDept}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization:
          `Bearer ${localStorage.getItem('token')}`
      },
      body: JSON.stringify(payload)
    }
  );

  const data = await res.json();

  if (handleExpiredSession(res, data)) {
    return;
  }

  if (res.ok) {
    showToast(
      activeDept === 'invoice'
        ? data.email_sent
          ? 'Invoice generated and customer email sent.'
          : 'Invoice generated. No customer email is on file.'
        : 'Record saved!',
      'success'
    );

    e.target.reset();

    fetchCustomerList();

    await loadWorkflowRecord(jobId);
    if (activeDept !== 'invoice') openRepairSection(activeRepairSection);
  } else {
    showToast(
      data.error ||
      'Unable to save record.',
      'error'
    );
  }
}

async function markJobReady() {
  const jobId =
    document.getElementById('activeJobId').value;

  if (!jobId) {
    showToast('Select a repair job first.', 'error');
    return;
  }

  const res = await fetch(
    `/api/department/job/${encodeURIComponent(jobId)}/ready`,
    {
      method: 'POST',
      headers: {
        Authorization:
          `Bearer ${localStorage.getItem('token')}`
      }
    }
  );

  const data = await res.json();

  if (handleExpiredSession(res, data)) {
    return;
  }

  if (!res.ok) {
    showToast(data.error || 'Unable to mark this vehicle ready.', 'error');
    return;
  }

  showToast(
    data.email_sent
      ? 'Vehicle marked ready. Customer notification sent.'
      : 'Vehicle marked ready. No customer email is on file.',
    'success'
  );
}

async function logout() {
  try { await motivoNativeFetch('/api/session/logout',{method:'POST',credentials:'same-origin'}); }
  catch(err) { console.warn('Logout revocation request failed:',err.message); }
  clearAuthSession();
  renderDashboard();
}

renderDashboard();
// =========================
// HERO SLIDESHOW makes it move
// =========================

let currentHeroSlide = 0;
let heroSlideTimer;

function updateHeroSlides() {
  const slides = document.querySelectorAll('.hero-slide');
  const dots = document.querySelectorAll('.hero-dot');

  if (!slides.length) return;

  slides.forEach((slide, index) => {
    slide.classList.toggle('active', index === currentHeroSlide);
  });

  dots.forEach((dot, index) => {
    dot.classList.toggle('active', index === currentHeroSlide);
  });
}

function setHeroSlide(index) {
  const slides = document.querySelectorAll('.hero-slide');

  if (!slides.length) return;

  currentHeroSlide = (index + slides.length) % slides.length;

  updateHeroSlides();
  resetHeroSlideTimer();
}

function nextHeroSlide() {
  setHeroSlide(currentHeroSlide + 1);
}

function previousHeroSlide() {
  setHeroSlide(currentHeroSlide - 1);
}

function resetHeroSlideTimer() {
  clearInterval(heroSlideTimer);

  heroSlideTimer = setInterval(() => {
    const slides = document.querySelectorAll('.hero-slide');

    if (!slides.length) return;

    currentHeroSlide =
      (currentHeroSlide + 1) % slides.length;

    updateHeroSlides();
  }, 6000);
}

document.addEventListener('DOMContentLoaded', () => {
  updateHeroSlides();
  resetHeroSlideTimer();
});

// =========================
// CUSTOMER PORTAL SETTINGS
// =========================

function setCustomerPortalHeaderImage(imageSource) {
  const header = document.getElementById('customerPortalHeader');

  if (!header) return;

  header.style.backgroundImage = `
    linear-gradient(
      90deg,
      rgba(7, 24, 39, 0.88),
      rgba(7, 24, 39, 0.68)
    ),
    url("${imageSource}")
  `;

  header.style.backgroundSize = 'cover';
  header.style.backgroundPosition = 'center';
}

function darkenAccentColor(hexColor) {
  const amount = 42;

  const channels = hexColor
    .match(/[\da-f]{2}/gi)
    .map(channel =>
      Math.max(0, parseInt(channel, 16) - amount)
    );

  return `#${channels
    .map(channel =>
      channel.toString(16).padStart(2, '0')
    )
    .join('')}`;
}

function setCustomerAccentColor(color) {
  const darkerColor = darkenAccentColor(color);

  document.documentElement.style.setProperty(
    '--orange',
    color
  );

  document.documentElement.style.setProperty(
    '--orange-dark',
    darkerColor
  );

  document.documentElement.style.setProperty(
    '--primary',
    color
  );

  document.documentElement.style.setProperty(
    '--primary-hover',
    darkerColor
  );
}

function initializeCustomerPortalSettings() {
  const imageInput =
    document.getElementById('shopLogoInput');

  const colorInput =
    document.getElementById('themeColorInput');

  const savedImage =
    localStorage.getItem('customer_portal_image');

  const savedColor =
    localStorage.getItem('customer_accent_color');

  if (savedImage) {
    setCustomerPortalHeaderImage(savedImage);
  }

  if (savedColor) {
    setCustomerAccentColor(savedColor);

    if (colorInput) {
      colorInput.value = savedColor;
    }
  }

  if (colorInput) {
    colorInput.addEventListener('change', (event) => {
      const color = event.target.value;

      setCustomerAccentColor(color);

      localStorage.setItem(
        'customer_accent_color',
        color
      );
    });
  }

  if (imageInput) {
    imageInput.addEventListener('change', (event) => {
      const file = event.target.files[0];

      if (!file) return;

      const reader = new FileReader();

      reader.addEventListener('load', () => {
        setCustomerPortalHeaderImage(reader.result);

        localStorage.setItem(
          'customer_portal_image',
          reader.result
        );
      });

      reader.readAsDataURL(file);
    });
  }
}

document.addEventListener('DOMContentLoaded', () => {
  initializeCustomerPortalSettings();
});
function openScreenFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const screen = params.get('screen');

  const allowedScreens = [
    'landingSection',
    'registerSection',
    'loginSection'
  ];

  if (screen && allowedScreens.includes(screen)) {
    const token = localStorage.getItem('token');
    const role = localStorage.getItem('role');

    if (screen === 'landingSection' && token) {
      if (role === 'customer') {
        openCustomerPortalTab('home');
      } else {
        showScreen('employeeDashboard');
      }

      return;
    }

    showScreen(screen);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  openScreenFromUrl();
});

// ======================================================
// CUSTOMER ACCOUNT DELETION
// Restored from the known-good e5784f1 implementation.
// ======================================================
async function deleteCustomerAccount(event) {
  event.preventDefault();

  const token = localStorage.getItem('token');
  const role = localStorage.getItem('role');
  const passwordInput = document.getElementById('delete_account_password');
  const deleteButton = document.getElementById('deleteAccountButton');

  if (!token || role !== 'customer') {
    showToast('You must be signed in as a customer to delete this account.', 'error');
    return;
  }

  const current_password = passwordInput?.value || '';

  if (!current_password) {
    showToast('Enter your current password before deleting your account.', 'error');
    return;
  }

  const confirmed = window.confirm(
    'Permanently delete your account and associated repair data? This cannot be undone.'
  );

  if (!confirmed) {
    return;
  }

  if (deleteButton) {
    deleteButton.disabled = true;
    deleteButton.textContent = 'Deleting Account...';
  }

  try {
    const res = await fetch('/api/customer/account', {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ current_password })
    });

    const data = await res.json().catch(() => ({}));

    if (handleExpiredSession(res, data)) {
      return;
    }

    if (!res.ok) {
      showToast(
        data.error || 'Unable to delete your account right now.',
        'error'
      );
      return;
    }

    clearAuthSession();
    localStorage.removeItem('customer_portal_image');
    localStorage.removeItem('customer_accent_color');

    if (passwordInput) {
      passwordInput.value = '';
    }

    showToast(
      data.message || 'Your account has been permanently deleted.',
      'success'
    );

    showScreen('landingSection');
    updateHeaderAuthButtons();

    window.setTimeout(() => {
      window.location.href = '/';
    }, 900);
  } catch (err) {
    console.error('Account deletion request failed:', err);
    showToast('Unable to reach the server. Your account was not deleted.', 'error');
  } finally {
    if (deleteButton && localStorage.getItem('token')) {
      deleteButton.disabled = false;
      deleteButton.textContent = 'Permanently Delete My Account';
    }
  }
}

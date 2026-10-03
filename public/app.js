let activeDept = 'customer';
let staffJobs = [];
let activeStaffJobFilter = 'current';
let loadedCustomerList = [];
let currentShop = null;
let activeWorkflowRecord = null;


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
  clearAuthFormFields();
  localStorage.removeItem('token');
  localStorage.removeItem('user_id');
  localStorage.removeItem('role');
  localStorage.removeItem('username');
  localStorage.removeItem('company_name');
  localStorage.removeItem('company_id');
  localStorage.removeItem('primary_color');
}

function handleExpiredSession(res, data = {}) {
  const message =
    String(data?.error || '');

  const expired =
    res.status === 401 ||
    (
      res.status === 403 &&
      message
        .toLowerCase()
        .includes('session expired')
    );

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
    '<button type="button" onclick="checkLivePartsPrice()" style="margin-bottom:8px;">Lookup Price For This Vehicle</button>' +
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

async function lookupVinOnline() {
  const vin =
    document.getElementById('field_vin').value;

  if (!vin || vin.length !== 17) {
    showToast('Enter any valid 17-digit VIN number', 'error');
    return;
  }

  const res = await fetch(
    `/api/vehicle/vin-lookup/${vin}`,
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
    document.getElementById('field_make').value =
      data.make;

    document.getElementById('field_model').value =
      data.model;

    document.getElementById('field_year').value =
      data.year;

    showToast(
      `Decoded VIN (${data.vin}): ${data.year} ${data.make} ${data.model}`,
      'success'
    );
  } else {
    showToast(data.error, 'error');
  }
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

  activeWorkflowRecord = data;
  populateWorkflowDepartment();
}

async function autoFillCustomerData() {
  const jobId =
    document.getElementById('customerSelector').value;

  if (!jobId) {
    return;
  }

  document.getElementById('activeJobId').value =
    jobId;

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

  await loadWorkflowRecord(jobId);
}

function applyRolePermissions(role) {
  const allowedDepts = ROLE_MAP[role] || [];

  const allDepts = [
    'customer',
    'vehicle',
    'appointment',
    'repair_order',
    'parts_labor',
    'estimate',
    'repair',
    'invoice'
  ];

  allDepts.forEach((dept) => {
    const btn =
      document.getElementById(`btn-${dept}`);

    if (btn) {
      if (allowedDepts.includes(dept)) {
        btn.classList.remove('hidden');
      } else {
        btn.classList.add('hidden');
      }
    }
  });

  if (allowedDepts.length > 0) {
    showDept(allowedDepts[0]);
  }
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

  if (jobs.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7">No jobs in this view.</td></tr>';
    return;
  }

  tbody.innerHTML = jobs.map((job) => {
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
      <td>${canClaim ? `<button class="staff-inline-action" type="button" onclick="claimStaffJob(${Number(job.id)})">Claim</button>` : ''}</td>
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
  managerPanel.classList.toggle('hidden', view !== 'team' || !isManager);

  if (view === 'jobs') {
    loadStaffJobs();
  }
}

async function showDept(dept) {
  activeDept = dept;
  
  const workflowTitles = {
    customer: 'Customer intake',
    vehicle: 'Vehicle details',
    appointment: 'Appointment',
    repair_order: 'Repair order',
    parts_labor: 'Parts and labor',
    estimate: 'Estimate',
    repair: 'Repair in progress',
    invoice: 'Invoice and payment'
  };
  
  const workflowOrder = Object.keys(workflowTitles);
  const workflowIndex = workflowOrder.indexOf(dept);
  const progressKicker = document.getElementById('workflowProgressKicker');
  const progressTitle = document.getElementById('workflowProgressTitle');
  const progressFill = document.getElementById('workflowProgressFill');
  
  if (progressKicker && progressTitle && progressFill) {
    progressKicker.textContent = `STEP ${workflowIndex + 1} OF ${workflowOrder.length}`;
    progressTitle.textContent = workflowTitles[dept];
    progressFill.style.width = `${((workflowIndex + 1) / workflowOrder.length) * 100}%`;
  }

  document
    .querySelectorAll('.step-card')
    .forEach((el) =>
      el.classList.remove('active')
    );

  const activeBtn =
    document.getElementById(`btn-${dept}`);

  if (activeBtn) {
    activeBtn.classList.add('active');
  }

  const readyButton =
    document.getElementById('markReadyBtn');

  const saveButton =
    document.querySelector('.staff-save-record-btn');

  if (readyButton) {
    readyButton.classList.toggle('hidden', dept !== 'invoice');
  }

  if (saveButton) {
    saveButton.textContent =
      dept === 'invoice'
        ? 'Generate Invoice & Email Customer'
        : 'Save Department Record';
  }

  document.getElementById(
    'deptTitle'
  ).textContent =
    `Department: ${dept
      .replace('_', ' ')
      .toUpperCase()}`;

  document.getElementById(
    'formFields'
  ).innerHTML = DEPT_FIELDS[dept] || '';

  await loadWorkflowRecord(
    document.getElementById('activeJobId').value
  );
}

async function submitDepartment(e) {
  e.preventDefault();

  const jobId =
    document.getElementById('activeJobId').value;

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

    showDept(activeDept);
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

function logout() {
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

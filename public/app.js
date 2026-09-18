let activeDept = 'customer';
let loadedCustomerList = [];
let currentShop = null;


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

const ROLE_MAP = {
  service_advisor: [
    'customer',
    'vehicle',
    'appointment',
    'repair_order',
    'estimate'
  ],
  technician: ['parts_labor', 'repair'],
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
    '<input name="first_name" id="field_first_name" placeholder="First Name" required/>' +
    '<input name="last_name" id="field_last_name" placeholder="Last Name" required/>' +
    '<input name="phone" id="field_phone" placeholder="Phone Number" required/>',

  vehicle:
    '<input name="vin" id="field_vin" maxlength="17" placeholder="Any 17-Digit VIN Number" required/>' +
    '<button type="button" onclick="lookupVinOnline()" style="margin-bottom:8px;">Search / Decode Any VIN Online</button>' +
    '<input name="make" id="field_make" placeholder="Make" required/>' +
    '<input name="model" id="field_model" placeholder="Model" required/>' +
    '<input name="year" id="field_year" type="number" placeholder="Year" required/>',

  appointment:
    '<input name="scheduled_datetime" type="datetime-local" required/>' +
    '<input name="service_advisor" placeholder="Service Advisor"/>',

  repair_order:
    '<input name="ro_number" placeholder="RO Number" required/>' +
    '<textarea name="issue_description" placeholder="Issue Description" required></textarea>',

  parts_labor:
    '<select name="item_type">' +
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
    '<input name="description" id="part_desc" placeholder="Part Description" required/>' +
    '<button type="button" onclick="checkLivePartsPrice()" style="margin-bottom:8px;">Lookup Price For This Vehicle</button>' +
    '<input name="unit_cost" id="part_cost" type="number" step="0.01" placeholder="Cost ($)" required/>',

  estimate:
    '<input name="estimated_total" type="number" step="0.01" placeholder="Estimated Total ($)" required/>',

  repair:
    '<textarea name="work_summary" placeholder="Summary of performed repairs" required></textarea>',

  invoice:
    '<input name="invoice_number" placeholder="Invoice #" required/>' +
    '<input name="subtotal" type="number" step="0.01" placeholder="Subtotal ($)" required/>' +
    '<input name="total_amount" type="number" step="0.01" placeholder="Total ($)" required/>'
};

function applyShopThemeColor(colorHex) {
  if (colorHex) {
    document.documentElement.style.setProperty('--primary', colorHex);

    let hoverColor = colorHex;

    if (colorHex === '#3b82f6') {
      hoverColor = '#2563eb';
    }

    if (colorHex === '#f97316') {
      hoverColor = '#ea580c';
    }

    document.documentElement.style.setProperty(
      '--primary-hover',
      hoverColor
    );
  }
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
    `${currentShop.company_name} <span>Portal</span>`;

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

  const regSelect =
    document.getElementById('reg_company_id');

  const loginSelect =
    document.getElementById('login_company_id');

  const optionsHtml = companies
    .map(
      (c) =>
        `<option value="${c.id}">${c.company_name}</option>`
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

function showScreen(screenId) {
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
  document
    .getElementById('customerTab-view-requests')
    .classList.add('hidden');

  document
    .getElementById('customerTab-create-request')
    .classList.add('hidden');

  document
    .getElementById('customerTab-contact-us')
    .classList.add('hidden');

  document
    .getElementById('customerTab-settings')
    .classList.add('hidden');

  document
    .querySelectorAll('.portal-tab')
    .forEach((el) => el.classList.remove('active'));

  document
    .getElementById(`customerTab-${tabName}`)
    .classList.remove('hidden');

  document
    .getElementById(`tab-${tabName}`)
    .classList.add('active');
}

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
      'primary_color',
      data.primary_color || '#f97316'
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
async function loadManagerStaffTable() {
  const res = await fetch('/api/manager/employees', {
    headers: {
      Authorization:
        `Bearer ${localStorage.getItem('token')}`
    }
  });

  if (!res.ok) {
    return;
  }

  const employees = await res.json();

  const tbody =
    document.getElementById('employeeRosterBody');

  tbody.innerHTML = employees
    .map(
      (emp) => `
        <tr>
          <td>${emp.id}</td>

          <td>
            <strong>${emp.username}</strong>
          </td>

          <td>${emp.email || 'N/A'}</td>

          <td>
            <input
              type="text"
              id="pin_${emp.id}"
              value="${emp.pin_code || ''}"
              maxlength="6"
              style="width:100px; padding:6px;"
            />
          </td>

          <td>
            <select
              id="role_${emp.id}"
              style="padding:6px;"
            >
              <option
                value="manager"
                ${emp.role === 'manager' ? 'selected' : ''}
              >
                Manager
              </option>

              <option
                value="service_advisor"
                ${emp.role === 'service_advisor' ? 'selected' : ''}
              >
                Service Advisor
              </option>

              <option
                value="technician"
                ${emp.role === 'technician' ? 'selected' : ''}
              >
                Technician
              </option>

              <option
                value="billing"
                ${emp.role === 'billing' ? 'selected' : ''}
              >
                Billing Clerk
              </option>
            </select>
          </td>

          <td>
            <button
              onclick="saveEmployeeChanges(${emp.id})"
              style="margin:0; padding:6px 12px; font-size:0.8rem;"
            >
              Save PIN & Role
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

  if (res.ok) {
    showToast(data.message, 'success');
    e.target.reset();
    loadManagerStaffTable();
  } else {
    showToast(data.error, 'error');
  }
}

async function saveEmployeeChanges(empId) {
  const pin_code =
    document.getElementById(`pin_${empId}`).value;

  const role =
    document.getElementById(`role_${empId}`).value;

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

  if (res.ok) {
    showToast(data.message, 'success');
    loadManagerStaffTable();
  } else {
    showToast(data.error, 'error');
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

  const payload = {
    vin,

    make:
      document.getElementById('book_make').value,

    model:
      document.getElementById('book_model').value,

    year:
      document.getElementById('book_year').value,

    scheduled_datetime:
      document.getElementById('book_datetime').value,

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

  if (res.ok) {
    showToast(data.message, 'success');
    switchCustomerTab('view-requests');
    loadCustomerProfile();
  } else {
    showToast(data.error, 'error');
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
    `Current Service Status: <span class="badge">${data.status}</span>`;

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

  if (data.invoice) {
    document.getElementById(
      'invoiceContent'
    ).innerHTML = `
      <p>
        <strong>Scheduled Appointment:</strong>
        ${apptText}
      </p>

      <p>
        <strong>Invoice Number:</strong>
        ${data.invoice.invoice_number}
      </p>

      <p>
        <strong>Work Summary:</strong>
        ${data.repairExec.work_summary || 'Service in progress.'}
      </p>

      <div style="margin-top:16px; font-size:1.1rem;">
        <strong>Total Due:</strong>

        <span
          style="color:var(--primary); font-weight:bold;"
        >
          $${parseFloat(
            data.invoice.total_amount
          ).toFixed(2)}
        </span>

        <span
          class="badge"
          style="margin-left:10px;"
        >
          ${data.invoice.payment_status || 'Unpaid'}
        </span>
      </div>
    `;
  } else {
    document.getElementById(
      'invoiceContent'
    ).innerHTML = `
      <p>
        <strong>Scheduled Appointment:</strong>
        ${apptText}
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
    return;
  }

  loadedCustomerList = await res.json();

  const select =
    document.getElementById('customerSelector');

  select.innerHTML =
    '<option value="">-- Choose Existing Customer Record --</option>' +
    loadedCustomerList
      .map(
        (c) =>
          `<option value="${c.repair_job_id}">Job #${c.repair_job_id} - ${c.first_name} ${c.last_name} (${c.year || ''} ${c.make || ''} ${c.model || ''})</option>`
      )
      .join('');
}

function autoFillCustomerData() {
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

  const signupButton =
    document.querySelector(
      'a[href*="screen=registerSection"]'
    );

  const loginButton =
    document.querySelector(
      'a[href*="screen=loginSection"]'
    );

  if (signupButton) {
    signupButton.classList.toggle(
      'hidden',
      Boolean(token)
    );
  }

  if (loginButton) {
    loginButton.classList.toggle(
      'hidden',
      Boolean(token)
    );
  }
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
    switchCustomerTab('view-requests');
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
    applyRolePermissions(role);
  }
}

function showDept(dept) {
  activeDept = dept;

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

  document.getElementById(
    'deptTitle'
  ).textContent =
    `Department: ${dept
      .replace('_', ' ')
      .toUpperCase()}`;

  document.getElementById(
    'formFields'
  ).innerHTML = DEPT_FIELDS[dept] || '';

  autoFillCustomerData();
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

  if (res.ok) {
    showToast('Record saved!', 'success');

    e.target.reset();

    fetchCustomerList();

    showDept(activeDept);
  } else {
    showToast('Access Denied: ' + data.error, 'error');
  }
}

function logout() {
  localStorage.clear();
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
    'registerSection',
    'loginSection'
  ];

  if (screen && allowedScreens.includes(screen)) {
    showScreen(screen);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  openScreenFromUrl();
});
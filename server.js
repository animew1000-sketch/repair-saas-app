const express = require('express');
const pool = require('./db/pool');
const path = require('path');
require('dotenv').config();

const {
  authenticateToken,
  authorizeDepartment
} = require('./middleware/auth');

const companiesRoutes = require('./routes/companies');
const authRoutes = require('./routes/auth');
const managerRoutes = require('./routes/manager');
const customerRoutes = require('./routes/customer');
const toolsRoutes = require('./routes/tools');
const departmentRoutes = require('./routes/departments');

const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/companies', companiesRoutes);
app.use('/api', authRoutes);
app.use('/api/manager', managerRoutes);
app.use('/api/customer', customerRoutes);
app.use('/api', toolsRoutes);
app.use('/api/department', departmentRoutes);

// Automatic Schema Migration & Setup
async function initDatabase() {
  const schema = `
    CREATE TABLE IF NOT EXISTS companies (
        id INT AUTO_INCREMENT PRIMARY KEY,
        company_name VARCHAR(150) NOT NULL,
        slug VARCHAR(100) NOT NULL UNIQUE,
        tagline VARCHAR(255) NULL,
        hero_text TEXT NULL,
        primary_color VARCHAR(10) DEFAULT '#f97316',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        company_id INT NOT NULL,
        username VARCHAR(100) NOT NULL,
        email VARCHAR(255) NULL,
        password VARCHAR(255) NOT NULL,
        pin_code VARCHAR(6) NULL,
        role ENUM('manager', 'service_advisor', 'technician', 'parts_manager', 'billing', 'customer') NOT NULL,
        customer_id INT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
        UNIQUE KEY unique_company_user (company_id, username),
        UNIQUE KEY unique_company_pin (company_id, pin_code)
    );

    CREATE TABLE IF NOT EXISTS repair_jobs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        company_id INT NOT NULL,
        job_number VARCHAR(50) NOT NULL,
        status ENUM('Requested', 'Scheduled', 'In Progress', 'Invoiced', 'Completed') DEFAULT 'Requested',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS customers (
        id INT AUTO_INCREMENT PRIMARY KEY,
        company_id INT NOT NULL,
        repair_job_id INT NOT NULL,
        first_name VARCHAR(100) NOT NULL,
        last_name VARCHAR(100) NOT NULL,
        phone VARCHAR(50) NOT NULL,
        email VARCHAR(255),
        FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
        FOREIGN KEY (repair_job_id) REFERENCES repair_jobs(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS vehicles (
        id INT AUTO_INCREMENT PRIMARY KEY,
        company_id INT NOT NULL,
        repair_job_id INT NOT NULL,
        vin VARCHAR(17) NOT NULL, make VARCHAR(100) NOT NULL, model VARCHAR(100) NOT NULL, year INT NOT NULL,
        FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
        FOREIGN KEY (repair_job_id) REFERENCES repair_jobs(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS appointments (
        id INT AUTO_INCREMENT PRIMARY KEY,
        company_id INT NOT NULL,
        repair_job_id INT NOT NULL, scheduled_datetime DATETIME NOT NULL, service_advisor VARCHAR(100),
        FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
        FOREIGN KEY (repair_job_id) REFERENCES repair_jobs(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS repair_orders (
        id INT AUTO_INCREMENT PRIMARY KEY,
        company_id INT NOT NULL,
        repair_job_id INT NOT NULL, ro_number VARCHAR(100) NOT NULL, issue_description TEXT NOT NULL,
        FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
        FOREIGN KEY (repair_job_id) REFERENCES repair_jobs(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS parts_and_labor (
        id INT AUTO_INCREMENT PRIMARY KEY,
        company_id INT NOT NULL,
        repair_job_id INT NOT NULL, item_type ENUM('Part', 'Labor') NOT NULL, description VARCHAR(255) NOT NULL, unit_cost DECIMAL(10, 2) NOT NULL,
        FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
        FOREIGN KEY (repair_job_id) REFERENCES repair_jobs(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS estimates (
        id INT AUTO_INCREMENT PRIMARY KEY,
        company_id INT NOT NULL,
        repair_job_id INT NOT NULL, estimated_total DECIMAL(10, 2) NOT NULL, approved BOOLEAN DEFAULT FALSE,
        FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
        FOREIGN KEY (repair_job_id) REFERENCES repair_jobs(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS repair_executions (
        id INT AUTO_INCREMENT PRIMARY KEY,
        company_id INT NOT NULL,
        repair_job_id INT NOT NULL, work_summary TEXT NOT NULL,
        FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
        FOREIGN KEY (repair_job_id) REFERENCES repair_jobs(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS invoices (
        id INT AUTO_INCREMENT PRIMARY KEY,
        company_id INT NOT NULL,
        repair_job_id INT NOT NULL, invoice_number VARCHAR(100) NOT NULL, subtotal DECIMAL(10, 2) NOT NULL, total_amount DECIMAL(10, 2) NOT NULL,
        payment_status ENUM('Unpaid', 'Paid') DEFAULT 'Unpaid',
        FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
        FOREIGN KEY (repair_job_id) REFERENCES repair_jobs(id) ON DELETE CASCADE
    );
  `;

  try {
    await pool.query(schema);

    try { await pool.query("ALTER TABLE companies ADD COLUMN tagline VARCHAR(255) NULL;"); } catch (e) {}
    try { await pool.query("ALTER TABLE companies ADD COLUMN hero_text TEXT NULL;"); } catch (e) {}
    try { await pool.query("ALTER TABLE companies ADD COLUMN primary_color VARCHAR(10) DEFAULT '#f97316';"); } catch (e) {}

    await pool.query(`
      INSERT INTO companies (id, company_name, slug, tagline, hero_text, primary_color) VALUES
      (1, 'Apex Precision Mechanics', 'apex-mechanics', 'Precision Auto Service & Complete Repair Workflow', 'Apex Precision Mechanics provides top-tier diagnostic, engine repair, and routine maintenance solutions.', '#f97316'),
      (2, 'Vanguard Auto Performance', 'vanguard-auto', 'High Performance Tuning & Custom Mechanical Engineering', 'Vanguard Auto Performance specializes in dyno tuning, custom exhaust systems, track prep, and high-performance upgrades.', '#3b82f6')
      ON DUPLICATE KEY UPDATE 
        company_name=VALUES(company_name),
        tagline=VALUES(tagline),
        hero_text=VALUES(hero_text),
        primary_color=VALUES(primary_color);
    `);

    await pool.query(`
      INSERT INTO users (id, company_id, username, email, password, pin_code, role, customer_id) VALUES
      (1, 1, 'manager', 'manager@apex.com', 'manager123', '111111', 'manager', NULL),
      (2, 1, 'advisor', 'advisor@apex.com', 'pass123', '222222', 'service_advisor', NULL),
      (3, 1, 'tech', 'tech@apex.com', 'pass123', '333333', 'technician', NULL),
      (4, 1, 'billing', 'billing@apex.com', 'pass123', '444444', 'billing', NULL),
      (5, 1, 'client', 'client@example.com', 'pass123', NULL, 'customer', 1),
      (6, 2, 'vanguard_mgr', 'manager@vanguard.com', 'manager123', '999999', 'manager', NULL)
      ON DUPLICATE KEY UPDATE 
        company_id=VALUES(company_id),
        username=VALUES(username), 
        email=VALUES(email),
        password=VALUES(password),
        pin_code=VALUES(pin_code), 
        role=VALUES(role);
    `);

    console.log('Multi-Tenant Database initialized.');
  } catch (err) {
    console.error('Database setup error details:', err.message);
  }
}



app.get(['/', '/:slug'], (req, res) => {
  const htmlContent = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Apex SaaS | Multi-Tenant Auto Repair Operating System</title>
  <link rel="stylesheet" href="/styles.css">
</head>
<body>
  <div class="container">
    
    <div class="header">
      <div class="brand" id="navBrand" onclick="showScreen('landingSection')">🔧 <span id="brandName">Apex Auto SaaS</span></div>
      <div>
        <button class="nav-btn" onclick="showScreen('landingSection')">Platform Overview</button>
        <button class="nav-btn" onclick="showScreen('registerSection')">Client Signup</button>
        <button class="nav-btn" onclick="showScreen('loginSection')">Portal Login</button>
      </div>
    </div>

    <!-- 0. PUBLIC MARKETING LANDING PAGE -->
    <div id="landingSection">
      <div class="hero">
        <div class="marketing-pill">⚡ Next-Gen Auto Repair Operating System</div>
        <h1 id="heroTitle">Cloud-Native Management Built for <span>Independent Auto Shops</span></h1>
        <p id="heroSubtitle">Streamline customer intake, vehicle diagnostic tracking, technician workflow, parts lookup, and automated invoicing in one secure, multi-tenant SaaS platform.</p>
        
        <div style="display:flex; justify-content:center; gap:12px; flex-wrap:wrap;">
          <button style="width:auto; padding:12px 24px;" onclick="showScreen('registerSection')">Book Appointment / Signup</button>
          <button style="width:auto; padding:12px 24px; background:transparent; border:1px solid var(--primary);" onclick="showScreen('loginSection')">Staff & Client Portal Login</button>
        </div>

        <div class="shop-switcher">
          <span style="font-size:0.85rem; color:var(--text-muted); line-height:34px;">Interactive Demo Shop Pages:</span>
          <a href="/apex-mechanics" class="shop-chip">🍊 Apex Precision Mechanics</a>
          <a href="/vanguard-auto" class="shop-chip">🔹 Vanguard Auto Performance</a>
        </div>
      </div>

      <div class="marketing-stat-grid">
        <div class="stat-box">
          <div class="stat-number">100%</div>
          <div class="stat-label">Multi-Tenant Data Isolation</div>
        </div>
        <div class="stat-box">
          <div class="stat-number">6-Digit</div>
          <div class="stat-label">Fast Staff PIN Authentication</div>
        </div>
        <div class="stat-box">
          <div class="stat-number">8-Step</div>
          <div class="stat-label">End-to-End Shop Workflow</div>
        </div>
      </div>

      <div class="grid" style="margin-bottom: 24px;">
        <div class="feature-card">
          <h3>🏢 Multi-Tenant SaaS Architecture</h3>
          <p>Instantly onboard auto repair businesses with individual branding, custom theme colors, dedicated URLs, and isolated database schemas.</p>
        </div>
        <div class="feature-card">
          <h3>⚡ Staff 6-Digit PIN System</h3>
          <p>Technicians and service advisors log in within seconds via shop-assigned PINs, eliminating complex passwords on the shop floor.</p>
        </div>
        <div class="feature-card">
          <h3>✉️ Client Portal & Status Tracking</h3>
          <p>Vehicle owners receive live job status updates, view digital repair estimates, and review transparent invoices from any device.</p>
        </div>
        <div class="feature-card">
          <h3>🔍 Integrated VIN & Parts Lookup</h3>
          <p>Automated 17-digit VIN decoding matches vehicle makes and models with real-time market pricing for parts and labor billing.</p>
        </div>
      </div>

      <div class="card" style="border-left: 4px solid var(--primary);">
        <h3 style="margin-top:0; color:var(--primary);">🎯 Ready-to-Present Project Architecture</h3>
        <p style="color:var(--text-muted); margin-bottom:12px;">
          This software solution demonstrates a production-grade Web Application featuring Node.js Express API endpoints, MySQL multi-tenant database normalization, JWT authentication with role-based access control (RBAC), and custom frontend CSS variable theme synchronization.
        </p>
      </div>
    </div>

    <!-- 1. REGISTRATION -->
    <div id="registerSection" class="card hidden">
      <h2>Create Customer Account</h2>
      <p style="color: var(--text-muted);">Please confirm your shop location and create an account to schedule service.</p>
      <form onsubmit="handleRegister(event)">
        <label>Selected Auto Repair Shop Location</label>
        <select id="reg_company_id" required>
          <option value="">Loading shop locations...</option>
        </select>
        <div class="grid">
          <div><label>First Name</label><input type="text" id="reg_first_name" required /></div>
          <div><label>Last Name</label><input type="text" id="reg_last_name" required /></div>
          <div><label>Phone Number</label><input type="text" id="reg_phone" required /></div>
        </div>
        <div class="grid">
          <div><label>Email Address (Your Login ID)</label><input type="email" id="reg_email" placeholder="e.g. user@domain.com" required /></div>
          <div><label>Username</label><input type="text" id="reg_username" required /></div>
        </div>
        <div><label>Password</label><input type="password" id="reg_password" required /></div>
        <button type="submit">Register Account</button>
      </form>
    </div>

    <!-- 2. LOGIN PAGE -->
    <div id="loginSection" class="card hidden">
      <h2>Portal Login</h2>
      <p style="color:var(--text-muted);">Staff log in using your 6-Digit PIN. Customers log in using your Email Address & Password.</p>
      <form onsubmit="handleLogin(event)">
        <label>Shop Location</label>
        <select id="login_company_id">
          <option value="">-- Auto-Detect Shop by PIN/Account --</option>
        </select>

        <label style="margin-top:12px;">Customer Email / Username OR Staff 6-Digit PIN</label>
        <input type="text" id="login_input" placeholder="e.g. user@domain.com (Customer) or 111111 (Staff PIN)" required />
        
        <label style="margin-top:12px;">Password (Required for Customer Email Login)</label>
        <input type="password" id="password" placeholder="Password for email/username login" />
        
        <button type="submit">Log In</button>
      </form>
    </div>

    <!-- 3. CUSTOMER DASHBOARD -->
    <div id="customerDashboard" class="card hidden">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
        <div>
          <h2>Customer Portal</h2>
          <small class="shop-title-text" id="clientShopBanner"></small>
        </div>
        <div>
          Welcome, <strong id="clientWelcomeName" style="color:var(--primary);"></strong>!
          <button onclick="logout()" class="nav-btn" style="margin-left:12px;">Logout</button>
        </div>
      </div>

      <div class="portal-tab-bar">
        <div id="tab-view-requests" class="portal-tab active" onclick="switchCustomerTab('view-requests')">📋 View Service Requests & Invoices</div>
        <div id="tab-create-request" class="portal-tab" onclick="switchCustomerTab('create-request')">➕ Create New Service Request</div>
        <div id="tab-contact-us" class="portal-tab" onclick="switchCustomerTab('contact-us')">📞 Contact Us & Support</div>
      </div>

      <div id="customerTab-view-requests">
        <div id="statusBadge" style="margin: 12px 0;"></div>
        <div id="invoiceContainer" class="invoice-box">
          <h3>Active Repair Job & Invoicing Details</h3>
          <div id="invoiceContent">Loading records...</div>
        </div>

        <form onsubmit="handleUpdateCustomerProfile(event)" style="margin-top: 24px;">
          <h3>Update Profile & Vehicle Details</h3>
          <div class="grid">
            <div><label>First Name</label><input type="text" id="cust_first_name" required /></div>
            <div><label>Last Name</label><input type="text" id="cust_last_name" required /></div>
            <div><label>Phone Number</label><input type="text" id="cust_phone" required /></div>
          </div>
          <div class="grid">
            <div><label>Email Address</label><input type="email" id="cust_email" required /></div>
            <div><label>VIN Number (17 Digits)</label><input type="text" id="cust_vin" maxlength="17" required /></div>
          </div>
          <div class="grid">
            <div><label>Vehicle Make</label><input type="text" id="cust_make" required /></div>
            <div><label>Vehicle Model</label><input type="text" id="cust_model" required /></div>
            <div><label>Year</label><input type="number" id="cust_year" required /></div>
          </div>
          <label>Reported Problem / Symptoms</label>
          <textarea id="cust_issue" rows="3" required></textarea>
          
          <button type="submit">Save Updated Profile</button>
        </form>
      </div>

      <div id="customerTab-create-request" class="invoice-box hidden">
        <h3>Submit New Vehicle Repair / Maintenance Request</h3>
        <form onsubmit="handleBookAppointment(event)">
          <div class="grid">
            <div><label>VIN Number (17 Digits)</label><input type="text" id="book_vin" maxlength="17" placeholder="e.g. 1FA6P8CF0H1234567" required /></div>
            <div><label>Vehicle Make</label><input type="text" id="book_make" placeholder="e.g. Ford" required /></div>
            <div><label>Vehicle Model</label><input type="text" id="book_model" placeholder="e.g. Mustang" required /></div>
            <div><label>Year</label><input type="number" id="book_year" placeholder="e.g. 2022" required /></div>
          </div>
          <label>Preferred Appointment Date & Time</label>
          <input type="datetime-local" id="book_datetime" required />
          <label>Describe Vehicle Issue / Symptoms</label>
          <textarea id="book_issue" rows="3" placeholder="Describe symptoms..." required></textarea>
          <button type="submit">Submit Service Request</button>
        </form>
      </div>

      <div id="customerTab-contact-us" class="invoice-box hidden">
        <h3>Contact Shop Support</h3>
        <div class="grid" style="margin-top:20px;">
          <div class="feature-card">
            <h4>📍 Service Location</h4>
            <p id="shopAddressText">100 Industrial Parkway, Mechanics Hub</p>
          </div>
          <div class="feature-card">
            <h4>📞 Phone Support</h4>
            <p>(555) 019-2834</p>
          </div>
        </div>
      </div>
    </div>

    <!-- 4. EMPLOYEE & MANAGER DASHBOARD -->
    <div id="employeeDashboard" class="card hidden">
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <div>
          <h2>Shop Operations Portal</h2>
          <small class="shop-title-text" style="font-size:1.05rem;" id="empShopBanner"></small>
        </div>
        <div>User: <span id="userRoleBadge" class="badge"></span> <button onclick="logout()" class="nav-btn">Logout</button></div>
      </div>

      <div id="managerControlPanel" class="invoice-box hidden" style="margin-bottom:24px;">
        <h3 class="shop-title-text">👑 Manager Dashboard: Staff PIN & Role Manager</h3>
        <p style="color:var(--text-muted); font-size:0.9rem;">Create staff profiles, assign 6-digit login PINs, and update employee roles for this shop.</p>
        
        <form onsubmit="handleCreateEmployee(event)" style="margin-bottom:20px;">
          <h4>Add New Employee Profile</h4>
          <div class="grid">
            <div><label>Employee Name / Username</label><input type="text" id="new_emp_username" placeholder="e.g. john_tech" required /></div>
            <div><label>Employee Email (Optional)</label><input type="email" id="new_emp_email" placeholder="john@apex.com" /></div>
            <div><label>Assign 6-Digit PIN</label><input type="text" id="new_emp_pin" maxlength="6" placeholder="e.g. 654321" required /></div>
            <div>
              <label>Assign Role</label>
              <select id="new_emp_role" required>
                <option value="service_advisor">Service Advisor</option>
                <option value="technician">Technician</option>
                <option value="billing">Billing Clerk</option>
                <option value="manager">Manager</option>
              </select>
            </div>
          </div>
          <button type="submit" style="width:auto; padding:10px 20px;">Create Employee Profile</button>
        </form>

        <h4>Assigned Employee Roster & PIN Codes</h4>
        <table class="staff-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Username</th>
              <th>Email</th>
              <th>6-Digit PIN Code</th>
              <th>Role</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody id="employeeRosterBody">
            <tr><td colspan="6">Loading employee records...</td></tr>
          </tbody>
        </table>
      </div>

      <label class="shop-title-text" style="font-size:1rem;">Select Customer (Auto-fills Customer & Vehicle Data)</label>
      <select id="customerSelector" onchange="autoFillCustomerData()">
        <option value="">-- Choose Existing Customer Record --</option>
      </select>

      <label>Active Repair Job ID</label>
      <input type="number" id="activeJobId" value="1" />

      <div class="workflow-bar" style="margin-top:16px;">
        <div id="btn-customer" class="step-card" onclick="showDept('customer')">1. Customer</div>
        <div id="btn-vehicle" class="step-card" onclick="showDept('vehicle')">2. Vehicle</div>
        <div id="btn-appointment" class="step-card" onclick="showDept('appointment')">3. Appointment</div>
        <div id="btn-repair_order" class="step-card" onclick="showDept('repair_order')">4. Repair Order</div>
        <div id="btn-parts_labor" class="step-card" onclick="showDept('parts_labor')">5. Parts + Labor</div>
        <div id="btn-estimate" class="step-card" onclick="showDept('estimate')">6. Estimate</div>
        <div id="btn-repair" class="step-card" onclick="showDept('repair')">7. Repair</div>
        <div id="btn-invoice" class="step-card" onclick="showDept('invoice')">8. Invoice</div>
      </div>

      <form id="deptForm" onsubmit="submitDepartment(event)">
        <h3 id="deptTitle">Department Action</h3>
        <div id="formFields">Select a department above</div>
        <button type="submit">Save Department Record</button>
      </form>
    </div>

  </div>

  <script>
    let activeDept = 'customer';
    let loadedCustomerList = [];
    let currentShop = null;

    const ROLE_MAP = {
      service_advisor: ['customer', 'vehicle', 'appointment', 'repair_order', 'estimate'],
      technician: ['parts_labor', 'repair'],
      billing: ['estimate', 'invoice'],
      manager: ['customer', 'vehicle', 'appointment', 'repair_order', 'parts_labor', 'estimate', 'repair', 'invoice']
    };

    const DEPT_FIELDS = {
      customer: '<input name="first_name" id="field_first_name" placeholder="First Name" required/><input name="last_name" id="field_last_name" placeholder="Last Name" required/><input name="phone" id="field_phone" placeholder="Phone Number" required/>',
      vehicle: '<input name="vin" id="field_vin" maxlength="17" placeholder="Any 17-Digit VIN Number" required/><button type="button" onclick="lookupVinOnline()" style="margin-bottom:8px;">Search / Decode Any VIN Online</button><input name="make" id="field_make" placeholder="Make" required/><input name="model" id="field_model" placeholder="Model" required/><input name="year" id="field_year" type="number" placeholder="Year" required/>',
      appointment: '<input name="scheduled_datetime" type="datetime-local" required/><input name="service_advisor" placeholder="Service Advisor"/>',
      repair_order: '<input name="ro_number" placeholder="RO Number" required/><textarea name="issue_description" placeholder="Issue Description" required></textarea>',
      parts_labor: '<select name="item_type"><option value="Part">Part</option><option value="Labor">Labor</option></select><select id="part_desc_select" onchange="autoFillPartName()"><option value="">-- Choose Common Vehicle Replacement Part --</option><option value="Front Brake Rotors & Pads">Front Brake Rotors & Pads</option><option value="Engine Spark Plugs Set">Engine Spark Plugs Set</option><option value="High Performance Alternator">High Performance Alternator</option><option value="Synthetic Oil Filter">Synthetic Oil Filter</option></select><input name="description" id="part_desc" placeholder="Part Description" required/><button type="button" onclick="checkLivePartsPrice()" style="margin-bottom:8px;">Lookup Price For This Vehicle</button><input name="unit_cost" id="part_cost" type="number" step="0.01" placeholder="Cost ($)" required/>',
      estimate: '<input name="estimated_total" type="number" step="0.01" placeholder="Estimated Total ($)" required/>',
      repair: '<textarea name="work_summary" placeholder="Summary of performed repairs" required></textarea>',
      invoice: '<input name="invoice_number" placeholder="Invoice #" required/><input name="subtotal" type="number" step="0.01" placeholder="Subtotal ($)" required/><input name="total_amount" type="number" step="0.01" placeholder="Total ($)" required/>'
    };

    function applyShopThemeColor(colorHex) {
      if (colorHex) {
        document.documentElement.style.setProperty('--primary', colorHex);
        
        let hoverColor = colorHex;
        if (colorHex === '#3b82f6') hoverColor = '#2563eb';
        if (colorHex === '#f97316') hoverColor = '#ea580c';
        document.documentElement.style.setProperty('--primary-hover', hoverColor);
      }
    }

    async function loadShopLandingContext() {
      const slug = window.location.pathname.replace('/', '').trim();
      if (!slug) return loadCompaniesDropdown();

      const res = await fetch(\`/api/companies/\${slug}\`);
      if (!res.ok) return loadCompaniesDropdown();

      currentShop = await res.json();

      document.getElementById('brandName').textContent = currentShop.company_name;
      document.getElementById('heroTitle').innerHTML = \`\${currentShop.company_name} <span>Portal</span>\`;
      document.getElementById('heroSubtitle').textContent = currentShop.hero_text || currentShop.tagline;

      applyShopThemeColor(currentShop.primary_color);

      await loadCompaniesDropdown();
      if (currentShop) {
        document.getElementById('reg_company_id').value = currentShop.id;
        document.getElementById('login_company_id').value = currentShop.id;
      }
    }

    async function loadCompaniesDropdown() {
      const res = await fetch('/api/companies');
      if (!res.ok) return;
      const companies = await res.json();
      
      const regSelect = document.getElementById('reg_company_id');
      const loginSelect = document.getElementById('login_company_id');
      
      const optionsHtml = companies.map(c => \`<option value="\${c.id}">\${c.company_name}</option>\`).join('');
      
      if (regSelect) regSelect.innerHTML = optionsHtml;
      if (loginSelect) loginSelect.innerHTML = '<option value="">-- Auto-Detect Shop by PIN/Account --</option>' + optionsHtml;

      if (currentShop) {
        if (regSelect) regSelect.value = currentShop.id;
        if (loginSelect) loginSelect.value = currentShop.id;
      }
    }

    function showScreen(screenId) {
      document.getElementById('landingSection').classList.add('hidden');
      document.getElementById('registerSection').classList.add('hidden');
      document.getElementById('loginSection').classList.add('hidden');
      document.getElementById('customerDashboard').classList.add('hidden');
      document.getElementById('employeeDashboard').classList.add('hidden');
      document.getElementById(screenId).classList.remove('hidden');
    }

    function switchCustomerTab(tabName) {
      document.getElementById('customerTab-view-requests').classList.add('hidden');
      document.getElementById('customerTab-create-request').classList.add('hidden');
      document.getElementById('customerTab-contact-us').classList.add('hidden');

      document.querySelectorAll('.portal-tab').forEach(el => el.classList.remove('active'));

      document.getElementById(\`customerTab-\${tabName}\`).classList.remove('hidden');
      document.getElementById(\`tab-\${tabName}\`).classList.add('active');
    }

    async function handleLogin(e) {
      e.preventDefault();
      const company_id = document.getElementById('login_company_id').value;
      const login_input = document.getElementById('login_input').value;
      const password = document.getElementById('password').value;

      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company_id, login_input, password })
      });
      const data = await res.json();
      if (!res.ok) return alert(data.error);

      localStorage.setItem('token', data.token);
      localStorage.setItem('role', data.role);
      localStorage.setItem('username', data.username);
      localStorage.setItem('company_name', data.company_name);
      localStorage.setItem('primary_color', data.primary_color || '#f97316');
      
      renderDashboard();
    }

    async function loadManagerStaffTable() {
      const res = await fetch('/api/manager/employees', {
        headers: { 'Authorization': \`Bearer \${localStorage.getItem('token')}\` }
      });
      if (!res.ok) return;

      const employees = await res.json();
      const tbody = document.getElementById('employeeRosterBody');
      tbody.innerHTML = employees.map(emp => \`
        <tr>
          <td>\${emp.id}</td>
          <td><strong>\${emp.username}</strong></td>
          <td>\${emp.email || 'N/A'}</td>
          <td><input type="text" id="pin_\${emp.id}" value="\${emp.pin_code || ''}" maxlength="6" style="width:100px; padding:6px;" /></td>
          <td>
            <select id="role_\${emp.id}" style="padding:6px;">
              <option value="manager" \${emp.role === 'manager' ? 'selected' : ''}>Manager</option>
              <option value="service_advisor" \${emp.role === 'service_advisor' ? 'selected' : ''}>Service Advisor</option>
              <option value="technician" \${emp.role === 'technician' ? 'selected' : ''}>Technician</option>
              <option value="billing" \${emp.role === 'billing' ? 'selected' : ''}>Billing Clerk</option>
            </select>
          </td>
          <td>
            <button onclick="saveEmployeeChanges(\${emp.id})" style="margin:0; padding:6px 12px; font-size:0.8rem;">Save PIN & Role</button>
          </td>
        </tr>
      \`).join('');
    }

    async function handleCreateEmployee(e) {
      e.preventDefault();
      const payload = {
        username: document.getElementById('new_emp_username').value,
        email: document.getElementById('new_emp_email').value,
        pin_code: document.getElementById('new_emp_pin').value,
        role: document.getElementById('new_emp_role').value
      };

      const res = await fetch('/api/manager/create-employee', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': \`Bearer \${localStorage.getItem('token')}\`
        },
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      if (res.ok) {
        alert(data.message);
        e.target.reset();
        loadManagerStaffTable();
      } else {
        alert('Error: ' + data.error);
      }
    }

    async function saveEmployeeChanges(empId) {
      const pin_code = document.getElementById(\`pin_\${empId}\`).value;
      const role = document.getElementById(\`role_\${empId}\`).value;

      const res = await fetch('/api/manager/update-employee', {
        method: 'PUT',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': \`Bearer \${localStorage.getItem('token')}\`
        },
        body: JSON.stringify({ id: empId, pin_code, role })
      });

      const data = await res.json();
      if (res.ok) {
        alert(data.message);
        loadManagerStaffTable();
      } else {
        alert('Error: ' + data.error);
      }
    }

    async function lookupVinOnline() {
      const vin = document.getElementById('field_vin').value;
      if (!vin || vin.length !== 17) return alert('Enter any valid 17-digit VIN number');

      const res = await fetch(\`/api/vehicle/vin-lookup/\${vin}\`, {
        headers: { 'Authorization': \`Bearer \${localStorage.getItem('token')}\` }
      });
      const data = await res.json();
      if (res.ok) {
        document.getElementById('field_make').value = data.make;
        document.getElementById('field_model').value = data.model;
        document.getElementById('field_year').value = data.year;
        alert(\`Decoded VIN (\${data.vin}): \${data.year} \${data.make} \${data.model}\`);
      } else {
        alert('VIN Lookup Error: ' + data.error);
      }
    }

    function autoFillPartName() {
      const val = document.getElementById('part_desc_select').value;
      if (val) document.getElementById('part_desc').value = val;
    }

    async function checkLivePartsPrice() {
      const desc = document.getElementById('part_desc').value;
      const jobId = document.getElementById('activeJobId').value;
      if (!desc) return alert('Enter a part description first');

      const res = await fetch(\`/api/parts/catalog-lookup?jobId=\${jobId}&partName=\${encodeURIComponent(desc)}\`, {
        headers: { 'Authorization': \`Bearer \${localStorage.getItem('token')}\` }
      });
      const data = await res.json();
      if (res.ok) {
        document.getElementById('part_cost').value = data.market_price;
        alert(\`Online Price for \${data.vehicle}: $\${data.market_price}\`);
      }
    }

    async function handleRegister(e) {
      e.preventDefault();
      const payload = {
        company_id: document.getElementById('reg_company_id').value,
        first_name: document.getElementById('reg_first_name').value,
        last_name: document.getElementById('reg_last_name').value,
        phone: document.getElementById('reg_phone').value,
        email: document.getElementById('reg_email').value,
        username: document.getElementById('reg_username').value,
        password: document.getElementById('reg_password').value
      };

      const res = await fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      if (res.ok) {
        alert(data.message);
        showScreen('loginSection');
      } else {
        alert('Error: ' + data.error);
      }
    }

    async function handleBookAppointment(e) {
      e.preventDefault();
      const vin = document.getElementById('book_vin').value;
      if (vin.length !== 17) return alert('VIN must be exactly 17 digits');

      const payload = {
        vin: vin,
        make: document.getElementById('book_make').value,
        model: document.getElementById('book_model').value,
        year: document.getElementById('book_year').value,
        scheduled_datetime: document.getElementById('book_datetime').value,
        issue_description: document.getElementById('book_issue').value
      };

      const res = await fetch('/api/customer/request-appointment', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': \`Bearer \${localStorage.getItem('token')}\`
        },
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      if (res.ok) {
        alert(data.message);
        switchCustomerTab('view-requests');
        loadCustomerProfile();
      } else {
        alert('Error: ' + data.error);
      }
    }

    async function loadCustomerProfile() {
      const res = await fetch('/api/customer/my-repair', {
        headers: { 'Authorization': \`Bearer \${localStorage.getItem('token')}\` }
      });
      const data = await res.json();
      
      document.getElementById('clientShopBanner').textContent = \`Shop: \${localStorage.getItem('company_name') || ''}\`;
      document.getElementById('clientWelcomeName').textContent = data.customer.first_name ? \`\${data.customer.first_name} \${data.customer.last_name}\` : localStorage.getItem('username');
      document.getElementById('statusBadge').innerHTML = \`Current Service Status: <span class="badge">\${data.status}</span>\`;
      document.getElementById('cust_first_name').value = data.customer.first_name || '';
      document.getElementById('cust_last_name').value = data.customer.last_name || '';
      document.getElementById('cust_phone').value = data.customer.phone || '';
      document.getElementById('cust_email').value = data.customer.email || '';
      document.getElementById('cust_vin').value = data.vehicle.vin || '';
      document.getElementById('cust_make').value = data.vehicle.make || '';
      document.getElementById('cust_model').value = data.vehicle.model || '';
      document.getElementById('cust_year').value = data.vehicle.year || '';
      document.getElementById('cust_issue').value = data.repairOrder.issue_description || '';

      let apptText = data.appointment.scheduled_datetime ? new Date(data.appointment.scheduled_datetime).toLocaleString() : 'No appointment scheduled yet.';

      if (data.invoice) {
        document.getElementById('invoiceContent').innerHTML = \`
          <p><strong>Scheduled Appointment:</strong> \${apptText}</p>
          <p><strong>Invoice Number:</strong> \${data.invoice.invoice_number}</p>
          <p><strong>Work Summary:</strong> \${data.repairExec.work_summary || 'Service in progress.'}</p>
          <div style="margin-top:16px; font-size:1.1rem;">
            <strong>Total Due:</strong> <span style="color:var(--primary); font-weight:bold;">$\${parseFloat(data.invoice.total_amount).toFixed(2)}</span>
            <span class="badge" style="margin-left:10px;">\${data.invoice.payment_status || 'Unpaid'}</span>
          </div>
        \`;
      } else {
        document.getElementById('invoiceContent').innerHTML = \`
          <p><strong>Scheduled Appointment:</strong> \${apptText}</p>
          <p style="color:var(--text-muted);">No invoice generated yet.</p>
        \`;
      }
    }

    async function handleUpdateCustomerProfile(e) {
      e.preventDefault();
      const vin = document.getElementById('cust_vin').value;
      if (vin.length !== 17) return alert('VIN must be exactly 17 digits');

      const payload = {
        first_name: document.getElementById('cust_first_name').value,
        last_name: document.getElementById('cust_last_name').value,
        phone: document.getElementById('cust_phone').value,
        email: document.getElementById('cust_email').value,
        vin: vin,
        make: document.getElementById('cust_make').value,
        model: document.getElementById('cust_model').value,
        year: document.getElementById('cust_year').value,
        issue_description: document.getElementById('cust_issue').value
      };

      const res = await fetch('/api/customer/update-profile', {
        method: 'PUT',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': \`Bearer \${localStorage.getItem('token')}\`
        },
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      if (res.ok) {
        alert(data.message);
      } else {
        alert('Error: ' + data.error);
      }
    }

    async function fetchCustomerList() {
      const res = await fetch('/api/customer/list', {
        headers: { 'Authorization': \`Bearer \${localStorage.getItem('token')}\` }
      });

      if (!res.ok) return;
      
      loadedCustomerList = await res.json();
      const select = document.getElementById('customerSelector');
      select.innerHTML = '<option value="">-- Choose Existing Customer Record --</option>' + 
        loadedCustomerList.map(c => \`<option value="\${c.repair_job_id}">Job #\${c.repair_job_id} - \${c.first_name} \${c.last_name} (\${c.year || ''} \${c.make || ''} \${c.model || ''})</option>\`).join('');
    }

    function autoFillCustomerData() {
      const jobId = document.getElementById('customerSelector').value;
      if (!jobId) return;

      document.getElementById('activeJobId').value = jobId;
      const customer = loadedCustomerList.find(c => c.repair_job_id == jobId);
      if (!customer) return;

      if (activeDept === 'customer') {
        if (document.getElementById('field_first_name')) document.getElementById('field_first_name').value = customer.first_name || '';
        if (document.getElementById('field_last_name')) document.getElementById('field_last_name').value = customer.last_name || '';
        if (document.getElementById('field_phone')) document.getElementById('field_phone').value = customer.phone || '';
      } else if (activeDept === 'vehicle') {
        if (document.getElementById('field_vin')) document.getElementById('field_vin').value = customer.vin || '';
        if (document.getElementById('field_make')) document.getElementById('field_make').value = customer.make || '';
        if (document.getElementById('field_model')) document.getElementById('field_model').value = customer.model || '';
        if (document.getElementById('field_year')) document.getElementById('field_year').value = customer.year || '';
      }
    }

    function applyRolePermissions(role) {
      const allowedDepts = ROLE_MAP[role] || [];
      const allDepts = ['customer', 'vehicle', 'appointment', 'repair_order', 'parts_labor', 'estimate', 'repair', 'invoice'];

      allDepts.forEach(dept => {
        const btn = document.getElementById(\`btn-\${dept}\`);
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

    function renderDashboard() {
      const token = localStorage.getItem('token');
      const role = localStorage.getItem('role');
      const primaryColor = localStorage.getItem('primary_color');

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
        document.getElementById('empShopBanner').textContent = \`Shop: \${localStorage.getItem('company_name') || ''}\`;
        document.getElementById('userRoleBadge').textContent = \`\${localStorage.getItem('username')} (\${role})\`;
        
        if (role === 'manager') {
          document.getElementById('managerControlPanel').classList.remove('hidden');
          loadManagerStaffTable();
        } else {
          document.getElementById('managerControlPanel').classList.add('hidden');
        }

        fetchCustomerList();
        applyRolePermissions(role);
      }
    }

    function showDept(dept) {
      activeDept = dept;
      document.querySelectorAll('.step-card').forEach(el => el.classList.remove('active'));
      const activeBtn = document.getElementById(\`btn-\${dept}\`);
      if (activeBtn) activeBtn.classList.add('active');

      document.getElementById('deptTitle').textContent = \`Department: \${dept.replace('_', ' ').toUpperCase()}\`;
      document.getElementById('formFields').innerHTML = DEPT_FIELDS[dept] || '';
      autoFillCustomerData();
    }

    async function submitDepartment(e) {
      e.preventDefault();
      const jobId = document.getElementById('activeJobId').value;
      const formData = new FormData(e.target);
      const payload = { repair_job_id: jobId };
      formData.forEach((val, key) => payload[key] = val);

      const res = await fetch(\`/api/department/\${activeDept}\`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': \`Bearer \${localStorage.getItem('token')}\`
        },
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      if (res.ok) {
        alert('Record saved!');
        e.target.reset();
        fetchCustomerList();
        showDept(activeDept);
      } else {
        alert('Access Denied: ' + data.error);
      }
    }

    function logout() {
      localStorage.clear();
      renderDashboard();
    }

    renderDashboard();
  </script>
</body>
</html>
  `;
  res.send(htmlContent);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  await initDatabase();
  console.log(`Multi-Tenant SaaS Application live on http://localhost:${PORT}`);
});
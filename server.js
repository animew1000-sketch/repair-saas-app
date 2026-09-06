const express = require('express');
const mysql = require('mysql2/promise');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const app = express();
app.use(express.json());

const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_school_project_key_2026';

// Database Pool Configuration
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'repair_db',
  port: process.env.DB_PORT || 3306,
  multipleStatements: true,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Automatic Schema Migration & Setup
async function initDatabase() {
  const schema = `
    CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        username VARCHAR(100) NOT NULL UNIQUE,
        password VARCHAR(255) NOT NULL,
        role ENUM('admin', 'service_advisor', 'technician', 'parts_manager', 'billing', 'customer') NOT NULL,
        customer_id INT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS repair_jobs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        job_number VARCHAR(50) NOT NULL UNIQUE,
        status ENUM('Requested', 'Scheduled', 'In Progress', 'Invoiced', 'Completed') DEFAULT 'Requested',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS customers (
        id INT AUTO_INCREMENT PRIMARY KEY,
        repair_job_id INT NOT NULL,
        first_name VARCHAR(100) NOT NULL,
        last_name VARCHAR(100) NOT NULL,
        phone VARCHAR(50) NOT NULL,
        email VARCHAR(255),
        FOREIGN KEY (repair_job_id) REFERENCES repair_jobs(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS vehicles (
        id INT AUTO_INCREMENT PRIMARY KEY,
        repair_job_id INT NOT NULL,
        vin VARCHAR(17) NOT NULL, make VARCHAR(100) NOT NULL, model VARCHAR(100) NOT NULL, year INT NOT NULL,
        FOREIGN KEY (repair_job_id) REFERENCES repair_jobs(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS appointments (
        id INT AUTO_INCREMENT PRIMARY KEY,
        repair_job_id INT NOT NULL, scheduled_datetime DATETIME NOT NULL, service_advisor VARCHAR(100),
        FOREIGN KEY (repair_job_id) REFERENCES repair_jobs(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS repair_orders (
        id INT AUTO_INCREMENT PRIMARY KEY,
        repair_job_id INT NOT NULL, ro_number VARCHAR(100) NOT NULL UNIQUE, issue_description TEXT NOT NULL,
        FOREIGN KEY (repair_job_id) REFERENCES repair_jobs(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS parts_and_labor (
        id INT AUTO_INCREMENT PRIMARY KEY,
        repair_job_id INT NOT NULL, item_type ENUM('Part', 'Labor') NOT NULL, description VARCHAR(255) NOT NULL, unit_cost DECIMAL(10, 2) NOT NULL,
        FOREIGN KEY (repair_job_id) REFERENCES repair_jobs(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS estimates (
        id INT AUTO_INCREMENT PRIMARY KEY,
        repair_job_id INT NOT NULL, estimated_total DECIMAL(10, 2) NOT NULL, approved BOOLEAN DEFAULT FALSE,
        FOREIGN KEY (repair_job_id) REFERENCES repair_jobs(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS repair_executions (
        id INT AUTO_INCREMENT PRIMARY KEY,
        repair_job_id INT NOT NULL, work_summary TEXT NOT NULL,
        FOREIGN KEY (repair_job_id) REFERENCES repair_jobs(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS invoices (
        id INT AUTO_INCREMENT PRIMARY KEY,
        repair_job_id INT NOT NULL, invoice_number VARCHAR(100) NOT NULL UNIQUE, subtotal DECIMAL(10, 2) NOT NULL, total_amount DECIMAL(10, 2) NOT NULL,
        payment_status ENUM('Unpaid', 'Paid') DEFAULT 'Unpaid',
        FOREIGN KEY (repair_job_id) REFERENCES repair_jobs(id) ON DELETE CASCADE
    );
  `;
  try {
    await pool.query(schema);

    const [users] = await pool.query('SELECT * FROM users');
    if (users.length === 0) {
      await pool.query(`
        INSERT INTO users (username, password, role, customer_id) VALUES
        ('admin', 'admin123', 'admin', NULL),
        ('advisor', 'pass123', 'service_advisor', NULL),
        ('tech', 'pass123', 'technician', NULL),
        ('billing', 'pass123', 'billing', NULL),
        ('client', 'pass123', 'customer', 1);
      `);
      console.log('Default project test accounts created.');
    }
  } catch (err) {
    console.error('Database setup error:', err.message);
  }
}

// Authentication Middleware
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Access denied. Please register or log in first.' });

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Session expired. Please log in again.' });
    req.user = user;
    next();
  });
}

// Strictly Defined Role Permissions Matrix
const ROLE_PERMISSIONS = {
  customer: [],
  service_advisor: ['customer', 'vehicle', 'appointment', 'repair_order', 'estimate'],
  technician: ['parts_labor', 'repair'],
  billing: ['estimate', 'invoice'],
  admin: ['customer', 'vehicle', 'appointment', 'repair_order', 'parts_labor', 'estimate', 'repair', 'invoice']
};

function authorizeDepartment(req, res, next) {
  const userRole = req.user.role;
  const dept = req.params.name;

  if (userRole === 'admin') return next();
  
  const allowedDepts = ROLE_PERMISSIONS[userRole] || [];
  if (!allowedDepts.includes(dept)) {
    return res.status(403).json({ error: `Unauthorized: Your rank (${userRole}) cannot modify ${dept}.` });
  }
  next();
}

// API: Customer Registration
app.post('/api/register', async (req, res) => {
  const { username, password, first_name, last_name, phone } = req.body;
  try {
    const jobNum = `JOB-${Date.now().toString().slice(-6)}`;
    const [jobRes] = await pool.query('INSERT INTO repair_jobs (job_number, status) VALUES (?, ?)', [jobNum, 'Requested']);
    const jobId = jobRes.insertId;

    await pool.query('INSERT INTO customers (repair_job_id, first_name, last_name, phone) VALUES (?, ?, ?, ?)', [jobId, first_name, last_name, phone]);
    await pool.query('INSERT INTO users (username, password, role, customer_id) VALUES (?, ?, ?, ?)', [
      username, password, 'customer', jobId
    ]);

    res.json({ success: true, message: 'Account created successfully! Log in to schedule an appointment.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Login
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const [rows] = await pool.query('SELECT * FROM users WHERE username = ? AND password = ?', [username, password]);
    if (rows.length === 0) return res.status(401).json({ error: 'Invalid username or password' });

    const user = rows[0];
    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role, customer_id: user.customer_id },
      JWT_SECRET,
      { expiresIn: '8h' }
    );

    res.json({ token, role: user.role, username: user.username, customer_id: user.customer_id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Offline Simulated VIN Decoder (Does NOT Query Real Road Vehicles)
app.get('/api/vehicle/vin-lookup/:vin', authenticateToken, async (req, res) => {
  const vin = req.params.vin.toUpperCase();
  if (vin.length !== 17) {
    return res.status(400).json({ error: 'VIN must be exactly 17 characters long.' });
  }

  // School project simulated make/model generator
  const projectMakes = ['Apex-Motors', 'Project-Auto', 'Titan-Drive', 'Vanguard-EV', 'Hyperion-Motors'];
  const projectModels = ['Interceptor', 'Courier', 'Falcon-X', 'Omni-Truck', 'Pioneer-SUV'];
  
  const vinSum = vin.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0);
  const simulatedMake = projectMakes[vinSum % projectMakes.length];
  const simulatedModel = projectModels[(vinSum * 7) % projectModels.length];
  const simulatedYear = 2018 + (vinSum % 9);

  return res.json({
    vin,
    make: simulatedMake,
    model: simulatedModel,
    year: simulatedYear.toString()
  });
});

// API: Vehicle Parts Catalog Lookup
app.get('/api/parts/catalog-lookup', authenticateToken, async (req, res) => {
  const { jobId, partName } = req.query;
  try {
    const [vehicles] = await pool.query('SELECT * FROM vehicles WHERE repair_job_id = ?', [jobId]);
    const car = vehicles[0] || { make: 'Project-Auto', model: 'Vehicle', year: '2022' };

    let basePrice = 50.00;
    const nameLower = (partName || '').toLowerCase();
    if (nameLower.includes('brake') || nameLower.includes('pad')) basePrice = 89.99;
    if (nameLower.includes('rotor')) basePrice = 135.50;
    if (nameLower.includes('spark') || nameLower.includes('plug')) basePrice = 18.00;
    if (nameLower.includes('alternator') || nameLower.includes('starter')) basePrice = 240.00;
    if (nameLower.includes('filter') || nameLower.includes('oil')) basePrice = 22.50;

    res.json({
      vehicle: `${car.year} ${car.make} ${car.model}`,
      part: partName,
      market_price: basePrice.toFixed(2)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Customer Schedule Appointment
app.post('/api/customer/request-appointment', authenticateToken, async (req, res) => {
  if (req.user.role !== 'customer') return res.status(403).json({ error: 'Only customers can schedule appointments.' });

  const jobId = req.user.customer_id;
  const { vin, make, model, year, scheduled_datetime, issue_description } = req.body;
  
  if (!vin || vin.length !== 17) {
    return res.status(400).json({ error: 'Please enter a valid 17-digit VIN.' });
  }

  try {
    await pool.query(
      'INSERT INTO vehicles (repair_job_id, vin, make, model, year) VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE vin=?, make=?, model=?, year=?',
      [jobId, vin, make, model, year, vin, make, model, year]
    );

    await pool.query('INSERT INTO appointments (repair_job_id, scheduled_datetime) VALUES (?, ?)', [jobId, scheduled_datetime]);

    const roNum = `RO-${Date.now().toString().slice(-6)}`;
    await pool.query(
      'INSERT INTO repair_orders (repair_job_id, ro_number, issue_description) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE issue_description=?',
      [jobId, roNum, issue_description, issue_description]
    );

    res.json({ success: true, message: 'Appointment booked successfully!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Update Customer Profile
app.put('/api/customer/update-profile', authenticateToken, async (req, res) => {
  if (req.user.role !== 'customer') return res.status(403).json({ error: 'Access denied.' });

  const jobId = req.user.customer_id;
  const { first_name, last_name, phone, vin, make, model, year, issue_description } = req.body;

  if (!vin || vin.length !== 17) {
    return res.status(400).json({ error: 'Please enter a valid 17-digit VIN.' });
  }

  try {
    await pool.query('UPDATE customers SET first_name = ?, last_name = ?, phone = ? WHERE repair_job_id = ?', [first_name, last_name, phone, jobId]);
    await pool.query('UPDATE vehicles SET vin = ?, make = ?, model = ?, year = ? WHERE repair_job_id = ?', [vin, make, model, year, jobId]);
    await pool.query('UPDATE repair_orders SET issue_description = ? WHERE repair_job_id = ?', [issue_description, jobId]);

    res.json({ success: true, message: 'Profile updated!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Fetch Customer View
app.get('/api/customer/my-repair', authenticateToken, async (req, res) => {
  if (req.user.role !== 'customer') return res.status(403).json({ error: 'Access denied.' });

  const jobId = req.user.customer_id;
  try {
    const [job] = await pool.query('SELECT * FROM repair_jobs WHERE id = ?', [jobId]);
    const [customer] = await pool.query('SELECT * FROM customers WHERE repair_job_id = ?', [jobId]);
    const [vehicle] = await pool.query('SELECT * FROM vehicles WHERE repair_job_id = ?', [jobId]);
    const [appointment] = await pool.query('SELECT * FROM appointments WHERE repair_job_id = ?', [jobId]);
    const [repairOrder] = await pool.query('SELECT * FROM repair_orders WHERE repair_job_id = ?', [jobId]);
    const [partsLabor] = await pool.query('SELECT * FROM parts_and_labor WHERE repair_job_id = ?', [jobId]);
    const [repairExec] = await pool.query('SELECT * FROM repair_executions WHERE repair_job_id = ?', [jobId]);
    const [invoice] = await pool.query('SELECT * FROM invoices WHERE repair_job_id = ?', [jobId]);

    res.json({
      status: job[0] ? job[0].status : 'Pending',
      customer: customer[0] || {},
      vehicle: vehicle[0] || {},
      appointment: appointment[0] || {},
      repairOrder: repairOrder[0] || {},
      partsLabor: partsLabor || [],
      repairExec: repairExec[0] || {},
      invoice: invoice[0] || null
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: List Customers
app.get('/api/customers/list', authenticateToken, async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT c.repair_job_id, c.first_name, c.last_name, c.phone, c.email, 
             v.make, v.model, v.year, v.vin
      FROM customers c
      LEFT JOIN vehicles v ON v.repair_job_id = c.repair_job_id
      ORDER BY c.id DESC
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Save Department Data
app.post('/api/department/:name', authenticateToken, authorizeDepartment, async (req, res) => {
  const dept = req.params.name;
  const data = req.body;

  const tableMap = {
    customer: 'customers', vehicle: 'vehicles', appointment: 'appointments',
    repair_order: 'repair_orders', parts_labor: 'parts_and_labor', estimate: 'estimates',
    repair: 'repair_executions', invoice: 'invoices'
  };

  const table = tableMap[dept];
  try {
    const jobId = data.repair_job_id;
    const [existingJobs] = await pool.query('SELECT id FROM repair_jobs WHERE id = ?', [jobId]);
    if (existingJobs.length === 0) {
      await pool.query('INSERT INTO repair_jobs (id, job_number) VALUES (?, ?)', [jobId, `JOB-${jobId}`]);
    }

    const keys = Object.keys(data);
    const values = Object.values(data);
    const placeholders = keys.map(() => '?').join(', ');
    const sql = `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${placeholders})`;

    const [result] = await pool.query(sql, values);
    res.json({ success: true, id: result.insertId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Serve Web Interface
app.get('/', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Apex Precision Mechanics & Auto Service</title>
  <style>
    :root {
      --bg: #0f172a;
      --card-bg: #1e293b;
      --border: #334155;
      --primary: #f97316;
      --primary-hover: #ea580c;
      --text: #f8fafc;
      --text-muted: #94a3b8;
    }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: var(--bg); color: var(--text); margin: 0; padding: 20px; }
    .container { max-width: 1050px; margin: 0 auto; }
    .header { display: flex; justify-content: space-between; align-items: center; padding: 16px 0; border-bottom: 2px solid var(--primary); margin-bottom: 24px; }
    .brand { font-size: 1.5rem; font-weight: 800; text-transform: uppercase; letter-spacing: 1px; }
    .brand span { color: var(--primary); }
    .card { background: var(--card-bg); padding: 24px; border-radius: 8px; border: 1px solid var(--border); margin-bottom: 20px; box-shadow: 0 4px 12px rgba(0,0,0,0.3); }
    .hidden { display: none !important; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; }
    label { font-size: 0.85rem; font-weight: 600; color: var(--text-muted); display: block; margin-top: 10px; margin-bottom: 4px; }
    input, select, textarea, button { width: 100%; padding: 12px; border: 1px solid var(--border); border-radius: 6px; box-sizing: border-box; background: #0f172a; color: white; }
    button { background: var(--primary); color: white; font-weight: bold; text-transform: uppercase; border: none; cursor: pointer; margin-top: 16px; transition: 0.2s; }
    button:hover { background: var(--primary-hover); }
    .workflow-bar { display: flex; gap: 8px; overflow-x: auto; margin-bottom: 20px; }
    .step-card { flex: 1; padding: 12px 6px; text-align: center; border-radius: 4px; font-weight: bold; cursor: pointer; background: #0f172a; border: 1px solid var(--border); font-size: 0.85rem; }
    .step-card.active { border-color: var(--primary); background: #334155; color: var(--primary); }
    .badge { background: var(--primary); color: white; padding: 4px 8px; border-radius: 4px; font-size: 0.8rem; font-weight: bold; }
    .nav-btn { background: transparent; border: 1px solid var(--border); color: var(--text-muted); width: auto; margin: 0 4px; }
    .invoice-box { background: #0f172a; padding: 20px; border-radius: 6px; border: 1px dashed var(--primary); margin-top: 20px; }
  </style>
</head>
<body>
  <div class="container">
    
    <div class="header">
      <div class="brand">🔧 Apex <span>Mechanics</span></div>
      <div>
        <button class="nav-btn" onclick="showScreen('registerSection')">Create Account</button>
        <button class="nav-btn" onclick="showScreen('loginSection')">Portal Login</button>
      </div>
    </div>

    <!-- 1. REGISTRATION -->
    <div id="registerSection" class="card">
      <h2>Create Customer Account</h2>
      <p style="color: var(--text-muted);">Please create an account to schedule an appointment or manage repairs.</p>
      <form onsubmit="handleRegister(event)">
        <div class="grid">
          <div><label>First Name</label><input type="text" id="reg_first_name" required /></div>
          <div><label>Last Name</label><input type="text" id="reg_last_name" required /></div>
          <div><label>Phone Number</label><input type="text" id="reg_phone" required /></div>
        </div>
        <div class="grid">
          <div><label>Desired Username</label><input type="text" id="reg_username" required /></div>
          <div><label>Password</label><input type="password" id="reg_password" required /></div>
        </div>
        <button type="submit">Register Account</button>
      </form>
    </div>

    <!-- 2. LOGIN -->
    <div id="loginSection" class="card hidden">
      <h2>Portal Login</h2>
      <form onsubmit="handleLogin(event)">
        <label>Username</label>
        <input type="text" id="username" required />
        <label>Password</label>
        <input type="password" id="password" required />
        <button type="submit">Log In</button>
      </form>
    </div>

    <!-- 3. CUSTOMER DASHBOARD -->
    <div id="customerDashboard" class="card hidden">
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <h2>Customer Portal & Appointments</h2>
        <button onclick="logout()" class="nav-btn">Logout</button>
      </div>
      
      <div id="statusBadge" style="margin: 12px 0;"></div>

      <div class="invoice-box">
        <h3>Book / Schedule Mechanic Appointment</h3>
        <form onsubmit="handleBookAppointment(event)">
          <div class="grid">
            <div><label>VIN Number (17 Digits)</label><input type="text" id="book_vin" maxlength="17" placeholder="e.g. 1FA6P8CF0H1234567" required /></div>
            <div><label>Vehicle Make</label><input type="text" id="book_make" placeholder="e.g. Ford" required /></div>
            <div><label>Vehicle Model</label><input type="text" id="book_model" placeholder="e.g. Mustang" required /></div>
            <div><label>Year</label><input type="number" id="book_year" placeholder="e.g. 2022" required /></div>
          </div>
          <label>Preferred Appointment Date & Time</label>
          <input type="datetime-local" id="book_datetime" required />
          <label>Vehicle Symptoms / Problem</label>
          <textarea id="book_issue" rows="3" placeholder="Describe faults..." required></textarea>
          <button type="submit">Schedule Appointment</button>
        </form>
      </div>

      <div id="invoiceContainer" class="invoice-box">
        <h3>Current Scheduled Appointment & Invoice</h3>
        <div id="invoiceContent">Loading records...</div>
      </div>

      <form onsubmit="handleUpdateCustomerProfile(event)" style="margin-top: 24px;">
        <h3>Edit Personal Profile & Vehicle VIN</h3>
        <div class="grid">
          <div><label>First Name</label><input type="text" id="cust_first_name" required /></div>
          <div><label>Last Name</label><input type="text" id="cust_last_name" required /></div>
          <div><label>Phone Number</label><input type="text" id="cust_phone" required /></div>
        </div>
        <div class="grid">
          <div><label>VIN Number (17 Digits)</label><input type="text" id="cust_vin" maxlength="17" required /></div>
          <div><label>Vehicle Make</label><input type="text" id="cust_make" required /></div>
          <div><label>Vehicle Model</label><input type="text" id="cust_model" required /></div>
          <div><label>Year</label><input type="number" id="cust_year" required /></div>
        </div>
        <label>Reported Problem / Symptoms</label>
        <textarea id="cust_issue" rows="3" required></textarea>
        
        <button type="submit">Save Updated Profile</button>
      </form>
    </div>

    <!-- 4. EMPLOYEE DASHBOARD -->
    <div id="employeeDashboard" class="card hidden">
      <div style="display:flex; justify-between; align-items:center;">
        <h2>Shop Operations Portal</h2>
        <div>User: <span id="userRoleBadge" class="badge"></span> <button onclick="logout()" class="nav-btn">Logout</button></div>
      </div>

      <label style="color:var(--primary); font-size:1rem;">Select Customer (Auto-fills Customer & Vehicle Data)</label>
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

    const ROLE_MAP = {
      service_advisor: ['customer', 'vehicle', 'appointment', 'repair_order', 'estimate'],
      technician: ['parts_labor', 'repair'],
      billing: ['estimate', 'invoice'],
      admin: ['customer', 'vehicle', 'appointment', 'repair_order', 'parts_labor', 'estimate', 'repair', 'invoice']
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

    function showScreen(screenId) {
      document.getElementById('registerSection').classList.add('hidden');
      document.getElementById('loginSection').classList.add('hidden');
      document.getElementById('customerDashboard').classList.add('hidden');
      document.getElementById('employeeDashboard').classList.add('hidden');
      document.getElementById(screenId).classList.remove('hidden');
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
        first_name: document.getElementById('reg_first_name').value,
        last_name: document.getElementById('reg_last_name').value,
        phone: document.getElementById('reg_phone').value,
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

    async function handleLogin(e) {
      e.preventDefault();
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: document.getElementById('username').value,
          password: document.getElementById('password').value
        })
      });
      const data = await res.json();
      if (!res.ok) return alert(data.error);

      localStorage.setItem('token', data.token);
      localStorage.setItem('role', data.role);
      localStorage.setItem('username', data.username);
      
      renderDashboard();
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
      
      document.getElementById('statusBadge').innerHTML = \`Current Repair Status: <span class="badge">\${data.status}</span>\`;
      document.getElementById('cust_first_name').value = data.customer.first_name || '';
      document.getElementById('cust_last_name').value = data.customer.last_name || '';
      document.getElementById('cust_phone').value = data.customer.phone || '';
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
      const res = await fetch('/api/customers/list', {
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

      if (!token) {
        showScreen('registerSection');
        return;
      }

      if (role === 'customer') {
        showScreen('customerDashboard');
        loadCustomerProfile();
      } else {
        showScreen('employeeDashboard');
        document.getElementById('userRoleBadge').textContent = \`\${localStorage.getItem('username')} (\${role})\`;
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
  `);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  await initDatabase();
  console.log(`School Project Application live on http://localhost:${PORT}`);
});
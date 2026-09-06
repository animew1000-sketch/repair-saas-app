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

    // Seed default companies
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

    // Seed default accounts
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

    console.log('Multi-Tenant Database initialized with marketing showcase content.');
  } catch (err) {
    console.error('Database setup error details:', err.message);
  }
}

// Authentication Middleware
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Access denied. Please log in first.' });

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Session expired. Please log in again.' });
    req.user = user;
    next();
  });
}

// Role Permissions Matrix
const ROLE_PERMISSIONS = {
  customer: [],
  service_advisor: ['customer', 'vehicle', 'appointment', 'repair_order', 'estimate'],
  technician: ['parts_labor', 'repair'],
  billing: ['estimate', 'invoice'],
  manager: ['customer', 'vehicle', 'appointment', 'repair_order', 'parts_labor', 'estimate', 'repair', 'invoice']
};

function authorizeDepartment(req, res, next) {
  const userRole = req.user.role;
  const dept = req.params.name;

  if (userRole === 'manager') return next();
  
  const allowedDepts = ROLE_PERMISSIONS[userRole] || [];
  if (!allowedDepts.includes(dept)) {
    return res.status(403).json({ error: `Unauthorized: Your rank (${userRole}) cannot modify ${dept}.` });
  }
  next();
}

// API: Fetch Companies
app.get('/api/companies', async (req, res) => {
  try {
    const [companies] = await pool.query('SELECT * FROM companies ORDER BY id ASC');
    res.json(companies);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/companies/:slug', async (req, res) => {
  try {
    const [companies] = await pool.query('SELECT * FROM companies WHERE slug = ?', [req.params.slug]);
    if (companies.length === 0) return res.status(404).json({ error: 'Company not found' });
    res.json(companies[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Registration
app.post('/api/register', async (req, res) => {
  const { company_id, username, email, password, first_name, last_name, phone } = req.body;
  try {
    const jobNum = `JOB-${Date.now().toString().slice(-6)}`;
    const [jobRes] = await pool.query('INSERT INTO repair_jobs (company_id, job_number, status) VALUES (?, ?, ?)', [company_id, jobNum, 'Requested']);
    const jobId = jobRes.insertId;

    await pool.query('INSERT INTO customers (company_id, repair_job_id, first_name, last_name, phone, email) VALUES (?, ?, ?, ?, ?, ?)', [company_id, jobId, first_name, last_name, phone, email]);
    await pool.query('INSERT INTO users (company_id, username, email, password, role, customer_id) VALUES (?, ?, ?, ?, ?, ?)', [
      company_id, username, email, password, 'customer', jobId
    ]);

    res.json({ success: true, message: 'Account created successfully! You can now log in.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Multi-Tenant Login Handler
app.post('/api/login', async (req, res) => {
  const { company_id, login_input, password } = req.body;
  const inputStr = (login_input || '').trim();

  try {
    let rows = [];

    if (/^\d{6}$/.test(inputStr)) {
      if (company_id) {
        [rows] = await pool.query(
          'SELECT u.*, c.company_name, c.primary_color FROM users u JOIN companies c ON u.company_id = c.id WHERE u.pin_code = ? AND u.company_id = ?',
          [inputStr, company_id]
        );
      } else {
        [rows] = await pool.query(
          'SELECT u.*, c.company_name, c.primary_color FROM users u JOIN companies c ON u.company_id = c.id WHERE u.pin_code = ?',
          [inputStr]
        );
      }
    }

    if (rows.length === 0) {
      if (company_id) {
        [rows] = await pool.query(
          'SELECT u.*, c.company_name, c.primary_color FROM users u JOIN companies c ON u.company_id = c.id WHERE (u.email = ? OR u.username = ?) AND u.password = ? AND u.company_id = ?',
          [inputStr, inputStr, password, company_id]
        );
      } else {
        [rows] = await pool.query(
          'SELECT u.*, c.company_name, c.primary_color FROM users u JOIN companies c ON u.company_id = c.id WHERE (u.email = ? OR u.username = ?) AND u.password = ?',
          [inputStr, inputStr, password]
        );
      }
    }

    if (rows.length === 0) {
      return res.status(401).json({ error: 'Invalid Credentials for the selected shop.' });
    }

    const user = rows[0];
    
    const token = jwt.sign(
      { 
        id: user.id, 
        company_id: user.company_id, 
        company_name: user.company_name, 
        primary_color: user.primary_color,
        username: user.username, 
        email: user.email, 
        role: user.role, 
        customer_id: user.customer_id 
      },
      JWT_SECRET,
      { expiresIn: '8h' }
    );

    res.json({ 
      token, 
      company_id: user.company_id,
      company_name: user.company_name,
      primary_color: user.primary_color || '#f97316',
      role: user.role, 
      username: user.username, 
      email: user.email, 
      customer_id: user.customer_id, 
      pin_code: user.pin_code 
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Manager Roster
app.get('/api/manager/employees', authenticateToken, async (req, res) => {
  if (req.user.role !== 'manager') return res.status(403).json({ error: 'Only Managers can access employee rosters.' });
  try {
    const [rows] = await pool.query(
      'SELECT id, username, email, pin_code, role, created_at FROM users WHERE company_id = ? AND role != "customer" ORDER BY id ASC',
      [req.user.company_id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/manager/create-employee', authenticateToken, async (req, res) => {
  if (req.user.role !== 'manager') return res.status(403).json({ error: 'Only Managers can create employee profiles.' });
  
  const { username, email, pin_code, role } = req.body;
  
  if (!/^\d{6}$/.test(pin_code)) {
    return res.status(400).json({ error: 'PIN Code must be exactly 6 digits.' });
  }

  try {
    await pool.query('INSERT INTO users (company_id, username, email, password, pin_code, role) VALUES (?, ?, ?, ?, ?, ?)', [
      req.user.company_id, username, email || null, 'pass123', pin_code, role
    ]);
    res.json({ success: true, message: `Staff profile created for ${username} with 6-digit PIN ${pin_code}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/manager/update-employee', authenticateToken, async (req, res) => {
  if (req.user.role !== 'manager') return res.status(403).json({ error: 'Only Managers can edit employee PINs and roles.' });

  const { id, pin_code, role } = req.body;

  if (!/^\d{6}$/.test(pin_code)) {
    return res.status(400).json({ error: 'PIN Code must be exactly 6 digits.' });
  }

  try {
    await pool.query('UPDATE users SET pin_code = ?, role = ? WHERE id = ? AND company_id = ?', [pin_code, role, id, req.user.company_id]);
    res.json({ success: true, message: 'Employee PIN code and role updated successfully!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Offline Simulated VIN Decoder
app.get('/api/vehicle/vin-lookup/:vin', authenticateToken, async (req, res) => {
  const vin = req.params.vin.toUpperCase();
  if (vin.length !== 17) {
    return res.status(400).json({ error: 'VIN must be exactly 17 characters long.' });
  }

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

// API: Parts Catalog
app.get('/api/parts/catalog-lookup', authenticateToken, async (req, res) => {
  const { jobId, partName } = req.query;
  try {
    const [vehicles] = await pool.query('SELECT * FROM vehicles WHERE repair_job_id = ? AND company_id = ?', [jobId, req.user.company_id]);
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
  const companyId = req.user.company_id;
  const { vin, make, model, year, scheduled_datetime, issue_description } = req.body;
  
  if (!vin || vin.length !== 17) {
    return res.status(400).json({ error: 'Please enter a valid 17-digit VIN.' });
  }

  try {
    await pool.query(
      'INSERT INTO vehicles (company_id, repair_job_id, vin, make, model, year) VALUES (?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE vin=?, make=?, model=?, year=?',
      [companyId, jobId, vin, make, model, year, vin, make, model, year]
    );

    await pool.query('INSERT INTO appointments (company_id, repair_job_id, scheduled_datetime) VALUES (?, ?, ?)', [companyId, jobId, scheduled_datetime]);

    const roNum = `RO-${Date.now().toString().slice(-6)}`;
    await pool.query(
      'INSERT INTO repair_orders (company_id, repair_job_id, ro_number, issue_description) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE issue_description=?',
      [companyId, jobId, roNum, issue_description, issue_description]
    );

    res.json({ success: true, message: 'Service request created successfully!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Update Customer Profile
app.put('/api/customer/update-profile', authenticateToken, async (req, res) => {
  if (req.user.role !== 'customer') return res.status(403).json({ error: 'Access denied.' });

  const jobId = req.user.customer_id;
  const companyId = req.user.company_id;
  const { first_name, last_name, phone, email, vin, make, model, year, issue_description } = req.body;

  if (!vin || vin.length !== 17) {
    return res.status(400).json({ error: 'Please enter a valid 17-digit VIN.' });
  }

  try {
    await pool.query('UPDATE customers SET first_name = ?, last_name = ?, phone = ?, email = ? WHERE repair_job_id = ? AND company_id = ?', [first_name, last_name, phone, email, jobId, companyId]);
    await pool.query('UPDATE users SET email = ? WHERE id = ? AND company_id = ?', [email, req.user.id, companyId]);
    await pool.query('UPDATE vehicles SET vin = ?, make = ?, model = ?, year = ? WHERE repair_job_id = ? AND company_id = ?', [vin, make, model, year, jobId, companyId]);
    await pool.query('UPDATE repair_orders SET issue_description = ? WHERE repair_job_id = ? AND company_id = ?', [issue_description, jobId, companyId]);

    res.json({ success: true, message: 'Profile updated!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Customer View
app.get('/api/customer/my-repair', authenticateToken, async (req, res) => {
  if (req.user.role !== 'customer') return res.status(403).json({ error: 'Access denied.' });

  const jobId = req.user.customer_id;
  const companyId = req.user.company_id;
  try {
    const [job] = await pool.query('SELECT * FROM repair_jobs WHERE id = ? AND company_id = ?', [jobId, companyId]);
    const [customer] = await pool.query('SELECT * FROM customers WHERE repair_job_id = ? AND company_id = ?', [jobId, companyId]);
    const [vehicle] = await pool.query('SELECT * FROM vehicles WHERE repair_job_id = ? AND company_id = ?', [jobId, companyId]);
    const [appointment] = await pool.query('SELECT * FROM appointments WHERE repair_job_id = ? AND company_id = ?', [jobId, companyId]);
    const [repairOrder] = await pool.query('SELECT * FROM repair_orders WHERE repair_job_id = ? AND company_id = ?', [jobId, companyId]);
    const [partsLabor] = await pool.query('SELECT * FROM parts_and_labor WHERE repair_job_id = ? AND company_id = ?', [jobId, companyId]);
    const [repairExec] = await pool.query('SELECT * FROM repair_executions WHERE repair_job_id = ? AND company_id = ?', [jobId, companyId]);
    const [invoice] = await pool.query('SELECT * FROM invoices WHERE repair_job_id = ? AND company_id = ?', [jobId, companyId]);

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
      LEFT JOIN vehicles v ON v.repair_job_id = c.repair_job_id AND v.company_id = c.company_id
      WHERE c.company_id = ?
      ORDER BY c.id DESC
    `, [req.user.company_id]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Save Department Data
app.post('/api/department/:name', authenticateToken, authorizeDepartment, async (req, res) => {
  const dept = req.params.name;
  const data = req.body;
  const companyId = req.user.company_id;

  const tableMap = {
    customer: 'customers', vehicle: 'vehicles', appointment: 'appointments',
    repair_order: 'repair_orders', parts_labor: 'parts_and_labor', estimate: 'estimates',
    repair: 'repair_executions', invoice: 'invoices'
  };

  const table = tableMap[dept];
  try {
    const jobId = data.repair_job_id;
    const [existingJobs] = await pool.query('SELECT id FROM repair_jobs WHERE id = ? AND company_id = ?', [jobId, companyId]);
    if (existingJobs.length === 0) {
      await pool.query('INSERT INTO repair_jobs (id, company_id, job_number) VALUES (?, ?, ?)', [jobId, companyId, `JOB-${jobId}`]);
    }

    data.company_id = companyId;
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
app.get(['/', '/:slug'], (req, res) => {
  const htmlContent = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Apex SaaS | Multi-Tenant Auto Repair Operating System</title>
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
    .brand { font-size: 1.5rem; font-weight: 800; text-transform: uppercase; letter-spacing: 1px; cursor: pointer; }
    .brand span { color: var(--primary); }
    .card { background: var(--card-bg); padding: 24px; border-radius: 8px; border: 1px solid var(--border); margin-bottom: 20px; box-shadow: 0 4px 12px rgba(0,0,0,0.3); }
    .hidden { display: none !important; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; }
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
    
    .hero { text-align: center; padding: 48px 24px; background: linear-gradient(180deg, #1e293b 0%, #0f172a 100%); border-radius: 8px; border: 1px solid var(--border); margin-bottom: 24px; }
    .hero h1 { font-size: 2.3rem; margin-bottom: 12px; line-height: 1.2; }
    .hero h1 span { color: var(--primary); }
    .hero p { color: var(--text-muted); max-width: 720px; margin: 0 auto 24px auto; font-size: 1.1rem; line-height: 1.5; }
    
    .feature-card { background: #0f172a; padding: 20px; border-radius: 6px; border: 1px solid var(--border); }
    .feature-card h3 { color: var(--primary); margin-top: 0; }
    .portal-tab-bar { display: flex; gap: 12px; border-bottom: 1px solid var(--border); padding-bottom: 12px; margin-bottom: 20px; }
    .portal-tab { padding: 10px 18px; border-radius: 6px; cursor: pointer; background: #0f172a; font-weight: bold; border: 1px solid var(--border); color: var(--text-muted); }
    .portal-tab.active { background: var(--primary); color: white; border-color: var(--primary); }
    
    .staff-table { width: 100%; border-collapse: collapse; margin-top: 12px; }
    .staff-table th, .staff-table td { padding: 10px; border: 1px solid var(--border); text-align: left; }
    .staff-table th { background: #0f172a; color: var(--primary); }
    .shop-switcher { display: flex; justify-content: center; gap: 10px; margin-top: 16px; flex-wrap: wrap; }
    .shop-chip { padding: 8px 16px; border-radius: 20px; background: #1e293b; border: 1px solid var(--border); color: var(--text-muted); text-decoration: none; font-size: 0.9rem; font-weight: bold; transition: 0.2s; }
    .shop-chip:hover { border-color: var(--primary); color: white; }
    
    .shop-title-text { color: var(--primary); font-weight: bold; }
    
    /* Presentation Marketing Banner Styles */
    .marketing-pill { display: inline-block; background: rgba(249, 115, 22, 0.15); border: 1px solid var(--primary); color: var(--primary); padding: 4px 12px; border-radius: 20px; font-size: 0.8rem; font-weight: bold; margin-bottom: 16px; text-transform: uppercase; letter-spacing: 0.5px; }
    .marketing-stat-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin: 24px 0; }
    .stat-box { background: #0f172a; border: 1px solid var(--border); padding: 16px; border-radius: 6px; text-align: center; }
    .stat-number { font-size: 1.8rem; font-weight: 800; color: var(--primary); }
    .stat-label { font-size: 0.85rem; color: var(--text-muted); margin-top: 4px; }
  </style>
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

      <!-- KEY PLATFORM METRICS SHOWCASE -->
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

      <!-- PRESENTATION HIGHLIGHT CARD -->
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

      <!-- TAB 1: VIEW SERVICE REQUESTS -->
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

      <!-- TAB 2: CREATE REQUEST -->
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

      <!-- TAB 3: CONTACT US -->
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

      <!-- MANAGER STAFF PIN & ROLE MANAGER -->
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

      <!-- WORKFLOW OPERATIONS -->
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
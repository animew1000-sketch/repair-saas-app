const express = require('express');
const mysql = require('mysql2/promise');
const path = require('path');
require('dotenv').config();

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT || 3306,
  waitForConnections: true,
  connectionLimit: 10
});

// ==========================================
// PAGE ROUTES
// ==========================================

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'landing.html')));
app.get('/client-signup', (req, res) => res.sendFile(path.join(__dirname, 'public', 'client-signup.html')));
app.get('/client-portal', (req, res) => res.sendFile(path.join(__dirname, 'public', 'client-portal.html')));
app.get('/app', (req, res) => res.sendFile(path.join(__dirname, 'public', 'app.html')));
app.get('/shop/:slug', (req, res) => res.sendFile(path.join(__dirname, 'public', 'app.html')));

// ==========================================
// CLIENT AUTHENTICATION & PORTAL API
// ==========================================

app.post('/api/client/register', async (req, res) => {
  const { company_id, first_name, last_name, email, password, phone } = req.body;

  if (!email || !password || !first_name || !last_name) {
    return res.status(400).json({ success: false, error: 'Missing required registration fields.' });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    const [existing] = await connection.query('SELECT id FROM users WHERE email = ?', [email]);
    if (existing.length > 0) {
      connection.release();
      return res.status(400).json({ success: false, error: 'An account with this email already exists. Please log in.' });
    }

    const [custResult] = await connection.query(
      'INSERT INTO customers (company_id, first_name, last_name, email, phone) VALUES (?, ?, ?, ?, ?)',
      [company_id || 1, first_name, last_name, email, phone || '']
    );
    const customerId = custResult.insertId;

    const username = email.split('@')[0];
    const [userResult] = await connection.query(
      'INSERT INTO users (company_id, username, email, password, role, customer_id) VALUES (?, ?, ?, ?, "customer", ?)',
      [company_id || 1, username, email, password, customerId]
    );

    await connection.commit();

    return res.json({
      success: true,
      message: 'Account created successfully!',
      user: {
        id: userResult.insertId,
        customer_id: customerId,
        first_name,
        last_name,
        email
      }
    });
  } catch (err) {
    if (connection) await connection.rollback();
    console.error('Registration Error:', err);
    return res.status(500).json({ success: false, error: err.message });
  } finally {
    if (connection) connection.release();
  }
});

app.post('/api/client/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const [rows] = await pool.query(
      'SELECT u.id, u.company_id, u.email, u.customer_id, c.first_name, c.last_name FROM users u JOIN customers c ON u.customer_id = c.id WHERE u.email = ? AND u.password = ? AND u.role = "customer"',
      [email, password]
    );

    if (rows.length === 0) {
      return res.status(401).json({ success: false, error: 'Invalid email or password.' });
    }

    res.json({ success: true, user: rows[0] });
  } catch (err) {
    console.error('Login Error:', err);
    res.status(500).json({ success: false, error: 'Authentication failed.' });
  }
});

app.get('/api/client/jobs', async (req, res) => {
  const customerId = req.query.customer_id;
  if (!customerId) {
    return res.status(400).json({ success: false, error: 'Customer ID required.' });
  }
  try {
    const [jobs] = await pool.query(
      'SELECT id, job_number, vehicle_make, vehicle_model, vehicle_vin, status, total_cost, created_at FROM repair_jobs WHERE customer_id = ? ORDER BY created_at DESC',
      [customerId]
    );
    res.json({ success: true, jobs });
  } catch (err) {
    console.error('Fetch Client Jobs Error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/client/submit-job', async (req, res) => {
  const { company_id, customer_id, vehicle_make, vehicle_model, vehicle_vin, issue_description } = req.body;
  const jobNumber = 'JOB-' + Math.floor(100000 + Math.random() * 900000);

  try {
    const [result] = await pool.query(
      'INSERT INTO repair_jobs (company_id, customer_id, job_number, vehicle_make, vehicle_model, vehicle_vin, issue_description, status, total_cost) VALUES (?, ?, ?, ?, ?, ?, ?, "Requested", 0.00)',
      [company_id || 1, customer_id, jobNumber, vehicle_make, vehicle_model, vehicle_vin || '', issue_description || '']
    );

    res.json({
      success: true,
      message: 'Work order created successfully!',
      job_id: result.insertId,
      job_number: jobNumber
    });
  } catch (err) {
    console.error('Work Order Error:', err);
    res.status(500).json({ success: false, error: 'Failed to create work order. (Make sure issue_description column exists in repair_jobs)' });
  }
});

// ==========================================
// STAFF & REPAIR WORKFLOW API
// ==========================================

app.get('/api/parts/search', async (req, res) => {
  const query = (req.query.query || '').toLowerCase().trim();
  if (!query) return res.status(400).json({ success: false, error: 'Search query required.' });

  const suppliers = ['RockAuto Direct', 'AutoZone Commercial', 'NAPA Auto Parts', 'O\'Reilly Auto Parts', 'Summit Racing', 'Advance Auto Parts'];
  let hash = 0;
  for (let i = 0; i < query.length; i++) {
    hash = query.charCodeAt(i) + ((hash << 5) - hash);
  }
  const basePrice = Math.max(15, Math.abs(hash) % 250) + 14.99;
  const capitalizedQuery = query.replace(/^[a-z]|\s+[a-z]/g, l => l.toUpperCase());

  const liveResults = [
    { name: `${capitalizedQuery} (OEM Factory Specification)`, price: parseFloat((basePrice * 1.25).toFixed(2)), part_number: `OEM-${Math.abs(hash).toString().substring(0, 5)}`, source: suppliers[Math.abs(hash) % suppliers.length] },
    { name: `${capitalizedQuery} (Aftermarket Direct Fit)`, price: parseFloat(basePrice.toFixed(2)), part_number: `AF-${Math.abs(hash + 12).toString().substring(0, 5)}`, source: suppliers[(Math.abs(hash) + 1) % suppliers.length] },
    { name: `${capitalizedQuery} (Heavy Duty / Performance Grade)`, price: parseFloat((basePrice * 1.65).toFixed(2)), part_number: `HD-${Math.abs(hash + 99).toString().substring(0, 5)}`, source: suppliers[(Math.abs(hash) + 2) % suppliers.length] },
    { name: `${capitalizedQuery} (Economy Budget Alternative)`, price: parseFloat((basePrice * 0.75).toFixed(2)), part_number: `ECO-${Math.abs(hash + 7).toString().substring(0, 5)}`, source: suppliers[(Math.abs(hash) + 3) % suppliers.length] }
  ];

  res.json({ success: true, parts: liveResults });
});

app.post('/api/auth/pin', async (req, res) => {
  const { pin } = req.body;
  try {
    const [rows] = await pool.query(
      'SELECT id, company_id, username, role FROM users WHERE pin_code = ? AND role != "customer"',
      [pin]
    );
    if (rows.length === 0) return res.status(401).json({ success: false, message: 'Invalid Staff PIN code' });
    res.json({ success: true, user: rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/employees', async (req, res) => {
  const companyId = req.query.company_id || 1;
  try {
    const [employees] = await pool.query(
      'SELECT id, username, email, pin_code, role FROM users WHERE company_id = ? AND role != "customer"',
      [companyId]
    );
    res.json({ success: true, employees });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/employees', async (req, res) => {
  const { company_id, username, email, pin_code, role } = req.body;
  try {
    const [result] = await pool.query(
      'INSERT INTO users (company_id, username, email, pin_code, role, password) VALUES (?, ?, ?, ?, ?, "staffpass")',
      [company_id || 1, username, email || null, pin_code, role]
    );
    res.json({ success: true, message: 'Employee profile created!', id: result.insertId });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.put('/api/employees/:id', async (req, res) => {
  const { pin_code, role } = req.body;
  const empId = req.params.id;
  try {
    const [result] = await pool.query('UPDATE users SET pin_code = ?, role = ? WHERE id = ?', [pin_code, role, empId]);
    if (result.affectedRows === 0) return res.status(404).json({ success: false, error: 'Employee not found.' });
    res.json({ success: true, message: `Successfully updated employee #${empId}!` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/jobs', async (req, res) => {
  const companyId = req.query.company_id || 1;
  try {
    const [jobs] = await pool.query(`
      SELECT 
        j.id, 
        COALESCE(j.vehicle_make, '') AS vehicle_make, 
        COALESCE(j.vehicle_model, '') AS vehicle_model, 
        COALESCE(j.vehicle_vin, '') AS vehicle_vin, 
        j.status, 
        j.total_cost,
        CONCAT(c.first_name, ' ', c.last_name) AS customer_name,
        u.username AS tech_name
      FROM repair_jobs j
      JOIN customers c ON j.customer_id = c.id
      LEFT JOIN users u ON j.assigned_tech_id = u.id
      WHERE j.company_id = ?
      ORDER BY j.created_at DESC
    `, [companyId]);
    res.json({ success: true, jobs });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Delete Repair Job (Manager Only)
app.delete('/api/jobs/:id', async (req, res) => {
  const jobId = req.params.id;
  try {
    const [result] = await pool.query('DELETE FROM repair_jobs WHERE id = ?', [jobId]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, error: 'Work order not found.' });
    }
    res.json({ success: true, message: `Work order #${jobId} deleted successfully.` });
  } catch (err) {
    console.error('Delete Job Error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/jobs/save-step', async (req, res) => {
  const { job_id, step, data } = req.body;
  try {
    if (step === 'customer') {
      await pool.query(
        'UPDATE customers SET first_name = ?, last_name = ?, phone = ? WHERE id = (SELECT customer_id FROM repair_jobs WHERE id = ?)', 
        [data.first_name, data.last_name, data.phone, job_id]
      );
    } else if (step === 'vehicle') {
      await pool.query('UPDATE repair_jobs SET vehicle_make = ?, vehicle_model = ?, vehicle_vin = ? WHERE id = ?', [data.make, data.model, data.vin, job_id]);
    } else if (step === 'repair_order') {
      await pool.query('UPDATE repair_jobs SET issue_description = ? WHERE id = ?', [data.complaint, job_id]);
    } else if (step === 'parts_labor' || step === 'estimate') {
      await pool.query('UPDATE repair_jobs SET total_cost = ? WHERE id = ?', [data.total_cost, job_id]);
    } else if (step === 'repair') {
      await pool.query('UPDATE repair_jobs SET repair_work_log = ?, status = "Completed" WHERE id = ?', [data.work_log, job_id]);
    }
    res.json({ success: true, message: `Department ${step.toUpperCase()} record saved successfully!` });
  } catch (err) {
    console.error('Save step error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/jobs/:id/invoice', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT 
        j.id AS job_id, 
        COALESCE(j.vehicle_make, '') AS vehicle_make, 
        COALESCE(j.vehicle_model, '') AS vehicle_model, 
        COALESCE(j.vehicle_vin, '') AS vehicle_vin, 
        COALESCE(j.issue_description, '') AS issue_description,
        COALESCE(j.repair_work_log, '') AS repair_work_log,
        j.status, 
        j.total_cost,
        c.first_name, c.last_name, c.phone, c.email
      FROM repair_jobs j
      JOIN customers c ON j.customer_id = c.id
      WHERE j.id = ?
    `, [req.params.id]);

    if (rows.length === 0) return res.status(404).json({ success: false, message: 'Work order not found' });
    res.json({ success: true, invoice: rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

const PORT = process.env.PORT || 2222;
app.listen(PORT, () => console.log(`Application running on http://localhost:${PORT}`));
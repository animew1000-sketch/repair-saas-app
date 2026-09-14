const express = require('express');
const pool = require('./db/pool');
const path = require('path');
require('dotenv').config();

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
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  await initDatabase();
  console.log(`Multi-Tenant SaaS Application live on http://localhost:${PORT}`);
});
# Repair SaaS

Repair SaaS is a multi-tenant automotive repair management platform developed as a Senior Design project. It provides separate customer and staff workflows for repair shops while keeping each company's data isolated through company-scoped authentication and database records.

The system is built with Node.js, Express, MySQL, HTML, CSS, and JavaScript and is currently deployed on an Ubuntu homelab server.

## Project Goals

The project is designed to model the workflow of an automotive repair business from the initial customer request through repair completion and invoicing.

The application supports:

- Multiple repair shops in one application
- Customer registration and authentication
- Staff authentication and role-based permissions
- Customer and vehicle records
- Appointment scheduling
- Repair orders
- Parts and labor tracking
- Estimates
- Repair execution records
- Invoices
- Customer portal customization
- Customer self-service account deletion
- Transactional email notifications
- Production health monitoring

## Current Status

**Active Senior Design development project**

Implemented and tested:

- Multi-tenant database architecture
- Dynamic repair-shop landing pages
- JWT authentication
- bcrypt password hashing
- bcrypt staff PIN hashing
- Role-based authorization
- Customer portal
- Staff workflow
- Customer account deletion
- Database cascade cleanup
- API rate limiting
- Helmet security headers
- Health-check endpoint
- Production deployment with PM2 and Nginx
- HTTPS access
- Local Postfix outbound mail
- OpenDKIM signing
- SPF, DKIM, and DMARC authentication
- Registration confirmation email
- Uptime Kuma monitoring and Discord alerts

Planned / in progress:

- Email verification
- Verification-token expiration and resend flow
- Appointment confirmation emails
- Appointment reminders
- Additional UI and workflow refinement
- Expanded automated testing
- Continued sprint-based development

## Application Workflow

A typical repair workflow follows this sequence:

```text
Customer Registration
        |
        v
Customer / Vehicle Information
        |
        v
Appointment
        |
        v
Repair Order
        |
        v
Parts & Labor
        |
        v
Estimate
        |
        v
Repair Execution
        |
        v
Invoice
```

Each repair process is associated with a `repair_job_id`, which connects the related customer, vehicle, appointment, repair-order, estimate, labor, repair, and invoice records.

## User Roles

The application supports the following roles:

| Role | Primary Responsibilities |
| --- | --- |
| Customer | Manage customer portal, repair information, appointments, and account |
| Service Advisor | Customer intake, vehicles, appointments, repair orders, estimates |
| Technician | Parts/labor and repair execution |
| Parts Manager | Parts and labor workflow |
| Billing | Estimates and invoices |
| Manager | Full operational access and employee management |

Backend authorization is used to enforce permissions; frontend controls are not treated as the security boundary.

## Technology Stack

### Application

- Node.js
- Express
- JavaScript
- HTML5
- CSS3
- MySQL
- `mysql2`

### Authentication and Security

- JSON Web Tokens (`jsonwebtoken`)
- bcrypt
- Helmet
- `express-rate-limit`
- Environment-based secrets using `dotenv`

### Email

- Nodemailer
- Local Postfix SMTP
- OpenDKIM
- SPF
- DKIM
- DMARC

### Production Infrastructure

- Ubuntu Linux
- PM2
- Nginx
- HTTPS
- DuckDNS for the public application hostname
- dynv6 for mail-related DNS
- XAMPP installed on the Ubuntu server as part of the broader server/lab environment
- Uptime Kuma
- Discord monitoring alerts

> XAMPP is part of the Ubuntu homelab environment, but the Repair SaaS Node application is served through the production path **Nginx -> Node/Express -> PM2**.

## Project Structure

```text
repair-saas-app/
|
|-- db/
|   `-- pool.js
|
|-- middleware/
|   `-- auth.js
|
|-- public/
|   |-- index.html
|   |-- app.js
|   |-- styles-reworked.css
|   |-- styles.css
|   |-- theme.js
|   `-- images/
|
|-- routes/
|   |-- auth.js
|   |-- companies.js
|   |-- customer.js
|   |-- departments.js
|   |-- manager.js
|   `-- tools.js
|
|-- services/
|   `-- mail.js
|
|-- server.js
|-- package.json
|-- package-lock.json
`-- .gitignore
```

## Database Design

The application uses a relational MySQL database.

Primary tables include:

- `companies`
- `users`
- `repair_jobs`
- `customers`
- `vehicles`
- `appointments`
- `repair_orders`
- `parts_and_labor`
- `estimates`
- `repair_executions`
- `invoices`

Most operational records reference both:

- `company_id`
- `repair_job_id`

This allows the application to enforce tenant separation while connecting all stages of a repair workflow.

Foreign keys tied to `repair_jobs` use `ON DELETE CASCADE`, allowing dependent repair records to be cleaned up when a repair job is intentionally removed.

## Multi-Tenant Architecture

Each repair shop is represented by a record in the `companies` table.

The application supports shop-specific URLs such as:

```text
/<shop-slug>
```

A shop can have its own:

- Company name
- Slug
- Tagline
- Hero text
- Primary theme color

Authentication and API operations use `company_id` so records remain scoped to the appropriate shop.

## Authentication

### Customers

Customers authenticate with:

- Email or username
- Password

Passwords are stored with bcrypt.

### Staff

Staff can authenticate using a six-digit PIN.

Legacy plaintext values are migrated to bcrypt when valid credentials are successfully used.

### Sessions

Authenticated users receive a JWT containing identity and company context.

JWT signing requires an environment-provided secret. The application does not intentionally rely on a production fallback secret.

## Security Controls

Current protections include:

- bcrypt password hashing
- bcrypt staff PIN hashing
- JWT authentication
- Environment-only JWT secret
- Backend role authorization
- API rate limiting
- Stricter login rate limiting
- Registration rate limiting
- Helmet security headers
- Request body size limit
- Tenant-scoped database queries
- Transactional database operations for sensitive workflows
- Password confirmation before customer account deletion

Helmet Content Security Policy is currently disabled because portions of the frontend still use inline handlers/styles. This remains a future hardening item.

## Customer Account Deletion

Customers can permanently delete their own account from the portal's **Settings / Danger Zone**.

The flow:

1. Requires an authenticated customer session.
2. Requires the customer's current password.
3. Verifies the password with bcrypt.
4. Uses a database transaction.
5. Deletes the user account.
6. Deletes the associated repair job.
7. MySQL cascades the repair-job deletion to linked records.
8. Clears the browser authentication/session state.

The deletion flow was tested against MySQL to confirm removal of both the user and associated repair job.

## Email System

The application sends transactional email through a local SMTP stack.

```text
Repair SaaS
    |
    v
Nodemailer
    |
    v
Postfix on localhost
    |
    v
OpenDKIM
    |
    v
Recipient mail server
```

The mail domain is configured with:

- SPF
- DKIM
- DMARC

Registration confirmation emails have been successfully delivered to Gmail. Because the project is hosted from a residential connection, mailbox providers may still place messages in spam based on IP reputation or reverse-DNS reputation.

## Health Monitoring

The application exposes:

```text
GET /api/health
```

A healthy response resembles:

```json
{
  "status": "ok",
  "database": "connected",
  "uptime": 123.45
}
```

The endpoint verifies both:

- Express application availability
- MySQL connectivity

Uptime Kuma monitors the public health endpoint and can send alerts through Discord.

## Local Development

### Prerequisites

Install:

- Node.js
- npm
- MySQL

Clone the repository:

```bash
git clone https://github.com/animew1000-sketch/repair-saas-app.git
cd repair-saas-app
```

Install dependencies:

```bash
npm install
```

The mail service uses Nodemailer. If a fresh clone does not yet contain Nodemailer in the package manifest, install it with:

```bash
npm install nodemailer
```

### Environment Configuration

Create a `.env` file in the project root.

Example:

```env
PORT=3000

DB_HOST=localhost
DB_USER=repairapp
DB_PASSWORD=replace_with_your_database_password
DB_NAME=repair_db
DB_PORT=3306

JWT_SECRET=replace_with_a_long_random_secret

SMTP_HOST=127.0.0.1
SMTP_PORT=25
MAIL_FROM="Repair SaaS <noreply@example.com>"
```

**Never commit `.env` or real credentials to GitHub.**

### Start the Application

```bash
node server.js
```

Then open:

```text
http://localhost:3000
```

## Production Deployment

The current production architecture is:

```text
Internet
   |
   v
HTTPS / Nginx
   |
   v
127.0.0.1:3000
   |
   v
Node.js / Express
   |
   +----> MySQL
   |
   `----> Postfix SMTP
```

PM2 manages the Node.js process.

Typical deployment flow:

```bash
git pull --ff-only origin main
npm install
PORT=3000 pm2 restart 0 --update-env
pm2 save
```

Health can then be checked with:

```bash
curl -i http://127.0.0.1:3000/api/health
```

## Development Workflow

The team uses sprint-based development and ClickUp for project management.

GitHub is used for:

- Version control
- Change history
- Collaboration
- Deployment synchronization
- Technical evidence of implementation progress

The project also maintains development / engineering documentation describing architecture changes, troubleshooting, deployments, testing, and infrastructure work.

## Testing Performed

Testing completed during development includes:

- Customer registration
- Customer login
- Staff PIN login
- JWT-protected route access
- Role authorization
- Tenant-specific data access
- Customer profile retrieval
- Appointment requests
- Manager employee management
- Customer account deletion
- Foreign-key cascade deletion
- Production health endpoint
- Database connectivity
- PM2 application restart/recovery
- Registration email delivery
- SPF authentication
- DKIM authentication
- DMARC authentication
- Monitoring alerts

## Known Development Notes

This is an active academic project, not a commercial production service.

Current areas for continued improvement include:

- Email verification
- Password reset workflow
- Automated test coverage
- More granular authorization review
- Content Security Policy migration
- Mail deliverability/reputation
- Improved database migration tooling
- Additional validation and error handling
- Cleanup of legacy/demo assets and credentials
- Formal deployment automation

## Project Management

Development is organized using an iterative / sprint-based workflow.

Project evidence can include:

- ClickUp sprint tasks
- Git commits
- Pull/merge history
- Test results
- Deployment logs
- Server configuration records
- Screenshots
- Engineering notebook entries
- Sprint reviews and retrospectives

These artifacts document progress through planning, design, implementation, testing, deployment, and maintenance activities within the SDLC.

## Senior Design

This repository is part of an academic Senior Design project focused on the design and implementation of a real-world, multi-user information system.

The project combines:

- Full-stack web development
- Relational database design
- Authentication and authorization
- Cybersecurity hardening
- Linux server administration
- Networking and reverse proxy configuration
- Email infrastructure
- DNS authentication
- Monitoring
- Agile project management
- Production deployment and troubleshooting

## Contributors

This is a team Senior Design project. Contributions are tracked through GitHub history and the team's ClickUp sprint workspace.

See the GitHub contributors and commit history for implementation activity by team members.

## Security Notice

Do not commit or publish:

- `.env`
- Database passwords
- JWT secrets
- SMTP credentials
- API keys
- DNS provider tokens
- DKIM private keys
- Private SSH keys

Only example or placeholder values should appear in public documentation.

## License

This project is currently configured with the ISC license in `package.json`.

---

**Repair SaaS**  
Senior Design Project  
Active Development

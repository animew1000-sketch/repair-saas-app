const jwt = require('jsonwebtoken');

const JWT_SECRET =
  process.env.JWT_SECRET || 'super_secret_school_project_key_2026';

function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res
      .status(401)
      .json({ error: 'Access denied. Please log in first.' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res
        .status(403)
        .json({ error: 'Session expired. Please log in again.' });
    }

    req.user = user;
    next();
  });
}

const ROLE_PERMISSIONS = {
  customer: [],
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

function authorizeDepartment(req, res, next) {
  const userRole = req.user.role;
  const dept = req.params.name;

  if (userRole === 'manager') {
    return next();
  }

  const allowedDepts = ROLE_PERMISSIONS[userRole] || [];

  if (!allowedDepts.includes(dept)) {
    return res.status(403).json({
      error: `Unauthorized: Your rank (${userRole}) cannot modify ${dept}.`
    });
  }

  next();
}

module.exports = {
  authenticateToken,
  authorizeDepartment
};
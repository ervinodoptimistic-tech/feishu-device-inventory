// middleware/auth.js
const jwt = require('jsonwebtoken');
const { ROLES } = require('../config/constants');

/**
 * Verifies JWT and attaches decoded user to req.user.
 */
function authenticate(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: 'Authorization header missing or malformed' });
  }
  const token = header.slice(7);
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET || 'dev_secret');
    req.user.ip = req.ip;
    next();
  } catch (err) {
    return res.status(401).json({ success: false, message: 'Invalid or expired token' });
  }
}

/**
 * Role guard — pass one or more allowed roles.
 * Usage: authorize(ROLES.ADMIN, ROLES.TL)
 */
function authorize(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ success: false, message: 'Not authenticated' });
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: `Access denied. Required role(s): ${allowedRoles.join(', ')}. Your role: ${req.user.role}`,
      });
    }
    next();
  };
}

// Pre-built guards for convenience
const adminOnly        = authorize(ROLES.ADMIN);
const adminOrTL        = authorize(ROLES.ADMIN, ROLES.TL);
const adminOrHolder    = authorize(ROLES.ADMIN, ROLES.INVENTORY_HOLDER);
const allStaff         = authorize(ROLES.ADMIN, ROLES.TL, ROLES.INVENTORY_HOLDER, ROLES.EMPLOYEE);

module.exports = { authenticate, authorize, adminOnly, adminOrTL, adminOrHolder, allStaff };

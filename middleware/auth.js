function requireAuth(req, res, next) {
  if (!req.userId) {
    return res.status(401).json({ success: false, error: 'Authentication required' });
  }
  next();
}

function adminOnly(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ success: false, error: 'Authentication required' });
  }
  if (req.userRole !== 'admin') {
    return res.status(403).json({ success: false, error: 'Admin access required' });
  }
  next();
}

function adminProductMutationsOnly(req, res, next) {
  if (['POST', 'PUT', 'DELETE'].includes(req.method) && req.userRole !== 'admin') {
    return res.status(403).json({ success: false, error: 'Admin access required' });
  }
  next();
}

module.exports = {
  requireAuth,
  adminOnly,
  adminProductMutationsOnly
};
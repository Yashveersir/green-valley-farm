function requireAuth(req, res, next) {
  if (!req.userId) {
    return res.status(401).json({ success: false, error: 'Authentication required' });
  }
  next();
}

module.exports = {
  requireAuth
};
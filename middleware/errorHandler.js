// middleware/errorHandler.js
function errorHandler(err, req, res, next) {
  console.error(`[${new Date().toISOString()}] ${req.method} ${req.path} — ERROR:`, err.message);

  if (err.code && err.msg) {
    return res.status(502).json({ success: false, message: `Feishu API error: ${err.msg}`, code: err.code });
  }
  const status = err.status || err.statusCode || 500;
  res.status(status).json({ success: false, message: err.message || 'Internal server error' });
}

module.exports = errorHandler;

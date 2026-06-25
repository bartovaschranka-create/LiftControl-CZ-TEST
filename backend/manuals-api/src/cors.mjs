export function applyCors(req, res, config) {
  const origin = req.headers?.origin || '';
  if (origin && config.allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');
}

export function isOriginAllowed(req, config) {
  const origin = req.headers?.origin || '';
  return !origin || config.allowedOrigins.includes(origin);
}

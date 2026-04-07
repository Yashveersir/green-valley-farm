const crypto = require('crypto');

function getHmacSecret() { return 'test-secret'; }

function createStatelessToken(userId) {
  const ts = Date.now();
  const secret = getHmacSecret();
  const middle = ts;
  const sig = crypto.createHmac('sha256', secret).update(`${userId}:${middle}`).digest('hex').slice(0, 16);
  return Buffer.from(`${userId}:${middle}:${sig}`).toString('base64url');
}

function verifyStatelessToken(raw) {
  try {
    const decoded = Buffer.from(raw, 'base64url').toString();
    console.log("Decoded:", decoded);
    const lastColon = decoded.lastIndexOf(':');
    const firstColon = decoded.indexOf(':');
    if (firstColon === -1 || firstColon === lastColon) return null;
    const userId = decoded.slice(0, firstColon);
    const middle = decoded.slice(firstColon + 1, lastColon);
    const sig = decoded.slice(lastColon + 1);
    
    console.log("Extracted:", {userId, middle, sig});

    const secret = getHmacSecret();
    const expected = crypto.createHmac('sha256', secret).update(`${userId}:${middle}`).digest('hex').slice(0, 16);
    
    console.log("Expected Sig:", expected);
    
    if (sig !== expected) return null;
    // Token valid for 7 days
    if (Date.now() - parseInt(middle) > 7 * 24 * 60 * 60 * 1000) return null;
    return userId;
  } catch { return null; }
}

const token = createStatelessToken('admin-001');
console.log("Token:", token);
const result = verifyStatelessToken(token);
console.log("Result:", result);

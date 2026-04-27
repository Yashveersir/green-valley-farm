// ═══════════════════════════════════════
// API Client — Green Valley Poultry Farm
// ═══════════════════════════════════════

const API = {
  BASE: '/api',

  getToken() { return localStorage.getItem('gvf_token'); },
  setToken(t) { localStorage.setItem('gvf_token', t); },
  clearToken() { localStorage.removeItem('gvf_token'); localStorage.removeItem('gvf_user'); },
  getUser() { try { return JSON.parse(localStorage.getItem('gvf_user')); } catch { return null; } },
  setUser(u) { localStorage.setItem('gvf_user', JSON.stringify(u)); },

  async request(endpoint, options = {}) {
    const headers = { 'Content-Type': 'application/json' };
    const token = this.getToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;
    try {
      const res = await fetch(`${this.BASE}${endpoint}`, { headers, ...options });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Request failed');
      return data;
    } catch (err) {
      console.error(`API Error [${endpoint}]:`, err);
      throw err;
    }
  },

  // Auth
  async getAuthConfig() {
    return this.request('/auth/config');
  },
  async sendOtp(email, action, userData) {
    const data = await this.request('/auth/send-otp', { method: 'POST', body: JSON.stringify({ email, action, userData }) });
    // Store the otpToken for stateless verification on serverless platforms
    if (data.otpToken) sessionStorage.setItem('gvf_otpToken', data.otpToken);
    return data;
  },
  async verifyOtp(email, otp) {
    const otpToken = sessionStorage.getItem('gvf_otpToken') || '';
    const data = await this.request('/auth/verify-otp', { method: 'POST', body: JSON.stringify({ email, otp, otpToken }) });
    sessionStorage.removeItem('gvf_otpToken');
    this.setToken(data.token); this.setUser(data.user);
    return data;
  },
  async register(name, email, password, phone) {
    const data = await this.request('/auth/register', { method: 'POST', body: JSON.stringify({ name, email, password, phone }) });
    this.setToken(data.token); this.setUser(data.user);
    return data;
  },
  async login(email, password) {
    const data = await this.request('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
    this.setToken(data.token); this.setUser(data.user);
    return data;
  },
  async loginWithGoogle(credential) {
    const data = await this.request('/auth/google', { method: 'POST', body: JSON.stringify({ credential }) });
    this.setToken(data.token); this.setUser(data.user);
    return data;
  },
  async getMe() { return this.request('/auth/me'); },
  async logout() {
    try { await this.request('/auth/logout', { method: 'POST' }); } catch {}
    this.clearToken();
  },

  // Products
  async getProducts(category) {
    const q = category && category !== 'all' ? `?category=${category}` : '';
    return this.request(`/products${q}`);
  },
  async searchProducts(query) { return this.request(`/products?search=${encodeURIComponent(query)}`); },

  // Cart
  async getCart() { return this.request('/cart'); },
  async addToCart(productId, quantity = 1) {
    return this.request('/cart', { method: 'POST', body: JSON.stringify({ productId, quantity }) });
  },
  async updateCartItem(cartItemId, quantity) {
    return this.request(`/cart/${cartItemId}`, { method: 'PUT', body: JSON.stringify({ quantity }) });
  },
  async removeCartItem(cartItemId) { return this.request(`/cart/${cartItemId}`, { method: 'DELETE' }); },
  async clearCart() { return this.request('/cart', { method: 'DELETE' }); },

  // Orders
  async placeOrder(info) { return this.request('/orders', { method: 'POST', body: JSON.stringify(info) }); },
  async getOrders() { return this.request('/orders'); },
  async cancelOrder(orderId) { return this.request(`/orders/${orderId}/cancel`, { method: 'PUT' }); },

  // Payments
  async createPaymentOrder(amount) {
    return this.request('/payments/create-order', { method: 'POST', body: JSON.stringify({ amount }) });
  },
  async verifyPayment(details) {
    return this.request('/payments/verify-payment', { method: 'POST', body: JSON.stringify(details) });
  },

  // Farm
  async getFarmInfo() { return this.request('/farm'); },
};

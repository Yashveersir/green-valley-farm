// ═══════════════════════════════════════
// API Client — Green Valley Poultry Farm
// ═══════════════════════════════════════

const API = {
  BASE: '/api',
  getStoragePrefix() {
    return window.location.pathname.startsWith('/admin') ? 'gvf_admin' : 'gvf_store';
  },
  getTokenKey() {
    return `${this.getStoragePrefix()}_token`;
  },
  getRefreshTokenKey() {
    return `${this.getStoragePrefix()}_refresh_token`;
  },
  getUserKey() {
    return `${this.getStoragePrefix()}_user`;
  },

  getToken() { return localStorage.getItem(this.getTokenKey()); },
  setToken(t) { localStorage.setItem(this.getTokenKey(), t); },
  getRefreshToken() { return localStorage.getItem(this.getRefreshTokenKey()); },
  setRefreshToken(t) {
    if (t) localStorage.setItem(this.getRefreshTokenKey(), t);
    else localStorage.removeItem(this.getRefreshTokenKey());
  },
  clearToken() {
    localStorage.removeItem(this.getTokenKey());
    localStorage.removeItem(this.getRefreshTokenKey());
    localStorage.removeItem(this.getUserKey());
  },
  getUser() {
    try {
      return JSON.parse(localStorage.getItem(this.getUserKey()));
    } catch {
      return null;
    }
  },
  setUser(u) { localStorage.setItem(this.getUserKey(), JSON.stringify(u)); },

  async rawRequest(endpoint, options = {}) {
    const headers = { 'Content-Type': 'application/json' };
    const token = this.getToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch(`${this.BASE}${endpoint}`, { cache: 'no-store', headers, ...options });
    const data = await res.json().catch(() => ({}));
    return { res, data };
  },

  async refreshSession() {
    const refreshToken = this.getRefreshToken();
    if (!refreshToken) throw new Error('Session expired');
    const { res, data } = await fetch(`${this.BASE}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken })
    }).then(async (response) => ({
      res: response,
      data: await response.json().catch(() => ({}))
    }));
    if (!res.ok || !data.token || !data.refreshToken) {
      this.clearToken();
      throw new Error(data.error || 'Session expired');
    }
    this.setToken(data.token);
    this.setRefreshToken(data.refreshToken);
    if (data.user) this.setUser(data.user);
    return data;
  },

  async request(endpoint, options = {}, retry = true) {
    try {
      const { res, data } = await this.rawRequest(endpoint, options);
      if (res.status === 401 && retry && endpoint !== '/auth/refresh' && endpoint !== '/auth/login') {
        await this.refreshSession();
        return this.request(endpoint, options, false);
      }
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
    this.setToken(data.token); this.setRefreshToken(data.refreshToken); this.setUser(data.user);
    return data;
  },
  async register(name, email, password, phone) {
    const data = await this.request('/auth/register', { method: 'POST', body: JSON.stringify({ name, email, password, phone }) });
    this.setToken(data.token); this.setRefreshToken(data.refreshToken); this.setUser(data.user);
    return data;
  },
  async login(email, password) {
    const data = await this.request('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
    this.setToken(data.token); this.setRefreshToken(data.refreshToken); this.setUser(data.user);
    return data;
  },
  async loginWithGoogle(credential) {
    const data = await this.request('/auth/google', { method: 'POST', body: JSON.stringify({ credential }) });
    this.setToken(data.token); this.setRefreshToken(data.refreshToken); this.setUser(data.user);
    return data;
  },
  async getMe() { return this.request('/auth/me'); },
  async logout() {
    try {
      await this.request('/auth/logout', {
        method: 'POST',
        body: JSON.stringify({ refreshToken: this.getRefreshToken() })
      }, false);
    } catch {}
    this.clearToken();
  },

  // Products
  async getProducts(category, options = {}) {
    const params = new URLSearchParams();
    if (category && category !== 'all') params.set('category', category);
    if (options.sort) params.set('sort', options.sort);
    if (options.minRating) params.set('minRating', options.minRating);
    const q = params.toString() ? `?${params.toString()}` : '';
    return this.request(`/products${q}`);
  },
  async searchProducts(query) { return this.request(`/products?search=${encodeURIComponent(query)}`); },
  async getProductReviews(productId, filters = {}) {
    const params = new URLSearchParams();
    if (filters.sort) params.set('sort', filters.sort);
    if (filters.rating) params.set('rating', filters.rating);
    if (filters.withPhotos) params.set('withPhotos', 'true');
    const query = params.toString() ? `?${params.toString()}` : '';
    return this.request(`/products/${productId}/reviews${query}`);
  },
  async submitProductReview(productId, rating, comment, photos = []) {
    return this.request(`/products/${productId}/reviews`, {
      method: 'POST',
      body: JSON.stringify({ rating, comment, photos })
    });
  },
  async updateProductReview(productId, rating, comment, photos = []) {
    return this.request(`/products/${productId}/reviews`, {
      method: 'PUT',
      body: JSON.stringify({ rating, comment, photos })
    });
  },
  async deleteProductReview(productId) {
    return this.request(`/products/${productId}/reviews`, { method: 'DELETE' });
  },

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

  // Admin reviews
  async getPendingReviews(filters = {}) {
    const params = new URLSearchParams();
    if (filters.status) params.set('status', filters.status);
    if (filters.sort) params.set('sort', filters.sort);
    if (filters.rating) params.set('rating', filters.rating);
    if (filters.search) params.set('search', filters.search);
    const query = params.toString() ? `?${params.toString()}` : '';
    return this.request(`/admin/reviews${query}`);
  },
  async moderateReview(reviewId, status, rejectionNote = '') {
    return this.request(`/admin/reviews/${reviewId}/status`, {
      method: 'PUT',
      body: JSON.stringify({ status, rejectionNote })
    });
  },

  // Farm
  async getFarmInfo() { return this.request('/farm'); },
};

window.API = API;

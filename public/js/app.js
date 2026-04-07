// ═══════════════════════════════════════
// Main Application — Green Valley Poultry
// ═══════════════════════════════════════

const App = {
  currentPage: 'home',
  currentCategory: 'all',
  products: [],
  searchTimeout: null,

  async init() {
    this.bindEvents();
    await this.checkAuth();
    await this.loadProducts();
    this.updateCartBadge();
  },

  // ── Auth ──
  async checkAuth() {
    const token = API.getToken();
    if (token) {
      try {
        const data = await API.getMe();
        API.setUser(data.user);
        this.renderAuthUI(data.user);
      } catch {
        API.clearToken();
        this.renderAuthUI(null);
      }
    } else {
      this.renderAuthUI(null);
    }
  },

  renderAuthUI(user) {
    const area = document.getElementById('auth-area');
    if (user) {
      const initials = user.name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
      area.innerHTML = `
        <div class="user-menu">
          <div class="user-avatar" onclick="App.toggleUserMenu()" title="${user.name}">${initials}</div>
          <div class="user-dropdown" id="user-dropdown">
            <div class="user-dropdown-header"><strong>${user.name}</strong><span>${user.email}</span></div>
            <a href="#" onclick="App.openProfile();App.toggleUserMenu()">👤 Edit Profile</a>
            <a href="#" onclick="App.navigate('orders');App.toggleUserMenu()">📦 My Orders</a>
            <button class="logout-btn" onclick="App.handleLogout()">🚪 Logout</button>
          </div>
        </div>`;
    } else {
      area.innerHTML = `<button class="btn btn-sm btn-primary" onclick="App.showModal('login')">Login</button>`;
    }
  },

  toggleUserMenu() {
    const dd = document.getElementById('user-dropdown');
    if (dd) dd.classList.toggle('open');
  },

  showModal(type) {
    this.closeModals();
    const el = document.getElementById(`modal-${type}`);
    if (el) el.style.display = 'flex';
  },

  openProfile() {
    const user = API.getUser();
    if (!user) return;
    document.getElementById('profile-email').value = user.email;
    document.getElementById('profile-name').value = user.name || '';
    document.getElementById('profile-phone').value = user.phone || '';
    this.showModal('profile');
  },

  async handleProfileUpdate(e) {
    e.preventDefault();
    const btn = document.getElementById('profile-submit');
    const name = document.getElementById('profile-name').value.trim();
    const phone = document.getElementById('profile-phone').value.trim();
    const newPassword = document.getElementById('profile-password').value.trim();
    btn.disabled = true; btn.textContent = 'Saving...';
    try {
      const bodyParams = { name, phone };
      if (newPassword) bodyParams.newPassword = newPassword;
      const res = await API.request('/auth/profile', {
        method: 'PUT',
        body: JSON.stringify(bodyParams)
      });
      API.setUser(res.user);
      this.renderAuthUI(res.user);
      this.toast('Profile updated successfully!', 'success');
      this.closeModals();
    } catch (err) {
      this.toast(err.message, 'error');
    }
    btn.disabled = false; btn.textContent = 'Save Changes';
  },

  closeModals() {
    document.querySelectorAll('.modal-overlay').forEach(m => m.style.display = 'none');
  },

  async handleLogin(e) {
    e.preventDefault();
    const btn = document.getElementById('login-submit');
    btn.disabled = true; btn.textContent = 'Logging in...';
    try {
      const email = document.getElementById('login-email').value;
      const password = document.getElementById('login-password').value;
      const data = await API.login(email, password);
      this.closeModals();
      this.renderAuthUI(data.user);
      this.updateCartBadge();
      this.toast(`Welcome back, ${data.user.name}!`, 'success');
    } catch (err) {
      this.toast(err.message, 'error');
    }
    btn.disabled = false; btn.textContent = 'Login';
  },

  async handleLoginOtp(e) {
    e.preventDefault();
    const btn = document.getElementById('login-otp-submit');
    btn.disabled = true; btn.textContent = 'Sending...';
    try {
      const email = document.getElementById('login-otp-email').value;
      await API.sendOtp(email, 'login', {});
      this.closeModals();
      this.showModal('otp');
      document.getElementById('verify-email-show').textContent = email;
      document.getElementById('verify-email').value = email;
      this.toast('Auth Code sent to your email!', 'success');
    } catch (err) {
      this.toast(err.message, 'error');
    }
    btn.disabled = false; btn.textContent = 'Send Auth Code';
  },

  async handleRegisterRequest(e) {
    e.preventDefault();
    const btn = document.getElementById('reg-submit');
    btn.disabled = true; btn.textContent = 'Sending OTP...';
    try {
      const name = document.getElementById('reg-name').value;
      const email = document.getElementById('reg-email').value;
      const phone = document.getElementById('reg-phone').value;
      const password = document.getElementById('reg-password').value;
      
      await API.sendOtp(email, 'register', { name, email, phone, password });
      
      this.closeModals();
      this.showModal('otp');
      document.getElementById('verify-email-show').textContent = email;
      document.getElementById('verify-email').value = email;
      this.toast('OTP sent for verification!', 'success');
    } catch (err) {
      this.toast(err.message, 'error');
    }
    btn.disabled = false; btn.textContent = 'Verify Email';
  },

  async handleOtpSubmit(e) {
    e.preventDefault();
    const btn = document.getElementById('verify-submit');
    btn.disabled = true; btn.textContent = 'Verifying...';
    try {
      const email = document.getElementById('verify-email').value;
      const otp = document.getElementById('verify-code').value;
      
      const data = await API.verifyOtp(email, otp);
      this.closeModals();
      this.renderAuthUI(data.user);
      this.updateCartBadge();
      this.toast(data.user ? `Welcome, ${data.user.name}!` : 'Success!', 'success');
    } catch (err) {
      this.toast(err.message, 'error');
    }
    btn.disabled = false; btn.textContent = 'Verify & Continue';
  },

  async handleForgotOtp(e) {
    e.preventDefault();
    const btn = document.getElementById('forgot-submit');
    btn.disabled = true; btn.textContent = 'Sending...';
    try {
      const email = document.getElementById('forgot-email').value;
      const data = await API.sendOtp(email, 'reset-password', {});
      document.getElementById('forgot-step-1').style.display = 'none';
      document.getElementById('forgot-step-2').style.display = 'block';
      this.toast('Reset OTP sent to email!', 'success');
    } catch(err) {
      this.toast(err.message, 'error');
    }
    btn.disabled = false; btn.textContent = 'Send Reset OTP';
  },

  async handleForgotReset(e) {
    e.preventDefault();
    const btn = document.getElementById('forgot-reset-btn');
    btn.disabled = true; btn.textContent = 'Resetting...';
    try {
      const email = document.getElementById('forgot-email').value;
      const otp = document.getElementById('forgot-otp').value;
      const newPassword = document.getElementById('forgot-password').value;
      
      const otpToken = sessionStorage.getItem('gvf_otpToken') || '';
      const data = await API.request('/auth/reset-password', {
        method: 'POST', body: JSON.stringify({ email, otp, newPassword, otpToken })
      });
      
      this.closeModals();
      this.toast('Password reset successfully! Please login.', 'success');
      this.showModal('login');
      document.getElementById('login-email').value = email;
    } catch(err) {
      this.toast(err.message, 'error');
    }
    btn.disabled = false; btn.textContent = 'Reset & Login';
  },

  async handleLogout() {
    await API.logout();
    this.renderAuthUI(null);
    this.updateCartBadge();
    this.toast('Logged out', 'success');
    this.navigate('home');
  },

  // ── Navigation ──
  navigate(page) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    const el = document.getElementById(`page-${page}`);
    if (el) { el.classList.add('active'); this.currentPage = page; }
    document.querySelectorAll('.nav-link').forEach(l => l.classList.toggle('active', l.dataset.page === page));
    window.scrollTo({ top: 0, behavior: 'smooth' });
    // Close user dropdown
    const dd = document.getElementById('user-dropdown');
    if (dd) dd.classList.remove('open');

    if (page === 'cart') this.renderCart();
    if (page === 'checkout') { if (!API.getToken()) { this.showModal('login'); this.toast('Please login to checkout', 'error'); return; } this.renderCheckoutSummary(); }
    if (page === 'orders') { if (!API.getToken()) { this.showModal('login'); return; } this.loadOrders(); }
    if (page === 'about') this.loadAbout();
  },

  // ── Events ──
  bindEvents() {
    window.addEventListener('scroll', () => {
      document.getElementById('main-header').classList.toggle('scrolled', window.scrollY > 50);
    });
    const searchToggle = document.getElementById('search-toggle');
    const searchWrapper = document.getElementById('search-wrapper');
    const searchInput = document.getElementById('search-input');
    searchToggle.addEventListener('click', () => {
      searchWrapper.classList.toggle('open');
      if (searchWrapper.classList.contains('open')) searchInput.focus();
      else { searchInput.value = ''; this.loadProducts(); }
    });
    searchInput.addEventListener('input', (e) => {
      clearTimeout(this.searchTimeout);
      this.searchTimeout = setTimeout(() => {
        if (e.target.value.trim()) this.searchProducts(e.target.value.trim());
        else this.loadProducts();
      }, 300);
    });
    // Close modals on overlay click
    document.querySelectorAll('.modal-overlay').forEach(m => {
      m.addEventListener('click', (e) => { if (e.target === m) this.closeModals(); });
    });
    // Close user dropdown on outside click
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.user-menu')) {
        const dd = document.getElementById('user-dropdown');
        if (dd) dd.classList.remove('open');
      }
    });
  },

  // ── Products ──
  async loadProducts() {
    const spinner = document.getElementById('loading-spinner');
    const grid = document.getElementById('products-grid');
    spinner.classList.add('active'); grid.innerHTML = '';
    try {
      const data = await API.getProducts(this.currentCategory);
      this.products = data.products;
      this.renderProducts(this.products);
    } catch { grid.innerHTML = '<p style="text-align:center;color:var(--text-muted);padding:40px;">Failed to load.</p>'; }
    spinner.classList.remove('active');
  },

  async searchProducts(query) {
    try { const data = await API.searchProducts(query); this.renderProducts(data.products); } catch {}
  },

  filterCategory(cat) {
    this.currentCategory = cat;
    document.querySelectorAll('.cat-btn').forEach(b => b.classList.toggle('active', b.dataset.category === cat));
    this.loadProducts();
  },

  renderProducts(products) {
    const grid = document.getElementById('products-grid');
    if (!products.length) { grid.innerHTML = '<p style="text-align:center;color:var(--text-muted);padding:40px;grid-column:1/-1;">No products found.</p>'; return; }
    grid.innerHTML = products.map((p, i) => {
      let sc = 'in-stock', st = 'In Stock';
      if (p.stock <= 0) { sc = 'out-of-stock'; st = 'Out of Stock'; }
      else if (p.stock <= 20) { sc = 'low-stock'; st = `Only ${p.stock} left`; }
      return `<div class="product-card" style="animation:fadeInUp 0.4s ease ${i*0.05}s both">
        <div class="product-card-img ${p.category}"><span>${p.emoji}</span><span class="stock-badge ${sc}">${st}</span></div>
        <div class="product-card-body">
          <div class="product-card-tags">${p.tags.slice(0,2).map(t=>`<span class="product-tag">${t}</span>`).join('')}</div>
          <h3 class="product-card-name">${p.name}</h3>
          <p class="product-card-desc">${p.description}</p>
          <div class="product-card-meta"><span>⚖️ ${p.weight}</span><span>📍 ${(p.farmOrigin||'').split(' - ')[1]||p.farmOrigin}</span></div>
          <div class="product-card-footer">
            <div class="product-card-price">₹${p.price} <small>/ ${p.unit}</small></div>
            <button class="add-to-cart-btn" id="atc-${p.id}" onclick="App.addToCart('${p.id}')" ${p.stock<=0?'disabled style="opacity:.4;pointer-events:none"':''}>🛒 Add</button>
          </div>
        </div></div>`;
    }).join('');
  },

  // ── Cart ──
  async addToCart(productId) {
    if (!API.getToken()) { this.showModal('login'); this.toast('Please login first', 'error'); return; }
    const btn = document.getElementById(`atc-${productId}`);
    try {
      await API.addToCart(productId, 1);
      if (btn) { btn.classList.add('added'); btn.innerHTML = '✓ Added'; setTimeout(() => { btn.classList.remove('added'); btn.innerHTML = '🛒 Add'; }, 1500); }
      this.updateCartBadge();
      this.toast('Added to cart!', 'success');
    } catch (err) { this.toast(err.message, 'error'); }
  },

  async updateCartBadge() {
    try {
      const data = await API.getCart();
      const badge = document.getElementById('cart-badge');
      badge.textContent = data.cart.totalItems;
      badge.classList.add('bounce');
      setTimeout(() => badge.classList.remove('bounce'), 400);
    } catch {}
  },

  async renderCart() {
    try {
      const data = await API.getCart();
      const cart = data.cart;
      const itemsEl = document.getElementById('cart-items');
      const summaryEl = document.getElementById('cart-summary');
      const emptyEl = document.getElementById('cart-empty');
      if (!cart.items.length) {
        itemsEl.innerHTML = ''; summaryEl.innerHTML = '';
        emptyEl.style.display = 'block';
        document.querySelector('.cart-layout').style.display = 'none';
        return;
      }
      emptyEl.style.display = 'none';
      document.querySelector('.cart-layout').style.display = 'grid';
      itemsEl.innerHTML = cart.items.map(item => `
        <div class="cart-item">
          <div class="cart-item-emoji">${item.emoji}</div>
          <div class="cart-item-info"><div class="cart-item-name">${item.name}</div><div class="cart-item-price">₹${item.price} <span class="cart-item-unit">/ ${item.unit}</span></div><div class="cart-item-subtotal">Subtotal: ₹${item.subtotal}</div></div>
          <div class="cart-item-actions"><div class="qty-controls"><button class="qty-btn" onclick="App.updateQty('${item.cartItemId}',${item.quantity-1})">−</button><span class="qty-value">${item.quantity}</span><button class="qty-btn" onclick="App.updateQty('${item.cartItemId}',${item.quantity+1})">+</button></div><button class="remove-btn" onclick="App.removeItem('${item.cartItemId}')">✕ Remove</button></div>
        </div>`).join('');
      summaryEl.innerHTML = `<h3 class="summary-title">Order Summary</h3>
        <div class="summary-row"><span>Items (${cart.totalItems})</span><span>₹${cart.totalPrice}</span></div>
        <div class="summary-row"><span>Delivery</span><span class="summary-delivery">FREE</span></div>
        <div class="summary-row total"><span>Total</span><span>₹${cart.totalPrice}</span></div>
        <button class="btn btn-primary btn-lg btn-block" style="margin-top:20px" onclick="App.navigate('checkout')">Proceed to Checkout</button>
        <button class="btn btn-outline btn-block" style="margin-top:10px" onclick="App.clearCart()">Clear Cart</button>`;
    } catch (err) { this.toast('Failed to load cart', 'error'); }
  },

  async updateQty(id, qty) { try { if (qty <= 0) return this.removeItem(id); await API.updateCartItem(id, qty); this.renderCart(); this.updateCartBadge(); } catch (err) { this.toast(err.message, 'error'); } },
  async removeItem(id) { try { await API.removeCartItem(id); this.renderCart(); this.updateCartBadge(); this.toast('Removed', 'success'); } catch (err) { this.toast(err.message, 'error'); } },
  async clearCart() { try { await API.clearCart(); this.renderCart(); this.updateCartBadge(); this.toast('Cart cleared', 'success'); } catch (err) { this.toast(err.message, 'error'); } },

  // ── Checkout ──
  async renderCheckoutSummary() {
    try {
      const data = await API.getCart();
      const cart = data.cart;
      if (!cart.items.length) { this.navigate('home'); return; }
      const user = API.getUser();
      if (user) { document.getElementById('customer-name').value = user.name || ''; document.getElementById('customer-phone').value = user.phone || ''; }
      document.getElementById('checkout-summary').innerHTML = `<h3 class="summary-title">Order Summary</h3>
        ${cart.items.map(i => `<div class="summary-row"><span>${i.emoji} ${i.name} × ${i.quantity}</span><span>₹${i.subtotal}</span></div>`).join('')}
        <div class="summary-row"><span>Delivery</span><span class="summary-delivery">FREE</span></div>
        <div class="summary-row total"><span>Total</span><span>₹${cart.totalPrice}</span></div>`;
    } catch (err) { this.toast('Error loading summary', 'error'); }
  },

  async placeOrder(e) {
    e.preventDefault();
    if (!API.getToken()) { this.toast('Session expired', 'error'); return; }
    
    let paymentMethod = 'COD';
    const methodRadios = document.getElementsByName('payment-method');
    for (const r of methodRadios) { if (r.checked) paymentMethod = r.value; }
    
    let upiUtr = '';
    let upiScreenshot = null;
    
    if (paymentMethod === 'UPI') {
      upiUtr = document.getElementById('upi-utr').value.trim();
      if (upiUtr.length !== 12 || isNaN(upiUtr)) {
        this.toast('Please enter a valid 12-digit UPI UTR number', 'error');
        return;
      }
      
      const fileInput = document.getElementById('upi-screenshot');
      if (!fileInput.files.length) {
        this.toast('Payment screenshot is absolutely required for UPI verification', 'error');
        return;
      }
      
      const file = fileInput.files[0];
      if (file.size > 2 * 1024 * 1024) {
        this.toast('Image must be less than 2MB', 'error');
        return;
      }
      
      // Convert image gracefully to base64 inline string format so native generic API structure retains form
      try {
        upiScreenshot = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
      } catch(err) {
        this.toast('Failed to load screenshot format.', 'error');
        return;
      }
    }

    const payload = {
      name: document.getElementById('customer-name').value,
      phone: document.getElementById('customer-phone').value,
      address: document.getElementById('customer-address').value,
      paymentMethod,
      upiUtr,
      upiScreenshot
    };
    
    const btn = document.getElementById('place-order-btn');
    btn.disabled = true; btn.innerHTML = '⏳ Placing...';
    try {
      const data = await API.placeOrder(payload);
      this.updateCartBadge();
      this.renderOrderSuccess(data.order);
      document.getElementById('checkout-form').reset();
      this.toast('Order placed!', 'success');
    } catch (err) { this.toast(err.message, 'error'); }
    btn.disabled = false; btn.innerHTML = '✓ Place Order';
  },

  renderOrderSuccess(order) {
    this.navigate('success');
    let emailText = order.emailSent ? '<div class="payment-badge" style="margin-bottom:16px;">📧 Email receipt sent!</div>' : '';
    document.getElementById('success-content').innerHTML = `
      <div class="success-icon">🎉</div><h2>Order Placed!</h2>
      <p class="order-id">Order ID: ${order.orderId}</p>
      ${emailText}
      <div class="order-detail-card">
        <div class="order-detail-row"><span>Status</span><span style="color:#2ecc71;font-weight:600">✓ Confirmed</span></div>
        <div class="order-detail-row"><span>Items</span><span>${order.totalItems} items</span></div>
        <div class="order-detail-row"><span>Total</span><span style="color:var(--accent);font-weight:800">₹${order.totalPrice}</span></div>
        <div class="order-detail-row"><span>Delivery</span><span>Est. ${order.estimatedDelivery}</span></div>
        <div class="order-detail-row"><span>Payment</span><span>Cash on Delivery</span></div>
      </div>
      <button class="btn btn-primary btn-lg" onclick="App.navigate('home')">Continue Shopping</button>
      <button class="btn btn-outline" style="margin-left:12px" onclick="App.navigate('orders')">View Orders</button>`;
  },

  // ── Orders ──
  async loadOrders() {
    try {
      const data = await API.getOrders();
      const el = document.getElementById('orders-list');
      const emptyEl = document.getElementById('orders-empty');
      if (!data.orders.length) { el.innerHTML = ''; emptyEl.style.display = 'block'; return; }
      emptyEl.style.display = 'none';
      el.innerHTML = data.orders.map(o => `
        <div class="order-card"><div class="order-card-header"><span class="order-card-id">${o.orderId}</span><span class="order-status">${o.status}</span></div>
        <div class="order-card-items">${o.items.map(i => `<div class="order-card-item"><span>${i.emoji} ${i.name} × ${i.quantity}</span><span>₹${i.subtotal}</span></div>`).join('')}</div>
        <div class="order-card-footer"><span style="color:var(--text-muted);font-size:13px">📅 ${new Date(o.placedAt).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'})}</span><span class="order-card-total">₹${o.totalPrice}</span></div></div>`).join('');
    } catch (err) { this.toast('Failed to load orders', 'error'); }
  },

  // ── About ──
  async loadAbout() {
    try {
      const data = await API.getFarmInfo(); const f = data.farm;
      document.getElementById('about-content').innerHTML = `<p style="font-size:17px;color:var(--text-secondary);line-height:1.8;margin-bottom:32px">${f.description}</p>
        <div class="about-grid">
          <div class="about-card"><div class="about-card-icon">📍</div><h4>Location</h4><p><a href="https://www.google.com/maps/place/Green+Valley+Poultry+Farm/@26.2929519,85.3947712,17z/data=!4m14!1m7!3m6!1s0x39ed1dd0ddeaf6e5:0xeb79e79b089a853f!2sGreen+Valley+Poultry+Farm!8m2!3d26.2929519!4d85.3947712!16s%2Fg%2F11sbq_4t46!3m5!1s0x39ed1dd0ddeaf6e5:0xeb79e79b089a853f!8m2!3d26.2929519!4d85.3947712!16s%2Fg%2F11sbq_4t46?entry=ttu&g_ep=EgoyMDI2MDQwMS4wIKXMDSoASAFQAw%3D%3D" target="_blank" style="color:inherit;text-decoration:none;">${f.location}</a></p></div>
          <div class="about-card"><div class="about-card-icon">📞</div><h4>Phone</h4><p><a href="tel:${f.phone.replace(/[^0-9+]/g, '')}" style="color:inherit;text-decoration:none;">${f.phone}</a></p></div>
          <div class="about-card"><div class="about-card-icon">📧</div><h4>Email</h4><p><a href="mailto:${f.email}" style="color:inherit;text-decoration:none;">${f.email}</a></p></div>
          <div class="about-card"><div class="about-card-icon">🕐</div><h4>Hours</h4><p>${f.hours}</p></div>
          <div class="about-card"><div class="about-card-icon">📅</div><h4>Established</h4><p>Since ${f.established}</p></div>
          <div class="about-card"><div class="about-card-icon">🏅</div><h4>Certifications</h4><p>${f.certifications.join(', ')}</p></div>
        </div>`;
    } catch {}
  },

  // ── Toast ──
  toast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    const icon = type === 'success' ? '✓' : '✕';
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `<span>${icon}</span> ${message}`;
    container.appendChild(toast);
    setTimeout(() => { toast.classList.add('fade-out'); setTimeout(() => toast.remove(), 300); }, 2500);
  },
};

document.addEventListener('DOMContentLoaded', () => App.init());

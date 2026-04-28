// ═══════════════════════════════════════
// Main Application — Green Valley Poultry
// ═══════════════════════════════════════

const App = {
  currentPage: 'home',
  currentCategory: 'all',
  products: [],
  selectedProductId: null,
  selectedProductReviewMeta: null,
  productSort: 'featured',
  reviewFilters: { sort: 'newest', rating: '', withPhotos: false },
  cookieConsentKey: 'gvf_cookie_notice_ack',
  productLoadSeq: 0,
  searchTimeout: null,
  googleClientId: '',
  googleButtonsRendered: false,

  async init() {
    this.bindEvents();
    document.body.dataset.page = this.currentPage;
    await this.checkAuth();
    await this.loadProducts();
    await this.openProductFromLocation();
    await this.initGoogleAuth();
    this.updateCartBadge();
    this.initCookieBanner();
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
    if (window.location.pathname.startsWith('/products/')) {
      history.replaceState({}, '', '/');
    }
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
    if (window.google?.accounts?.id) google.accounts.id.disableAutoSelect();
    this.renderAuthUI(null);
    this.updateCartBadge();
    this.toast('Logged out', 'success');
    this.navigate('home');
  },

  async initGoogleAuth() {
    try {
      const config = await API.getAuthConfig();
      this.googleClientId = config.googleClientId || '';
      this.razorpayKeyId = config.razorpayKeyId || '';
      if (!this.googleClientId) {
        this.setGoogleAuthNotes('Add GOOGLE_CLIENT_ID in .env to enable Google sign-in.');
        return;
      }

      await this.waitForGoogleSdk();
      google.accounts.id.initialize({
        client_id: this.googleClientId,
        ux_mode: 'popup',
        callback: (response) => {
          console.log('Google credential received');
          this.handleGoogleCredential(response);
        },
        error_callback: (error) => {
          console.error('Google sign-in error:', error);
          const messageByType = {
            popup_failed_to_open: 'Google sign-in popup could not open. Please allow popups and try again.',
            popup_closed: 'Google sign-in was closed before it finished.',
            unknown: 'Google sign-in could not complete. Please try again.'
          };
          this.toast(messageByType[error?.type] || 'Google sign-in could not complete. Please try again.', 'error');
        },
        auto_select: false,
        cancel_on_tap_outside: true,
        itp_support: true
      });

      ['google-login-btn', 'google-register-btn'].forEach((id) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.innerHTML = '';
        google.accounts.id.renderButton(el, {
          type: 'standard',
          theme: 'outline',
          size: 'large',
          text: id.includes('register') ? 'signup_with' : 'signin_with',
          shape: 'pill',
          width: Math.min(340, el.closest('.modal')?.clientWidth - 80 || 320)
        });
      });

      this.googleButtonsRendered = true;
      this.setGoogleAuthNotes('', true);
    } catch (err) {
      this.setGoogleAuthNotes('Google sign-in is unavailable right now.');
    }
  },

  waitForGoogleSdk() {
    if (window.google?.accounts?.id) return Promise.resolve();
    return new Promise((resolve, reject) => {
      let attempts = 0;
      const timer = setInterval(() => {
        attempts += 1;
        if (window.google?.accounts?.id) {
          clearInterval(timer);
          resolve();
        } else if (attempts >= 80) {
          clearInterval(timer);
          reject(new Error('Google SDK failed to load'));
        }
      }, 100);
    });
  },

  setGoogleAuthNotes(message, hidden = false) {
    ['google-login-note', 'google-register-note'].forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.textContent = message;
      el.classList.toggle('hidden', hidden);
    });
  },

  async handleGoogleCredential(response) {
    if (!response?.credential) {
      this.toast('Google sign-in was cancelled', 'error');
      return;
    }

    try {
      const data = await API.loginWithGoogle(response.credential);
      this.closeModals();
      this.renderAuthUI(data.user);
      this.updateCartBadge();
      this.toast(`Welcome, ${data.user.name}!`, 'success');
    } catch (err) {
      this.toast(err.message || 'Google sign-in failed', 'error');
    }
  },

  // ── Navigation ──
  navigate(page, targetId = null) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    const el = document.getElementById(`page-${page}`);
    if (el) {
      el.classList.add('active');
      this.currentPage = page;
      document.body.dataset.page = page;
    }
    document.querySelectorAll('.nav-link').forEach(l => l.classList.toggle('active', l.dataset.page === page));
    
    if (targetId) {
      setTimeout(() => {
        const target = document.getElementById(targetId);
        if (target) target.scrollIntoView({ behavior: 'smooth' });
      }, 50);
    } else {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    // Close user dropdown
    const dd = document.getElementById('user-dropdown');
    if (dd) dd.classList.remove('open');

    if (page === 'cart') this.renderCart();
    if (page === 'checkout') { if (!API.getToken()) { this.showModal('login'); this.toast('Please login to checkout', 'error'); return; } this.renderCheckoutSummary(); }
    if (page === 'orders') { if (!API.getToken()) { this.showModal('login'); return; } this.loadOrders(); }
    if (page === 'about') this.loadAbout();
  },

  async browseCategory(cat, options = {}) {
    const { direct = false } = options;
    this.currentCategory = cat;
    if (this.currentPage !== 'home') {
      this.navigate('home');
      await new Promise(resolve => setTimeout(resolve, 80));
    } else if (!direct) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
    document.querySelectorAll('.cat-btn').forEach(b => b.classList.toggle('active', b.dataset.category === cat));
    await this.loadProducts();
    this.scrollToCategoryLocation(cat, { direct });
  },

  scrollToCategoryLocation(cat, options = {}) {
    const { direct = false } = options;
    const target = direct
      ? document.querySelector('#products-grid .product-card')
      : document.querySelector(`.cat-btn[data-category="${cat}"]`) || document.querySelector('#products-grid .product-card');
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    const section = document.getElementById('products-section');
    if (section) section.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
    const loadSeq = ++this.productLoadSeq;
    const spinner = document.getElementById('loading-spinner');
    const grid = document.getElementById('products-grid');
    spinner.classList.add('active'); grid.innerHTML = '';
    try {
      const data = await API.getProducts(this.currentCategory, { sort: this.productSort });
      if (loadSeq !== this.productLoadSeq) return;
      this.products = data.products;
      this.renderProducts(this.products);
    } catch {
      if (loadSeq === this.productLoadSeq) {
        grid.innerHTML = '<p style="text-align:center;color:var(--text-muted);padding:40px;">Failed to load.</p>';
      }
    } finally {
      if (loadSeq === this.productLoadSeq) spinner.classList.remove('active');
    }
  },

  async searchProducts(query) {
    try { const data = await API.searchProducts(query); this.renderProducts(data.products); } catch {}
  },

  filterCategory(cat) {
    this.currentCategory = cat;
    document.querySelectorAll('.cat-btn').forEach(b => b.classList.toggle('active', b.dataset.category === cat));
    this.loadProducts();
  },

  setProductSort(sort) {
    this.productSort = sort || 'featured';
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
        <div class="product-card-img ${p.category}" style="${p.imageUrl ? `background-image: url('${p.imageUrl}'); background-size: cover; background-position: center; position: relative; overflow: hidden;` : ''}">
          <div style="${p.imageUrl ? 'position: absolute; inset: 0; background: linear-gradient(0deg, rgba(0,0,0,0.6) 0%, transparent 40%);' : ''}"></div>
          ${!p.imageUrl ? `<span>${p.emoji}</span>` : ''}
          <span class="stock-badge ${sc}">${st}</span>
        </div>
        <div class="product-card-body">
          <div class="product-card-tags">${p.tags.slice(0,2).map(t=>`<span class="product-tag">${t}</span>`).join('')}</div>
          <h3 class="product-card-name">${p.name}</h3>
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;color:var(--text-muted);font-size:13px;">
            <span style="color:#f5b301;">${this.renderStars(p.averageRating || 0, true)}</span>
            <span>${p.reviewCount ? `${p.averageRating || 0} (${p.reviewCount})` : 'No ratings yet'}</span>
          </div>
          <p class="product-card-desc">${p.description}</p>
          <div class="product-card-meta"><span>⚖️ ${p.weight}</span><span>📍 ${(p.farmOrigin||'').split(' - ')[1]||p.farmOrigin}</span></div>
          <div class="product-card-footer">
            <div class="product-card-price">₹${p.price} <small>/ ${p.unit}</small></div>
            <div id="price-hint-${p.id}" style="font-size:12px; color:var(--primary); margin-bottom:6px; font-weight:600; display:none;"></div>
            <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
              <div class="qty-picker" style="display:flex;align-items:center;border:1px solid var(--border-subtle);border-radius:8px;overflow:hidden;background:var(--bg-surface);">
                <button type="button" onclick="App.changeQty('${p.id}',-1)" style="width:30px;height:32px;border:none;background:transparent;color:var(--text);font-size:16px;cursor:pointer;font-weight:700;">−</button>
                <input type="number" id="qty-${p.id}" value="1" min="1" max="${p.stock}" data-price="${p.price}" style="width:36px;text-align:center;border:none;background:transparent;color:var(--text);font-size:14px;font-weight:600;-moz-appearance:textfield;outline:none;" onchange="App.validateQty('${p.id}',${p.stock})">
                <button type="button" onclick="App.changeQty('${p.id}',1)" style="width:30px;height:32px;border:none;background:transparent;color:var(--text);font-size:16px;cursor:pointer;font-weight:700;">+</button>
              </div>
              <button class="add-to-cart-btn btn-sm" style="flex:1;padding:8px 12px;border:none;" id="atc-${p.id}" onclick="App.addToCart('${p.id}')" ${p.stock<=0?'disabled style="opacity:.4;pointer-events:none"':''}>🛒 Add</button>

            </div>
            <button class="btn btn-outline btn-sm" style="width:100%;margin-top:6px;font-size:12px;" onclick="App.viewProductDetails('${p.id}')">View Details</button>
          </div>
        </div></div>`;
    }).join('');
  },

  async viewProductDetails(id) {
    try {
      const res = await API.request(`/products/${id}`);
      const p = res.product;
      if (!p) return;
      this.selectedProductId = p.id;
      history.replaceState({}, '', `/products/${p.slug || p.id}`);
      document.getElementById('pd-img').style.backgroundImage = `url('${p.imageUrl}')`;
      document.getElementById('pd-name').textContent = p.name;
      document.getElementById('pd-share-link').value = `${window.location.origin}/products/${p.slug || p.id}`;
      document.getElementById('pd-tags').innerHTML = p.tags.map(t=>`<span class="product-tag">${t}</span>`).join('');
      document.getElementById('pd-price').textContent = `₹${p.price} / ${p.unit}`;
      document.getElementById('pd-desc').textContent = p.description;
      document.getElementById('pd-weight').textContent = p.weight;
      document.getElementById('pd-farm').textContent = p.farmOrigin;
      document.getElementById('pd-rating-stars').textContent = this.renderStars(p.averageRating || 0, true);
      document.getElementById('pd-rating-text').textContent = p.reviewCount ? `${p.averageRating || 0} from ${p.reviewCount} review${p.reviewCount === 1 ? '' : 's'}` : 'No approved reviews yet';
      const stockBadge = document.getElementById('pd-stock');
      if (p.stock <= 0) {
        stockBadge.className = 'stock-badge out-of-stock'; stockBadge.textContent = 'Out of Stock';
        document.getElementById('pd-add-btn').disabled = true;
        document.getElementById('pd-add-btn').style.opacity = '0.4';
      } else {
        stockBadge.className = p.stock <= 20 ? 'stock-badge low-stock' : 'stock-badge in-stock';
        stockBadge.textContent = p.stock <= 20 ? `Only ${p.stock} left` : 'In Stock';
        document.getElementById('pd-add-btn').disabled = false;
        document.getElementById('pd-add-btn').style.opacity = '1';
        
        const qtyInput = document.getElementById('qty-pd');
        if (qtyInput) {
          qtyInput.value = 1;
          qtyInput.max = p.stock;
          qtyInput.dataset.price = p.price;
          qtyInput.onchange = () => App.validateQty('pd', p.stock);
          const priceHint = document.getElementById('price-hint-pd');
          if (priceHint) priceHint.style.display = 'none';
        }
        
        document.getElementById('pd-add-btn').onclick = () => { 
          const q = document.getElementById('qty-pd') ? parseInt(document.getElementById('qty-pd').value) || 1 : 1;
          App.addToCart(p.id, q); 
          App.closeModals(); 
        };
      }
      await this.loadProductReviews(p.id);
      this.showModal('product-details');
    } catch (err) { }
  },

  async openProductFromLocation() {
    const slug = window.__GVF_PRODUCT_SLUG || (window.location.pathname.startsWith('/products/') ? window.location.pathname.split('/products/')[1] : '');
    if (!slug) return;
    const matched = this.products.find(product => product.slug === slug);
    if (matched) await this.viewProductDetails(matched.id);
  },

  renderStars(rating, compact = false) {
    const rounded = compact ? Math.round(Number(rating) || 0) : Number(rating) || 0;
    return Array.from({ length: 5 }, (_, index) => index < rounded ? '★' : '☆').join('');
  },

  async loadProductReviews(productId) {
    const listEl = document.getElementById('pd-reviews-list');
    const statusEl = document.getElementById('pd-review-status');
    const eligibilityEl = document.getElementById('pd-review-eligibility');
    const formWrap = document.getElementById('pd-review-form-wrap');
    const form = document.getElementById('pd-review-form');
    const submitBtn = document.getElementById('pd-review-submit');
    const deleteBtn = document.getElementById('pd-review-delete');
    if (!listEl || !statusEl || !eligibilityEl || !formWrap || !form) return;

    listEl.innerHTML = '<p style="color:var(--text-muted);font-size:13px;">Loading reviews...</p>';
    statusEl.textContent = '';
    eligibilityEl.textContent = '';
    formWrap.style.display = 'none';
    if (deleteBtn) deleteBtn.style.display = 'none';
    if (submitBtn) submitBtn.textContent = 'Submit Review';

    try {
      const data = await API.getProductReviews(productId, this.reviewFilters);
      this.selectedProductReviewMeta = data;
      document.getElementById('pd-rating-stars').textContent = this.renderStars(data.summary.averageRating || 0, true);
      document.getElementById('pd-rating-text').textContent = data.summary.reviewCount
        ? `${data.summary.averageRating || 0} from ${data.summary.reviewCount} review${data.summary.reviewCount === 1 ? '' : 's'}`
        : 'No approved reviews yet';

      if (!data.reviews.length) {
        listEl.innerHTML = '<p style="color:var(--text-muted);font-size:13px;">Be the first customer to share feedback after delivery.</p>';
      } else {
        listEl.innerHTML = data.reviews.map(review => `
          <div style="padding:14px 0;border-top:1px solid var(--border-subtle);">
            <div style="display:flex;justify-content:space-between;gap:12px;align-items:center;margin-bottom:6px;">
              <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                <strong style="font-size:14px;">${review.userName}</strong>
                ${review.updatedAt ? `<span style="font-size:11px;color:var(--accent);background:rgba(212,167,69,0.1);border:1px solid rgba(212,167,69,0.2);padding:2px 8px;border-radius:999px;">Edited</span>` : ''}
              </div>
              <span style="font-size:12px;color:var(--text-muted);">${new Date(review.updatedAt || review.createdAt).toLocaleDateString('en-IN')}</span>
            </div>
            <div style="color:#f5b301;font-size:14px;margin-bottom:6px;">${this.renderStars(review.rating, true)}</div>
            ${review.updatedAt ? `<div style="font-size:11px;color:var(--text-muted);margin-bottom:6px;">Updated ${new Date(review.updatedAt).toLocaleString('en-IN', { day:'numeric', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' })}</div>` : ''}
            <p style="margin:0;color:var(--text-secondary);font-size:13px;line-height:1.5;">${review.comment}</p>
            ${(review.photos || []).length ? `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;">${review.photos.map(photo => `<a href="${photo.url}" target="_blank" rel="noreferrer"><img src="${photo.url}" alt="Review photo" style="width:76px;height:76px;object-fit:cover;border-radius:10px;border:1px solid var(--border-subtle);"></a>`).join('')}</div>` : ''}
          </div>
        `).join('');
      }

      const eligibility = data.eligibility;
      if (!API.getToken()) {
        eligibilityEl.innerHTML = `<button class="btn btn-outline btn-sm" onclick="App.showModal('login')">Login to review after delivery</button>`;
        return;
      }
      if (!eligibility) return;

      if (eligibility.existingReview?.status === 'pending') {
        statusEl.textContent = 'Your review is pending admin approval.';
      } else if (eligibility.existingReview?.status === 'approved') {
        statusEl.textContent = 'You have already reviewed this product. Editing it will send it back for approval.';
      } else if (eligibility.existingReview?.status === 'rejected') {
        statusEl.textContent = `Your earlier review was rejected. ${eligibility.existingReview.rejectionNote || 'You can update it and send it for approval again.'}`;
      }

      if (eligibility.eligible || eligibility.existingReview) {
        form.reset();
        if (eligibility.existingReview) {
          document.getElementById('pd-review-rating').value = eligibility.existingReview.rating;
          document.getElementById('pd-review-comment').value = eligibility.existingReview.comment || '';
          this.renderReviewPhotoPreview(eligibility.existingReview.photos || []);
          if (submitBtn) submitBtn.textContent = 'Update Review';
          if (deleteBtn) deleteBtn.style.display = 'inline-flex';
        } else {
          this.renderReviewPhotoPreview([]);
        }
        formWrap.style.display = 'block';
      } else if (eligibility.reason) {
        eligibilityEl.textContent = eligibility.reason;
      }
    } catch (err) {
      listEl.innerHTML = '<p style="color:var(--text-muted);font-size:13px;">Unable to load reviews right now.</p>';
    }
  },

  async submitProductReview(e, productId = null) {
    e.preventDefault();
    const targetProductId = productId || this.selectedProductId;
    if (!targetProductId) return;
    const btn = document.getElementById('pd-review-submit');
    const rating = parseInt(document.getElementById('pd-review-rating').value, 10);
    const comment = document.getElementById('pd-review-comment').value.trim();
    const photos = await this.collectReviewPhotos();
    const existingReview = this.selectedProductReviewMeta?.eligibility?.existingReview;
    btn.disabled = true;
    btn.textContent = existingReview ? 'Updating...' : 'Submitting...';
    try {
      if (existingReview) {
        await API.updateProductReview(targetProductId, rating, comment, photos);
        this.toast('Review updated and sent for approval', 'success');
      } else {
        await API.submitProductReview(targetProductId, rating, comment, photos);
        this.toast('Review submitted for admin approval', 'success');
      }
      await this.loadProducts();
      await this.loadProductReviews(targetProductId);
      if (this.currentPage === 'orders') await this.loadOrders();
    } catch (err) {
      this.toast(err.message || 'Unable to submit review', 'error');
    }
    btn.disabled = false;
    btn.textContent = this.selectedProductReviewMeta?.eligibility?.existingReview ? 'Update Review' : 'Submit Review';
  },

  async collectReviewPhotos() {
    const input = document.getElementById('pd-review-photos');
    if (!input) return [];
    if (!input.files?.length) {
      return this.selectedProductReviewMeta?.eligibility?.existingReview?.photos?.map(photo => photo.url) || [];
    }

    const files = Array.from(input.files).slice(0, 3);
    return Promise.all(files.map(file => new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = reject;
      reader.readAsDataURL(file);
    })));
  },

  renderReviewPhotoPreview(photos) {
    const preview = document.getElementById('pd-review-photo-preview');
    if (!preview) return;
    preview.innerHTML = (photos || []).map(photo => {
      const url = photo.url || photo;
      return `<img src="${url}" alt="Selected review photo" style="width:72px;height:72px;object-fit:cover;border-radius:10px;border:1px solid var(--border-subtle);">`;
    }).join('');
  },

  handleReviewPhotoSelection(event) {
    const files = Array.from(event.target.files || []).slice(0, 3);
    this.renderReviewPhotoPreview(files.map(file => URL.createObjectURL(file)));
  },

  setReviewSort(sort) {
    this.reviewFilters.sort = sort || 'newest';
    if (this.selectedProductId) this.loadProductReviews(this.selectedProductId);
  },

  setReviewRatingFilter(rating) {
    this.reviewFilters.rating = rating;
    if (this.selectedProductId) this.loadProductReviews(this.selectedProductId);
  },

  toggleReviewPhotoFilter(checked) {
    this.reviewFilters.withPhotos = Boolean(checked);
    if (this.selectedProductId) this.loadProductReviews(this.selectedProductId);
  },

  copyProductShareLink() {
    const input = document.getElementById('pd-share-link');
    if (!input) return;
    navigator.clipboard.writeText(input.value);
    this.toast('Product link copied', 'success');
  },

  initCookieBanner() {
    const banner = document.getElementById('cookie-banner');
    if (!banner) return;
    document.getElementById('cookie-dismiss-btn')?.addEventListener('click', () => this.dismissCookieBanner());
    document.getElementById('cookie-accept-btn')?.addEventListener('click', () => this.acceptCookieBanner());
    if (localStorage.getItem(this.cookieConsentKey)) return;
    banner.hidden = false;
  },

  hideCookieBanner() {
    const banner = document.getElementById('cookie-banner');
    if (banner) banner.hidden = true;
  },

  dismissCookieBanner() {
    localStorage.setItem(this.cookieConsentKey, 'dismissed');
    this.hideCookieBanner();
  },

  acceptCookieBanner() {
    localStorage.setItem(this.cookieConsentKey, 'accepted');
    this.hideCookieBanner();
  },

  async deleteProductReview(productId = null) {
    const targetProductId = productId || this.selectedProductId;
    if (!targetProductId) return;
    if (!confirm('Delete your review for this product?')) return;
    const btn = document.getElementById('pd-review-delete');
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Deleting...';
    }
    try {
      await API.deleteProductReview(targetProductId);
      this.toast('Review deleted', 'success');
      await this.loadProducts();
      await this.loadProductReviews(targetProductId);
      if (this.currentPage === 'orders') await this.loadOrders();
    } catch (err) {
      this.toast(err.message || 'Unable to delete review', 'error');
    }
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Delete Review';
    }
  },

  // ── Cart ──
  changeQty(id, delta) {
    const input = document.getElementById(`qty-${id}`);
    if (!input) return;
    let val = parseInt(input.value) || 1;
    const max = parseInt(input.max) || 999;
    val += delta;
    if (val < 1) val = 1;
    if (val > max) val = max;
    input.value = val;
    this.updatePriceHint(id, val, input.dataset.price);
  },

  validateQty(id, max) {
    const input = document.getElementById(`qty-${id}`);
    if (!input) return;
    let val = parseInt(input.value);
    if (isNaN(val) || val < 1) val = 1;
    if (val > max) val = max;
    input.value = val;
    this.updatePriceHint(id, val, input.dataset.price);
  },

  updatePriceHint(id, qty, unitPrice) {
    const priceHint = document.getElementById(`price-hint-${id}`);
    if (!priceHint || !unitPrice) return;
    if (qty > 1) {
      priceHint.innerHTML = `Total: ₹${(parseFloat(unitPrice) * qty).toFixed(2)}`;
      priceHint.style.display = 'block';
    } else {
      priceHint.style.display = 'none';
    }
  },

  async addToCart(productId, quantityOverride = null) {
    if (!API.getToken()) { this.showModal('login'); this.toast('Please login first', 'error'); return; }
    const btn = document.getElementById(`atc-${productId}`);
    const qtyInput = document.getElementById(`qty-${productId}`);
    const quantity = quantityOverride || (qtyInput ? parseInt(qtyInput.value) || 1 : 1);
    try {
      await API.addToCart(productId, quantity);
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

    const payload = {
      name: document.getElementById('customer-name').value,
      phone: document.getElementById('customer-phone').value,
      address: document.getElementById('customer-address').value,
      paymentMethod
    };
    
    const btn = document.getElementById('place-order-btn');
    btn.disabled = true; btn.innerHTML = '⏳ Processing...';
    try {
      if (paymentMethod === 'ONLINE') {
        const cartData = await API.getCart();
        const totalPrice = cartData.cart.totalPrice;
        if (totalPrice < 1) {
            this.toast('Order amount is too small for online payment.', 'error');
            btn.disabled = false; btn.innerHTML = '✓ Place Order';
            return;
        }

        const orderData = await API.createPaymentOrder(Math.round(totalPrice * 100));
        
        const options = {
          key: this.razorpayKeyId,
          amount: orderData.amount,
          currency: orderData.currency,
          name: 'Green Valley Poultry Farm',
          description: 'Payment for your order',
          order_id: orderData.order_id,
          handler: async (response) => {
            try {
              const verifyRes = await API.verifyPayment({
                razorpay_order_id: response.razorpay_order_id,
                razorpay_payment_id: response.razorpay_payment_id,
                razorpay_signature: response.razorpay_signature,
                orderDetails: payload
              });
              this.updateCartBadge();
              this.renderOrderSuccess(verifyRes.order);
              document.getElementById('checkout-form').reset();
              this.toast('Order placed & Paid successfully!', 'success');
              btn.disabled = false; btn.innerHTML = '✓ Place Order';
            } catch (err) {
              this.toast(err.message || 'Payment verification failed', 'error');
              btn.disabled = false; btn.innerHTML = '✓ Place Order';
            }
          },
          prefill: {
            name: payload.name,
            contact: payload.phone
          },
          theme: { color: '#2ecc71' },
          modal: {
            ondismiss: () => {
              this.toast('Payment cancelled', 'error');
              btn.disabled = false; btn.innerHTML = '✓ Place Order';
            }
          }
        };
        const rzp = new Razorpay(options);
        rzp.on('payment.failed', (response) => {
          this.toast(response.error.description || 'Payment Failed', 'error');
        });
        rzp.open();
      } else {
        const data = await API.placeOrder(payload);
        this.updateCartBadge();
        this.renderOrderSuccess(data.order);
        document.getElementById('checkout-form').reset();
        this.toast('Order placed!', 'success');
        btn.disabled = false; btn.innerHTML = '✓ Place Order';
      }
    } catch (err) {
      this.toast(err.message, 'error');
      btn.disabled = false; btn.innerHTML = '✓ Place Order';
    }
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
        <div class="order-detail-row"><span>Payment</span><span>${order.paymentMethod === 'COD' ? 'Cash on Delivery' : order.paymentMethod}</span></div>
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
      el.innerHTML = data.orders.map(o => {
        const canCancel = this.canCancelOrder(o);
        const deadlineText = o.cancelDeadline ? new Date(o.cancelDeadline).toLocaleString('en-IN', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' }) : '';
        return `
        <div class="order-card">
          <div class="order-card-header">
            <div><span class="order-card-id">${o.orderId}</span><div class="order-date">Placed ${new Date(o.placedAt).toLocaleString('en-IN',{day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'})}</div></div>
            <span class="order-status ${this.orderStatusClass(o.status)}">${this.formatOrderStatus(o.status)}</span>
          </div>
          <div class="order-progress">${this.renderOrderSteps(o.status)}</div>
          <div class="order-card-items">${o.items.map(i => `<div class="order-card-item"><span>${i.emoji} ${i.name} × ${i.quantity}</span><span>₹${i.subtotal}</span></div>`).join('')}</div>
          ${o.status === 'delivered' ? `
            <div style="display:flex;gap:8px;flex-wrap:wrap;margin:12px 0 6px;">
              ${o.items.map(i => `<button class="btn btn-outline btn-sm" onclick="App.viewProductDetails('${i.productId}')">Review ${i.name}</button>`).join('')}
            </div>
          ` : ''}
          <div class="order-policy ${canCancel ? 'active' : ''}">${canCancel ? `Cancellation available until ${deadlineText}` : this.getOrderPolicyText(o)}</div>
          <div class="order-card-footer"><span style="color:var(--text-muted);font-size:13px">Payment: ${o.paymentMethod || 'COD'}</span><span class="order-card-total">₹${o.totalPrice}</span></div>
          <div class="order-card-actions">${canCancel ? `<button class="btn btn-danger btn-sm" onclick="App.cancelOrder('${o.orderId}')">Cancel Order</button>` : ''}</div>
        </div>`;
      }).join('');
    } catch (err) { this.toast('Failed to load orders', 'error'); }
  },

  // Order helpers
  formatOrderStatus(status) {
    const labels = {
      confirmed: 'Confirmed',
      processing: 'Processing',
      dispatched: 'Dispatched',
      delivered: 'Delivered',
      cancelled: 'Cancelled'
    };
    return labels[status] || status || 'Confirmed';
  },

  orderStatusClass(status) {
    return `status-${(status || 'confirmed').toLowerCase()}`;
  },

  canCancelOrder(order) {
    if (!order?.canCancel || !order.cancelDeadline) return false;
    return Date.now() <= new Date(order.cancelDeadline).getTime();
  },

  getOrderPolicyText(order) {
    if (order.status === 'cancelled') return 'This order has been cancelled.';
    if (['dispatched', 'delivered'].includes(order.status)) return 'Cancellation is closed after dispatch.';
    if (order.cancelDeadline) {
      return `Cancellation window ended ${new Date(order.cancelDeadline).toLocaleString('en-IN', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' })}.`;
    }
    return 'Cancellation is not available for this order.';
  },

  renderOrderSteps(status) {
    const steps = ['confirmed', 'processing', 'dispatched', 'delivered'];
    if (status === 'cancelled') {
      return '<span class="order-step done">Confirmed</span><span class="order-step cancelled">Cancelled</span>';
    }
    const activeIndex = Math.max(0, steps.indexOf(status));
    return steps.map((step, index) => `<span class="order-step ${index <= activeIndex ? 'done' : ''}">${this.formatOrderStatus(step)}</span>`).join('');
  },

  async cancelOrder(orderId) {
    if (!confirm('Cancel this order? This can only be done within 2 hours of placing it.')) return;
    try {
      await API.cancelOrder(orderId);
      this.toast('Order cancelled successfully', 'success');
      this.loadOrders();
    } catch (err) {
      this.toast(err.message || 'Unable to cancel order', 'error');
    }
  },

  // About
  async loadAbout() {
    try {
      const data = await API.getFarmInfo(); const f = data.farm;
      document.getElementById('about-content').innerHTML = `
        <p style="font-size:17px;color:var(--text-secondary);line-height:1.8;margin-bottom:32px">${f.description}</p>
        
        <!-- Video Showcase -->
        <div class="farm-video-wrapper">
          <div class="farm-video-container">
            <video id="farm-video-about" autoplay muted loop controls playsinline poster="/myImage/InShot_20260407_084631044.jpg.jpeg">
              <source src="/myImage/InShot_20260407_085446488.mp4" type="video/mp4">
              Your browser does not support the video tag.
            </video>
            <div class="farm-video-overlay" style="pointer-events:none;">
              <span class="farm-video-badge">🎬 Live from our farm</span>
            </div>
          </div>
        </div>

        <!-- Photo Gallery -->
        <h3 style="margin-top:40px; margin-bottom:20px; font-family:'Playfair Display', serif; font-size:24px;">Life at <span class="text-accent">Our Farm</span></h3>
        <div class="farm-photo-grid">
          <div class="farm-photo-item farm-photo-large">
            <img src="/myImage/InShot_20260407_084631044.jpg.jpeg" alt="Panoramic green valley view of our farm" loading="lazy">
            <div class="farm-photo-caption">Our Farm's Green Valley</div>
          </div>
          <div class="farm-photo-item">
            <img src="/myImage/InShot_20260407_084700576.jpg.jpeg" alt="Baby chick held gently in hand" loading="lazy">
            <div class="farm-photo-caption">Raised with Care</div>
          </div>
          <div class="farm-photo-item">
            <img src="/myImage/InShot_20260407_084008098.jpg.jpeg" alt="Healthy baby chick close-up" loading="lazy">
            <div class="farm-photo-caption">Healthy Chicks</div>
          </div>
          <div class="farm-photo-item farm-photo-wide">
            <img src="/myImage/InShot_20260407_084027529.jpg.jpeg" alt="Inside our warm poultry house" loading="lazy">
            <div class="farm-photo-caption">Our Warm Poultry House</div>
          </div>
          <div class="farm-photo-item">
            <img src="/myImage/InShot_20260407_084730614.jpg.jpeg" alt="Chicks feeding naturally" loading="lazy">
            <div class="farm-photo-caption">Natural Feeding</div>
          </div>
          <div class="farm-photo-item">
            <img src="/myImage/InShot_20260407_084259574.jpg.jpeg" alt="Chicks under heat lamp" loading="lazy">
            <div class="farm-photo-caption">Brooding Area</div>
          </div>
          <div class="farm-photo-item">
            <img src="/myImage/InShot_20260407_084823526.jpg.jpeg" alt="Farm poultry house exterior" loading="lazy">
            <div class="farm-photo-caption">Our Farm House</div>
          </div>
          <div class="farm-photo-item">
            <img src="/myImage/InShot_20260407_085003082.jpg.jpeg" alt="Farm equipment and supplies collage" loading="lazy">
            <div class="farm-photo-caption">Quality Equipment</div>
          </div>
        </div>

        <h3 style="margin-top:60px; margin-bottom:20px; font-family:'Playfair Display', serif; font-size:24px;">Farm <span class="text-accent">Details</span></h3>
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

window.App = App;
document.addEventListener('DOMContentLoaded', () => App.init());

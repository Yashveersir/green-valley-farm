// ═══════════════════════════════════════
// Admin Application — Green Valley
// ═══════════════════════════════════════

const AdminApp = {
  currentTab: 'dashboard',
  products: [],
  orders: [],
  reviews: [],
  coupons: [],
  customers: [],
  reviewAnalytics: null,
  reviewFilters: { status: 'pending', sort: 'newest', rating: '', search: '' },
  notifications: [],
  notifsInterval: null,

  async init() {
    this.bindEvents();
    if (this.checkAuth()) {
      await this.loadInitialData();
      this.startNotifPolling();
    }
  },

  // ── Auth ──
  checkAuth() {
    const user = API.getUser();
    if (!user || user.role !== 'admin') {
      document.getElementById('admin-login-screen').style.display = 'flex';
      return false;
    }
    document.getElementById('admin-login-screen').style.display = 'none';
    this.updateSidebar(user);
    return true;
  },

  async handleLogin(e) {
    e.preventDefault();
    const btn = document.getElementById('login-btn');
    btn.disabled = true; btn.textContent = 'Authenticating...';
    try {
      const email = document.getElementById('admin-email').value;
      const pwd = document.getElementById('admin-password').value;
      const res = await API.login(email, pwd);
      if (res.user.role !== 'admin') throw new Error('Not an admin account');
      
      document.getElementById('admin-login-screen').style.display = 'none';
      this.updateSidebar(res.user);
      this.toast('Admin login successful');
      await this.loadInitialData();
      this.startNotifPolling();
    } catch (err) {
      this.toast(err.message || 'Login failed', 'error');
      API.clearToken();
    }
    btn.disabled = false; btn.textContent = 'Login to Dashboard';
  },

  switchLoginTab(tab) {
    const isPass = tab === 'password';
    document.getElementById('admin-pass-form').style.display = isPass ? 'block' : 'none';
    document.getElementById('admin-otp-form').style.display = isPass ? 'none' : 'block';
    document.getElementById('admin-otp-verify-form').style.display = 'none';
    document.getElementById('tab-pass').style.cssText = isPass
      ? 'background:var(--accent);color:#000;font-weight:600;'
      : 'background:var(--bg-surface);color:var(--text);';
    document.getElementById('tab-otp').style.cssText = isPass
      ? 'background:var(--bg-surface);color:var(--text);'
      : 'background:var(--accent);color:#000;font-weight:600;';
  },

  async handleAdminOtpSend(e) {
    e.preventDefault();
    const btn = document.getElementById('admin-otp-btn');
    btn.disabled = true; btn.textContent = 'Sending...';
    try {
      const email = document.getElementById('admin-otp-email').value.trim();
      const data = await API.request('/auth/send-otp', {
        method: 'POST', body: JSON.stringify({ email, action: 'login' })
      });
      if (data.otpToken) sessionStorage.setItem('gvf_otpToken', data.otpToken);
      document.getElementById('admin-otp-form').style.display = 'none';
      document.getElementById('admin-otp-verify-form').style.display = 'block';
      this.toast('OTP sent to your email!');
    } catch (err) {
      this.toast(err.message || 'Failed to send OTP', 'error');
    }
    btn.disabled = false; btn.textContent = 'Send OTP to Email';
  },

  async handleAdminOtpVerify(e) {
    e.preventDefault();
    const btn = document.getElementById('admin-verify-btn');
    btn.disabled = true; btn.textContent = 'Verifying...';
    try {
      const email = document.getElementById('admin-otp-email').value.trim();
      const otp = document.getElementById('admin-otp-code').value.trim();
      const res = await API.verifyOtp(email, otp);
      if (!res.user || res.user.role !== 'admin') throw new Error('OTP verified, but this is not an admin account');
      document.getElementById('admin-login-screen').style.display = 'none';
      this.updateSidebar(res.user);
      this.toast('Admin OTP login successful!');
      await this.loadInitialData();
      this.startNotifPolling();
    } catch (err) {
      this.toast(err.message || 'Verification failed', 'error');
      API.clearToken();
    }
    btn.disabled = false; btn.textContent = 'Verify & Login';
  },

  async logout() {
    await API.logout();
    if (this.notifsInterval) clearInterval(this.notifsInterval);
    window.location.reload();
  },

  updateSidebar(user) {
    if (!user) return;
    const initial = (user.name || 'A').charAt(0).toUpperCase();
    const nameEl = document.getElementById('sidebar-admin-name');
    const emailEl = document.getElementById('sidebar-admin-email');
    const avatarEl = document.getElementById('sidebar-admin-avatar');
    if (nameEl) nameEl.textContent = user.name || 'Admin';
    if (emailEl) emailEl.textContent = user.email || '';
    if (avatarEl) avatarEl.textContent = initial;
  },

  openProfileModal() {
    const user = API.getUser();
    if (!user) return;
    const emailEl = document.getElementById('ap-email');
    if (emailEl) emailEl.value = user.email || '';
    document.getElementById('ap-name').value = user.name || '';
    document.getElementById('ap-phone').value = user.phone || '';
    document.getElementById('ap-password').value = '';
    document.getElementById('modal-admin-profile').style.display = 'flex';
  },

  async saveProfile(e) {
    e.preventDefault();
    const btn = e.target.querySelector('button[type="submit"]') || document.getElementById('ap-submit');
    if (btn) { btn.disabled = true; btn.textContent = 'Saving...'; }
    const name = document.getElementById('ap-name').value.trim();
    const phone = (document.getElementById('ap-phone')?.value || '').trim();
    const newPassword = document.getElementById('ap-password').value.trim();
    try {
      const bodyParams = { name, phone };
      if (newPassword) {
        if (newPassword.length < 8) { this.toast('Password must be at least 8 characters', 'error'); if (btn) { btn.disabled = false; btn.textContent = 'Save Changes'; } return; }
        bodyParams.newPassword = newPassword;
      }
      const res = await API.request('/auth/profile', { method: 'PUT', body: JSON.stringify(bodyParams) });
      API.setUser(res.user);
      this.updateSidebar(res.user);
      document.getElementById('modal-admin-profile').style.display = 'none';
      this.toast('Profile updated successfully!');
    } catch (err) {
      this.toast(err.message || 'Failed to update profile', 'error');
    }
    if (btn) { btn.disabled = false; btn.textContent = 'Save Changes'; }
  },

  // ── Navigation ──
  navigate(tab) {
    document.querySelectorAll('.admin-content').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
    
    document.getElementById(`tab-${tab}`).classList.add('active');
    document.querySelector(`.nav-item[data-tab="${tab}"]`).classList.add('active');
    
    const titles = { dashboard: 'Dashboard', products: 'Product Catalog', orders: 'Order Management', coupons: 'Coupon Management', reviews: 'Review Moderation', customers: 'Customer Database', admins: 'Admin Management' };
    document.getElementById('page-title').textContent = titles[tab];
    this.currentTab = tab;
    
    if (tab === 'products') this.renderProducts();
    if (tab === 'orders') this.renderOrders();
    if (tab === 'coupons') this.renderCoupons();
    if (tab === 'reviews') this.renderReviews();
    if (tab === 'customers') this.renderCustomers();
    if (tab === 'admins') this.loadAdmins();
  },

  // ── Data Loading & Dashboard ──
  async loadInitialData() {
    try {
      const { stats, reviewAnalytics } = await API.request('/admin/dashboard');
      this.reviewAnalytics = reviewAnalytics;
      document.getElementById('stat-revenue').textContent = `₹${stats.totalRevenue.toLocaleString()}`;
      document.getElementById('stat-orders').textContent = stats.totalOrders;
      document.getElementById('stat-today').textContent = stats.todayOrders;
      document.getElementById('stat-customers').textContent = stats.totalCustomers;
      document.getElementById('stat-pending-reviews').textContent = stats.pendingReviews || 0;
      const avgRating = document.getElementById('stat-review-rating');
      if (avgRating) avgRating.textContent = stats.avgReviewRating || 0;
      const dashboardPending = document.getElementById('dashboard-pending-reviews');
      if (dashboardPending) dashboardPending.textContent = stats.pendingReviews || 0;
      
      const pRes = await API.getProducts();
      this.products = pRes.products;
      
      const oRes = await API.request('/admin/orders');
      this.orders = oRes.orders.sort((a,b) => new Date(b.placedAt) - new Date(a.placedAt));

      const reviewRes = await API.getPendingReviews(this.reviewFilters);
      this.reviews = reviewRes.reviews;
      this.reviewAnalytics = reviewRes.analytics || reviewAnalytics;
      
      this.renderDashboard();
      this.loadCoupons();
      this.loadCustomers();
      this.loadNotifications();
    } catch (err) {
      this.toast('Failed to load dashboard data', 'error');
    }
  },

  renderDashboard() {
    // Recent Orders
    const recent = this.orders.slice(0, 5);
    document.getElementById('recent-orders-body').innerHTML = recent.map(o => {
      const pm = o.paymentMethod || 'COD';
      const isOnline = pm === 'Razorpay Online';
      const pmLabel = isOnline ? '💳 Online' : (pm === 'UPI' ? '📱 UPI' : '💵 COD');
      const pmColor = isOnline ? '#4ade80' : (pm === 'UPI' ? '#60a5fa' : 'var(--text-muted)');
      return `
      <tr>
        <td><strong>${o.orderId}</strong></td>
        <td>${o.customer.name}</td>
        <td>${new Date(o.placedAt).toLocaleDateString()}</td>
        <td>₹${o.totalPrice}</td>
        <td><span style="color:${pmColor};font-weight:600;font-size:12px;">${pmLabel}</span></td>
        <td><span class="order-status" style="border: 1px solid rgba(255,255,255,0.1); padding:4px 10px; border-radius:12px; font-size:12px;">${o.status}</span></td>
      </tr>
    `}).join('');
    
    if (!recent.length) document.getElementById('recent-orders-body').innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text-muted)">No orders yet</td></tr>';

    // Low stock
    const low = this.products.filter(p => p.stock <= 10).sort((a,b) => a.stock - b.stock).slice(0, 5);
    document.getElementById('low-stock-body').innerHTML = low.map(p => `
      <tr>
        <td>${p.emoji} ${p.name}</td>
        <td style="text-transform:capitalize">${p.category.replace('-',' ')}</td>
        <td><span style="color:${p.stock===0?'var(--danger)':'var(--accent)'};font-weight:bold">${p.stock}</span></td>
        <td><button class="btn btn-outline btn-sm" onclick="AdminApp.editProduct('${p.id}')">Update</button></td>
      </tr>
    `).join('');
    
    if (!low.length) document.getElementById('low-stock-body').innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--text-muted)">Stock levels are good</td></tr>';

    const analyticsEl = document.getElementById('review-analytics-summary');
    if (analyticsEl && this.reviewAnalytics) {
      analyticsEl.innerHTML = `
        <strong>${this.reviewAnalytics.totals.total}</strong> reviews total,
        <strong>${this.reviewAnalytics.byStatus.pending || 0}</strong> pending,
        <strong>${this.reviewAnalytics.byStatus.rejected || 0}</strong> rejected,
        <strong>${this.reviewAnalytics.totals.withPhotos || 0}</strong> with photos.
      `;
    }
  },

  // ── Products ──
  renderProducts() {
    const tbody = document.getElementById('products-table-body');
    tbody.innerHTML = this.products.map(p => `
      <tr>
        <td><div style="display:flex;align-items:center;gap:12px"><span style="font-size:24px">${p.emoji}</span> <strong>${p.name}</strong></div></td>
        <td style="text-transform:capitalize">${p.category.replace('-',' ')}</td>
        <td>₹${p.price} <small style="color:var(--text-muted)">/${p.unit}</small></td>
        <td><span style="color:${p.stock<=10?'var(--accent)':'var(--text)'}">${p.stock}</span></td>
        <td>${p.reviewCount || 0}</td>
        <td>${p.reviewCount ? `${p.averageRating || 0} ★` : '—'}</td>
        <td>
          <button class="action-btn edit" onclick="AdminApp.editProduct('${p.id}')" title="Edit">✎</button>
          <button class="action-btn delete" onclick="AdminApp.deleteProduct('${p.id}')" title="Delete">✕</button>
        </td>
      </tr>
    `).join('');
  },

  openProductModal() {
    document.getElementById('product-form').reset();
    document.getElementById('p-id').value = '';
    document.getElementById('pm-title').textContent = 'Add Product';
    document.getElementById('modal-product').style.display = 'flex';
  },

  editProduct(id) {
    const p = this.products.find(p => p.id === id);
    if (!p) return;
    document.getElementById('p-id').value = p.id;
    document.getElementById('p-name').value = p.name;
    document.getElementById('p-category').value = p.category;
    document.getElementById('p-emoji').value = p.emoji;
    document.getElementById('p-price').value = p.price;
    document.getElementById('p-stock').value = p.stock;
    document.getElementById('p-unit').value = p.unit;
    document.getElementById('p-weight').value = p.weight;
    document.getElementById('p-tags').value = p.tags.join(', ');
    document.getElementById('p-desc').value = p.description;
    
    document.getElementById('pm-title').textContent = 'Edit Product';
    document.getElementById('modal-product').style.display = 'flex';
  },

  async saveProduct(e) {
    e.preventDefault();
    const btn = document.getElementById('p-submit');
    btn.disabled = true; btn.textContent = 'Saving...';
    
    const id = document.getElementById('p-id').value;
    const data = {
      name: document.getElementById('p-name').value,
      category: document.getElementById('p-category').value,
      emoji: document.getElementById('p-emoji').value,
      price: document.getElementById('p-price').value,
      stock: document.getElementById('p-stock').value,
      unit: document.getElementById('p-unit').value,
      weight: document.getElementById('p-weight').value,
      tags: document.getElementById('p-tags').value.split(',').map(t=>t.trim()).filter(Boolean),
      description: document.getElementById('p-desc').value
    };

    try {
      if (id) {
        await API.request(`/products/${id}`, { method: 'PUT', body: JSON.stringify(data) });
        this.toast('Product updated');
      } else {
        await API.request('/products', { method: 'POST', body: JSON.stringify(data) });
        this.toast('Product added');
      }
      document.getElementById('modal-product').style.display = 'none';
      await this.loadInitialData(); // reload everything
      if (this.currentTab === 'products') this.renderProducts();
    } catch (err) {
      this.toast(err.message, 'error');
    }
    btn.disabled = false; btn.textContent = 'Save Product';
  },

  async deleteProduct(id) {
    const confirmed = await this.confirmModal({
      title: 'Delete Product',
      message: 'Are you sure you want to delete this product? It will be removed from the store catalog.',
      confirmText: 'Yes, Delete Product'
    });
    if (!confirmed) return;
    try {
      await API.request(`/products/${id}`, { method: 'DELETE' });
      this.toast('Product deleted');
      await this.loadInitialData();
      this.renderProducts();
    } catch (err) { this.toast(err.message, 'error'); }
  },

  // ── Customers ──
  async loadCustomers() {
    try {
      const res = await API.request('/admin/customers');
      this.customers = res.customers || [];
      if (this.currentTab === 'customers') this.renderCustomers();
    } catch (err) {
      this.toast('Failed to load customers', 'error');
    }
  },

  renderCustomers() {
    const tbody = document.getElementById('customers-table-body');
    if (!tbody) return;
    if (!this.customers.length) {
      tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--text-muted);padding:40px;">No customers found.</td></tr>';
      return;
    }
    tbody.innerHTML = this.customers.map(c => `
      <tr>
        <td><strong>${c.name}</strong></td>
        <td>${c.email}</td>
        <td>${c.phone || '—'}</td>
        <td>${c.createdAt ? new Date(c.createdAt).toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric' }) : '—'}</td>
      </tr>
    `).join('');
  },

  // ── Coupons ──
  async loadCoupons() {
    try {
      const res = await API.request('/admin/coupons');
      this.coupons = res.coupons || [];
      if (this.currentTab === 'coupons') this.renderCoupons();
    } catch (err) {
      this.toast('Failed to load coupons', 'error');
    }
  },

  renderCoupons() {
    const tbody = document.getElementById('coupons-table-body');
    if (!tbody) return;
    if (!this.coupons.length) {
      tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--text-muted);padding:40px;">No coupons yet. Click "+ Create Coupon" to get started.</td></tr>';
      return;
    }
    tbody.innerHTML = this.coupons.map(c => {
      const isExpired = c.expiresAt && new Date(c.expiresAt) < new Date();
      const statusColor = !c.active ? 'var(--text-muted)' : isExpired ? 'var(--danger)' : 'var(--success)';
      const statusLabel = !c.active ? 'Inactive' : isExpired ? 'Expired' : 'Active';
      const usageText = c.maxUses ? `${c.usedCount || 0} / ${c.maxUses}` : `${c.usedCount || 0} / ∞`;
      const expiryText = c.expiresAt ? new Date(c.expiresAt).toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric' }) : 'Never';
      return `
      <tr>
        <td><strong style="letter-spacing:1px;color:var(--accent);">${c.code}</strong></td>
        <td style="text-transform:capitalize;">${c.type}</td>
        <td><strong>${c.type === 'percentage' ? c.value + '%' : '₹' + c.value}</strong></td>
        <td>${c.minOrderAmount ? '₹' + c.minOrderAmount : '—'}</td>
        <td>${usageText}<br><small style="color:var(--text-muted);">Per user: ${c.perUserLimit || '∞'}</small></td>
        <td>${expiryText}</td>
        <td><span style="color:${statusColor};font-weight:600;font-size:12px;">${statusLabel}</span></td>
        <td style="display:flex;gap:8px;flex-wrap:wrap;">
          <button class="btn btn-outline btn-sm" onclick="AdminApp.editCoupon('${c.id || c._id}')" title="Edit">✎ Edit</button>
          <button class="btn btn-outline btn-sm" style="color:${c.active ? 'var(--text-muted)' : 'var(--success)'};" onclick="AdminApp.toggleCoupon('${c.id || c._id}', ${!c.active})">${c.active ? '⏸ Disable' : '▶ Enable'}</button>
          <button class="btn btn-outline btn-sm" style="color:var(--danger);" onclick="AdminApp.deleteCoupon('${c.id || c._id}')" title="Delete">✕</button>
        </td>
      </tr>`;
    }).join('');
  },

  openCouponModal() {
    document.getElementById('coupon-form').reset();
    document.getElementById('c-id').value = '';
    document.getElementById('c-active').checked = true;
    document.getElementById('cm-title').textContent = 'Create Coupon';
    document.getElementById('modal-coupon').style.display = 'flex';
  },

  editCoupon(id) {
    const c = this.coupons.find(x => (x.id || x._id) === id);
    if (!c) return;
    document.getElementById('c-id').value = id;
    document.getElementById('c-code').value = c.code;
    document.getElementById('c-type').value = c.type;
    document.getElementById('c-value').value = c.value;
    document.getElementById('c-min-order').value = c.minOrderAmount || 0;
    document.getElementById('c-max-uses').value = c.maxUses || 0;
    document.getElementById('c-per-user').value = c.perUserLimit || 1;
    document.getElementById('c-expiry').value = c.expiresAt ? new Date(c.expiresAt).toISOString().split('T')[0] : '';
    document.getElementById('c-active').checked = c.active !== false;
    document.getElementById('cm-title').textContent = 'Edit Coupon';
    document.getElementById('modal-coupon').style.display = 'flex';
  },

  async saveCoupon(e) {
    e.preventDefault();
    const btn = document.getElementById('c-submit');
    btn.disabled = true; btn.textContent = 'Saving...';
    const id = document.getElementById('c-id').value;
    const data = {
      code: document.getElementById('c-code').value.toUpperCase().trim(),
      type: document.getElementById('c-type').value,
      value: Number(document.getElementById('c-value').value),
      minOrderAmount: Number(document.getElementById('c-min-order').value) || 0,
      maxUses: Number(document.getElementById('c-max-uses').value) || 0,
      perUserLimit: Number(document.getElementById('c-per-user').value) || 1,
      expiresAt: document.getElementById('c-expiry').value || null,
      active: document.getElementById('c-active').checked
    };
    try {
      if (id) {
        await API.request(`/admin/coupons/${id}`, { method: 'PUT', body: JSON.stringify(data) });
        this.toast('Coupon updated');
      } else {
        await API.request('/admin/coupons', { method: 'POST', body: JSON.stringify(data) });
        this.toast('Coupon created');
      }
      document.getElementById('modal-coupon').style.display = 'none';
      await this.loadCoupons();
    } catch (err) {
      this.toast(err.message || 'Failed to save coupon', 'error');
    }
    btn.disabled = false; btn.textContent = 'Save Coupon';
  },

  async toggleCoupon(id, active) {
    try {
      await API.request(`/admin/coupons/${id}`, { method: 'PUT', body: JSON.stringify({ active }) });
      this.toast(active ? 'Coupon enabled' : 'Coupon disabled');
      await this.loadCoupons();
    } catch (err) { this.toast(err.message, 'error'); }
  },

  async deleteCoupon(id) {
    const confirmed = await this.confirmModal({
      title: 'Delete Coupon',
      message: 'Are you sure you want to delete this coupon code? It will be permanently removed.',
      confirmText: 'Yes, Delete Coupon'
    });
    if (!confirmed) return;
    try {
      await API.request(`/admin/coupons/${id}`, { method: 'DELETE' });
      this.toast('Coupon deleted');
      await this.loadCoupons();
    } catch (err) { this.toast(err.message, 'error'); }
  },

  // ── Orders ──
  renderOrders() {
    const tbody = document.getElementById('orders-table-body');
    tbody.innerHTML = this.orders.map(o => {
      const pm = o.paymentMethod || 'COD';
      const isOnline = pm === 'Razorpay Online';
      const pmIcon = isOnline ? '💳' : (pm === 'UPI' ? '📱' : '💵');
      const pmLabel = isOnline ? 'Razorpay Online' : pm;
      const pmColor = isOnline ? '#4ade80' : (pm === 'UPI' ? '#60a5fa' : 'var(--text-muted)');
      const verified = o.razorpayPaymentId ? '✅ Verified' : (isOnline ? '⏳ Pending' : '—');
      const verifiedColor = o.razorpayPaymentId ? '#4ade80' : '#f59e0b';
      const rpayId = o.razorpayPaymentId || '';
      return `
      <tr>
        <td><strong>${o.orderId}</strong><br><small style="color:var(--text-muted)">${o.items.length} items</small></td>
        <td>${o.customer.name}<br><small style="color:var(--text-muted)">${o.customer.phone}</small></td>
        <td>${new Date(o.placedAt).toLocaleString('en-IN', {day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})}</td>
        <td>
          <strong>₹${o.totalPrice}</strong><br>
          <span style="color:${pmColor};font-weight:600;font-size:12px;">${pmIcon} ${pmLabel}</span>
        </td>
        <td>
          <span style="color:${verifiedColor};font-size:12px;font-weight:600;">${verified}</span>
          ${rpayId ? `<br><small style="color:var(--text-muted);font-size:10px;cursor:pointer;" title="${rpayId}" onclick="navigator.clipboard.writeText('${rpayId}');AdminApp.toast('Payment ID copied!');">ID: ${rpayId.substring(0,14)}...</small>` : ''}
        </td>
        <td>
          <select class="status-select" onchange="AdminApp.updateOrderStatus('${o.orderId}', this.value)" style="background:var(--bg-surface);color:var(--text);border:1px solid var(--border-subtle);padding:6px;border-radius:4px;">
            <option value="confirmed" ${o.status==='confirmed'?'selected':''}>Confirmed</option>
            <option value="processing" ${o.status==='processing'?'selected':''}>Processing</option>
            <option value="dispatched" ${o.status==='dispatched'?'selected':''}>Dispatched</option>
            <option value="delivered" ${o.status==='delivered'?'selected':''}>Delivered</option>
            <option value="cancelled" ${o.status==='cancelled'?'selected':''}>Cancelled</option>
          </select>
        </td>
        <td style="display:flex;gap:8px;flex-wrap:wrap;">
          <button class="btn btn-outline btn-sm" onclick="AdminApp.showOrderDetails('${o.orderId}')">Details</button>
          ${pm === 'UPI' && o.upiScreenshot ? `<button class="btn btn-outline btn-sm" style="color:var(--accent);border-color:var(--accent);" onclick="window.open('${o.upiScreenshot}','_blank')">View SS</button>` : ''}
        </td>
      </tr>
    `}).join('');
  },

  showOrderDetails(orderId) {
    const o = this.orders.find(x => x.orderId === orderId);
    if (!o) return;
    const pm = o.paymentMethod || 'COD';
    const isOnline = pm === 'Razorpay Online';
    const itemsList = o.items.map(i => `• ${i.name} × ${i.quantity} = ₹${i.price * i.quantity}`).join('\n');
    let paymentInfo = `\n━━ Payment Info ━━\nMethod: ${pm}`;
    if (isOnline) {
      paymentInfo += `\nRazorpay Order ID: ${o.razorpayOrderId || 'N/A'}`;
      paymentInfo += `\nRazorpay Payment ID: ${o.razorpayPaymentId || 'N/A'}`;
      paymentInfo += `\nPayment Status: ${o.razorpayPaymentId ? '✅ Verified & Captured' : '⏳ Pending'}`;
    }
    alert(`📦 Order: ${o.orderId}\n\n━━ Customer ━━\nName: ${o.customer.name}\nPhone: ${o.customer.phone}\nAddress: ${o.customer.address}\n\n━━ Items ━━\n${itemsList}\n\nTotal: ₹${o.totalPrice}${paymentInfo}\n\n━━ Status ━━\n${o.status.toUpperCase()}\nPlaced: ${new Date(o.placedAt).toLocaleString('en-IN')}`);
  },

  async updateOrderStatus(id, status) {
    try {
      await API.request(`/admin/orders/${id}/status`, { method: 'PUT', body: JSON.stringify({ status }) });
      this.toast('Order status updated');
      const o = this.orders.find(o => o.orderId === id);
      if (o) o.status = status;
      await this.loadInitialData();
      if (this.currentTab === 'orders') this.renderOrders();
    } catch (err) { this.toast(err.message, 'error'); }
  },

  // ── Reviews ──
  renderStars(rating) {
    return Array.from({ length: 5 }, (_, index) => index < Number(rating || 0) ? '★' : '☆').join('');
  },

  renderReviews() {
    const tbody = document.getElementById('reviews-table-body');
    if (!tbody) return;
    if (!this.reviews.length) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text-muted)">No reviews match these filters</td></tr>';
      return;
    }

    tbody.innerHTML = this.reviews.map(review => `
      <tr>
        <td><strong>${review.productName}</strong><br><small style="color:var(--text-muted)">${review.productId}</small></td>
        <td>${review.userName}${review.updatedAt ? `<br><small style="color:var(--accent);font-weight:600;">Edited submission</small>` : ''}<br><small style="color:var(--text-muted)">${review.orderId || 'No order ref'}</small></td>
        <td style="color:#f5b301;font-size:14px;">${this.renderStars(review.rating)}</td>
        <td style="max-width:320px;white-space:normal;color:var(--text-secondary);">${review.comment}${review.rejectionNote ? `<div style="margin-top:8px;color:#fda4af;font-size:12px;"><strong>Rejection note:</strong> ${review.rejectionNote}</div>` : ''}${(review.photos || []).length ? `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;">${review.photos.map(photo => `<a href="${photo.url}" target="_blank" rel="noreferrer"><img src="${photo.url}" alt="Review photo" style="width:56px;height:56px;object-fit:cover;border-radius:8px;border:1px solid var(--border-subtle);"></a>`).join('')}</div>` : ''}</td>
        <td>${new Date(review.createdAt).toLocaleString('en-IN', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' })}${review.updatedAt ? `<br><small style="color:var(--text-muted)">Updated ${new Date(review.updatedAt).toLocaleString('en-IN', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' })}</small>` : ''}</td>
        <td><span class="order-status" style="border:1px solid rgba(255,255,255,0.12);padding:4px 10px;border-radius:12px;font-size:12px;text-transform:capitalize;">${review.status}</span></td>
        <td style="display:flex;gap:8px;flex-wrap:wrap;">
          <button class="btn btn-primary btn-sm" onclick="AdminApp.moderateReview('${review.id}', 'approved')">Approve</button>
          <button class="btn btn-outline btn-sm" onclick="AdminApp.moderateReview('${review.id}', 'rejected')">Reject</button>
        </td>
      </tr>
    `).join('');
  },

  async loadPendingReviews() {
    try {
      const res = await API.getPendingReviews(this.reviewFilters);
      this.reviews = res.reviews;
      this.reviewAnalytics = res.analytics || this.reviewAnalytics;
      if (this.currentTab === 'reviews') this.renderReviews();
    } catch (err) {
      this.toast(err.message || 'Failed to load reviews', 'error');
    }
  },

  async applyReviewFilters() {
    this.reviewFilters.status = document.getElementById('review-filter-status')?.value || 'pending';
    this.reviewFilters.sort = document.getElementById('review-filter-sort')?.value || 'newest';
    this.reviewFilters.rating = document.getElementById('review-filter-rating')?.value || '';
    this.reviewFilters.search = document.getElementById('review-filter-search')?.value || '';
    await this.loadPendingReviews();
  },

  async moderateReview(reviewId, status) {
    try {
      let rejectionNote = '';
      if (status === 'rejected') {
        rejectionNote = prompt('Add a rejection note for the customer:', 'Please remove abusive language and resubmit with clearer product details.') || '';
      }
      await API.moderateReview(reviewId, status, rejectionNote);
      this.toast(`Review ${status === 'approved' ? 'approved' : 'rejected'}`);
      await this.loadInitialData();
      if (this.currentTab === 'reviews') this.renderReviews();
    } catch (err) {
      this.toast(err.message || 'Failed to update review', 'error');
    }
  },

  // ── Admin Management ──
  async loadAdmins() {
    try {
      const res = await API.request('/admin/admins');
      this.admins = res.admins;
      this.renderAdmins();
    } catch (err) {
      this.toast('Failed to load admins', 'error');
    }
  },

  renderAdmins() {
    const tbody = document.getElementById('admins-table-body');
    if (!tbody) return;
    if (!this.admins || this.admins.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--text-muted);">No admins found</td></tr>';
      return;
    }
    const html = this.admins.map(admin => {
      const isPermanent = ['admin-001', 'admin-002'].includes(admin.id) || admin.isPermanent;
      return `
        <tr>
          <td>
            <div style="font-weight:600;">${admin.name}</div>
          </td>
          <td>${admin.email}</td>
          <td>${admin.phone || '-'}</td>
          <td>
            <span class="badge ${isPermanent ? 'status-delivered' : 'status-processing'}">${isPermanent ? 'Yes' : 'No'}</span>
          </td>
          <td>
            ${!isPermanent ? `<button class="action-btn delete" onclick="AdminApp.deleteAdmin('${admin.id}')" title="Delete Admin">🗑️</button>` : '<span style="color:var(--text-muted);font-size:12px;">N/A</span>'}
          </td>
        </tr>
      `;
    }).join('');
    tbody.innerHTML = html;
  },

  openAddAdminModal() {
    document.getElementById('add-admin-form').reset();
    document.getElementById('modal-add-admin').style.display = 'flex';
  },

  async saveNewAdmin(e) {
    e.preventDefault();
    const btn = e.target.querySelector('button[type="submit"]');
    btn.disabled = true; btn.textContent = 'Saving...';
    
    const name = document.getElementById('na-name').value.trim();
    const email = document.getElementById('na-email').value.trim();
    const phone = document.getElementById('na-phone').value.trim();
    const password = document.getElementById('na-password').value.trim();
    
    try {
      await API.request('/admin/admins', {
        method: 'POST',
        body: JSON.stringify({ name, email, phone, password })
      });
      document.getElementById('modal-add-admin').style.display = 'none';
      this.toast('Admin added successfully!');
      this.loadAdmins();
    } catch (err) {
      this.toast(err.message || 'Failed to add admin', 'error');
    }
    btn.disabled = false; btn.textContent = 'Create Admin';
  },

  async deleteAdmin(id) {
    const confirmed = await this.confirmModal({
      title: 'Delete Admin',
      message: 'Are you sure you want to remove this administrator? This action cannot be undone.',
      confirmText: 'Yes, Delete Admin'
    });
    if (!confirmed) return;
    
    try {
      await API.request(`/admin/admins/${id}`, { method: 'DELETE' });
      this.toast('Admin deleted');
      this.loadAdmins();
    } catch (err) {
      this.toast(err.message || 'Failed to delete admin', 'error');
    }
  },

  // ── Utils ──
  confirmModal({ title, message, confirmText }) {
    return new Promise(resolve => {
      const modal = document.getElementById('modal-confirm');
      document.getElementById('confirm-title').textContent = title || 'Confirm Action';
      document.getElementById('confirm-message').textContent = message || 'Are you sure?';
      const okBtn = document.getElementById('confirm-btn-ok');
      okBtn.textContent = confirmText || 'Confirm';
      
      modal.style.display = 'flex';
      
      const cleanup = (val) => {
        modal.style.display = 'none';
        okBtn.removeEventListener('click', onConfirm);
        resolve(val);
      };
      
      const onConfirm = () => cleanup(true);
      okBtn.addEventListener('click', onConfirm);
      
      // Close on cancel or outside click
      const onCancel = (e) => {
        if (e.target.classList.contains('btn-outline') || e.target === modal) {
          modal.removeEventListener('click', onCancel);
          cleanup(false);
        }
      };
      modal.addEventListener('click', onCancel);
    });
  },

  // ── Notifications ──
  startNotifPolling() {
    this.notifsInterval = setInterval(() => this.loadNotifications(), 10000); // Poll every 10s
  },

  async loadNotifications() {
    try {
      const res = await API.request('/admin/notifications');
      this.notifications = res.notifications;
      
      const badge = document.getElementById('notif-badge');
      if (res.unread > 0) {
        badge.textContent = res.unread;
        badge.style.display = 'flex';
      } else {
        badge.style.display = 'none';
      }
      this.renderNotifications();
    } catch {}
  },

  renderNotifications() {
    const list = document.getElementById('notif-list');
    if (!this.notifications.length) {
      list.innerHTML = '<div style="padding:24px;text-align:center;color:var(--text-muted)">No notifications</div>';
      return;
    }
    list.innerHTML = this.notifications.map(n => `
      <div class="notif-item ${!n.read ? 'unread' : ''}" onclick="AdminApp.markNotifRead('${n.id}', '${n.orderId}')">
        <div class="notif-icon">${n.type === 'new-order' ? '📦' : '🔔'}</div>
        <div class="notif-content">
          <h4>${n.title}</h4>
          <p>${n.message}</p>
          <span class="notif-time">${new Date(n.createdAt).toLocaleTimeString()}</span>
        </div>
      </div>
    `).join('');
  },

  toggleNotifs() {
    document.getElementById('notif-panel').classList.toggle('open');
  },

  async markNotifRead(id, orderId) {
    const n = this.notifications.find(x => x.id === id);
    if (n && !n.read) {
      try {
        await API.request(`/admin/notifications/${id}/read`, { method: 'PUT' });
        this.loadNotifications();
      } catch {}
    }
    if (orderId) {
      this.navigate('orders');
      document.getElementById('notif-panel').classList.remove('open');
    }
  },

  async markAllRead() {
    try {
      await API.request('/admin/notifications/read-all', { method: 'POST' });
      this.loadNotifications();
    } catch {}
  },

  // ── Events ──
  bindEvents() {
    document.addEventListener('click', e => {
      if (!e.target.closest('.notif-bell') && !e.target.closest('.notif-panel')) {
        document.getElementById('notif-panel').classList.remove('open');
      }
    });
  },

  // ── Voice Offer Broadcast ──
  _recognition: null,
  _isRecording: false,

  toggleMic() {
    if (this._isRecording) {
      this.stopRecording();
    } else {
      this.startRecording();
    }
  },

  startRecording() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      this.toast('Speech recognition not supported in this browser. Please type your offer.', 'error');
      this.openOfferPanel();
      return;
    }

    this._recognition = new SpeechRecognition();
    this._recognition.lang = 'en-IN';
    this._recognition.interimResults = true;
    this._recognition.continuous = true;
    this._recognition.maxAlternatives = 1;

    let finalTranscript = document.getElementById('offer-message')?.value || '';

    this._recognition.onresult = (event) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const t = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalTranscript += (finalTranscript ? ' ' : '') + t;
        } else {
          interim += t;
        }
      }
      const textarea = document.getElementById('offer-message');
      if (textarea) textarea.value = finalTranscript + (interim ? ' ' + interim : '');
    };

    this._recognition.onerror = (event) => {
      console.error('Speech error:', event.error);
      if (event.error === 'not-allowed') {
        this.toast('Microphone access denied. Please allow mic access.', 'error');
      }
      this.stopRecording();
    };

    this._recognition.onend = () => {
      // Auto-stop if recognition ends
      if (this._isRecording) this.stopRecording();
    };

    try {
      this._recognition.start();
      this._isRecording = true;
      document.getElementById('mic-btn')?.classList.add('recording');
      this.openOfferPanel();
      document.getElementById('recording-hint').style.display = 'flex';
      this.toast('🎙️ Listening... Speak your offer');
    } catch (err) {
      this.toast('Could not start microphone: ' + err.message, 'error');
    }
  },

  stopRecording() {
    if (this._recognition) {
      try { this._recognition.stop(); } catch {}
      this._recognition = null;
    }
    this._isRecording = false;
    document.getElementById('mic-btn')?.classList.remove('recording');
    const hint = document.getElementById('recording-hint');
    if (hint) hint.style.display = 'none';
  },

  openOfferPanel() {
    document.getElementById('offer-panel')?.classList.add('open');
    document.getElementById('offer-overlay')?.classList.add('open');
  },

  closeOfferPanel() {
    this.stopRecording();
    document.getElementById('offer-panel')?.classList.remove('open');
    document.getElementById('offer-overlay')?.classList.remove('open');
  },

  async sendOfferBroadcast() {
    const subject = document.getElementById('offer-subject')?.value?.trim();
    const message = document.getElementById('offer-message')?.value?.trim();
    if (!message) { this.toast('Please enter or speak an offer message', 'error'); return; }
    if (!subject) { this.toast('Please enter an email subject', 'error'); return; }

    const btn = document.getElementById('send-offer-btn');
    btn.disabled = true;
    btn.textContent = '⏳ Sending...';

    try {
      const res = await API.request('/admin/broadcast-offer', {
        method: 'POST',
        body: JSON.stringify({ subject, message })
      });
      this.toast(`✅ Offer sent to ${res.sentCount || 0} customers!`);
      this.closeOfferPanel();
      document.getElementById('offer-message').value = '';
    } catch (err) {
      this.toast(err.message || 'Failed to send offer', 'error');
    }
    btn.disabled = false;
    btn.textContent = '📧 Send to All Customers';
  },

  toast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    const icon = type === 'success' ? '✓' : '✕';
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `<span>${icon}</span> ${message}`;
    container.appendChild(toast);
    setTimeout(() => { toast.classList.add('fade-out'); setTimeout(() => toast.remove(), 300); }, 2500);
  }
};

window.AdminApp = AdminApp;
document.addEventListener('DOMContentLoaded', () => AdminApp.init());

/**
 * Bunludham LINE Login Membership UI Controller (`window.MemberAuthUI`)
 *
 * Provides:
 * - Official Thai LINE Login button ("เข้าสู่ระบบด้วย LINE")
 * - Loading & callback error banners (cleaning URL query params safely)
 * - Authenticated member pill (avatar + display name)
 * - Member Profile, News Preference & PDPA Privacy Consent modal
 * - Logout & Session-Expired prompt handling
 * - Non-blocking fallback so public photo frame creation works 100% without login
 */
(function (globalScope) {
  'use strict';

  const AUTH_ERROR_MESSAGES = {
    cancelled: 'ยกเลิกการเข้าสู่ระบบด้วย LINE แล้ว — ท่านยังสามารถสร้างและดาวน์โหลดภาพที่ระลึกได้ตามปกติ',
    expired_state: 'เวลาในการยืนยันตัวตนหมดอายุ กรุณากด “เข้าสู่ระบบด้วย LINE” อีกครั้ง',
    invalid_state: 'ข้อมูลยืนยันตัวตนไม่ถูกต้องหรือถูกใช้งานไปแล้ว กรุณาลองเข้าสู่ระบบใหม่อีกครั้ง',
    missing_code: 'ไม่ได้รับรหัสยืนยันจาก LINE กรุณาลองเข้าสู่ระบบใหม่อีกครั้ง',
    provider_error: 'ระบบ LINE ไม่สามารถยืนยันตัวตนได้ในขณะนี้ กรุณาลองใหม่ภายหลัง',
    token_exchange_failed: 'การเชื่อมต่อกับระบบยืนยันตัวตน LINE ขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง',
    invalid_id_token: 'ไม่สามารถตรวจสอบโทเค็นยืนยันตัวตนจาก LINE ได้ กรุณาลองใหม่อีกครั้ง',
    account_suspended: 'บัญชีสมาชิกนี้ถูกระงับการใช้งานชั่วคราว กรุณาติดต่อผู้ดูแลระบบ',
    oauth_not_configured: 'ระบบสมาชิก LINE อยู่ระหว่างตั้งค่าเซิร์ฟเวอร์ — ท่านยังสามารถสร้างและดาวน์โหลดภาพได้ตามปกติ'
  };

  const LINE_ICON_SVG =
    '<svg class="line-logo-svg" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">' +
    '<path fill="currentColor" d="M19.365 9.863c.349 0 .63.285.63.631 0 .345-.281.63-.63.63H17.61v1.125h1.755c.349 0 .63.283.63.63 0 .344-.281.629-.63.629h-2.386c-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.63-.63h2.386c.346 0 .627.285.627.63 0 .349-.281.63-.63.63H17.61v1.125h1.755zm-3.855 3.016c0 .27-.174.51-.432.596-.064.021-.133.031-.199.031-.211 0-.391-.09-.51-.25l-2.443-3.317v2.94c0 .344-.279.629-.631.629-.346 0-.626-.285-.626-.629V8.108c0-.27.173-.51.43-.595.06-.023.136-.033.194-.033.195 0 .375.104.495.254l2.462 3.33V8.108c0-.345.282-.63.63-.63.345 0 .63.285.63.63v4.771zm-5.741 0c0 .344-.282.629-.631.629-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.63-.63.346 0 .628.285.628.63v4.771zm-2.466.629H4.917c-.345 0-.63-.285-.63-.629V8.108c0-.345.285-.63.63-.63.348 0 .63.285.63.63v4.141h1.756c.348 0 .629.283.629.63 0 .344-.282.629-.629.629M12 2C6.477 2 2 5.69 2 10.241c0 4.072 3.612 7.484 8.491 8.132.33.071.779.218.893.501.102.257.067.659.033.918l-.144.868c-.044.257-.204 1.004.88.548 1.085-.457 5.856-3.449 7.989-5.906C21.615 13.68 22 12.048 22 10.241 22 5.69 17.523 2 12 2"/></svg>';

  function escapeHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatThaiDateTime(isoStr) {
    if (!isoStr) return '—';
    try {
      const d = new Date(isoStr);
      if (Number.isNaN(d.getTime())) return '—';
      return d.toLocaleString('th-TH', {
        dateStyle: 'medium',
        timeStyle: 'short'
      });
    } catch (_) {
      return isoStr;
    }
  }

  function consumeAuthCallbackParams(win) {
    if (!win || !win.location) return { authError: null, authSuccess: false };
    try {
      const url = new URL(win.location.href);
      const authError = url.searchParams.get('auth_error');
      const authLogin = url.searchParams.get('auth_login');
      if (authError || authLogin) {
        url.searchParams.delete('auth_error');
        url.searchParams.delete('auth_login');
        if (win.history && typeof win.history.replaceState === 'function') {
          win.history.replaceState({}, '', url.pathname + url.search + url.hash);
        }
      }
      return {
        authError: authError || null,
        authSuccess: authLogin === 'success'
      };
    } catch (_) {
      return { authError: null, authSuccess: false };
    }
  }

  function getCleanCurrentUrl(win) {
    if (!win || !win.location) return '/';
    try {
      const url = new URL(win.location.href);
      url.searchParams.delete('auth_error');
      url.searchParams.delete('auth_login');
      return url.toString();
    } catch (_) {
      return win.location.href;
    }
  }

  function initMemberAuthUI(customOptions = {}) {
    const doc = customOptions.document || globalScope.document;
    const win = customOptions.window || globalScope;
    const apiClient = customOptions.apiClient || globalScope.MemberApiClient;
    const navigateFn = customOptions.navigate || ((targetUrl) => {
      win.location.assign(targetUrl);
    });

    if (!doc || !apiClient) return null;

    const slot = doc.getElementById(customOptions.slotId || 'memberAuthSlot');
    const adminStatusEl = doc.getElementById('adminMemberAuthStatus');
    if (!slot && !adminStatusEl) return null;

    let state = {
      loading: true,
      authenticated: false,
      member: null,
      consents: [],
      policyVersion: (win.PFS_CONFIG && win.PFS_CONFIG.privacyPolicyVersion) || '2026-01',
      banner: null, // { type: 'error' | 'success' | 'warning', text: string, showRelogin?: boolean }
      saving: false
    };

    let bannerHost = doc.getElementById('memberAuthBannerHost');
    if (!bannerHost && slot) {
      bannerHost = doc.createElement('div');
      bannerHost.id = 'memberAuthBannerHost';
      bannerHost.className = 'member-auth-banner-host';
      const header = slot.closest('header');
      if (header && header.parentNode) {
        header.parentNode.insertBefore(bannerHost, header.nextSibling);
      } else {
        doc.body.insertBefore(bannerHost, doc.body.firstChild);
      }
    }

    let modalEl = doc.getElementById('memberAccountModal');
    if (!modalEl && slot) {
      modalEl = doc.createElement('div');
      modalEl.id = 'memberAccountModal';
      modalEl.className = 'modal-overlay member-modal-overlay';
      modalEl.setAttribute('role', 'dialog');
      modalEl.setAttribute('aria-modal', 'true');
      modalEl.setAttribute('aria-labelledby', 'memberModalTitle');
      doc.body.appendChild(modalEl);

      modalEl.addEventListener('click', (e) => {
        if (e.target === modalEl) closeProfileModal();
      });
      doc.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && modalEl.classList.contains('open')) {
          closeProfileModal();
        }
      });
    }

    function setBanner(bannerObj) {
      state.banner = bannerObj;
      renderBanner();
    }

    function startLineLogin() {
      if (!apiClient.isConfigured()) {
        setBanner({
          type: 'warning',
          text: 'ระบบเข้าสู่ระบบด้วย LINE ยังไม่ได้ระบุ URL เซิร์ฟเวอร์ (apiBaseUrl) — ท่านยังสร้างและดาวน์โหลดภาพได้ตามปกติ'
        });
        return;
      }
      const loginUrl = apiClient.getLoginStartUrl(getCleanCurrentUrl(win));
      if (!loginUrl) return;

      const btn = slot ? slot.querySelector('.btn-line-login') : null;
      if (btn) {
        btn.disabled = true;
        btn.innerHTML = `${LINE_ICON_SVG}<span>กำลังเชื่อมต่อ LINE...</span>`;
      }
      navigateFn(loginUrl);
    }

    function renderBanner() {
      if (!bannerHost) return;
      if (!state.banner) {
        bannerHost.innerHTML = '';
        bannerHost.classList.add('hidden');
        return;
      }
      bannerHost.classList.remove('hidden');
      const cls = state.banner.type === 'success'
        ? 'member-banner-success'
        : state.banner.type === 'warning'
          ? 'member-banner-warning'
          : 'member-banner-error';

      bannerHost.innerHTML = `
        <div class="member-auth-banner ${cls}" role="status">
          <div class="member-auth-banner-text">${escapeHtml(state.banner.text)}</div>
          <div class="member-auth-banner-actions">
            ${state.banner.showRelogin
              ? '<button type="button" class="member-banner-relogin-btn">เข้าสู่ระบบใหม่</button>'
              : ''}
            <button type="button" class="member-banner-close-btn" aria-label="ปิดข้อความแจ้งเตือน">✕</button>
          </div>
        </div>
      `;

      const closeBtn = bannerHost.querySelector('.member-banner-close-btn');
      if (closeBtn) {
        closeBtn.addEventListener('click', () => setBanner(null));
      }
      const reloginBtn = bannerHost.querySelector('.member-banner-relogin-btn');
      if (reloginBtn) {
        reloginBtn.addEventListener('click', () => startLineLogin());
      }
    }

    function renderSlot() {
      if (!slot) return;

      if (state.loading) {
        slot.innerHTML = `
          <span class="member-auth-loading" aria-live="polite">
            <span class="member-auth-dot"></span> กำลังตรวจสอบสมาชิก...
          </span>
        `;
        return;
      }

      if (!state.authenticated || !state.member) {
        slot.innerHTML = `
          <button type="button" class="btn-line-login" id="btnLineLoginTrigger">
            ${LINE_ICON_SVG}
            <span>เข้าสู่ระบบด้วย LINE</span>
          </button>
        `;
        const btn = slot.querySelector('#btnLineLoginTrigger');
        if (btn) {
          btn.addEventListener('click', () => startLineLogin());
        }
        return;
      }

      const member = state.member;
      const initial = (member.displayName || 'ส').trim().charAt(0).toUpperCase();
      const avatarHtml = member.pictureUrl
        ? `<img src="${escapeHtml(member.pictureUrl)}" alt="" class="member-pill-avatar" referrerpolicy="no-referrer">`
        : `<span class="member-pill-initial" aria-hidden="true">${escapeHtml(initial)}</span>`;

      slot.innerHTML = `
        <button type="button" class="member-profile-pill" id="btnOpenMemberModal" title="จัดการข้อมูลสมาชิกและความเป็นส่วนตัว">
          ${avatarHtml}
          <span class="member-pill-name">${escapeHtml(member.displayName)}</span>
          <span class="member-pill-badge">สมาชิก</span>
        </button>
      `;

      const avatarImg = slot.querySelector('.member-pill-avatar');
      if (avatarImg) {
        avatarImg.addEventListener('error', () => {
          avatarImg.replaceWith(Object.assign(doc.createElement('span'), {
            className: 'member-pill-initial',
            textContent: initial
          }));
        }, { once: true });
      }

      const pillBtn = slot.querySelector('#btnOpenMemberModal');
      if (pillBtn) {
        pillBtn.addEventListener('click', () => openProfileModal());
      }
    }

    function renderAdminStatus() {
      if (!adminStatusEl) return;
      if (state.loading) {
        adminStatusEl.textContent = 'กำลังตรวจสอบสิทธิ์เซิร์ฟเวอร์...';
        return;
      }
      if (!state.authenticated || !state.member) {
        adminStatusEl.innerHTML = `<span class="status-pill offline" title="หน้าจัดการนี้ทำงานในโหมด LocalStorage เฉพาะเบราว์เซอร์นี้">⚪ โหมดผู้ดูแลเฉพาะเครื่อง (ไม่ได้ล็อกอินเซิร์ฟเวอร์)</span>`;
        return;
      }
      if (state.member.role === 'ADMIN') {
        adminStatusEl.innerHTML = `<span class="status-pill online">🟢 ยืนยันสิทธิ์ผู้ดูแลระบบจากเซิร์ฟเวอร์ (${escapeHtml(state.member.displayName)})</span>`;
      } else {
        adminStatusEl.innerHTML = `<span class="status-pill offline">🟡 สมาชิกทั่วไป: ${escapeHtml(state.member.displayName)} (ไม่มีสิทธิ์ ADMIN บนเซิร์ฟเวอร์)</span>`;
      }
    }

    function getConsentGranted(type) {
      const found = (state.consents || []).find((c) => c.consentType === type);
      return Boolean(found && found.granted);
    }

    function renderProfileModalContent(feedbackMsg = null, isError = false) {
      if (!modalEl || !state.member) return;
      const m = state.member;
      const categories = ['', 'ทั้งหมด', 'กฐิน', 'มุทิตาสักการะ', 'งานบุญ', 'พิธี', 'อื่น ๆ'];
      const currentCat = m.preferredFrameCategory || '';

      const privacyChecked = getConsentGranted('PRIVACY_POLICY') ? 'checked' : '';
      const termsChecked = getConsentGranted('TERMS_OF_USE') ? 'checked' : '';
      const newsChecked = (m.newsOptIn || getConsentGranted('NEWS_PR')) ? 'checked' : '';

      const privacyRec = (state.consents || []).find((c) => c.consentType === 'PRIVACY_POLICY');
      const consentMetaText = privacyRec && privacyRec.recordedAt
        ? `บันทึกความยินยอมล่าสุดเมื่อ ${formatThaiDateTime(privacyRec.recordedAt)} (เวอร์ชัน ${escapeHtml(privacyRec.policyVersion)})`
        : `นโยบายความเป็นส่วนตัว เวอร์ชัน ${escapeHtml(state.policyVersion)}`;

      modalEl.innerHTML = `
        <div class="celebration-card member-modal-card">
          <div class="member-modal-header">
            <div class="member-modal-identity">
              ${m.pictureUrl
                ? `<img src="${escapeHtml(m.pictureUrl)}" alt="" class="member-modal-avatar" referrerpolicy="no-referrer">`
                : `<div class="member-modal-avatar member-modal-avatar-fallback">🪷</div>`}
              <div style="text-align:left;">
                <h3 id="memberModalTitle" class="member-modal-title">${escapeHtml(m.displayName)}</h3>
                <div class="member-modal-sub">
                  <span class="member-line-verified-tag">✓ ยืนยันตัวตนด้วย LINE แล้ว</span>
                </div>
              </div>
            </div>
            <button type="button" class="member-modal-close" id="btnCloseMemberModal" aria-label="ปิดหน้าต่าง">✕</button>
          </div>

          ${feedbackMsg ? `
            <div class="member-modal-feedback ${isError ? 'err' : 'ok'}" role="alert">
              ${escapeHtml(feedbackMsg)}
            </div>
          ` : ''}

          <form id="memberProfileForm" class="member-modal-form">
            <div class="member-field-group">
              <label for="memberDisplayNameInput">ชื่อที่แสดงสำหรับสมาชิก</label>
              <input
                type="text"
                id="memberDisplayNameInput"
                class="custom-text-input"
                maxlength="80"
                required
                value="${escapeHtml(m.displayName)}"
              >
            </div>

            <div class="member-field-group">
              <label for="memberPreferredCatSelect">หมวดหมู่กรอบภาพที่สนใจเป็นพิเศษ</label>
              <select id="memberPreferredCatSelect" class="custom-text-input">
                ${categories.map((cat) => `
                  <option value="${escapeHtml(cat)}" ${cat === currentCat ? 'selected' : ''}>
                    ${cat ? escapeHtml(cat) : '— ไม่ระบุ (แสดงทุกหมวดหมู่) —'}
                  </option>
                `).join('')}
              </select>
            </div>

            <div class="member-privacy-box">
              <div class="member-privacy-heading">🔒 การคุ้มครองข้อมูลส่วนบุคคลและการรับข่าวสาร</div>
              <p class="member-privacy-desc">
                ระบบจัดเก็บเฉพาะข้อมูลโปรไฟล์พื้นฐานจาก LINE (รหัสอ้างอิงภายใน ชื่อที่แสดง และรูปโปรไฟล์)
                เพื่อยืนยันตัวตนสมาชิกและจดจำการตั้งค่า โดย<strong>ไม่ขอสิทธิ์โพสต์ข้อความแทนท่าน</strong>
                และรูปถ่ายที่ท่านแต่งในสตูดิโอจะยังคงประมวลผลในอุปกรณ์ของท่านอย่างปลอดภัย
              </p>

              <label class="member-consent-row">
                <input type="checkbox" id="consentPrivacyInput" ${privacyChecked}>
                <span>รับทราบและยินยอมตามนโยบายความเป็นส่วนตัว (เวอร์ชัน ${escapeHtml(state.policyVersion)})</span>
              </label>

              <label class="member-consent-row">
                <input type="checkbox" id="consentTermsInput" ${termsChecked}>
                <span>ยอมรับข้อกำหนดการใช้งานระบบกรอบภาพที่ระลึกงานบุญ</span>
              </label>

              <label class="member-consent-row">
                <input type="checkbox" id="consentNewsInput" ${newsChecked}>
                <span>ต้องการรับข่าวสารงานบุญ กฐินคุณยายฯ และประชาสัมพันธ์มุทิตาสักการะ</span>
              </label>

              <div class="member-consent-meta">${consentMetaText}</div>
            </div>

            <div class="member-modal-actions">
              <button type="submit" class="btn-primary-action member-save-btn" id="btnSaveMemberProfile" ${state.saving ? 'disabled' : ''}>
                ${state.saving ? 'กำลังบันทึก...' : '💾 บันทึกข้อมูลสมาชิก'}
              </button>
              <button type="button" class="ghost-btn member-logout-btn" id="btnMemberLogout">
                ออกจากระบบ
              </button>
            </div>
          </form>
        </div>
      `;

      const closeBtn = modalEl.querySelector('#btnCloseMemberModal');
      if (closeBtn) closeBtn.addEventListener('click', closeProfileModal);

      const logoutBtn = modalEl.querySelector('#btnMemberLogout');
      if (logoutBtn) logoutBtn.addEventListener('click', handleLogoutClick);

      const formEl = modalEl.querySelector('#memberProfileForm');
      if (formEl) formEl.addEventListener('submit', handleSaveProfileAndConsents);
    }

    async function openProfileModal() {
      if (!modalEl || !state.authenticated) return;
      modalEl.classList.add('open');
      renderProfileModalContent();

      const fullRes = await apiClient.getMemberProfile();
      if (fullRes.ok && fullRes.data && fullRes.data.member) {
        state.member = fullRes.data.member;
        state.consents = fullRes.data.member.consents || [];
        renderSlot();
        renderProfileModalContent();
      }
    }

    function closeProfileModal() {
      if (!modalEl) return;
      modalEl.classList.remove('open');
    }

    async function handleSaveProfileAndConsents(e) {
      e.preventDefault();
      if (state.saving || !state.member) return;

      const nameInput = modalEl.querySelector('#memberDisplayNameInput');
      const catSelect = modalEl.querySelector('#memberPreferredCatSelect');
      const privacyCb = modalEl.querySelector('#consentPrivacyInput');
      const termsCb = modalEl.querySelector('#consentTermsInput');
      const newsCb = modalEl.querySelector('#consentNewsInput');

      const displayName = nameInput ? nameInput.value.trim() : '';
      if (!displayName) {
        renderProfileModalContent('กรุณากรอกชื่อที่แสดงอย่างน้อย 1 ตัวอักษร', true);
        return;
      }

      const preferredFrameCategory = catSelect && catSelect.value ? catSelect.value : null;
      const newsOptIn = Boolean(newsCb && newsCb.checked);
      const consentsPayload = {
        PRIVACY_POLICY: Boolean(privacyCb && privacyCb.checked),
        TERMS_OF_USE: Boolean(termsCb && termsCb.checked),
        NEWS_PR: newsOptIn
      };

      state.saving = true;
      renderProfileModalContent();

      const profileRes = await apiClient.updateMemberProfile({
        displayName,
        newsOptIn,
        preferredFrameCategory
      });

      if (!profileRes.ok) {
        state.saving = false;
        renderProfileModalContent(
          (profileRes.error && profileRes.error.message) || 'ไม่สามารถบันทึกโปรไฟล์ได้',
          true
        );
        return;
      }

      const consentRes = await apiClient.updateMemberConsents(consentsPayload, state.policyVersion);
      state.saving = false;

      if (!consentRes.ok) {
        renderProfileModalContent(
          (consentRes.error && consentRes.error.message) || 'ไม่สามารถบันทึกข้อมูลความยินยอมได้',
          true
        );
        return;
      }

      state.member = profileRes.data.member;
      state.consents = consentRes.data.consents || profileRes.data.member.consents || [];
      renderSlot();
      renderAdminStatus();
      renderProfileModalContent('บันทึกข้อมูลสมาชิกและการตั้งค่าความเป็นส่วนตัวเรียบร้อยแล้ว', false);
    }

    async function handleLogoutClick() {
      const logoutBtn = modalEl ? modalEl.querySelector('#btnMemberLogout') : null;
      if (logoutBtn) {
        logoutBtn.disabled = true;
        logoutBtn.textContent = 'กำลังออกจากระบบ...';
      }

      await apiClient.logout();
      state.authenticated = false;
      state.member = null;
      state.consents = [];
      closeProfileModal();
      renderSlot();
      renderAdminStatus();
      setBanner({
        type: 'success',
        text: 'ออกจากระบบเรียบร้อยแล้ว — ท่านยังสามารถสร้างกรอบภาพที่ระลึกได้ตามปกติ'
      });
    }

    async function refreshSession() {
      state.loading = true;
      renderSlot();
      renderAdminStatus();

      const callbackInfo = consumeAuthCallbackParams(win);
      if (callbackInfo.authError) {
        const msg = AUTH_ERROR_MESSAGES[callbackInfo.authError] ||
          'ไม่สามารถเข้าสู่ระบบด้วย LINE ได้ในขณะนี้ กรุณาลองใหม่อีกครั้ง';
        setBanner({ type: 'error', text: msg });
      }

      if (!apiClient.isConfigured()) {
        state.loading = false;
        state.authenticated = false;
        state.member = null;
        renderSlot();
        renderAdminStatus();
        return state;
      }

      const sessionRes = await apiClient.getAuthSession();
      state.loading = false;

      if (sessionRes.ok && sessionRes.data && sessionRes.data.authenticated && sessionRes.data.member) {
        state.authenticated = true;
        state.member = sessionRes.data.member;
        if (callbackInfo.authSuccess) {
          setBanner({
            type: 'success',
            text: `ยินดีต้อนรับคุณ ${state.member.displayName} เข้าสู่ระบบสมาชิกสำเร็จ`
          });
        }
      } else {
        state.authenticated = false;
        state.member = null;
      }

      renderSlot();
      renderAdminStatus();
      return state;
    }

    win.addEventListener('pfs:member_session_expired', () => {
      state.authenticated = false;
      state.member = null;
      state.consents = [];
      closeProfileModal();
      renderSlot();
      renderAdminStatus();
      setBanner({
        type: 'warning',
        text: 'เซสชันของท่านหมดอายุแล้ว กรุณาเข้าสู่ระบบด้วย LINE ใหม่อีกครั้ง',
        showRelogin: true
      });
    });

    const readyPromise = refreshSession();

    return {
      ready: readyPromise,
      getState: () => ({ ...state }),
      refreshSession,
      openProfileModal,
      closeProfileModal,
      startLineLogin,
      logout: handleLogoutClick
    };
  }

  globalScope.initMemberAuthUI = initMemberAuthUI;

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        globalScope.MemberAuthInstance = initMemberAuthUI();
      });
    } else {
      globalScope.MemberAuthInstance = initMemberAuthUI();
    }
  }
})(typeof window !== 'undefined' ? window : globalThis);

/**
 * Bunludham Membership API Client (`window.MemberApiClient`)
 *
 * Security invariants:
 * - Uses HttpOnly server-managed cookies (`credentials: 'include'`)
 * - Keeps session-bound CSRF token strictly in JS closure memory (NEVER in LocalStorage/SessionStorage)
 * - Degrades gracefully when API is unconfigured or offline so static photo editing always works
 */
(function (globalScope) {
  'use strict';

  const DEFAULT_TIMEOUT_MS = 6000;

  function createMemberApiClient(options = {}) {
    let csrfTokenInMemory = null;
    const fetchFn = options.fetchImpl || (typeof fetch === 'function' ? fetch.bind(globalScope) : null);

    function getBaseUrl() {
      let explicit = '';
      if (options.baseUrl !== undefined) {
        explicit = options.baseUrl;
      } else if (globalScope.PFS_CONFIG && globalScope.PFS_CONFIG.apiBaseUrl !== undefined) {
        explicit = globalScope.PFS_CONFIG.apiBaseUrl;
      } else if (
        globalScope.location &&
        globalScope.location.hostname === 'cchengjan.github.io'
      ) {
        // Fallback if browser cached a legacy pre-v3.1 config.js
        explicit = 'https://bunludham-membership-api.cchengjan63-a3b.workers.dev';
      }
      return String(explicit || '').trim().replace(/\/+$/, '').replace(/\/api\/v1$/, '');
    }

    function isConfigured() {
      return getBaseUrl().length > 0;
    }

    function clearMemoryAuth() {
      csrfTokenInMemory = null;
    }

    function getCsrfTokenForDebugOrTest() {
      return csrfTokenInMemory;
    }

    function buildUrl(path) {
      const base = getBaseUrl();
      if (!base) return null;
      const cleanPath = path.startsWith('/') ? path : `/${path}`;
      return `${base}${cleanPath}`;
    }

    function getLoginStartUrl(returnToUrl) {
      const endpoint = buildUrl('/api/v1/auth/line/start');
      if (!endpoint) return null;
      const url = new URL(endpoint);
      if (returnToUrl) {
        url.searchParams.set('return_to', String(returnToUrl));
      }
      return url.toString();
    }

    function emitSessionExpired(errorPayload) {
      clearMemoryAuth();
      if (globalScope && typeof globalScope.dispatchEvent === 'function' && typeof CustomEvent === 'function') {
        globalScope.dispatchEvent(new CustomEvent('pfs:member_session_expired', {
          detail: errorPayload || { code: 'SESSION_EXPIRED' }
        }));
      }
    }

    async function requestJson(path, {
      method = 'GET',
      body = undefined,
      includeCsrf = false,
      timeoutMs = DEFAULT_TIMEOUT_MS
    } = {}) {
      const fullUrl = buildUrl(path);
      if (!fullUrl || !fetchFn) {
        return {
          ok: false,
          status: 0,
          offline: true,
          unconfigured: !fullUrl,
          error: {
            code: !fullUrl ? 'API_NOT_CONFIGURED' : 'FETCH_UNAVAILABLE',
            message: 'ยังไม่ได้เชื่อมต่อเซิร์ฟเวอร์ระบบสมาชิก'
          }
        };
      }

      const headers = {
        'Accept': 'application/json'
      };

      let serializedBody = undefined;
      if (body !== undefined) {
        headers['Content-Type'] = 'application/json';
        serializedBody = JSON.stringify(body);
      }

      if (includeCsrf && csrfTokenInMemory) {
        headers['X-CSRF-Token'] = csrfTokenInMemory;
      }

      const controller = typeof AbortController === 'function' ? new AbortController() : null;
      const timer = controller
        ? setTimeout(() => controller.abort(), timeoutMs)
        : null;

      try {
        const res = await fetchFn(fullUrl, {
          method,
          headers,
          body: serializedBody,
          credentials: 'include',
          signal: controller ? controller.signal : undefined
        });

        let payload = null;
        try {
          payload = await res.json();
        } catch (_) {
          payload = null;
        }

        if (res.status === 401) {
          const errObj = (payload && payload.error) || {
            code: 'UNAUTHENTICATED',
            message: 'เซสชันหมดอายุหรือไม่ถูกต้อง กรุณาเข้าสู่ระบบใหม่อีกครั้ง'
          };
          if (errObj.code === 'SESSION_EXPIRED' || errObj.code === 'SESSION_INVALID') {
            emitSessionExpired(errObj);
          } else {
            clearMemoryAuth();
          }
          return {
            ok: false,
            status: 401,
            offline: false,
            error: errObj
          };
        }

        if (!res.ok || !payload || payload.ok === false) {
          return {
            ok: false,
            status: res.status,
            offline: false,
            error: (payload && payload.error) || {
              code: `HTTP_${res.status}`,
              message: 'ไม่สามารถดำเนินการได้ในขณะนี้ กรุณาลองใหม่อีกครั้ง'
            }
          };
        }

        return {
          ok: true,
          status: res.status,
          offline: false,
          data: payload
        };
      } catch (err) {
        return {
          ok: false,
          status: 0,
          offline: true,
          error: {
            code: err && err.name === 'AbortError' ? 'NETWORK_TIMEOUT' : 'NETWORK_OFFLINE',
            message: 'ไม่สามารถติดต่อเซิร์ฟเวอร์ระบบสมาชิกได้ในขณะนี้ (สตูดิโอแต่งภาพยังใช้งานได้ตามปกติ)'
          }
        };
      } finally {
        if (timer) clearTimeout(timer);
      }
    }

    async function checkHealth() {
      return requestJson('/api/v1/health', { method: 'GET', timeoutMs: 4000 });
    }

    async function getAuthSession() {
      const res = await requestJson('/api/v1/auth/me', { method: 'GET', timeoutMs: 4500 });
      if (res.ok && res.data) {
        if (res.data.authenticated && res.data.csrfToken) {
          csrfTokenInMemory = res.data.csrfToken;
        } else {
          clearMemoryAuth();
        }
      }
      return res;
    }

    async function getMemberProfile() {
      return requestJson('/api/v1/members/me', { method: 'GET' });
    }

    async function updateMemberProfile(patch) {
      if (!csrfTokenInMemory) {
        await getAuthSession();
      }
      return requestJson('/api/v1/members/me', {
        method: 'PATCH',
        body: patch,
        includeCsrf: true
      });
    }

    async function getMemberConsents() {
      return requestJson('/api/v1/members/me/consents', { method: 'GET' });
    }

    async function updateMemberConsents(consentsMap, policyVersion) {
      if (!csrfTokenInMemory) {
        await getAuthSession();
      }
      const body = { consents: consentsMap };
      if (policyVersion) body.policyVersion = policyVersion;
      return requestJson('/api/v1/members/me/consents', {
        method: 'PUT',
        body,
        includeCsrf: true
      });
    }

    async function logout() {
      if (!csrfTokenInMemory) {
        await getAuthSession();
      }
      const res = await requestJson('/api/v1/auth/logout', {
        method: 'POST',
        includeCsrf: true
      });
      clearMemoryAuth();
      return res;
    }

    async function getAdminStats() {
      return requestJson('/api/v1/admin/stats', { method: 'GET', timeoutMs: 4500 });
    }

    return {
      getBaseUrl,
      isConfigured,
      getLoginStartUrl,
      checkHealth,
      getAuthSession,
      getMemberProfile,
      updateMemberProfile,
      getMemberConsents,
      updateMemberConsents,
      logout,
      getAdminStats,
      _getCsrfToken: getCsrfTokenForDebugOrTest
    };
  }

  const defaultClient = createMemberApiClient();
  globalScope.createMemberApiClient = createMemberApiClient;
  globalScope.MemberApiClient = defaultClient;
})(typeof window !== 'undefined' ? window : globalThis);

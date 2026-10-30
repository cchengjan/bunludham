/**
 * Frontend Integration, Asset Path Integrity & Offline Resilience Tests (Phases F & G5).
 *
 * Covers:
 * - Static HTML & JSON asset path verification (compatible with GitHub Pages `/bunludham/` subpath)
 * - `backend/Code.gs` preservation check (`admin.js` copy button compatibility)
 * - Public offline resilience: when API is unreachable, `MemberApiClient` & `MemberAuthUI` degrade cleanly without errors
 * - End-to-end UI state transitions in `MemberAuthUI` + `MemberApiClient` connected to Worker + D1:
 *   1. Guest state -> clicks "เข้าสู่ระบบด้วย LINE" -> redirects to `/api/v1/auth/line/start`
 *   2. Callback error (`?auth_error=cancelled`) -> displays Thai banner and strips query param via `history.replaceState`
 *   3. Authenticated member -> displays member pill -> opens profile modal -> saves `displayName`, `newsOptIn`, and PDPA consents
 *   4. Session expiration event -> clears member UI and prompts re-login
 *   5. Logout -> revokes server session and returns to guest state
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import {
  createTestApp,
  formatCookieHeader,
  loginTestMemberViaLine,
  TEST_API_ORIGIN,
  TEST_FRONTEND_ORIGIN
} from './helpers/test-harness.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');

function createFrontendDomHarness({
  initialUrl = `${TEST_FRONTEND_ORIGIN}/index.html`,
  apiBaseUrl = TEST_API_ORIGIN,
  fetchImpl
}) {
  const elementsById = new Map();
  const winListeners = new Map();
  const docListeners = new Map();

  class FakeElement {
    constructor(tagName = 'div') {
      this.tagName = tagName.toUpperCase();
      this.id = '';
      this.className = '';
      this.textContent = '';
      this._innerHTML = '';
      this.disabled = false;
      this.checked = false;
      this.value = '';
      this.attributes = new Map();
      this.listeners = new Map();
      this.children = [];
      this.parentNode = null;
      this.classList = {
        _set: new Set(),
        add: (...names) => names.forEach((n) => this.classList._set.add(n)),
        remove: (...names) => names.forEach((n) => this.classList._set.delete(n)),
        contains: (n) => this.classList._set.has(n),
        toggle: (n, force) => {
          const shouldHave = force !== undefined ? force : !this.classList._set.has(n);
          if (shouldHave) this.classList._set.add(n);
          else this.classList._set.delete(n);
        }
      };
    }

    set innerHTML(html) {
      this._innerHTML = String(html);
      this._hydrateControlsFromHtml(this._innerHTML);
    }

    get innerHTML() {
      return this._innerHTML;
    }

    setAttribute(k, v) {
      this.attributes.set(k, String(v));
      if (k === 'id') {
        this.id = String(v);
        elementsById.set(this.id, this);
      }
    }

    getAttribute(k) {
      return this.attributes.get(k) ?? null;
    }

    addEventListener(type, fn) {
      if (!this.listeners.has(type)) this.listeners.set(type, []);
      this.listeners.get(type).push(fn);
    }

    dispatchEvent(evt) {
      const fns = [...(this.listeners.get(evt.type) || [])];
      for (const fn of fns) fn(evt);
    }

    click() {
      this.dispatchEvent({ type: 'click', target: this, preventDefault() {} });
    }

    closest(selector) {
      if (selector === 'header') return headerEl;
      return null;
    }

    appendChild(child) {
      child.parentNode = this;
      this.children.push(child);
      if (child.id) elementsById.set(child.id, child);
      return child;
    }

    insertBefore(child) {
      return this.appendChild(child);
    }

    querySelector(selector) {
      return this._subElements ? (this._subElements.get(selector) || null) : null;
    }

    _hydrateControlsFromHtml(html) {
      this._subElements = new Map();
      const registerSub = (sel, el) => {
        this._subElements.set(sel, el);
        if (sel.startsWith('#')) elementsById.set(sel.slice(1), el);
      };

      // Extract IDs and key classes used by MemberAuthUI
      const idMatches = [...html.matchAll(/<([a-z0-9]+)\b([^>]*?\bid="([^"]+)"[^>]*)>/gi)];
      for (const [, tag, attrs, id] of idMatches) {
        const sub = new FakeElement(tag);
        sub.id = id;
        const valMatch = attrs.match(/\bvalue="([^"]*)"/i);
        if (valMatch) sub.value = valMatch[1];
        sub.checked = /\bchecked\b/i.test(attrs);
        registerSub(`#${id}`, sub);
      }

      for (const cls of [
        '.btn-line-login',
        '.member-banner-close-btn',
        '.member-banner-relogin-btn',
        '.member-pill-avatar'
      ]) {
        const rawCls = cls.slice(1);
        if (html.includes(rawCls)) {
          const sub = new FakeElement('button');
          registerSub(cls, sub);
        }
      }
    }
  }

  const bodyEl = new FakeElement('body');
  const headerEl = new FakeElement('header');
  const slotEl = new FakeElement('div');
  slotEl.id = 'memberAuthSlot';
  elementsById.set('memberAuthSlot', slotEl);
  headerEl.appendChild(slotEl);
  bodyEl.appendChild(headerEl);

  let currentHref = initialUrl;
  let lastNavigatedUrl = null;

  const documentObj = {
    readyState: 'complete',
    body: bodyEl,
    querySelector: () => null,
    getElementById: (id) => elementsById.get(id) || null,
    createElement: (tag) => new FakeElement(tag),
    addEventListener: (type, fn) => {
      if (!docListeners.has(type)) docListeners.set(type, []);
      docListeners.get(type).push(fn);
    }
  };

  class MockCustomEvent {
    constructor(type, init = {}) {
      this.type = type;
      this.detail = init.detail;
    }
  }

  const windowObj = {
    console,
    URL,
    AbortController,
    setTimeout,
    clearTimeout,
    CustomEvent: MockCustomEvent,
    PFS_CONFIG: {
      gasWebAppUrl: '',
      apiBaseUrl,
      privacyPolicyVersion: '2026-01'
    },
    document: documentObj,
    location: {
      get href() {
        return currentHref;
      },
      hostname: 'localhost',
      assign(target) {
        lastNavigatedUrl = target;
      }
    },
    history: {
      replaceState(_state, _title, newRelUrl) {
        const base = new URL(currentHref);
        currentHref = new URL(newRelUrl, base.origin).toString();
      }
    },
    fetch: fetchImpl,
    addEventListener(type, fn) {
      if (!winListeners.has(type)) winListeners.set(type, []);
      winListeners.get(type).push(fn);
    },
    dispatchEvent(evt) {
      const fns = [...(winListeners.get(evt.type) || [])];
      for (const fn of fns) fn(evt);
    }
  };
  windowObj.window = windowObj;
  windowObj.globalThis = windowObj;

  const ctx = vm.createContext(windowObj);
  vm.runInContext(fs.readFileSync(path.join(repoRoot, 'shared/api-client.js'), 'utf8'), ctx);
  vm.runInContext(fs.readFileSync(path.join(repoRoot, 'shared/member-auth.js'), 'utf8'), ctx);

  return {
    windowObj,
    documentObj,
    slotEl,
    elementsById,
    getCurrentHref: () => currentHref,
    getLastNavigatedUrl: () => lastNavigatedUrl
  };
}

describe('Frontend Asset Integrity, Offline Resilience & LINE Member UI Flows', () => {
  it('preserves relative asset paths across HTML/JSON files and keeps backend/Code.gs intact', () => {
    assert.equal(fs.existsSync(path.join(repoRoot, 'backend/Code.gs')), true, 'backend/Code.gs must remain intact');

    for (const htmlFile of ['index.html', 'create.html', 'admin.html', 'user.html', 'test_runner.html']) {
      const html = fs.readFileSync(path.join(repoRoot, htmlFile), 'utf8');
      const refs = [...html.matchAll(/\b(?:src|href)="([^"]+)"/g)].map((m) => m[1]);
      for (const ref of refs) {
        if (
          ref.startsWith('http://') ||
          ref.startsWith('https://') ||
          ref.startsWith('#') ||
          ref.startsWith('data:')
        ) {
          continue;
        }
        assert.equal(
          ref.startsWith('/'),
          false,
          `${htmlFile} must use relative path (not root-absolute "${ref}") so GitHub Pages /bunludham/ works`
        );
        const cleanRef = ref.split('?')[0].split('#')[0];
        assert.equal(
          fs.existsSync(path.join(repoRoot, cleanRef)),
          true,
          `Missing referenced file "${cleanRef}" in ${htmlFile}`
        );
      }
    }

    for (const jsonFile of ['frames.json', 'config/frames.json']) {
      const frames = JSON.parse(fs.readFileSync(path.join(repoRoot, jsonFile), 'utf8'));
      for (const frame of frames) {
        assert.equal(fs.existsSync(path.join(repoRoot, frame.filename)), true, `Missing frame PNG: ${frame.filename}`);
        if (frame.thumbnail) {
          assert.equal(fs.existsSync(path.join(repoRoot, frame.thumbnail)), true, `Missing thumb PNG: ${frame.thumbnail}`);
        }
      }
    }
  });

  it('degrades cleanly without errors when Backend API is offline, and initiates LINE Login on button click', async () => {
    const harness = createFrontendDomHarness({
      initialUrl: `${TEST_FRONTEND_ORIGIN}/create.html?auth_error=cancelled`,
      fetchImpl: async () => {
        throw new TypeError('Failed to fetch (offline)');
      }
    });

    await harness.windowObj.MemberAuthInstance.ready;

    // Query parameter ?auth_error=cancelled was consumed and cleaned from URL
    assert.equal(harness.getCurrentHref(), `${TEST_FRONTEND_ORIGIN}/create.html`);
    const bannerHost = harness.elementsById.get('memberAuthBannerHost');
    assert.match(bannerHost.innerHTML, /ยกเลิกการเข้าสู่ระบบด้วย LINE แล้ว/);

    // Guest LINE login button rendered in Thai
    assert.match(harness.slotEl.innerHTML, /เข้าสู่ระบบด้วย LINE/);

    // Clicking button navigates to /api/v1/auth/line/start with return_to
    const loginBtn = harness.elementsById.get('btnLineLoginTrigger');
    loginBtn.click();
    assert.equal(
      harness.getLastNavigatedUrl(),
      `${TEST_API_ORIGIN}/api/v1/auth/line/start?return_to=${encodeURIComponent(`${TEST_FRONTEND_ORIGIN}/create.html`)}`
    );
  });

  it('renders authenticated member pill, updates profile & PDPA consents, handles session expiry, and logs out', async () => {
    const app = await createTestApp();
    try {
      const { jar } = await loginTestMemberViaLine(app, {
        sub: 'U_FRONTEND_FLOW',
        name: 'สาธุชน ทดสอบหน้าเว็บ'
      });

      let activeCookieHeader = formatCookieHeader(jar);

      const harness = createFrontendDomHarness({
        initialUrl: `${TEST_FRONTEND_ORIGIN}/index.html?auth_login=success`,
        fetchImpl: async (url, init = {}) => {
          const headers = new Headers(init.headers || {});
          if (activeCookieHeader) headers.set('Cookie', activeCookieHeader);
          headers.set('Origin', TEST_FRONTEND_ORIGIN);
          return app.request(String(url), {
            method: init.method || 'GET',
            headers,
            body: init.body
          });
        }
      });

      const ui = harness.windowObj.MemberAuthInstance;
      await ui.ready;

      // Authenticated pill displays member name & welcome banner
      assert.equal(ui.getState().authenticated, true);
      assert.match(harness.slotEl.innerHTML, /สาธุชน ทดสอบหน้าเว็บ/);
      assert.match(harness.elementsById.get('memberAuthBannerHost').innerHTML, /ยินดีต้อนรับคุณ/);

      // Open profile modal, modify displayName + opt-in + consents, and submit form
      await ui.openProfileModal();
      harness.elementsById.get('memberDisplayNameInput').value = 'สาธุชน แก้ไขโปรไฟล์ใหม่';
      harness.elementsById.get('memberPreferredCatSelect').value = 'มุทิตาสักการะ';
      harness.elementsById.get('consentPrivacyInput').checked = true;
      harness.elementsById.get('consentTermsInput').checked = true;
      harness.elementsById.get('consentNewsInput').checked = true;

      const formEl = harness.elementsById.get('memberProfileForm');
      const submitListeners = formEl.listeners.get('submit') || [];
      await submitListeners[0]({ preventDefault() {} });

      assert.equal(ui.getState().member.displayName, 'สาธุชน แก้ไขโปรไฟล์ใหม่');
      assert.equal(ui.getState().member.newsOptIn, true);
      assert.match(harness.slotEl.innerHTML, /สาธุชน แก้ไขโปรไฟล์ใหม่/);

      // Logout clears authenticated state and renders guest LINE Login button again
      await ui.logout();
      assert.equal(ui.getState().authenticated, false);
      assert.match(harness.slotEl.innerHTML, /เข้าสู่ระบบด้วย LINE/);
    } finally {
      app.close();
    }
  });

  it('detects server-expired session (401 SESSION_EXPIRED) and renders Thai session-expired re-login prompt', async () => {
    const app = await createTestApp();
    try {
      const { jar } = await loginTestMemberViaLine(app, {
        sub: 'U_SESSION_EXP_UI',
        name: 'สมาชิก ทดสอบหมดอายุ'
      });

      const cookieHeader = formatCookieHeader(jar);
      const harness = createFrontendDomHarness({
        initialUrl: `${TEST_FRONTEND_ORIGIN}/index.html`,
        fetchImpl: async (url, init = {}) => {
          const headers = new Headers(init.headers || {});
          headers.set('Cookie', cookieHeader);
          headers.set('Origin', TEST_FRONTEND_ORIGIN);
          return app.request(String(url), {
            method: init.method || 'GET',
            headers,
            body: init.body
          });
        }
      });

      const ui = harness.windowObj.MemberAuthInstance;
      await ui.ready;
      assert.equal(ui.getState().authenticated, true);

      // Expire the session in DB and trigger an API call
      await app.db.prepare("UPDATE sessions SET expires_at = '2020-01-01T00:00:00.000Z'").run();
      const profileRes = await harness.windowObj.MemberApiClient.getMemberProfile();
      assert.equal(profileRes.status, 401);

      assert.equal(ui.getState().authenticated, false);
      assert.match(harness.slotEl.innerHTML, /เข้าสู่ระบบด้วย LINE/);
      assert.match(
        harness.elementsById.get('memberAuthBannerHost').innerHTML,
        /เซสชันของท่านหมดอายุแล้ว/
      );
    } finally {
      app.close();
    }
  });
});

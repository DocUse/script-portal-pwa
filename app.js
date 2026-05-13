(function () {
  'use strict';

  var TOKEN_STORAGE_KEY = 'script_portal_id_token_v1';
  var TOKEN_EMAIL_HINT_KEY = 'script_portal_email_hint_v1';
  var JSONP_TIMEOUT_MS = 25000;
  var GIS_LOAD_TIMEOUT_MS = 8000;

  var scriptPortalApp = document.getElementById('app');

  var scriptPortalState = {
    data: null,
    activeMenuId: 'scenario',
    activeStepIndex: 0,
    openPromptIds: {},
    openContractIds: {},
    activeMobileTab: 'script',
    idToken: '',
    emailHint: '',
    gisReady: false,
    isLoadingData: false,
    didAutoPrompt: false,
    pendingScenarioKey: '',
  };

  var scriptPortalSidePanelHeightFrame_ = 0;
  var scriptPortalSidePanelResizeObserver_ = null;
  var scriptPortalObservedStepPanel_ = null;

  var SCRIPT_PORTAL_MOBILE_TABS = [
    { id: 'script', label: 'Текущий шаг', icon: 'tabScript' },
    { id: 'objections', label: 'Вопросы', icon: 'tabQuestions' },
    { id: 'contract', label: 'Шпаргалка', icon: 'tabCheatsheet' },
  ];

  var SCRIPT_PORTAL_ICONS = {
    scenario: iconSvg_('book'),
    materials: iconSvg_('folder'),
    objections: iconSvg_('chat'),
    cheatsheet: iconSvg_('bookmark'),
    regions: iconSvg_('map'),
    personas: iconSvg_('users'),
    mistakes: iconSvg_('warning'),
  };

  bootstrapScriptPortal_();

  // ---------- Bootstrap & viewport detection ----------

  function bootstrapScriptPortal_() {
    if (!getApiUrl_()) {
      renderScriptPortalError_(
        'Не задан apiUrl в config.js. Откройте файл config.js, вставьте URL второго Apps Script deployment (с доступом Anyone) и перезагрузите страницу.'
      );
      return;
    }

    applyScriptPortalDeviceMode_();
    window.addEventListener('resize', handleScriptPortalViewportChange_);
    window.addEventListener('orientationchange', handleScriptPortalViewportChange_);
    if (window.visualViewport && typeof window.visualViewport.addEventListener === 'function') {
      window.visualViewport.addEventListener('resize', handleScriptPortalViewportChange_);
    }

    scriptPortalState.idToken = readCachedToken_();
    scriptPortalState.emailHint = readCachedEmailHint_();

    waitForGoogleSignIn_(function (ok) {
      scriptPortalState.gisReady = ok;
      if (!ok) {
        renderScriptPortalLoginScreen_('Не удалось загрузить Google Sign-In. Проверьте подключение и обновите страницу.');
        return;
      }
      initGoogleSignIn_();

      if (scriptPortalState.idToken) {
        loadScriptPortalData_();
      } else {
        renderScriptPortalLoginScreen_('');
      }
    });
  }

  function applyScriptPortalDeviceMode_() {
    if (!document.body) return;
    var ua = (navigator && navigator.userAgent) ? navigator.userAgent : '';
    var screenWidth = (window.screen && window.screen.width) ? window.screen.width : 0;
    var isPhoneUA = /Mobi|Android|iPhone|iPod|IEMobile|Opera Mini/i.test(ua);
    var isSmallScreen = screenWidth > 0 && screenWidth < 768;
    var isPhone = isPhoneUA || isSmallScreen;
    document.body.classList.toggle('is-mobile', isPhone);
    if (isPhone) {
      document.body.setAttribute('data-active-tab', scriptPortalState.activeMobileTab || 'script');
    } else {
      document.body.removeAttribute('data-active-tab');
    }
    renderScriptPortalDebugOverlay_();
  }

  function handleScriptPortalViewportChange_() {
    applyScriptPortalDeviceMode_();
    scheduleScriptPortalSidePanelHeightSync_();
  }

  // Диагностический оверлей — для проверки, что PWA получает реальный
  // viewport iPhone (393px), а не 980px от iframe Apps Script.
  function renderScriptPortalDebugOverlay_() {
    if (!document.body) return;
    var enabled = !!(window.SCRIPT_PORTAL_CONFIG && window.SCRIPT_PORTAL_CONFIG.enableDebugOverlay);
    var isMobile = document.body.classList.contains('is-mobile');
    var overlay = document.getElementById('script-portal-debug-overlay');

    if (!enabled || !isMobile) {
      if (overlay) overlay.remove();
      return;
    }

    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'script-portal-debug-overlay';
      overlay.style.cssText = [
        'position: fixed',
        'top: 6px',
        'right: 6px',
        'z-index: 2147483647',
        'background: #000',
        'color: #ffeb3b',
        'font-family: -apple-system, BlinkMacSystemFont, "SF Mono", Menlo, monospace',
        'font-size: 13px',
        'line-height: 1.35',
        'font-weight: 700',
        'padding: 10px 12px',
        'border: 2px solid #ffeb3b',
        'border-radius: 8px',
        'max-width: 78vw',
        'white-space: pre',
        'pointer-events: auto',
        'box-shadow: 0 4px 16px rgba(0,0,0,0.5)',
      ].join(';');
      overlay.title = 'Нажми, чтобы скрыть';
      overlay.addEventListener('click', function (event) {
        event.stopPropagation();
        overlay.remove();
      });
      document.body.appendChild(overlay);
    }

    var docEl = document.documentElement;
    var bodyFs = parseFloat(getComputedStyle(document.body).fontSize);
    var htmlFs = parseFloat(getComputedStyle(docEl).fontSize);
    var visualW = (window.visualViewport && window.visualViewport.width) || '—';
    var visualH = (window.visualViewport && window.visualViewport.height) || '—';
    var standalone =
      (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
      window.navigator.standalone === true;

    var lines = [
      'DEBUG VIEWPORT',
      'inner:  ' + window.innerWidth + ' x ' + window.innerHeight,
      'outer:  ' + window.outerWidth + ' x ' + window.outerHeight,
      'screen: ' + window.screen.width + ' x ' + window.screen.height,
      'visual: ' + visualW + ' x ' + visualH,
      'dpr:    ' + window.devicePixelRatio,
      'docEl.clientW: ' + docEl.clientWidth,
      'body fs: ' + bodyFs + 'px',
      'html fs: ' + htmlFs + 'px',
      'in iframe: ' + (window.top !== window.self ? 'yes' : 'no'),
      'standalone: ' + (standalone ? 'yes' : 'no'),
    ];

    overlay.textContent = lines.join('\n');
  }

  // ---------- Config helpers ----------

  function getConfig_() {
    return window.SCRIPT_PORTAL_CONFIG || {};
  }

  function getApiUrl_() {
    var url = String(getConfig_().apiUrl || '').trim();
    if (!url || url === 'PASTE_NEW_APPS_SCRIPT_EXEC_URL_HERE') return '';
    return url;
  }

  function getOAuthClientId_() {
    return String(getConfig_().oauthClientId || '').trim();
  }

  // ---------- Google Sign-In ----------

  function waitForGoogleSignIn_(done) {
    var startedAt = Date.now();
    (function tick() {
      var ready =
        window.google &&
        window.google.accounts &&
        window.google.accounts.id &&
        typeof window.google.accounts.id.initialize === 'function';
      if (ready) {
        done(true);
        return;
      }
      if (Date.now() - startedAt > GIS_LOAD_TIMEOUT_MS) {
        done(false);
        return;
      }
      setTimeout(tick, 100);
    })();
  }

  function initGoogleSignIn_() {
    var clientId = getOAuthClientId_();
    if (!clientId) {
      renderScriptPortalLoginScreen_('OAuth Client ID не задан в config.js.');
      return;
    }
    try {
      google.accounts.id.initialize({
        client_id: clientId,
        callback: handleGoogleCredentialResponse_,
        auto_select: false,
        ux_mode: 'popup',
        context: 'signin',
        itp_support: true,
      });
    } catch (err) {
      renderScriptPortalLoginScreen_('Ошибка инициализации Google Sign-In: ' + (err && err.message ? err.message : err));
    }
  }

  function handleGoogleCredentialResponse_(response) {
    var idToken = response && response.credential ? String(response.credential) : '';
    if (!idToken) {
      renderScriptPortalLoginScreen_('Не удалось получить Google ID-токен. Попробуйте ещё раз.');
      return;
    }
    scriptPortalState.idToken = idToken;
    scriptPortalState.emailHint = extractEmailFromIdToken_(idToken);
    persistToken_(idToken, scriptPortalState.emailHint);
    loadScriptPortalData_();
  }

  function signOut_() {
    scriptPortalState.idToken = '';
    scriptPortalState.emailHint = '';
    scriptPortalState.data = null;
    scriptPortalState.pendingScenarioKey = '';
    try { sessionStorage.removeItem(TOKEN_STORAGE_KEY); } catch (e) {}
    try { sessionStorage.removeItem(TOKEN_EMAIL_HINT_KEY); } catch (e) {}
    if (window.google && google.accounts && google.accounts.id) {
      try { google.accounts.id.disableAutoSelect(); } catch (e) {}
    }
    renderScriptPortalLoginScreen_('Вы вышли. Войдите снова, чтобы продолжить.');
  }

  function persistToken_(token, emailHint) {
    try { sessionStorage.setItem(TOKEN_STORAGE_KEY, String(token || '')); } catch (e) {}
    try { sessionStorage.setItem(TOKEN_EMAIL_HINT_KEY, String(emailHint || '')); } catch (e) {}
  }

  function readCachedToken_() {
    try { return sessionStorage.getItem(TOKEN_STORAGE_KEY) || ''; } catch (e) { return ''; }
  }

  function readCachedEmailHint_() {
    try { return sessionStorage.getItem(TOKEN_EMAIL_HINT_KEY) || ''; } catch (e) { return ''; }
  }

  function extractEmailFromIdToken_(jwt) {
    try {
      var parts = String(jwt || '').split('.');
      if (parts.length < 2) return '';
      var payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      var pad = payload.length % 4;
      if (pad) payload += new Array(5 - pad).join('=');
      var json = atob(payload);
      var data = JSON.parse(decodeURIComponent(json.split('').map(function (c) {
        return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
      }).join('')));
      return String(data.email || '').toLowerCase();
    } catch (e) {
      return '';
    }
  }

  // ---------- Data loading ----------

  function switchScenario_(scenarioKey) {
    scriptPortalState.pendingScenarioKey = String(scenarioKey || '');
    loadScriptPortalData_();
  }

  function updateUrlScenarioParam_(scenarioKey) {
    try {
      var url = new URL(window.location.href);
      if (scenarioKey) {
        url.searchParams.set('scenario', scenarioKey);
      } else {
        url.searchParams.delete('scenario');
      }
      window.history.replaceState(null, '', url.pathname + (url.search ? url.search : '') + (url.hash ? url.hash : ''));
    } catch (e) {}
  }

  function loadScriptPortalData_() {
    if (!scriptPortalState.idToken) {
      renderScriptPortalLoginScreen_('');
      return;
    }
    if (scriptPortalState.isLoadingData) return;
    scriptPortalState.isLoadingData = true;
    renderScriptPortalLoadingState_();

    var launchParams = readScriptPortalLaunchParams_();
    var effectiveScenarioKey = scriptPortalState.pendingScenarioKey || launchParams.scenarioKey || '';
    var requestParams = {
      api: 'script-portal-data',
      id_token: scriptPortalState.idToken,
    };
    if (effectiveScenarioKey) requestParams.scenario = effectiveScenarioKey;
    if (launchParams.activeStep && !scriptPortalState.pendingScenarioKey) {
      requestParams.step = launchParams.activeStep;
    }

    jsonpFetch_(getApiUrl_(), requestParams)
      .then(function (response) {
        scriptPortalState.isLoadingData = false;
        handleScriptPortalResponse_(response, launchParams);
      })
      .catch(function (error) {
        scriptPortalState.isLoadingData = false;
        renderScriptPortalError_(error && error.message ? error.message : String(error));
      });
  }

  function handleScriptPortalResponse_(response, launchParams) {
    if (!response || !response.ok) {
      var errCode = response && response.error ? response.error.code : '';
      var errMsg = response && response.error ? response.error.message : 'Не удалось загрузить данные.';

      if (errCode === 'token_expired' || errCode === 'token_invalid' || errCode === 'token_aud_mismatch' || errCode === 'no_token' || errCode === 'token_no_email') {
        scriptPortalState.idToken = '';
        try { sessionStorage.removeItem(TOKEN_STORAGE_KEY); } catch (e) {}
        renderScriptPortalLoginScreen_('Сессия истекла. Войдите ещё раз.');
        return;
      }

      renderScriptPortalError_(errMsg);
      return;
    }

    scriptPortalState.data = response.data;
    scriptPortalState.activeMenuId = 'scenario';
    var stepsLen = response.data && response.data.scenario && response.data.scenario.steps ? response.data.scenario.steps.length : 0;
    var initialStep = response.data && response.data.scenario ? response.data.scenario.activeStepIndex : 0;
    scriptPortalState.activeStepIndex = coerceScriptPortalIndex_(initialStep, stepsLen);
    scriptPortalState.openPromptIds = {};
    scriptPortalState.openContractIds = {};
    scriptPortalState.activeMobileTab = 'script';
    if (document.body) document.body.setAttribute('data-active-tab', 'script');
    var loadedKey = (response.data && response.data.scenario) ? String(response.data.scenario.key || '') : '';
    updateUrlScenarioParam_(loadedKey);
    scriptPortalState.pendingScenarioKey = '';
    renderScriptPortalPage_();
  }

  function readScriptPortalLaunchParams_() {
    var params = {};
    var search = new URLSearchParams(window.location.search || '');
    search.forEach(function (value, key) {
      params[key] = value;
    });
    return {
      scenarioKey: params.scenario || params.scenarioKey || '',
      activeStep: params.step || params.activeStep || '',
    };
  }

  // ---------- JSONP transport ----------

  function jsonpFetch_(baseUrl, params) {
    return new Promise(function (resolve, reject) {
      var callbackName = '__sp_jsonp_' + Date.now() + '_' + Math.floor(Math.random() * 1000000);
      var script = null;
      var timeoutId = null;
      var settled = false;

      function cleanup() {
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
        try { delete window[callbackName]; } catch (e) { window[callbackName] = undefined; }
        if (script && script.parentNode) script.parentNode.removeChild(script);
      }

      window[callbackName] = function (response) {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(response);
      };

      var url;
      try {
        url = new URL(baseUrl);
      } catch (urlErr) {
        cleanup();
        reject(new Error('Некорректный apiUrl в config.js: ' + baseUrl));
        return;
      }
      Object.keys(params || {}).forEach(function (key) {
        if (params[key] === undefined || params[key] === null) return;
        url.searchParams.set(key, String(params[key]));
      });
      url.searchParams.set('callback', callbackName);
      // Cache-buster: гарантирует уникальность URL, чтобы ни Safari, ни
      // Google CDN не отдали закешированный JSONP-ответ.
      url.searchParams.set('_t', String(Date.now()) + '_' + Math.floor(Math.random() * 1000000));

      script = document.createElement('script');
      script.async = true;
      script.src = url.toString();
      script.onerror = function () {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error('Не удалось связаться с сервером. Проверьте интернет-соединение.'));
      };

      timeoutId = setTimeout(function () {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error('Сервер не ответил за ' + Math.round(JSONP_TIMEOUT_MS / 1000) + ' секунд. Попробуйте ещё раз.'));
      }, JSONP_TIMEOUT_MS);

      document.head.appendChild(script);
    });
  }

  // ---------- Login & loading & error screens ----------

  function renderScriptPortalLoginScreen_(message) {
    scriptPortalApp.innerHTML =
      '<div class="loading-state">' +
      '<h2>Вход в "Скрипты обучения"</h2>' +
      '<p>Войдите через Google. Доступ открыт сотрудникам из "Справочник рекрутеров".</p>' +
      (message ? '<p style="color:#b91c1c;margin-top:10px;">' + escapeScriptPortalHtml_(message) + '</p>' : '') +
      '<div id="script-portal-google-button" style="display:flex;justify-content:center;margin-top:18px;"></div>' +
      '</div>';

    var container = document.getElementById('script-portal-google-button');
    if (!container) return;
    if (!(window.google && google.accounts && google.accounts.id && typeof google.accounts.id.renderButton === 'function')) {
      container.innerHTML = '<p style="color:#64748b;">Загружаем Google Sign-In…</p>';
      return;
    }

    try {
      google.accounts.id.renderButton(container, {
        type: 'standard',
        theme: 'filled_blue',
        size: 'large',
        text: 'signin_with',
        shape: 'pill',
        logo_alignment: 'left',
        locale: 'ru',
      });
    } catch (e) {
      container.innerHTML = '<p style="color:#b91c1c;">Не удалось показать кнопку входа: ' + escapeScriptPortalHtml_(e && e.message ? e.message : String(e)) + '</p>';
    }

    if (!scriptPortalState.didAutoPrompt) {
      scriptPortalState.didAutoPrompt = true;
      try { google.accounts.id.prompt(); } catch (e) {}
    }
  }

  function renderScriptPortalLoadingState_() {
    scriptPortalApp.innerHTML =
      '<div class="loading-state">' +
      '<h2>Загружаем скрипты обучения</h2>' +
      '<p>Считываем данные из Google Таблицы.</p>' +
      '</div>';
  }

  function renderScriptPortalError_(message) {
    scriptPortalApp.innerHTML =
      '<div class="error-state">' +
      '<h2>Не удалось открыть портал скриптов</h2>' +
      '<p>' + escapeScriptPortalHtml_(message) + '</p>' +
      '<p style="margin-top:14px;"><button type="button" data-role="retry-load" style="appearance:none;border:1px solid rgba(15,23,42,0.2);border-radius:10px;padding:10px 18px;font:inherit;cursor:pointer;background:#fff;">Повторить</button> ' +
      '<button type="button" data-role="sign-out" style="appearance:none;border:1px solid rgba(15,23,42,0.2);border-radius:10px;padding:10px 18px;font:inherit;cursor:pointer;background:#fff;margin-left:8px;">Выйти</button></p>' +
      '</div>';

    var retry = scriptPortalApp.querySelector('[data-role="retry-load"]');
    if (retry) retry.addEventListener('click', function () { loadScriptPortalData_(); });
    var out = scriptPortalApp.querySelector('[data-role="sign-out"]');
    if (out) out.addEventListener('click', signOut_);
  }

  // ---------- Page rendering (ported from script_portal_scripts_v2.html) ----------

  function renderScriptPortalPage_() {
    var data = scriptPortalState.data;
    var scenario = data.scenario || {};
    var steps = scenario.steps || [];
    var currentStep = steps[scriptPortalState.activeStepIndex] || steps[0] || null;

    scriptPortalApp.innerHTML =
      '<header class="topbar">' +
        '<div class="topbar-inner">' +
          '<div class="topbar-title">NaimTech | Обучение и скрипты</div>' +
          renderScriptPortalTopLinks_(data.meta || {}, scenario.key) +
        '</div>' +
      '</header>' +
      '<div class="page">' +
        '<aside class="sidebar">' +
          '<nav class="menu">' +
            (data.menu || []).map(renderScriptPortalMenuItem_).join('') +
          '</nav>' +
        '</aside>' +
        '<main class="main">' +
          '<section class="hero">' +
            '<div class="hero-title">' + escapeScriptPortalHtml_(scenario.title || 'Скрипты обучения') + '</div>' +
          '</section>' +
          (scriptPortalState.activeMenuId === 'scenario' ? renderScriptPortalCurrentStepIndicator_(currentStep) : '') +
          '<section class="steps-bar">' +
            '<div class="steps-list">' +
              steps.map(function (step, index) { return renderScriptPortalStep_(step, index); }).join('') +
            '</div>' +
          '</section>' +
          '<section class="content">' +
            (scriptPortalState.activeMenuId === 'scenario'
              ? renderScriptPortalScenarioContent_(scenario, currentStep)
              : renderScriptPortalPlaceholder_(data.menu || [])) +
          '</section>' +
        '</main>' +
      '</div>' +
      (scriptPortalState.activeMenuId === 'scenario' ? renderScriptPortalMobileBottomNav_() : '');

    applyScriptPortalDeviceMode_();
    attachScriptPortalInteractions_();
    scheduleScriptPortalSidePanelHeightSync_();
  }

  function renderScriptPortalMobileBottomNav_() {
    return '<nav class="mobile-bottom-nav" role="tablist" aria-label="Разделы шага">' +
      SCRIPT_PORTAL_MOBILE_TABS.map(function (tab) {
        var isActive = tab.id === scriptPortalState.activeMobileTab;
        return '<button type="button"' +
          ' class="mobile-bottom-tab ' + (isActive ? 'is-active' : '') + '"' +
          ' data-role="mobile-tab"' +
          ' data-tab="' + escapeScriptPortalAttr_(tab.id) + '"' +
          ' role="tab"' +
          ' aria-selected="' + (isActive ? 'true' : 'false') + '">' +
          '<span class="mobile-bottom-tab-icon" aria-hidden="true">' + iconSvg_(tab.icon || 'tabScript') + '</span>' +
          '<span class="mobile-bottom-tab-label">' + escapeScriptPortalHtml_(tab.label) + '</span>' +
          '</button>';
      }).join('') +
      '</nav>';
  }

  function renderScriptPortalCurrentStepIndicator_(currentStep) {
    if (!currentStep) return '';
    var number = String(currentStep.number || (scriptPortalState.activeStepIndex + 1));
    var title = currentStep.title || ('Шаг ' + (scriptPortalState.activeStepIndex + 1));
    return '<section class="mobile-step-indicator" aria-label="Текущий шаг">' +
      '<div class="mobile-step-indicator-badge">' + escapeScriptPortalHtml_(number) + '</div>' +
      '<div class="mobile-step-indicator-title">' + escapeScriptPortalHtml_(title) + '</div>' +
      '</section>';
  }

  function renderScriptPortalTopLinks_(meta, currentScenarioKey) {
    var links = [];
    (meta.scenarioLinks || []).forEach(function (item) {
      var isCurrent = item.key === currentScenarioKey;
      var disabled = scriptPortalState.isLoadingData ? 'disabled' : '';
      links.push(
        '<button type="button"' +
        ' class="topbar-link ' + (isCurrent ? 'is-active' : '') + '"' +
        ' data-role="scenario-switch"' +
        ' data-scenario-key="' + escapeScriptPortalAttr_(item.key) + '"' +
        ' style="appearance:none;cursor:pointer;color:#fff;"' +
        ' ' + disabled + '>' +
        escapeScriptPortalHtml_(item.label) +
        '</button>'
      );
    });

    var portalUrl = meta.recruiterPortalUrl || '';
    if (portalUrl) {
      links.push('<a class="topbar-link" href="' + escapeScriptPortalAttr_(portalUrl) + '">Личный кабинет</a>');
    }

    if (scriptPortalState.emailHint) {
      links.push(
        '<button type="button" class="topbar-link" data-role="sign-out" style="border-color:rgba(255,255,255,0.18);background:rgba(255,255,255,0.08);color:#fff;cursor:pointer;">' +
        'Выйти (' + escapeScriptPortalHtml_(scriptPortalState.emailHint) + ')' +
        '</button>'
      );
    }

    if (!links.length) return '';
    return '<div class="topbar-actions">' + links.join('') + '</div>';
  }

  function renderScriptPortalMenuItem_(item) {
    var isActive = item.id === scriptPortalState.activeMenuId;
    return '<button type="button"' +
      ' class="menu-item ' + (isActive ? 'is-active' : '') + '"' +
      ' data-role="menu-item"' +
      ' data-menu-id="' + escapeScriptPortalAttr_(item.id) + '">' +
      '<span class="menu-icon">' + (SCRIPT_PORTAL_ICONS[item.id] || SCRIPT_PORTAL_ICONS.scenario) + '</span>' +
      '<span class="menu-label">' + escapeScriptPortalHtml_(item.label) + '</span>' +
      '</button>';
  }

  function renderScriptPortalStep_(step, index) {
    var isActive = index === scriptPortalState.activeStepIndex;
    var isComplete = index < scriptPortalState.activeStepIndex;
    return '<button type="button"' +
      ' class="step-button ' + (isActive ? 'is-active' : '') + ' ' + (isComplete ? 'is-complete' : '') + '"' +
      ' data-role="step"' +
      ' data-step-index="' + index + '">' +
      '<span class="step-badge">' + (isComplete ? '&#10003;' : escapeScriptPortalHtml_(String(step.number || (index + 1)))) + '</span>' +
      '<span class="step-title">' + escapeScriptPortalHtml_(step.title || ('Шаг ' + (index + 1))) + '</span>' +
      '</button>';
  }

  function renderScriptPortalScenarioContent_(scenario, currentStep) {
    if (!currentStep) {
      return '<section class="panel placeholder-panel">' +
        '<h2>Сценарий пока пустой</h2>' +
        '<p>В листе не найдены шаги для отображения.</p>' +
        '</section>';
    }

    var content = currentStep.content || {};
    var prompts = scenario.prompts || [];
    var contract = scenario.contract || {};

    var stepsLen = (scenario.steps || []).length;
    var prevDisabled = scriptPortalState.activeStepIndex <= 0 ? 'disabled' : '';
    var nextDisabled = scriptPortalState.activeStepIndex >= stepsLen - 1 ? 'disabled' : '';

    return '<section class="panel script-step-panel" data-mobile-tab="script">' +
        '<div class="script-step-top">' +
          '<div class="panel-kicker">Текущий шаг</div>' +
          (content.summary ? renderScriptPortalStepGuide_(content.summary) : '') +
        '</div>' +
        '<div class="panel-title script-step-title">' + escapeScriptPortalHtml_(content.title || currentStep.title) + '</div>' +
        '<div class="script-step-scroll">' +
          '<div class="script-step-card">' +
            renderScriptPortalStepSection_({
              number: 1,
              title: 'Что сказать кандидату',
              text: content.script || '—',
              quote: true,
              pill: 'Сказать дословно',
            }) +
            '<div class="script-step-divider"></div>' +
            renderScriptPortalStepSection_({
              number: 2,
              title: 'Задача для этого шага',
              text: content.next || '—',
            }) +
            '<div class="script-step-divider"></div>' +
            renderScriptPortalStepSection_({
              number: 3,
              title: 'Советы',
              text: content.tip || '—',
              soft: true,
            }) +
          '</div>' +
        '</div>' +
        '<div class="nav-actions">' +
          '<button type="button" class="action-button" data-role="prev-step" ' + prevDisabled + '>&larr; Предыдущий шаг</button>' +
          '<button type="button" class="action-button is-primary" data-role="next-step" ' + nextDisabled + '>Следующий шаг &rarr;</button>' +
        '</div>' +
      '</section>' +
      renderScriptPortalObjectionsPanel_(scenario, prompts) +
      '<section class="panel is-warm contract-panel" data-mobile-tab="contract">' +
        '<div class="panel-title contract-panel-title">' + escapeScriptPortalHtml_(contract.title || 'Если кандидат настойчив и добивается слова "Контракт"') + '</div>' +
        (contract.subtitle ? '<div class="contract-subtitle">' + escapeScriptPortalHtml_(contract.subtitle) + '</div>' : '') +
        '<div class="contract-scroll">' +
          ((contract.levels || []).length
            ? '<div class="contract-list">' + (contract.levels || []).map(renderScriptPortalContractCard_).join('') + '</div>'
            : '<div class="empty-card">Уровни для этого блока пока не заполнены.</div>') +
          (contract.note
            ? '<div class="contract-note" style="margin-top: 14px;"><span class="contract-note-icon">i</span><div class="contract-text">' + escapeScriptPortalHtml_(contract.note) + '</div></div>'
            : '') +
        '</div>' +
      '</section>';
  }

  function renderScriptPortalStepGuide_(text) {
    return '<div class="step-guide">' +
      '<button type="button" class="step-guide-trigger" aria-describedby="step-guide-tooltip">' +
        '<span>Как вести этот шаг</span>' +
        '<span class="step-guide-icon" aria-hidden="true">i</span>' +
      '</button>' +
      '<div class="step-guide-tooltip" id="step-guide-tooltip" role="tooltip">' +
        escapeScriptPortalHtml_(text) +
      '</div>' +
    '</div>';
  }

  function renderScriptPortalStepSection_(section) {
    var classes = 'script-step-section ' + (section.quote ? 'is-quote' : '') + ' ' + (section.soft ? 'is-soft' : '');
    var body;
    if (section.quote) {
      body = '<div class="script-step-quote-box">' +
        '<span class="script-step-quote-mark" aria-hidden="true">"</span>' +
        '<div class="script-step-text">' + escapeScriptPortalHtml_(section.text) + '</div>' +
      '</div>';
    } else if (section.soft) {
      body = '<div class="script-step-soft-box">' +
        '<div class="script-step-text">' + escapeScriptPortalHtml_(section.text) + '</div>' +
      '</div>';
    } else {
      body = '<div class="script-step-task-text">' + escapeScriptPortalHtml_(section.text) + '</div>';
    }
    return '<div class="' + classes + '">' +
      '<div class="script-step-section-head">' +
        '<span class="script-step-number">' + escapeScriptPortalHtml_(String(section.number)) + '</span>' +
        '<span class="script-step-section-title">' + escapeScriptPortalHtml_(section.title) + '</span>' +
        (section.pill ? '<span class="script-step-pill">' + escapeScriptPortalHtml_(section.pill) + '</span>' : '') +
      '</div>' +
      body +
    '</div>';
  }

  function renderScriptPortalObjectionsPanel_(scenario, prompts) {
    var stageNumber = extractScriptPortalStageNumber_((scenario && scenario.title) || (scenario && scenario.sheetName) || '');
    var stageLabel = stageNumber ? ('Актуально на ' + stageNumber + ' этап') : 'Актуально для этапа';
    return '<section class="panel objections-panel" data-mobile-tab="objections">' +
      '<div class="objections-headline">' +
        '<div class="objections-title-wrap">' +
          '<span class="objections-flame">' + iconSvg_('flame') + '</span>' +
          '<div class="panel-title objections-title">Ответы на возражения</div>' +
        '</div>' +
        '<span class="objections-pill">' + escapeScriptPortalHtml_(stageLabel) + '</span>' +
      '</div>' +
      '<div class="objections-hint">Нажмите на ситуацию, чтобы показать ответ</div>' +
      '<div class="objections-scroll">' +
        (prompts.length
          ? '<div class="answer-list">' + prompts.map(renderScriptPortalPromptCard_).join('') + '</div>'
          : '<div class="empty-card">В этом блоке пока нет вопросов и ответов.</div>') +
      '</div>' +
    '</section>';
  }

  function renderScriptPortalPromptCard_(item) {
    var isOpen = !!scriptPortalState.openPromptIds[item.id];
    return '<div class="answer-card ' + (isOpen ? 'is-open' : '') + '">' +
      '<button type="button" class="answer-toggle" data-role="prompt-toggle" data-prompt-id="' + escapeScriptPortalAttr_(item.id) + '" aria-expanded="' + (isOpen ? 'true' : 'false') + '">' +
        '<span class="answer-dot">...</span>' +
        '<span class="answer-title">' + escapeScriptPortalHtml_(item.question) + '</span>' +
        '<span class="answer-chevron" aria-hidden="true">' + iconSvg_('chevron') + '</span>' +
      '</button>' +
      '<div class="answer-body">' +
        '<div class="answer-body-inner">' +
          '<div class="answer-text">' + escapeScriptPortalHtml_(item.answer || 'Ответ пока не заполнен.') + '</div>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  function renderScriptPortalContractCard_(item) {
    var isOpen = !!scriptPortalState.openContractIds[item.id];
    return '<div class="contract-card ' + (isOpen ? 'is-open' : '') + '">' +
      '<div class="contract-level">' + escapeScriptPortalHtml_(item.title) + '</div>' +
      '<div class="contract-text">' + escapeScriptPortalHtml_(item.situation || '') + '</div>' +
      '<button type="button" class="contract-toggle" data-role="contract-toggle" data-contract-id="' + escapeScriptPortalAttr_(item.id) + '" aria-expanded="' + (isOpen ? 'true' : 'false') + '">' +
        '<span>' + escapeScriptPortalHtml_(item.buttonLabel || 'Показать ответ') + '</span>' +
        '<span class="contract-chevron" aria-hidden="true">' + iconSvg_('chevron') + '</span>' +
      '</button>' +
      '<div class="contract-response-wrap">' +
        '<div class="contract-response-inner">' +
          '<div class="contract-response">' + escapeScriptPortalHtml_(item.response || 'Ответ пока не заполнен.') + '</div>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  function renderScriptPortalPlaceholder_(menuItems) {
    var activeItem = (menuItems || []).find(function (item) { return item.id === scriptPortalState.activeMenuId; }) || {};
    return '<section class="panel placeholder-panel">' +
      '<h2>' + escapeScriptPortalHtml_(activeItem.label || 'Раздел') + '</h2>' +
      '<p>Этот раздел уже отображается в меню, но его контент пока не подключен. На текущем этапе работает только раздел "Сценарий".</p>' +
    '</section>';
  }

  // ---------- Interactions ----------

  function attachScriptPortalInteractions_() {
    scriptPortalApp.onclick = function (event) {
      var signOutBtn = event.target.closest('[data-role="sign-out"]');
      if (signOutBtn) {
        event.preventDefault();
        signOut_();
        return;
      }

      var scenarioSwitchBtn = event.target.closest('[data-role="scenario-switch"]');
      if (scenarioSwitchBtn) {
        event.preventDefault();
        var nextKey = scenarioSwitchBtn.getAttribute('data-scenario-key') || '';
        var currentKey = (scriptPortalState.data && scriptPortalState.data.scenario)
          ? scriptPortalState.data.scenario.key
          : '';
        if (!nextKey || nextKey === currentKey || scriptPortalState.isLoadingData) return;
        switchScenario_(nextKey);
        return;
      }

      var menuItem = event.target.closest('[data-role="menu-item"]');
      if (menuItem) {
        scriptPortalState.activeMenuId = menuItem.getAttribute('data-menu-id') || 'scenario';
        renderScriptPortalPage_();
        return;
      }

      var mobileTab = event.target.closest('[data-role="mobile-tab"]');
      if (mobileTab) {
        var nextTab = mobileTab.getAttribute('data-tab') || 'script';
        if (scriptPortalState.activeMobileTab !== nextTab) {
          scriptPortalState.activeMobileTab = nextTab;
          document.body.setAttribute('data-active-tab', nextTab);
          scriptPortalApp.querySelectorAll('[data-role="mobile-tab"]').forEach(function (node) {
            var isActive = node.getAttribute('data-tab') === nextTab;
            node.classList.toggle('is-active', isActive);
            node.setAttribute('aria-selected', isActive ? 'true' : 'false');
          });
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }
        return;
      }

      var stepButton = event.target.closest('[data-role="step"]');
      if (stepButton) {
        var stepsLen = (scriptPortalState.data && scriptPortalState.data.scenario && scriptPortalState.data.scenario.steps) ? scriptPortalState.data.scenario.steps.length : 0;
        scriptPortalState.activeStepIndex = coerceScriptPortalIndex_(stepButton.getAttribute('data-step-index'), stepsLen, true);
        renderScriptPortalPage_();
        return;
      }

      if (event.target.closest('[data-role="prev-step"]')) {
        scriptPortalState.activeStepIndex = Math.max(0, scriptPortalState.activeStepIndex - 1);
        renderScriptPortalPage_();
        return;
      }

      if (event.target.closest('[data-role="next-step"]')) {
        var maxIndex = Math.max(0, (scriptPortalState.data && scriptPortalState.data.scenario && scriptPortalState.data.scenario.steps ? scriptPortalState.data.scenario.steps.length : 1) - 1);
        scriptPortalState.activeStepIndex = Math.min(maxIndex, scriptPortalState.activeStepIndex + 1);
        renderScriptPortalPage_();
        return;
      }

      var promptToggle = event.target.closest('[data-role="prompt-toggle"]');
      if (promptToggle) {
        var promptId = promptToggle.getAttribute('data-prompt-id');
        var willOpenP = !scriptPortalState.openPromptIds[promptId];
        scriptPortalState.openPromptIds[promptId] = willOpenP;
        var pCard = promptToggle.closest('.answer-card');
        if (pCard) {
          pCard.classList.toggle('is-open', willOpenP);
          promptToggle.setAttribute('aria-expanded', willOpenP ? 'true' : 'false');
        } else {
          renderScriptPortalPage_();
        }
        return;
      }

      var contractToggle = event.target.closest('[data-role="contract-toggle"]');
      if (contractToggle) {
        var contractId = contractToggle.getAttribute('data-contract-id');
        var willOpenC = !scriptPortalState.openContractIds[contractId];
        scriptPortalState.openContractIds[contractId] = willOpenC;
        var cCard = contractToggle.closest('.contract-card');
        if (cCard) {
          cCard.classList.toggle('is-open', willOpenC);
          contractToggle.setAttribute('aria-expanded', willOpenC ? 'true' : 'false');
        } else {
          renderScriptPortalPage_();
        }
      }
    };
  }

  // ---------- Side panel sync (desktop) ----------

  function syncScriptPortalSidePanelHeights_() {
    var content = scriptPortalApp.querySelector('.content');
    var objectionsPanel = scriptPortalApp.querySelector('.objections-panel');
    var contractPanel = scriptPortalApp.querySelector('.contract-panel');

    [objectionsPanel, contractPanel].forEach(function (panel) {
      if (!panel) return;
      panel.style.height = '';
      panel.style.maxHeight = '';
    });
    if (content) content.style.removeProperty('--script-side-panel-height');

    if (
      !scriptPortalApp ||
      !document.body ||
      document.body.classList.contains('is-mobile') ||
      scriptPortalState.activeMenuId !== 'scenario'
    ) {
      disconnectScriptPortalSidePanelObserver_();
      return;
    }

    var stepPanel = scriptPortalApp.querySelector('.script-step-panel');
    if (!stepPanel || !objectionsPanel || !contractPanel) {
      disconnectScriptPortalSidePanelObserver_();
      return;
    }

    var stepPanelHeight = stepPanel.getBoundingClientRect().height;
    if (!stepPanelHeight) return;

    var syncedHeight = Math.ceil(stepPanelHeight) + 'px';
    if (content) content.style.setProperty('--script-side-panel-height', syncedHeight);
    objectionsPanel.style.height = syncedHeight;
    objectionsPanel.style.maxHeight = syncedHeight;
    contractPanel.style.height = syncedHeight;
    contractPanel.style.maxHeight = syncedHeight;
    observeScriptPortalStepPanelHeight_(stepPanel);
  }

  function scheduleScriptPortalSidePanelHeightSync_() {
    if (scriptPortalSidePanelHeightFrame_) {
      window.cancelAnimationFrame(scriptPortalSidePanelHeightFrame_);
    }
    scriptPortalSidePanelHeightFrame_ = window.requestAnimationFrame(function () {
      scriptPortalSidePanelHeightFrame_ = 0;
      syncScriptPortalSidePanelHeights_();
    });
  }

  function observeScriptPortalStepPanelHeight_(stepPanel) {
    if (typeof ResizeObserver === 'undefined') return;
    if (scriptPortalObservedStepPanel_ === stepPanel) return;

    disconnectScriptPortalSidePanelObserver_();
    scriptPortalObservedStepPanel_ = stepPanel;
    scriptPortalSidePanelResizeObserver_ = new ResizeObserver(function () {
      scheduleScriptPortalSidePanelHeightSync_();
    });
    scriptPortalSidePanelResizeObserver_.observe(stepPanel);
  }

  function disconnectScriptPortalSidePanelObserver_() {
    if (scriptPortalSidePanelResizeObserver_) {
      scriptPortalSidePanelResizeObserver_.disconnect();
    }
    scriptPortalSidePanelResizeObserver_ = null;
    scriptPortalObservedStepPanel_ = null;
  }

  // ---------- Helpers ----------

  function coerceScriptPortalIndex_(value, total, isZeroBased) {
    var count = Number(total || 0);
    if (!count) return 0;
    var numeric = Number(value);
    if (!Number.isFinite(numeric)) return 0;
    var zeroBased = isZeroBased ? numeric : (numeric > 0 ? numeric - 1 : 0);
    return Math.max(0, Math.min(count - 1, zeroBased));
  }

  function iconSvg_(name) {
    if (name === 'book') {
      return '<svg viewBox="0 0 24 24"><path d="M6 5.5A2.5 2.5 0 0 1 8.5 3H19v17H8.5A2.5 2.5 0 0 0 6 22"/><path d="M6 5.5V22"/><path d="M10 7h5"/><path d="M10 11h5"/></svg>';
    }
    if (name === 'folder') {
      return '<svg viewBox="0 0 24 24"><path d="M3 19.5V6.5h6l2 2H21v11z"/></svg>';
    }
    if (name === 'chat') {
      return '<svg viewBox="0 0 24 24"><path d="M5 18l1.5-3A7 7 0 1 1 19 11"/><path d="M8 10h.01"/><path d="M12 10h.01"/><path d="M16 10h.01"/></svg>';
    }
    if (name === 'bookmark') {
      return '<svg viewBox="0 0 24 24"><path d="M7 21V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16l-5-3z"/></svg>';
    }
    if (name === 'map') {
      return '<svg viewBox="0 0 24 24"><path d="M9 18l-6 3V6l6-3 6 3 6-3v15l-6 3z"/><path d="M9 3v15"/><path d="M15 6v15"/></svg>';
    }
    if (name === 'users') {
      return '<svg viewBox="0 0 24 24"><path d="M16 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2"/><circle cx="9.5" cy="7" r="3.5"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16.5 3.13a3.5 3.5 0 0 1 0 6.74"/></svg>';
    }
    if (name === 'warning') {
      return '<svg viewBox="0 0 24 24"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>';
    }
    if (name === 'flame') {
      return '<svg viewBox="0 0 24 24"><path d="M12 22a7 7 0 0 0 7-7c0-3.8-2.5-6.4-4.6-8.4-.8-.8-1.5-1.8-1.9-3.1a.5.5 0 0 0-.9-.1C9.8 5.9 8 8 8 10.8c0 .8.2 1.6.6 2.3-1.1-.3-2-.9-2.7-1.8a.5.5 0 0 0-.9.2A9 9 0 0 0 5 14.8 7 7 0 0 0 12 22z"/><path d="M12 18a3 3 0 0 0 3-3c0-1.6-1-2.7-2-3.6-.5.9-1.2 1.5-2 2.1A2.9 2.9 0 0 0 9 15a3 3 0 0 0 3 3z"/></svg>';
    }
    if (name === 'chevron') {
      return '<svg viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg>';
    }
    if (name === 'tabScript') {
      return '<svg viewBox="0 0 24 24"><rect x="5" y="3" width="14" height="18" rx="2.5"/><path d="M9 8h6"/><path d="M9 12h6"/><path d="M9 16h4"/></svg>';
    }
    if (name === 'tabQuestions') {
      return '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="3.5"/><path d="M5 20v-1a4 4 0 0 1 4-4h6a4 4 0 0 1 4 4v1"/><path d="M3 9.5c.6-.8 1.4-1.5 2.3-2"/><path d="M21 9.5c-.6-.8-1.4-1.5-2.3-2"/></svg>';
    }
    if (name === 'tabCheatsheet') {
      return '<svg viewBox="0 0 24 24"><path d="M7 3h10a1 1 0 0 1 1 1v17l-6-3.5L6 21V4a1 1 0 0 1 1-1z"/></svg>';
    }
    return '';
  }

  function extractScriptPortalStageNumber_(value) {
    var match = String(value || '').match(/этап\s*(\d+)/i) || String(value || '').match(/(\d+)/);
    return match ? match[1] : '';
  }

  function escapeScriptPortalHtml_(value) {
    return String(value === null || value === undefined ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function escapeScriptPortalAttr_(value) {
    return escapeScriptPortalHtml_(value).replace(/`/g, '&#096;');
  }
})();

/**
 * LCO i18n — internationalization strings.
 *
 * Minimal initial set. Languages can be added by extending LCO_I18N.
 * Load a config.json language preference to determine the active locale.
 */
(function () {
  'use strict';

  var DEFAULT_LOCALE = 'en';

  var messages = {
    en: {
      loading: 'Loading Monaco Editor…',
      loadError: 'Failed to load Monaco Editor',
      ready: 'Editor ready',
      welcome: 'Welcome to LCO — Lite Code On-device',
      fileSaved: 'File saved',
      fileNotFound: 'File not found',
      permissionDenied: 'Permission denied',
      gitInit: 'Initialized empty Git repository',
      gitStatus: 'On branch main',
      autosaveFailed: 'Auto-save failed',
      rpcTimeout: 'Request timed out',
      unknownError: 'Unknown error occurred'
    },
    zh: {
      loading: '正在加载 Monaco Editor…',
      loadError: 'Monaco Editor 加载失败',
      ready: '编辑器就绪',
      welcome: '欢迎使用 LCO — Lite Code On-device',
      fileSaved: '文件已保存',
      fileNotFound: '文件未找到',
      permissionDenied: '权限被拒绝',
      gitInit: '已初始化空的 Git 仓库',
      gitStatus: '当前分支 main',
      autosaveFailed: '自动保存失败',
      rpcTimeout: '请求超时',
      unknownError: '发生未知错误'
    }
  };

  /**
   * Get a localized message by key.
   * @param {string} key
   * @param {string} [locale]
   * @returns {string}
   */
  function t(key, locale) {
    locale = locale || DEFAULT_LOCALE;
    var lang = messages[locale] || messages[DEFAULT_LOCALE];
    return lang[key] || messages[DEFAULT_LOCALE][key] || key;
  }

  /**
   * Set the active locale.
   * @param {string} locale
   */
  function setLocale(locale) {
    if (messages[locale]) {
      DEFAULT_LOCALE = locale;
      // Emit an event so the UI can re-render localized text.
      window.dispatchEvent(new CustomEvent('lco-locale-changed', {
        detail: { locale: locale }
      }));
    }
  }

  /**
   * Get the current locale.
   * @returns {string}
   */
  function getLocale() {
    return DEFAULT_LOCALE;
  }

  // Expose globally.
  window.LCO_i18n = {
    t: t,
    setLocale: setLocale,
    getLocale: getLocale,
    locales: Object.keys(messages),
    messages: messages
  };

})();

(function installPwBotAccessor() {
  const stateKey = "__urlRedirectorPwBotDetectionState__";
  const apiKey = "__urlRedirectorPwBotDetectionApi__";
  const scoreKey = "_pwBotScore";

  const existingApi = window[apiKey];
  if (existingApi && typeof existingApi.install === "function") {
    existingApi.activate();
    return;
  }

  const state = window[stateKey] || {
    active: true,
    hasValue: Object.prototype.hasOwnProperty.call(window, scoreKey),
    value: window[scoreKey]
  };

  function readScore() {
    return state.active ? 99 : state.value;
  }

  function writeScore(value) {
    state.hasValue = true;
    state.value = value;
  }

  function install() {
    try {
      Object.defineProperty(window, scoreKey, {
        configurable: true,
        enumerable: true,
        get: readScore,
        set: writeScore
      });
    } catch {
      return false;
    }
    return true;
  }

  const api = {
    install,
    activate() {
      state.active = true;
      return install();
    },
    deactivate() {
      state.active = false;
      return install();
    },
    isActive() {
      return state.active;
    }
  };

  Object.defineProperty(window, stateKey, {
    configurable: true,
    value: state
  });
  Object.defineProperty(window, apiKey, {
    configurable: true,
    value: api
  });

  api.activate();
})();

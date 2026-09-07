/**
 * Where the Cesium ion token lives.
 *
 * Not in a file. `config.js` is tracked by git, so a token pasted there travels to
 * whatever remote the repository has, and a token in a working copy is one careless
 * `git add -A` from being published. Neither is recoverable by editing it out later:
 * once a credential has been pushed it has to be rotated.
 *
 * So the token is held in the browser's local storage instead, entered once through
 * the interface. It stays on the machine that entered it, it is never written to the
 * repository, and each person who opens the application uses their own — which is
 * how an access token is supposed to work anyway.
 */

const STORAGE_KEY = "3drome.ionToken";

/**
 * The token to use, in precedence order: the configuration first, so an unattended
 * or kiosk deployment can be pinned deliberately, then local storage.
 */
export function resolveIonToken(cfg) {
  const configured = (cfg.view.ionToken ?? "").trim();
  if (configured) return configured;
  return readStored();
}

export function readStored() {
  try {
    return (localStorage.getItem(STORAGE_KEY) ?? "").trim();
  } catch {
    // Private windows and locked-down browser policies can refuse storage entirely.
    return "";
  }
}

/** @returns {boolean} whether the token could actually be stored. */
export function storeToken(token) {
  try {
    const trimmed = token.trim();
    if (trimmed) localStorage.setItem(STORAGE_KEY, trimmed);
    else localStorage.removeItem(STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}

export function clearToken() {
  return storeToken("");
}

/**
 * A cheap shape check before we bother the network. Cesium ion tokens are JWTs, so
 * three dot-separated segments beginning with `eyJ`. Catching a half-copied paste
 * here gives a better answer than a generic rejection from the API.
 */
export function looksLikeIonToken(token) {
  const t = token.trim();
  return t.startsWith("eyJ") && t.split(".").length === 3;
}

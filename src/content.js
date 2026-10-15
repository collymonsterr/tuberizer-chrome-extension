/* global TUBERIZER_CONFIG */
// Tuberizer for YouTube — adds a "Tuberize" button to the watch page and opens
// the Tuberizer summary (tuberizer.com/embed/youtube/:videoId) in a modal.
//
// Notes:
// - YouTube enforces Trusted Types, so no innerHTML anywhere: DOM is built by hand.
// - Everything we render lives in closed shadow roots on custom tags, so YouTube's
//   CSS can't reach in and ours can't leak out.
(() => {
  "use strict";

  const CFG = TUBERIZER_CONFIG;
  const BUTTON_TAG = "tuberizer-action";
  const MODAL_TAG = "tuberizer-modal";
  const BRAND_RED = "#cc3d33";
  const SVG_NS = "http://www.w3.org/2000/svg";
  const ZAP_PATH =
    "M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z";
  const CHECK_PATH = "M20 6 9 17l-5-5";
  const CLOSE_PATH = "M18 6 6 18M6 6l12 12";

  // Where to put the button, most specific first. Each entry says how to insert.
  const ACTION_TARGETS = [
    { selector: "ytd-watch-metadata #top-level-buttons-computed", insert: "append" },
    { selector: "ytd-watch-metadata #actions-inner #menu", insert: "before" },
    { selector: "ytd-watch-metadata #actions", insert: "prepend" },
  ];
  const RETRY_INTERVAL_MS = 500;
  const RETRY_LIMIT = 40; // ~20s

  // A previous copy of this script (e.g. before the extension was reloaded) may have
  // left elements behind; its listeners are dead, so clear them out.
  document.querySelectorAll(`${BUTTON_TAG}, ${MODAL_TAG}`).forEach((el) => el.remove());

  // ---------------------------------------------------------------------------
  // Helpers

  function getVideoId() {
    if (location.pathname !== "/watch") return null;
    const v = new URLSearchParams(location.search).get("v");
    return v && /^[A-Za-z0-9_-]{11}$/.test(v) ? v : null;
  }

  function getVideoElement() {
    return document.querySelector("#movie_player video.html5-main-video") || document.querySelector("video");
  }

  function getVideoTitle() {
    const h1 = document.querySelector("ytd-watch-metadata:not([hidden]) h1");
    const text = (h1 && h1.textContent.trim()) || document.title.replace(/^\(\d+\)\s*/, "").replace(/ - YouTube$/, "");
    return text.trim();
  }

  function isVisible(el) {
    return !!el && el.getClientRects().length > 0 && !el.closest("[hidden]");
  }

  function icon(pathD, { size = 24, color = "currentColor", strokeWidth = 2 } = {}) {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("width", String(size));
    svg.setAttribute("height", String(size));
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", color);
    svg.setAttribute("stroke-width", String(strokeWidth));
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    svg.setAttribute("aria-hidden", "true");
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", pathD);
    svg.appendChild(path);
    return svg;
  }

  function el(tag, props = {}, children = []) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (key === "className") node.className = value;
      else if (key === "text") node.textContent = value;
      else node.setAttribute(key, value);
    }
    for (const child of children) node.appendChild(child);
    return node;
  }

  function styleSheet(css) {
    const style = document.createElement("style");
    style.textContent = css;
    return style;
  }

  function summaryPageUrl(videoId) {
    return `${CFG.origin}/share/${videoId}`;
  }

  // ---------------------------------------------------------------------------
  // "Already Tuberized?" lookup — one cheap, cached, read-only query per video.

  const summaryKnown = new Map(); // videoId -> boolean
  let lookupAbort = null;

  function lookupExistingSummary(videoId) {
    if (!CFG.checkExistingSummaries || summaryKnown.has(videoId)) return;
    if (lookupAbort) lookupAbort.abort();
    lookupAbort = new AbortController();
    const url =
      `${CFG.supabaseUrl}/rest/v1/video_summaries` +
      `?select=b:bullets->0,k:key_takeaways->0&video_id=eq.${encodeURIComponent(videoId)}&limit=1`;
    fetch(url, { headers: { apikey: CFG.supabaseAnonKey }, signal: lookupAbort.signal })
      .then((res) => (res.ok ? res.json() : []))
      .then((rows) => {
        // Matches the web app: a row with no bullets and no takeaways doesn't count.
        const exists = Array.isArray(rows) && rows.some((r) => r.b != null || r.k != null);
        summaryKnown.set(videoId, exists);
        if (getVideoId() === videoId) button.setTuberized(exists);
      })
      .catch(() => {});
  }

  function markTuberized(videoId) {
    summaryKnown.set(videoId, true);
    if (getVideoId() === videoId) button.setTuberized(true);
  }

  // ---------------------------------------------------------------------------
  // The YouTube action-bar button

  const button = (() => {
    const host = document.createElement(BUTTON_TAG);
    const root = host.attachShadow({ mode: "closed" });
    root.appendChild(
      styleSheet(`
        :host { all: initial; display: inline-flex; flex: none; margin-left: 8px; }
        button {
          display: inline-flex; align-items: center; gap: 6px;
          height: 36px; padding: 0 16px 0 12px; margin: 0;
          border: none; border-radius: 18px; cursor: pointer; white-space: nowrap;
          font-family: "Roboto", "Arial", sans-serif; font-size: 14px; font-weight: 500; line-height: 36px;
          color: #0f0f0f; background: rgba(0, 0, 0, 0.05);
          transition: background-color 0.1s;
        }
        button:hover { background: rgba(0, 0, 0, 0.1); }
        button:active { background: rgba(0, 0, 0, 0.2); }
        button:focus-visible { outline: 2px solid #065fd4; outline-offset: 2px; }
        /* YouTube's theme variables don't reliably reach us, so colours are explicit per theme. */
        :host([data-theme="dark"]) button { color: #f1f1f1; background: rgba(255, 255, 255, 0.1); }
        :host([data-theme="dark"]) button:hover { background: rgba(255, 255, 255, 0.2); }
        :host([data-theme="dark"]) button:active { background: rgba(255, 255, 255, 0.3); }
        :host([data-theme="dark"]) button:focus-visible { outline-color: #3ea6ff; }
        .icon { display: inline-flex; }
        .done { display: inline-flex; margin-left: -2px; opacity: 0.7; }
        .done[hidden] { display: none; }
        .icon svg { display: block; }
        .tip {
          position: fixed; z-index: 2147483646; pointer-events: none;
          padding: 8px; border-radius: 4px; max-width: 280px;
          font-family: "Roboto", "Arial", sans-serif; font-size: 12px; line-height: 18px;
          color: #fff; background: rgba(97, 97, 97, 0.92);
          opacity: 0; transform: translateX(-50%); transition: opacity 0.1s;
        }
        .tip.show { opacity: 1; transition-delay: 0.35s; }
        @media (max-width: 520px) {
          .label { display: none; }
          button { padding: 0 6px; width: 36px; justify-content: center; }
        }
      `)
    );

    const iconWrap = el("span", { className: "icon" });
    const label = el("span", { className: "label" });
    const done = el("span", { className: "done" }, [icon(CHECK_PATH, { size: 16, strokeWidth: 2.5 })]);
    const btn = el("button", { type: "button" }, [iconWrap, label, done]);
    iconWrap.appendChild(icon(ZAP_PATH, { color: BRAND_RED }));
    label.textContent = "AI Summary";

    // YouTube marks dark mode with a `dark` attribute on <html>.
    const syncTheme = () => host.setAttribute("data-theme", document.documentElement.hasAttribute("dark") ? "dark" : "light");
    syncTheme();
    new MutationObserver(syncTheme).observe(document.documentElement, { attributes: true, attributeFilter: ["dark"] });
    const tip = el("div", { className: "tip", role: "tooltip", id: "tip" });
    btn.setAttribute("aria-describedby", "tip");
    root.append(btn, tip);

    // A small tick after the label marks videos Tuberizer has already summarised.
    function setTuberized(isDone) {
      done.hidden = !isDone;
      tip.textContent = isDone ? "Read the Tuberizer summary of this video" : "Summarize this video with Tuberizer";
      btn.setAttribute("aria-label", tip.textContent);
    }
    setTuberized(false);

    // Tooltip is position:fixed so the action bar's overflow can't clip it.
    function showTip() {
      const r = btn.getBoundingClientRect();
      tip.style.left = `${r.left + r.width / 2}px`;
      tip.style.top = `${r.bottom + 8}px`;
      tip.classList.add("show");
    }
    const hideTip = () => tip.classList.remove("show");
    btn.addEventListener("mouseenter", showTip);
    btn.addEventListener("mouseleave", hideTip);
    btn.addEventListener("focus", showTip);
    btn.addEventListener("blur", hideTip);

    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      hideTip();
      const videoId = getVideoId();
      if (videoId) modal.open(videoId);
    });

    return { host, setTuberized };
  })();

  // ---------------------------------------------------------------------------
  // Keeping the button in YouTube's action bar across SPA navigations

  let retryTimer = null;
  let retryCount = 0;
  let metadataObserver = null;
  let ensureQueued = false;

  function findActionTarget() {
    for (const target of ACTION_TARGETS) {
      const node = Array.from(document.querySelectorAll(target.selector)).find(isVisible);
      if (node) return { node, insert: target.insert };
    }
    return null;
  }

  function placeButton(target) {
    const { node, insert } = target;
    if (insert === "append") {
      if (button.host.parentNode !== node || node.lastElementChild !== button.host) node.appendChild(button.host);
    } else if (insert === "prepend") {
      if (node.firstElementChild !== button.host) node.prepend(button.host);
    } else if (node.previousElementSibling !== button.host) {
      node.before(button.host);
    }
  }

  // Watch the metadata block so we can put the button back if YouTube re-renders it away.
  function observeMetadata(target) {
    const metadata = target.node.closest("ytd-watch-metadata");
    if (!metadata) return;
    if (metadataObserver && metadataObserver.target === metadata) return;
    if (metadataObserver) metadataObserver.observer.disconnect();
    const observer = new MutationObserver(() => {
      if (!button.host.isConnected || !isVisible(button.host)) queueEnsure();
    });
    observer.observe(metadata, { childList: true, subtree: true });
    metadataObserver = { observer, target: metadata };
  }

  function stopRetrying() {
    if (retryTimer) clearInterval(retryTimer);
    retryTimer = null;
  }

  /** Returns true when there's nothing more to do for the current page. */
  function ensureButton() {
    const videoId = getVideoId();
    if (!videoId) {
      button.host.remove();
      return true;
    }
    const target = findActionTarget();
    if (!target) return false;
    placeButton(target);
    observeMetadata(target);
    button.setTuberized(summaryKnown.get(videoId) === true);
    lookupExistingSummary(videoId);
    return true;
  }

  function queueEnsure() {
    if (ensureQueued) return;
    ensureQueued = true;
    requestAnimationFrame(() => {
      ensureQueued = false;
      if (!ensureButton()) startRetrying();
    });
  }

  // YouTube's action bar renders lazily; poll briefly rather than observing all of <body>.
  function startRetrying() {
    if (retryTimer) return;
    retryCount = 0;
    retryTimer = setInterval(() => {
      retryCount += 1;
      if (ensureButton() || retryCount >= RETRY_LIMIT) stopRetrying();
    }, RETRY_INTERVAL_MS);
  }

  function onNavigate() {
    stopRetrying();
    if (modal.videoId && modal.videoId !== getVideoId()) modal.destroy();
    if (!ensureButton()) startRetrying();
  }

  // ---------------------------------------------------------------------------
  // The Tuberizer modal

  const modal = (() => {
    let host = null;
    let refs = null;
    let loadTimer = null;
    let restoreFocusTo = null;
    let savedOverflow = null;
    const state = { videoId: null, isOpen: false };

    const CSS = `
      :host { all: initial; }
      .backdrop {
        position: fixed; inset: 0;
        background: rgba(0, 0, 0, 0.6);
        display: flex; align-items: center; justify-content: center;
        animation: fade-in 0.15s ease-out;
      }
      .window {
        position: relative; display: flex; flex-direction: column;
        width: 90vw; height: 88vh; max-width: 1280px; max-height: 1000px;
        background: #000; color: #fff; overflow: hidden;
        border-radius: 12px;
        box-shadow: 0 24px 64px rgba(0, 0, 0, 0.45), 0 0 0 1px rgba(255, 255, 255, 0.08);
        font-family: "Roboto", "Arial", sans-serif;
        animation: pop-in 0.18s ease-out;
      }
      .toolbar {
        flex: none; display: flex; align-items: center; gap: 12px;
        height: 48px; padding: 0 8px 0 16px;
        background: #0f0f0f; border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      }
      .brand { display: flex; align-items: center; gap: 8px; min-width: 0; flex: 1; }
      .brand-mark {
        flex: none; display: inline-flex; align-items: center; justify-content: center;
        width: 26px; height: 26px; border-radius: 6px; background: ${BRAND_RED};
      }
      .brand-name { flex: none; font-size: 15px; font-weight: 600; letter-spacing: 0.01em; }
      .video-title {
        min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        font-size: 13px; color: rgba(255, 255, 255, 0.6);
      }
      .video-title::before { content: "·"; margin: 0 8px 0 2px; color: rgba(255, 255, 255, 0.35); }
      .open {
        flex: none; display: inline-flex; align-items: center; height: 32px; padding: 0 12px;
        border-radius: 16px; font-size: 13px; font-weight: 500; text-decoration: none;
        color: #fff; background: rgba(255, 255, 255, 0.1);
      }
      .open:hover { background: rgba(255, 255, 255, 0.18); }
      .close {
        flex: none; display: inline-flex; align-items: center; justify-content: center;
        width: 36px; height: 36px; padding: 0; border: none; border-radius: 50%;
        color: #fff; background: transparent; cursor: pointer;
      }
      .close:hover { background: rgba(255, 255, 255, 0.12); }
      .open:focus-visible, .close:focus-visible, .retry:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
      .body { position: relative; flex: 1; min-height: 0; }
      iframe { display: block; width: 100%; height: 100%; border: 0; background: #000; }
      .status {
        position: absolute; inset: 0; display: flex; flex-direction: column;
        align-items: center; justify-content: center; gap: 14px; padding: 24px;
        background: #000; text-align: center; font-size: 14px; color: rgba(255, 255, 255, 0.7);
      }
      .status[hidden] { display: none; }
      .spinner {
        width: 28px; height: 28px; border-radius: 50%;
        border: 3px solid rgba(255, 255, 255, 0.15); border-top-color: ${BRAND_RED};
        animation: spin 0.8s linear infinite;
      }
      .error-title { font-size: 16px; font-weight: 600; color: #fff; }
      .actions { display: flex; gap: 10px; }
      .retry {
        height: 36px; padding: 0 16px; border: none; border-radius: 18px; cursor: pointer;
        font: 500 14px "Roboto", "Arial", sans-serif; color: #fff; background: ${BRAND_RED};
      }
      @keyframes spin { to { transform: rotate(360deg); } }
      @keyframes fade-in { from { opacity: 0; } }
      @keyframes pop-in { from { opacity: 0; transform: scale(0.98); } }
      @media (max-width: 640px) {
        .window { width: 100vw; height: 100vh; max-height: none; border-radius: 0; }
        .video-title { display: none; }
      }
      @media (prefers-reduced-motion: reduce) {
        .backdrop, .window { animation: none; }
      }
    `;

    function build() {
      host = document.createElement(MODAL_TAG);
      for (const [prop, value] of [
        ["position", "fixed"],
        ["inset", "0"],
        ["z-index", "2147483647"],
        ["display", "block"],
      ]) {
        host.style.setProperty(prop, value, "important");
      }
      const root = host.attachShadow({ mode: "closed" });

      const mark = el("span", { className: "brand-mark" }, [icon(ZAP_PATH, { size: 16, color: "#fff" })]);
      const title = el("span", { className: "video-title" });
      const openLink = el("a", { className: "open", target: "_blank", rel: "noopener", text: "Open in Tuberizer ↗" });
      const closeBtn = el("button", { className: "close", type: "button", "aria-label": "Close Tuberizer" }, [
        icon(CLOSE_PATH, { size: 20 }),
      ]);
      const toolbar = el("div", { className: "toolbar" }, [
        el("div", { className: "brand" }, [mark, el("span", { className: "brand-name", text: "Tuberizer" }), title]),
        openLink,
        closeBtn,
      ]);

      const frame = el("iframe", { title: "Tuberizer summary", allow: "clipboard-write" });
      const statusText = el("div", { text: "Loading Tuberizer…" });
      const loading = el("div", { className: "status" }, [el("div", { className: "spinner" }), statusText]);
      const retryBtn = el("button", { className: "retry", type: "button", text: "Try again" });
      const errorOpen = el("a", { className: "open", target: "_blank", rel: "noopener", text: "Open in Tuberizer ↗" });
      const error = el("div", { className: "status", role: "alert" }, [
        el("div", { className: "error-title", text: "Couldn't load Tuberizer" }),
        el("div", { text: "Check your connection, or open the summary on tuberizer.com." }),
        el("div", { className: "actions" }, [retryBtn, errorOpen]),
      ]);
      error.hidden = true;

      const body = el("div", { className: "body" }, [frame, loading, error]);
      const win = el("div", { className: "window", role: "dialog", "aria-modal": "true", "aria-label": "Tuberizer" }, [
        toolbar,
        body,
      ]);
      const backdrop = el("div", { className: "backdrop" }, [win]);
      root.append(styleSheet(CSS), backdrop);

      backdrop.addEventListener("click", (e) => {
        if (e.target === backdrop) close();
      });
      closeBtn.addEventListener("click", close);
      retryBtn.addEventListener("click", () => load(state.videoId));

      refs = { frame, title, openLink, errorOpen, loading, error, closeBtn };
      document.documentElement.appendChild(host);
    }

    function setStatus(which) {
      refs.loading.hidden = which !== "loading";
      refs.error.hidden = which !== "error";
    }

    function load(videoId) {
      clearTimeout(loadTimer);
      setStatus("loading");
      refs.frame.src = `${CFG.origin}/embed/youtube/${encodeURIComponent(videoId)}`;
      loadTimer = setTimeout(() => setStatus("error"), CFG.loadTimeoutMs);
    }

    // While open, Escape closes and no other key reaches YouTube's shortcut handlers.
    function onWindowKey(e) {
      if (!state.isOpen) return;
      if (e.type === "keydown" && e.key === "Escape") {
        e.preventDefault();
        close();
      }
      e.stopPropagation();
    }

    function onMessage(e) {
      if (!refs || e.source !== refs.frame.contentWindow || e.origin !== CFG.origin) return;
      const data = e.data;
      if (!data || data.source !== "tuberizer-embed") return;
      switch (data.type) {
        case "ready":
          clearTimeout(loadTimer);
          setStatus(null);
          break;
        case "summary-status":
          if (data.status === "ready" && state.videoId) markTuberized(state.videoId);
          break;
        case "seek": {
          const video = getVideoElement();
          const seconds = Number(data.seconds);
          if (video && Number.isFinite(seconds) && seconds >= 0) {
            video.currentTime = seconds;
            video.play().catch(() => {});
            close();
          }
          break;
        }
        case "close":
          close();
          break;
      }
    }

    function open(videoId) {
      if (!host) build();
      if (state.videoId !== videoId) {
        state.videoId = videoId;
        load(videoId);
      }
      refs.title.textContent = getVideoTitle();
      refs.openLink.href = refs.errorOpen.href = summaryPageUrl(videoId);

      if (!state.isOpen) {
        state.isOpen = true;
        restoreFocusTo = document.activeElement;
        savedOverflow = document.documentElement.style.overflow;
        document.documentElement.style.overflow = "hidden";
        for (const type of ["keydown", "keyup", "keypress"]) window.addEventListener(type, onWindowKey, true);
      }
      host.style.setProperty("display", "block", "important");
      refs.closeBtn.focus({ preventScroll: true });
      onModalOpened();
    }

    function close() {
      if (!state.isOpen) return;
      state.isOpen = false;
      // Hide rather than remove, so reopening for the same video is instant.
      host.style.setProperty("display", "none", "important");
      document.documentElement.style.overflow = savedOverflow || "";
      for (const type of ["keydown", "keyup", "keypress"]) window.removeEventListener(type, onWindowKey, true);
      if (restoreFocusTo && typeof restoreFocusTo.focus === "function") restoreFocusTo.focus({ preventScroll: true });
      restoreFocusTo = null;
    }

    function destroy() {
      close();
      clearTimeout(loadTimer);
      if (host) host.remove();
      host = null;
      refs = null;
      state.videoId = null;
    }

    // Hook for playback behaviour on open (see config.pauseVideoOnOpen).
    function onModalOpened() {
      if (CFG.pauseVideoOnOpen) {
        const video = getVideoElement();
        if (video && !video.paused) video.pause();
      }
    }

    window.addEventListener("message", onMessage);

    return {
      open,
      destroy,
      get videoId() {
        return state.videoId;
      },
    };
  })();

  // ---------------------------------------------------------------------------
  // Boot

  // yt-navigate-finish fires after every SPA navigation (and the first page load).
  document.addEventListener("yt-navigate-finish", onNavigate);
  window.addEventListener("popstate", onNavigate);
  onNavigate();
})();

import {DiagramViewer} from './viewer.js';
/* Standalone Typora integration; no community plugin framework required. */
const PLUGIN_ID = "local.codex-mermaid";
const POLL_INTERVAL_MS = 100;
const RENDER_WRAPPER_FLAG = Symbol.for("local.codex-mermaid.render-wrapper");

function isDomNode(value) {
  return value != null && typeof value === "object" &&
    typeof value.nodeType === "number";
}

function parseColor(value) {
  if (typeof value !== "string") return null;
  const text = value.trim().toLowerCase();
  if (!text || text === "transparent") return null;

  let match = text.match(/^#([0-9a-f]{3,8})$/i);
  if (match) {
    const hex = match[1];
    if (hex.length === 3 || hex.length === 4) {
      return [0, 1, 2].map((index) => parseInt(hex[index] + hex[index], 16));
    }
    if (hex.length === 6 || hex.length === 8) {
      return [0, 2, 4].map((index) => parseInt(hex.slice(index, index + 2), 16));
    }
  }

  match = text.match(/^rgba?\(([^)]+)\)$/i);
  if (match) {
    const rawChannels = match[1].split(/\s*,\s*/).map(Number);
    if (rawChannels.length > 3 && rawChannels[3] <= 0) return null;
    const channels = rawChannels.slice(0, 3);
    return channels.length === 3 && channels.every(Number.isFinite)
      ? channels
      : null;
  }

  return null;
}

function colorBrightness(rgb) {
  return (299 * rgb[0] + 587 * rgb[1] + 114 * rgb[2]) / 256000;
}

function detectDarkTheme() {
  const body = document.body;
  if (!body) return false;

  // Typora's current themes do not expose one stable dark-theme class.  Keep
  // these class checks for custom themes, then use the same brightness signal
  // that Typora itself uses when it sets File.colorBrightness.
  const classNames = Array.from(body.classList || []).join(" ").toLowerCase();
  if (/(?:^|[-_ ])(?:dark|night|black)(?:$|[-_ ])/i.test(classNames)) {
    return true;
  }

  const fileBrightness = window.File && window.File.colorBrightness;
  if (typeof fileBrightness === "number" && Number.isFinite(fileBrightness)) {
    return fileBrightness < 0.5;
  }

  const root = document.documentElement;
  const computed = window.getComputedStyle ? window.getComputedStyle(body) : null;
  const rootComputed = window.getComputedStyle && root
    ? window.getComputedStyle(root)
    : null;
  const candidates = [
    computed && computed.backgroundColor,
    computed && computed.getPropertyValue("--bg-color"),
    computed && computed.getPropertyValue("--mermaid-background"),
    rootComputed && rootComputed.getPropertyValue("--bg-color"),
    rootComputed && rootComputed.getPropertyValue("--mermaid-background"),
  ];
  for (const candidate of candidates) {
    const rgb = parseColor(candidate);
    if (rgb) return colorBrightness(rgb) < 0.5;
  }

  return Boolean(window.matchMedia &&
    window.matchMedia("(prefers-color-scheme: dark)").matches);
}

function prepareSvgForHost(markup) {
  const template = document.createElement("template");
  template.innerHTML = markup;
  const svg = template.content.querySelector("svg");
  const intrinsicWidth = Number(svg?.getAttribute("width"));
  if (!svg?.hasAttribute("viewBox") || !Number.isFinite(intrinsicWidth) || intrinsicWidth <= 0) {
    return markup;
  }
  // Typora's macOS PNG export captures the displayed bounds, but only rewrites
  // the clone's height. A fixed intrinsic width would overflow that capture.
  // Keep the full viewBox and cap the responsive width at its original size.
  svg.setAttribute("width", "100%");
  svg.style.maxWidth = `${intrinsicWidth}px`;
  svg.style.height = "auto";
  return template.innerHTML;
}

function markWrapper(wrapper) {
  try {
    Object.defineProperty(wrapper, RENDER_WRAPPER_FLAG, { value: true });
  } catch (_) {
    // The marker is only diagnostic; the wrapper still works if a host blocks
    // defining a non-enumerable property on functions.
  }
  return wrapper;
}

class CodexMermaidPlugin {
  constructor() {
    this._requestedScripts = new Set();
    this._patchedApis = [];
    this._failedApis = new WeakSet();
    this._pollTimer = null;
    this._refreshTimers = new Set();
    this._ready = false;
  }

  onload() {
    this.viewer = new DiagramViewer();
    this._ensureAssets();
    this._ensurePatched();
    this._pollTimer = window.setInterval(
      () => this._ensurePatched(),
      POLL_INTERVAL_MS,
    );

  }

  onunload() {
    this.viewer?.destroy();
    if (this._pollTimer != null) {
      window.clearInterval(this._pollTimer);
      this._pollTimer = null;
    }

    for (const state of this._patchedApis) {
      // Do not clobber a later owner which intentionally replaced the method
      // while this plugin was active.
      if (window.mermaidAPI === state.wrapperApi) {
        try {
          window.mermaidAPI = state.originalApi;
        } catch (error) {
          this._warn("Could not restore Mermaid render", error);
        }
      }
    }
    this._patchedApis = [];

    for (const timer of this._refreshTimers) window.clearTimeout(timer);
    this._refreshTimers.clear();
    this._ready = false;

    // The native renderer is restored before refreshing.  This makes the
    // uninstall path immediately visible and also clears Codex-generated SVGs.
    const refresh = () => {
      const file = window.File;
      const diagrams = file && file.editor && file.editor.diagrams;
      if (diagrams && typeof diagrams.refreshDiagram === "function") {
        try {
          diagrams.refreshDiagram(true);
        } catch (error) {
          this._warn("Could not refresh Mermaid diagrams", error);
        }
      }
    };
    const refreshTimer = window.setTimeout(() => {
      this._refreshTimers.delete(refreshTimer);
      refresh();
    }, 0);
    this._refreshTimers.add(refreshTimer);
  }

  _warn(message, error) {
    const logger = this.logger;
    if (logger && typeof logger.warn === "function") {
      logger.warn(message, error);
    } else if (window.console && typeof console.warn === "function") {
      console.warn(`[${PLUGIN_ID}] ${message}`, error || "");
    }
  }

  _loadScript(name) {
    const script = document.createElement("script");
    script.src = new URL(name, import.meta.url).href;
    script.onerror = () => this._warn(`Could not load ${name}`);
    document.head.appendChild(script);
  }

  _ensureAssets() {
    // engine.js is intentionally loaded first: renderer.js can use the engine
    // global during its own classic-script evaluation.
    if (!window.CodexMermaidEngine && !this._requestedScripts.has("engine.js")) {
      this._requestedScripts.add("engine.js");
      try {
        this._loadScript("engine.js");
      } catch (error) {
        this._warn("Could not load engine.js", error);
      }
    }
    if (window.CodexMermaidEngine &&
        !window.CodexMermaidRenderer &&
        !this._requestedScripts.has("renderer.js")) {
      this._requestedScripts.add("renderer.js");
      try {
        this._loadScript("renderer.js");
      } catch (error) {
        this._warn("Could not load renderer.js", error);
      }
    }
  }

  _ensurePatched() {
    this._ensureAssets();
    const api = window.mermaidAPI;
    if (!api || typeof api.render !== "function" ||
        !window.CodexMermaidRenderer ||
        typeof window.CodexMermaidRenderer.render !== "function") return;
    if (this._patchedApis.some((state) => window.mermaidAPI === state.wrapperApi)) {
      return;
    }
    if (this._failedApis.has(api)) return;

    const originalApi = api;
    const wrapper = markWrapper(this._makeRenderWrapper());
    try {
      // Typora 1.13.4's Mermaid 11.13.0 exposes a frozen API object.  Clone its complete own
      // property descriptor set and replace only render on the clone.  The
      // original object, including initialize, is never mutated.
      const descriptors = Object.getOwnPropertyDescriptors(originalApi);
      const renderDescriptor = descriptors.render || {
        enumerable: true,
        configurable: true,
        writable: true,
      };
      delete descriptors.render;
      const wrapperApi = Object.create(Object.getPrototypeOf(originalApi));
      Object.defineProperties(wrapperApi, descriptors);
      const writableRenderDescriptor = { ...renderDescriptor };
      delete writableRenderDescriptor.get;
      delete writableRenderDescriptor.set;
      Object.defineProperty(wrapperApi, "render", {
        ...writableRenderDescriptor,
        configurable: true,
        writable: true,
        value: wrapper,
      });
      window.mermaidAPI = wrapperApi;
      if (window.mermaidAPI !== wrapperApi) throw new Error("Mermaid API global is not writable");
      this._patchedApis.push({ originalApi, wrapperApi });
      this._ready = true;
      this._refreshDiagrams();
    } catch (error) {
      this._failedApis.add(api);
      this._warn("Could not replace Mermaid API render", error);
    }
  }

  _makeRenderWrapper() {
    return async function codexMermaidRender(id, source, container) {
      const renderer = window.CodexMermaidRenderer;
      if (!renderer || typeof renderer.render !== "function") {
        throw new Error("Codex Mermaid renderer is not ready");
      }
      const target = isDomNode(container) ? container : null;
      const dark = detectDarkTheme();
      let rendered;
      try {
        rendered = await renderer.render(id, source, { dark });
      } catch (error) {
        console.error("Codex Mermaid render failed", error);
        const reported = new Error(`Codex Mermaid: ${error.message}`);
        reported.cause = error;
        if (error.hash) reported.hash = error.hash;
        throw reported;
      }
      const result = rendered && typeof rendered === "object"
        ? rendered
        : { svg: rendered == null ? "" : String(rendered) };
      const svg = result.svg == null ? "" : prepareSvgForHost(String(result.svg));

      if (target) {
        target.innerHTML = svg;
        if (typeof result.bindFunctions === "function") {
          result.bindFunctions(target);
        }
      }
      return { ...result, svg };
    };
  }

  _refreshDiagrams() {
    const file = window.File;
    const diagrams = file && file.editor && file.editor.diagrams;
    if (diagrams && typeof diagrams.refreshDiagram === "function") {
      try {
        diagrams.refreshDiagram(true);
      } catch (error) {
        this._warn("Could not refresh Mermaid diagrams", error);
      }
    }
  }
}

const instanceKey = Symbol.for("local.codex-mermaid.instance");
if (!window[instanceKey]) {
  window[instanceKey] = new CodexMermaidPlugin();
  window[instanceKey].onload();
}
export default CodexMermaidPlugin;

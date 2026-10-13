// Progressive enhancement only: every page is complete without this file.
(() => {
  const root = document.documentElement;
  const store = {
    get(k) {
      try {
        return localStorage.getItem(k);
      } catch {
        return null;
      }
    },
    set(k, v) {
      try {
        localStorage.setItem(k, v);
      } catch {
        /* storage unavailable */
      }
    },
  };

  // Theme: system by default, then light, then dark.
  // Labels come from data attributes so they're in the page's language.
  const order = ["system", "light", "dark"];
  const applyTheme = (mode) => {
    if (mode === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", mode);
    const btn = document.querySelector("[data-theme-toggle]");
    if (btn) {
      const d = btn.dataset;
      btn.textContent = d[mode] || mode;
      btn.setAttribute("aria-label", `${d.label || "Theme"}: ${d[mode] || mode}. ${d.change || ""}`.trim());
    }
  };
  let theme = order.includes(store.get("theme")) ? store.get("theme") : "system";
  applyTheme(theme);
  document.querySelector("[data-theme-toggle]")?.addEventListener("click", () => {
    theme = order[(order.indexOf(theme) + 1) % order.length];
    store.set("theme", theme);
    applyTheme(theme);
  });

  // Mobile navigation
  const menuBtn = document.querySelector("[data-menu-toggle]");
  const nav = document.getElementById("site-nav");
  if (menuBtn && nav) {
    const setOpen = (open) => {
      nav.classList.toggle("open", open);
      menuBtn.setAttribute("aria-expanded", String(open));
    };
    menuBtn.addEventListener("click", () => setOpen(menuBtn.getAttribute("aria-expanded") !== "true"));
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && menuBtn.getAttribute("aria-expanded") === "true") {
        setOpen(false);
        menuBtn.focus();
      }
    });
    nav.addEventListener("click", (e) => {
      if (e.target.closest("a")) setOpen(false);
    });
  }

  // Language switcher: remember the choice so "/" opens this language next time
  // (Netlify reads the nf_lang cookie in its language redirects).
  document.addEventListener("click", (e) => {
    const a = e.target.closest("a[data-lang]");
    if (a) document.cookie = `nf_lang=${a.dataset.lang}; path=/; max-age=31536000; SameSite=Lax`;
  });

  // Project directory filters. The URL (?category=) is the source of truth, so
  // direct links, refresh and back/forward all show the same selection.
  const filters = document.querySelector("[data-filters]");
  if (filters) {
    const rows = [...document.querySelectorAll("li.project-row[data-categories]")];
    const empty = document.querySelector("[data-empty]");
    const emptyText = empty?.querySelector("[data-empty-text]");
    let messages = {};
    try {
      messages = JSON.parse(empty?.dataset.messages || "{}");
    } catch {
      /* keep the generic state */
    }
    const count = document.querySelector("[data-count]");
    const chips = [...filters.querySelectorAll("button[data-filter]")];
    const valid = new Set(chips.map((c) => c.dataset.filter));
    const fromUrl = () => {
      const cat = new URL(location.href).searchParams.get("category") || "all";
      return valid.has(cat) ? cat : "all";
    };

    const apply = (cat) => {
      let shown = 0;
      for (const row of rows) {
        const match = cat === "all" || row.dataset.categories.split(" ").includes(cat);
        row.hidden = !match;
        if (match) shown++;
      }
      for (const c of chips) c.setAttribute("aria-pressed", String(c.dataset.filter === cat));
      if (empty) {
        empty.hidden = shown !== 0;
        if (emptyText) emptyText.textContent = shown === 0 ? messages[cat] || "" : "";
      }
      if (count) {
        const tpl = shown === 1 && count.dataset.countOne ? count.dataset.countOne : count.dataset.countTpl || "{n}";
        count.textContent = tpl.replace("{n}", String(shown));
      }
    };
    const select = (cat) => {
      if (!valid.has(cat)) cat = "all";
      const url = new URL(location.href);
      if (cat === "all") url.searchParams.delete("category");
      else url.searchParams.set("category", cat);
      if (url.href !== location.href) history.pushState({ category: cat }, "", url);
      apply(cat);
    };
    document.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-filter]");
      if (!btn) return;
      select(btn.dataset.filter);
      if (btn.closest("[data-empty]")) chips[0]?.focus();
    });
    window.addEventListener("popstate", () => apply(fromUrl()));
    filters.hidden = false;
    // An unknown ?category= is removed from the address bar instead of being kept.
    if (new URL(location.href).searchParams.has("category") && fromUrl() === "all") {
      const url = new URL(location.href);
      url.searchParams.delete("category");
      history.replaceState(null, "", url);
    }
    apply(fromUrl());
  }
})();

"use strict";
// Slotbook web client. No framework; the DOM is built with h(), which only
// ever sets text, never HTML, so data from the API can't inject markup.
(() => {
  const API = "/api/v1";
  const main = document.getElementById("main");
  const state = { token: null, user: null, services: null };

  // ---------- DOM helpers ----------
  function h(tag, attrs = {}, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v === false || v === null || v === undefined) continue;
      if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else if (k === "class") el.className = v;
      else el.setAttribute(k, v === true ? "" : String(v));
    }
    for (const kid of kids.flat())
      if (kid !== null && kid !== undefined && kid !== false) el.append(kid instanceof Node ? kid : String(kid));
    return el;
  }
  const present = (nodes) => nodes.filter((n) => n !== null && n !== undefined && n !== false);
  const render = (...nodes) => {
    main.replaceChildren(...present(nodes));
    main.focus({ preventScroll: true });
  };
  const toast = (msg) => {
    const t = document.getElementById("toast");
    t.textContent = msg;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => {
      t.textContent = "";
    }, 4000);
  };
  const money = (c) => new Intl.NumberFormat(undefined, { style: "currency", currency: "EUR" }).format(c / 100);
  const when = (iso) =>
    new Intl.DateTimeFormat(undefined, {
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(iso));
  const time = (iso) =>
    new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
  const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const STATUS = { confirmed: "Confirmed", completed: "Completed", cancelled: "Cancelled", no_show: "No-show" };

  // ---------- API ----------
  async function api(method, path, body, retry = true) {
    const res = await fetch(API + path, {
      method,
      credentials: "same-origin",
      headers: {
        ...(body ? { "content-type": "application/json" } : {}),
        ...(state.token ? { authorization: `Bearer ${state.token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 401 && retry && state.token && !path.startsWith("/auth/")) {
      if (await refresh()) return api(method, path, body, false);
    }
    const data = res.status === 204 ? null : await res.json().catch(() => null);
    if (!res.ok) {
      const err = new Error(data?.error?.message || `Request failed (${res.status})`);
      err.status = res.status;
      err.code = data?.error?.code;
      err.details = data?.error?.details || [];
      throw err;
    }
    return data;
  }

  async function refresh() {
    try {
      const s = await api("POST", "/auth/refresh", null, false);
      setSession(s);
      return true;
    } catch {
      setSession(null);
      return false;
    }
  }

  // A non-secret hint so signed-out visitors don't trigger a pointless refresh call.
  const HINT = "slotbook.session";
  const hint = {
    get: () => {
      try {
        return localStorage.getItem(HINT) === "1";
      } catch {
        return true;
      }
    },
    set: (on) => {
      try {
        if (on) localStorage.setItem(HINT, "1");
        else localStorage.removeItem(HINT);
      } catch {
        /* storage unavailable */
      }
    },
  };

  function setSession(s) {
    hint.set(Boolean(s));
    state.token = s?.accessToken ?? null;
    state.user = s?.user ?? null;
    document.querySelectorAll("[data-auth]").forEach((a) => {
      a.hidden = !state.user;
    });
    document.querySelectorAll("[data-role]").forEach((a) => {
      a.hidden = !state.user || !a.dataset.role.split(" ").includes(state.user.role);
    });
    document.getElementById("account-link").textContent = state.user ? "Account" : "Sign in";
  }

  function fieldErrors(form, err) {
    form.querySelectorAll(".field-error").forEach((e) => e.remove());
    const box = form.querySelector(".form-error");
    box.textContent = err.message;
    for (const d of err.details) {
      const input = form.querySelector(`[name="${CSS.escape(d.field)}"]`);
      if (input) {
        input.setAttribute("aria-invalid", "true");
        input.after(h("p", { class: "field-error" }, `This field ${d.message}.`));
      }
    }
  }

  async function busy(button, fn) {
    button.disabled = true;
    try {
      return await fn();
    } finally {
      button.disabled = false;
    }
  }

  // ---------- Views ----------
  async function viewBook() {
    const heading = h("h1", {}, "Book an appointment");
    render(heading, h("p", { class: "loading" }, "Loading services…"));
    let services, staff;
    try {
      [services, staff] = await Promise.all([api("GET", "/services?limit=100"), api("GET", "/staff")]);
    } catch (e) {
      return render(
        heading,
        h("p", { class: "error" }, `Couldn't load services: ${e.message}`),
        h("button", { class: "btn", onclick: viewBook }, "Try again"),
      );
    }
    if (!services.data.length)
      return render(heading, h("div", { class: "empty" }, "No services are open for booking yet."));

    const pick = { service: null, date: today(), staffId: "", slot: null };
    const svcGrid = h("div", { class: "grid", role: "group", "aria-label": "Services" });
    const slotsBox = h("div", { "aria-live": "polite" });
    const confirmBox = h("div");
    const dateInput = h("input", { type: "date", id: "date", min: today(), value: pick.date });
    const staffSelect = h("select", { id: "staff" }, h("option", { value: "" }, "Anyone available"));

    for (const s of services.data) {
      const b = h(
        "button",
        { class: "choice", type: "button", "aria-pressed": "false" },
        h("strong", {}, s.name),
        h("span", { class: "muted small" }, `${s.durationMin} min · ${money(s.priceCents)}`),
        s.description ? h("span", { class: "small" }, h("br"), s.description) : null,
      );
      b.addEventListener("click", () => {
        pick.service = s;
        svcGrid.querySelectorAll(".choice").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
        staffSelect.replaceChildren(
          h("option", { value: "" }, "Anyone available"),
          ...staff.data
            .filter((p) => p.serviceIds.includes(s.id))
            .map((p) => h("option", { value: p.id }, p.displayName)),
        );
        pick.staffId = "";
        loadSlots();
      });
      svcGrid.append(b);
    }
    dateInput.addEventListener("change", () => {
      pick.date = dateInput.value;
      loadSlots();
    });
    staffSelect.addEventListener("change", () => {
      pick.staffId = staffSelect.value;
      loadSlots();
    });

    async function loadSlots() {
      confirmBox.replaceChildren();
      if (!pick.service || !pick.date) return;
      slotsBox.replaceChildren(h("p", { class: "muted" }, "Checking availability…"));
      try {
        const q = new URLSearchParams({
          serviceId: pick.service.id,
          date: pick.date,
          ...(pick.staffId ? { staffId: pick.staffId } : {}),
        });
        const a = await api("GET", `/availability?${q}`);
        if (!a.slots.length)
          return slotsBox.replaceChildren(h("div", { class: "empty" }, "No free times on this day. Try another date."));
        const byStaff = new Map();
        for (const s of a.slots) byStaff.set(s.staffName, [...(byStaff.get(s.staffName) || []), s]);
        slotsBox.replaceChildren(
          ...[...byStaff].map(([name, list]) =>
            h(
              "div",
              {},
              h("h3", { class: "small" }, name),
              h(
                "div",
                { class: "slots" },
                list.map((s) => {
                  const b = h(
                    "button",
                    {
                      class: "slot",
                      type: "button",
                      "aria-pressed": "false",
                      "aria-label": `${time(s.startsAt)} with ${name}`,
                    },
                    time(s.startsAt),
                  );
                  b.addEventListener("click", () => {
                    slotsBox.querySelectorAll(".slot").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
                    pick.slot = s;
                    showConfirm();
                  });
                  return b;
                }),
              ),
            ),
          ),
        );
      } catch (e) {
        slotsBox.replaceChildren(h("p", { class: "error" }, e.message));
      }
    }

    function showConfirm() {
      const s = pick.slot;
      if (!state.user) {
        return confirmBox.replaceChildren(
          h(
            "div",
            { class: "panel" },
            h("p", {}, `${pick.service.name} with ${s.staffName}, ${when(s.startsAt)}.`),
            h("p", {}, h("a", { href: "#/account" }, "Sign in or create an account"), " to confirm this booking."),
          ),
        );
      }
      const notes = h("textarea", { id: "notes", rows: "2", maxlength: "500" });
      const btn = h("button", { class: "btn", type: "button" }, "Confirm booking");
      btn.addEventListener("click", () =>
        busy(btn, async () => {
          try {
            await api("POST", "/bookings", {
              serviceId: pick.service.id,
              staffId: s.staffId,
              startsAt: s.startsAt,
              notes: notes.value || undefined,
            });
            toast("Booking confirmed.");
            location.hash = "#/bookings";
          } catch (e) {
            toast(e.message);
            if (e.code === "slot_taken") loadSlots();
          }
        }),
      );
      confirmBox.replaceChildren(
        h(
          "div",
          { class: "panel" },
          h("h2", {}, "Confirm"),
          h(
            "p",
            {},
            h("strong", {}, pick.service.name),
            ` with ${s.staffName}`,
            h("br"),
            `${when(s.startsAt)} – ${time(s.endsAt)} · ${money(pick.service.priceCents)}`,
          ),
          h("label", { for: "notes" }, "Notes for the business (optional)"),
          notes,
          h("div", { class: "actions" }, btn),
        ),
      );
    }

    render(
      heading,
      h("h2", {}, "1. Choose a service"),
      svcGrid,
      h("h2", {}, "2. Choose a day"),
      h(
        "div",
        { class: "row" },
        h("div", {}, h("label", { for: "date" }, "Date"), dateInput),
        h("div", {}, h("label", { for: "staff" }, "With"), staffSelect),
      ),
      h("h2", {}, "3. Pick a time"),
      slotsBox,
      confirmBox,
    );
    slotsBox.replaceChildren(h("p", { class: "muted" }, "Choose a service to see free times."));
  }

  async function viewBookings(page = 1) {
    if (!state.user) return viewAccount();
    const heading = h("h1", {}, "My bookings");
    render(heading, h("p", { class: "loading" }, "Loading…"));
    let res;
    try {
      res = await api("GET", `/bookings?page=${page}&limit=10&sort=starts&order=desc`);
    } catch (e) {
      return render(heading, h("p", { class: "error" }, e.message));
    }
    if (!res.data.length)
      return render(
        heading,
        h("div", { class: "empty" }, "You have no bookings yet. ", h("a", { href: "#/book" }, "Book an appointment")),
      );
    const list = res.data.map((b) => {
      const cancel =
        b.status === "confirmed" && new Date(b.startsAt) > new Date()
          ? h("button", { class: "btn danger", type: "button" }, "Cancel booking")
          : null;
      cancel?.addEventListener("click", () => {
        if (!confirm(`Cancel ${b.service.name} on ${when(b.startsAt)}?`)) return;
        busy(cancel, async () => {
          try {
            await api("POST", `/bookings/${b.id}/cancel`, {});
            toast("Booking cancelled.");
            viewBookings(page);
          } catch (e) {
            toast(e.message);
          }
        });
      });
      return h(
        "div",
        { class: "panel" },
        h(
          "p",
          {},
          h("strong", {}, b.service.name),
          ` with ${b.staff.name} `,
          h("span", { class: `chip ${b.status}` }, STATUS[b.status]),
        ),
        h("p", { class: "muted" }, `${when(b.startsAt)} · ${money(b.priceCents)}`),
        cancel,
      );
    });
    render(heading, ...list, pager(res, viewBookings));
  }

  function pager(res, go) {
    if (res.totalPages <= 1) return null;
    return h(
      "div",
      { class: "actions" },
      h(
        "button",
        { class: "btn ghost", type: "button", disabled: res.page <= 1, onclick: () => go(res.page - 1) },
        "Previous",
      ),
      h("span", { class: "muted" }, ` Page ${res.page} of ${res.totalPages} `),
      h(
        "button",
        { class: "btn ghost", type: "button", disabled: res.page >= res.totalPages, onclick: () => go(res.page + 1) },
        "Next",
      ),
    );
  }

  function viewAccount() {
    if (state.user) {
      const out = h("button", { class: "btn ghost", type: "button" }, "Sign out");
      out.addEventListener("click", async () => {
        await api("POST", "/auth/logout").catch(() => {});
        setSession(null);
        location.hash = "#/book";
      });
      const form = h(
        "form",
        { class: "panel", novalidate: true },
        h("h2", {}, "Your details"),
        h("label", { for: "name" }, "Name"),
        h("input", { id: "name", name: "name", value: state.user.name, required: true, maxlength: "100" }),
        h("label", { for: "phone" }, "Phone"),
        h("input", { id: "phone", name: "phone", type: "tel", value: state.user.phone || "" }),
        h("p", { class: "form-error error", role: "alert" }),
        h("div", { class: "actions" }, h("button", { class: "btn" }, "Save changes")),
      );
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        try {
          const u = await api("PATCH", "/me", { name: form.name.value, phone: form.phone.value || null });
          state.user = u;
          toast("Changes saved.");
        } catch (err) {
          fieldErrors(form, err);
        }
      });
      return render(
        h("h1", {}, "Account"),
        h("p", {}, `Signed in as ${state.user.email} (${state.user.role}).`),
        form,
        out,
      );
    }
    const mode = { register: false };
    const draw = () => {
      const form = h(
        "form",
        { class: "panel", novalidate: true },
        mode.register
          ? [
              h("label", { for: "name" }, "Name"),
              h("input", { id: "name", name: "name", autocomplete: "name", required: true }),
            ]
          : null,
        h("label", { for: "email" }, "Email"),
        h("input", { id: "email", name: "email", type: "email", autocomplete: "email", required: true }),
        h("label", { for: "password" }, "Password"),
        h("input", {
          id: "password",
          name: "password",
          type: "password",
          autocomplete: mode.register ? "new-password" : "current-password",
          required: true,
          minlength: mode.register ? "10" : null,
        }),
        mode.register ? h("p", { class: "muted small" }, "At least 10 characters.") : null,
        h("p", { class: "form-error error", role: "alert" }),
        h("div", { class: "actions" }, h("button", { class: "btn" }, mode.register ? "Create account" : "Sign in")),
      );
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const body = {
          email: form.email.value,
          password: form.password.value,
          ...(mode.register ? { name: form.name.value } : {}),
        };
        try {
          setSession(await api("POST", mode.register ? "/auth/register" : "/auth/login", body));
          toast(mode.register ? "Account created." : "Signed in.");
          location.hash = "#/book";
        } catch (err) {
          fieldErrors(form, err);
        }
      });
      const toggle = h(
        "button",
        { class: "btn ghost", type: "button" },
        mode.register ? "I already have an account" : "Create an account",
      );
      toggle.addEventListener("click", () => {
        mode.register = !mode.register;
        draw();
      });
      render(h("h1", {}, mode.register ? "Create an account" : "Sign in"), form, toggle);
    };
    draw();
  }

  // ---------- Manage (staff and owner) ----------
  async function viewManage(tab = "schedule") {
    if (!state.user || !["staff", "owner"].includes(state.user.role)) return viewBook();
    const tabs = h(
      "div",
      { class: "tabs", role: "group", "aria-label": "Sections" },
      ...[
        ["schedule", "Schedule"],
        ...(state.user.role === "owner"
          ? [
              ["services", "Services"],
              ["staff", "Staff"],
            ]
          : []),
      ].map(([k, label]) =>
        h(
          "button",
          {
            class: `btn ${k === tab ? "" : "ghost"}`,
            type: "button",
            "aria-pressed": String(k === tab),
            onclick: () => viewManage(k),
          },
          label,
        ),
      ),
    );
    const body = h("div");
    render(h("h1", {}, "Manage"), tabs, body);
    if (tab === "schedule") return manageSchedule(body);
    if (tab === "services") return manageServices(body);
    return manageStaff(body);
  }

  async function manageSchedule(box, page = 1, filters = { from: today(), to: "", status: "confirmed" }) {
    const from = h("input", { type: "date", id: "f-from", value: filters.from });
    const to = h("input", { type: "date", id: "f-to", value: filters.to });
    const status = h(
      "select",
      { id: "f-status" },
      h("option", { value: "" }, "Any"),
      ...Object.entries(STATUS).map(([k, v]) => h("option", { value: k, selected: k === filters.status }, v)),
    );
    const apply = h("button", { class: "btn", type: "button" }, "Show");
    apply.addEventListener("click", () =>
      manageSchedule(box, 1, { from: from.value, to: to.value, status: status.value }),
    );
    const results = h("div", {}, h("p", { class: "loading" }, "Loading…"));
    box.replaceChildren(
      h(
        "div",
        { class: "row" },
        h("div", {}, h("label", { for: "f-from" }, "From"), from),
        h("div", {}, h("label", { for: "f-to" }, "To"), to),
        h("div", {}, h("label", { for: "f-status" }, "Status"), status),
        h("div", {}, apply),
      ),
      results,
    );
    const q = new URLSearchParams({ page, limit: 20, sort: "starts", order: "asc" });
    for (const [k, v] of Object.entries(filters)) if (v) q.set(k, v);
    try {
      const res = await api("GET", `/bookings?${q}`);
      if (!res.data.length)
        return results.replaceChildren(h("div", { class: "empty" }, "No bookings match these filters."));
      const rows = res.data.map((b) => {
        const act = (label, path) => {
          const btn = h("button", { class: "btn ghost", type: "button" }, label);
          btn.addEventListener("click", () =>
            busy(btn, async () => {
              try {
                await api("POST", `/bookings/${b.id}/${path}`, {});
                toast("Updated.");
                manageSchedule(box, page, filters);
              } catch (e) {
                toast(e.message);
              }
            }),
          );
          return btn;
        };
        const started = new Date(b.startsAt) <= new Date();
        return h(
          "tr",
          {},
          h("td", {}, when(b.startsAt)),
          h("td", {}, b.service.name),
          h("td", {}, b.staff.name),
          h("td", {}, b.customer.name, h("br"), h("span", { class: "muted small" }, b.customer.email)),
          h("td", {}, h("span", { class: `chip ${b.status}` }, STATUS[b.status])),
          h(
            "td",
            {},
            b.status === "confirmed"
              ? started
                ? [act("Completed", "complete"), " ", act("No-show", "no-show")]
                : act("Cancel", "cancel")
              : "",
          ),
        );
      });
      results.replaceChildren(
        h(
          "div",
          { class: "table-wrap" },
          h(
            "table",
            {},
            h(
              "thead",
              {},
              h(
                "tr",
                {},
                ...["When", "Service", "With", "Customer", "Status", ""].map((t) => h("th", { scope: "col" }, t)),
              ),
            ),
            h("tbody", {}, rows),
          ),
        ),
        ...present([pager(res, (p) => manageSchedule(box, p, filters))]),
      );
    } catch (e) {
      results.replaceChildren(h("p", { class: "error" }, e.message));
    }
  }

  async function manageServices(box) {
    box.replaceChildren(h("p", { class: "loading" }, "Loading…"));
    const res = await api("GET", "/services?status=all&limit=100");
    const form = (s) => {
      const f = h(
        "form",
        { class: "panel", novalidate: true },
        h("h2", {}, s ? `Edit ${s.name}` : "New service"),
        h("label", { for: "s-name" }, "Name"),
        h("input", { id: "s-name", name: "name", value: s?.name || "", required: true }),
        h("label", { for: "s-desc" }, "Description"),
        h("input", { id: "s-desc", name: "description", value: s?.description || "" }),
        h(
          "div",
          { class: "row" },
          h(
            "div",
            {},
            h("label", { for: "s-dur" }, "Duration (minutes)"),
            h("input", {
              id: "s-dur",
              name: "durationMin",
              type: "number",
              min: "5",
              step: "5",
              value: s?.durationMin ?? 30,
            }),
          ),
          h(
            "div",
            {},
            h("label", { for: "s-price" }, "Price (€)"),
            h("input", {
              id: "s-price",
              name: "priceCents",
              type: "number",
              min: "0",
              step: "0.5",
              value: s ? s.priceCents / 100 : "",
            }),
          ),
        ),
        h("p", { class: "form-error error", role: "alert" }),
        h("div", { class: "actions" }, h("button", { class: "btn" }, s ? "Save changes" : "Add service")),
      );
      f.addEventListener("submit", async (e) => {
        e.preventDefault();
        const body = {
          name: f.name.value,
          description: f.description.value,
          durationMin: Number(f.durationMin.value),
          priceCents: Math.round(Number(f.priceCents.value) * 100),
        };
        try {
          await api(s ? "PATCH" : "POST", s ? `/services/${s.id}` : "/services", body);
          toast(s ? "Service saved." : "Service added.");
          manageServices(box);
        } catch (err) {
          fieldErrors(f, err);
        }
      });
      return f;
    };
    const editor = h("div", {}, form(null));
    const rows = res.data.map((s) => {
      const edit = h(
        "button",
        {
          class: "btn ghost",
          type: "button",
          onclick: () => {
            editor.replaceChildren(form(s));
            editor.scrollIntoView();
          },
        },
        "Edit",
      );
      const toggle = h(
        "button",
        { class: `btn ${s.active ? "danger" : "ghost"}`, type: "button" },
        s.active ? "Archive" : "Restore",
      );
      toggle.addEventListener("click", () =>
        busy(toggle, async () => {
          try {
            if (s.active) await api("DELETE", `/services/${s.id}`);
            else await api("PATCH", `/services/${s.id}`, { active: true });
            toast(s.active ? "Service archived." : "Service restored.");
            manageServices(box);
          } catch (e) {
            toast(e.message);
          }
        }),
      );
      return h(
        "tr",
        {},
        h("td", {}, s.name, s.active ? "" : h("span", { class: "muted small" }, " (archived)")),
        h("td", {}, `${s.durationMin} min`),
        h("td", {}, money(s.priceCents)),
        h("td", {}, edit, " ", toggle),
      );
    });
    box.replaceChildren(
      res.data.length
        ? h(
            "div",
            { class: "table-wrap" },
            h(
              "table",
              {},
              h(
                "thead",
                {},
                h("tr", {}, ...["Service", "Duration", "Price", ""].map((t) => h("th", { scope: "col" }, t))),
              ),
              h("tbody", {}, rows),
            ),
          )
        : h("div", { class: "empty" }, "No services yet. Add the first one below."),
      editor,
    );
  }

  async function manageStaff(box) {
    box.replaceChildren(h("p", { class: "loading" }, "Loading…"));
    const [staff, services] = await Promise.all([api("GET", "/staff"), api("GET", "/services?limit=100")]);
    const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

    const add = h(
      "form",
      { class: "panel", novalidate: true },
      h("h2", {}, "Add a staff member"),
      h(
        "p",
        { class: "muted small" },
        "They need to create a customer account first. Their bookings stay; they gain the staff view.",
      ),
      h("label", { for: "st-email" }, "Their account email"),
      h("input", { id: "st-email", name: "email", type: "email", required: true }),
      h("label", { for: "st-name" }, "Name shown to customers"),
      h("input", { id: "st-name", name: "displayName", required: true }),
      h("p", { class: "form-error error", role: "alert" }),
      h("div", { class: "actions" }, h("button", { class: "btn" }, "Add staff member")),
    );
    add.addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        await api("POST", "/staff", { email: add.email.value, displayName: add.displayName.value });
        toast("Staff member added.");
        manageStaff(box);
      } catch (err) {
        fieldErrors(add, err);
      }
    });

    const cards = await Promise.all(
      staff.data.map(async (p) => {
        const hours = (await api("GET", `/staff/${p.id}/hours`)).data;
        const svcChecks = services.data.map((s) =>
          h(
            "label",
            { class: "small" },
            h("input", { type: "checkbox", value: s.id, checked: p.serviceIds.includes(s.id) }),
            ` ${s.name}`,
          ),
        );
        const dayRows = DAYS.map((d, i) => {
          const first = hours.find((x) => x.weekday === i + 1);
          return h(
            "div",
            { class: "hours-day" },
            h("span", {}, d),
            h(
              "span",
              {},
              h("input", { type: "time", "aria-label": `${d} start`, value: first?.start || "" }),
              " – ",
              h("input", { type: "time", "aria-label": `${d} end`, value: first?.end || "" }),
              hours.filter((x) => x.weekday === i + 1).length > 1
                ? h("span", { class: "muted small" }, " (has a break: edit via API)")
                : "",
            ),
          );
        });
        const save = h("button", { class: "btn", type: "button" }, "Save");
        save.addEventListener("click", () =>
          busy(save, async () => {
            try {
              const serviceIds = svcChecks
                .map((l) => l.querySelector("input"))
                .filter((c) => c.checked)
                .map((c) => c.value);
              await api("PATCH", `/staff/${p.id}`, { serviceIds });
              const next = [];
              dayRows.forEach((row, i) => {
                const [s, e] = row.querySelectorAll("input");
                const keepBreak = hours.filter((x) => x.weekday === i + 1).length > 1;
                if (keepBreak) next.push(...hours.filter((x) => x.weekday === i + 1));
                else if (s.value && e.value) next.push({ weekday: i + 1, start: s.value, end: e.value });
              });
              await api("PUT", `/staff/${p.id}/hours`, { hours: next });
              toast(`Saved ${p.displayName}.`);
            } catch (e) {
              toast(e.message);
            }
          }),
        );
        return h(
          "div",
          { class: "panel" },
          h("h2", {}, p.displayName, p.active ? "" : " (inactive)"),
          h("p", { class: "muted small" }, "Services"),
          h("div", { class: "row" }, svcChecks),
          h("p", { class: "muted small" }, "Weekly hours (leave empty for a day off)"),
          dayRows,
          h("div", { class: "actions" }, save),
        );
      }),
    );
    box.replaceChildren(
      ...(cards.length
        ? cards
        : [h("div", { class: "empty" }, "No staff yet. Add someone below so customers can book.")]),
      add,
    );
  }

  // ---------- Router ----------
  const routes = { book: viewBook, bookings: () => viewBookings(), account: viewAccount, manage: () => viewManage() };
  function route() {
    const key = (location.hash.replace(/^#\//, "") || "book").split("/")[0];
    const view = routes[key] || viewBook;
    document.querySelectorAll("[data-nav]").forEach((a) => {
      if (a.dataset.nav === key) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    });
    Promise.resolve(view()).catch((e) =>
      render(h("h1", {}, "Something went wrong"), h("p", { class: "error" }, e.message)),
    );
  }
  window.addEventListener("hashchange", route);
  (hint.get() ? refresh() : Promise.resolve(setSession(null))).finally(route);
})();

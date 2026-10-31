
/* ==========================================
   FRIDAY PERSONAL EDITION V2
   Application engine
   ========================================== */

(() => {
  "use strict";

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];

  const DEFAULT_DATA = {
    version: 2,
    tasks: [],
    notes: [],
    events: [],
    reminders: [],
    transactions: [],
    budgets: [],
    goals: [],
    profiles: [],
    settings: {
      theme: "obsidian",
      logo: "monogram",
      accent: "",
      currency: "USD",
      dateFormat: "DD/MM/YYYY",
      timezone: "local"
    }
  };

  let data = null;
  let currentPage = "home";
  let taskFilter = "all";
  let calendarDate = new Date();
  let selectedCalendarDate = null;
  let editing = null;
  let saveQueue = Promise.resolve();
  let locked = true;

  const ICONS = {
    monogram: "F",
    orbit: "◎",
    core: "▦",
    nexus: "⬡"
  };

  const CATEGORIES = {
    task: "Task",
    note: "Note",
    event: "Event",
    reminder: "Reminder",
    transaction: "Transaction",
    budget: "Budget",
    goal: "Savings goal",
    profile: "Profile"
  };

  /* UTILITIES */

  function uid() {
    return crypto.randomUUID
      ? crypto.randomUUID()
      : Date.now().toString(36) + Math.random().toString(36).slice(2);
  }

  function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, char => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    })[char]);
  }

  function normaliseData(input) {
    const result = { ...DEFAULT_DATA, ...(input || {}) };

    for (const key of Object.keys(DEFAULT_DATA)) {
      if (Array.isArray(DEFAULT_DATA[key])) {
        result[key] = Array.isArray(input?.[key]) ? input[key] : [];
      }
    }

    result.settings = {
      ...DEFAULT_DATA.settings,
      ...(input?.settings || {})
    };

    return result;
  }

  function toast(message) {
    const container = $("#toast-container");
    if (!container) return;

    const element = document.createElement("div");
    element.className = "toast";
    element.textContent = message;
    container.appendChild(element);

    setTimeout(() => element.remove(), 3000);
  }

  function formatDate(value) {
    if (!value) return "No date";

    const date = new Date(value + "T00:00:00");
    if (Number.isNaN(date.getTime())) return value;

    const format = data?.settings?.dateFormat || "DD/MM/YYYY";

    const day = String(date.getDate()).padStart(2, "0");
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const year = date.getFullYear();

    if (format === "MM/DD/YYYY") return `${month}/${day}/${year}`;
    if (format === "YYYY-MM-DD") return `${year}-${month}-${day}`;

    return `${day}/${month}/${year}`;
  }

  function todayISO() {
    const now = new Date();
    const offset = now.getTimezoneOffset() * 60000;
    return new Date(now.getTime() - offset).toISOString().slice(0, 10);
  }

  function currency(value) {
    const code = data?.settings?.currency || "USD";

    try {
      return new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: code,
        maximumFractionDigits: 2
      }).format(Number(value) || 0);
    } catch {
      return `${code} ${(Number(value) || 0).toFixed(2)}`;
    }
  }

    function saveData() {
    if (!data || locked) {
      return Promise.reject(new Error("FRIDAY is locked."));
    }

    // Recover the queue after a failed write.
    const nextWrite = saveQueue
      .catch(() => undefined)
      .then(() => FridayVault.save(data));

    saveQueue = nextWrite;
    return nextWrite;
  } 
   
  function applySettings() {
    const settings = data.settings;

    document.documentElement.dataset.theme = settings.theme || "obsidian";

    if (settings.accent) {
      document.documentElement.style.setProperty("--accent", settings.accent);
    } else {
      document.documentElement.style.removeProperty("--accent");
    }

    const logo = ICONS[settings.logo] || "F";

    $("#app-logo").textContent = logo;
    $("#lock-logo").textContent = logo;

    $$("[data-theme]").forEach(button => {
      button.classList.toggle(
        "active",
        button.dataset.theme === settings.theme
      );
    });

    $$("[data-logo]").forEach(button => {
      button.classList.toggle(
        "active",
        button.dataset.logo === settings.logo
      );
    });

    $("#accent-colour").value = settings.accent || (
      getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() ||
      "#36c9e8"
    );
    $("#currency-setting").value = settings.currency;
    $("#date-format-setting").value = settings.dateFormat;

    const timezoneSelect = $("#timezone-setting");
    const currentZone = settings.timezone || "local";

    if (
      timezoneSelect.options.length <= 1 &&
      typeof Intl.supportedValuesOf === "function"
    ) {
      const zones = Intl.supportedValuesOf("timeZone");
      const fragment = document.createDocumentFragment();

      zones.forEach(zone => {
        const option = document.createElement("option");
        option.value = zone;
        option.textContent = zone.replaceAll("_", " ");
        fragment.appendChild(option);
      });

      timezoneSelect.appendChild(fragment);
    }

    if (
      currentZone !== "local" &&
      ![...timezoneSelect.options].some(
        option => option.value === currentZone
      )
    ) {
      const option = document.createElement("option");
      option.value = currentZone;
      option.textContent = currentZone;
      timezoneSelect.appendChild(option);
    }

    timezoneSelect.value = currentZone;
  }
  function showPage(page) {
    const target = $(`#page-${page}`);
    if (!target) return;

    currentPage = page;

    $$(".page").forEach(section => {
      const active = section.id === `page-${page}`;
      section.hidden = !active;
      section.classList.toggle("active", active);
    });

    $$(".nav-item").forEach(button => {
      button.classList.toggle("active", button.dataset.page === page);
    });

    window.scrollTo({ top: 0, behavior: "smooth" });

    if (page === "home") renderDashboard();
    if (page === "tasks") renderTasks();
    if (page === "notes") renderNotes();
    if (page === "calendar") renderCalendar();
    if (page === "finance") renderFinance();
    if (page === "profiles") renderProfiles();
  }

  /* SECURITY AND VAULT */

  function showMainApp() {
    locked = false;
    $("#lock-screen").hidden = true;
    $("#main-app").hidden = false;

    applySettings();
    updateGreeting();
    renderAll();
    showPage("home"); 
     
    resetInactivityTimer();
  }

  function showLockScreen() {
    locked = true;
    $("#main-app").hidden = true;
    $("#lock-screen").hidden = false;
    $("#unlock-form").hidden = false;
    $("#setup-form").hidden = true;
    $("#unlock-password").value = "";
    $("#setup-password").value = "";
    $("#setup-confirm").value = "";
    $("#lock-message").textContent = "";

    if (data) {
      data = null;
    }

    FridayVault.lock();
  }

  async function initialiseSecurity() {
    try {
      const exists = await FridayVault.hasVault();

      $("#unlock-form").hidden = !exists;
      $("#setup-form").hidden = exists;

      $("#lock-message").textContent = exists
        ? "Enter your passphrase to continue."
        : "Create a passphrase to protect your FRIDAY vault.";
    } catch (error) {
      $("#lock-message").textContent = error.message;
    }
  }

  $("#setup-form").addEventListener("submit", async event => {
    event.preventDefault();

    const password = $("#setup-password").value;
    const confirmation = $("#setup-confirm").value;

    if (password.length < 8) {
      toast("Use at least 8 characters.");
      return;
    }

    if (password !== confirmation) {
      toast("Your passphrases do not match.");
      return;
    }

    const button = event.submitter;
    button.disabled = true;
    button.textContent = "Creating vault...";

    try {
      await FridayVault.initialize(password, DEFAULT_DATA);
      data = normaliseData(DEFAULT_DATA);
      showMainApp();
      toast("Your secure vault is ready.");
    } catch (error) {
      $("#lock-message").textContent = error.message;
    } finally {
      button.disabled = false;
      button.textContent = "Create secure vault";
    }
  });

  $("#unlock-form").addEventListener("submit", async event => {
    event.preventDefault();

    const button = $("#unlock-button");
    button.disabled = true;
    button.textContent = "Unlocking...";

    try {
      const stored = await FridayVault.unlock($("#unlock-password").value);
      data = normaliseData(stored);
      showMainApp();
      toast("Welcome back.");
    } catch {
      $("#lock-message").textContent =
        "Incorrect passphrase or damaged vault. Please try again.";
    } finally {
      button.disabled = false;
      button.textContent = "Unlock FRIDAY";
    }
  });

  $("#lock-button").addEventListener("click", () => {
    showLockScreen();
  });

  /* GREETING */

  function updateGreeting() {
    const hour = new Date().getHours();

    const greeting = hour < 12
      ? "Good morning."
      : hour < 18
        ? "Good afternoon."
        : "Good evening.";

    $("#greeting").textContent = greeting;

    const date = new Date();

    $("#current-date").textContent = date.toLocaleDateString(undefined, {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric"
    }).toUpperCase();

    $("#dashboard-date").textContent = date.toLocaleDateString(undefined, {
      weekday: "long",
      day: "numeric",
      month: "long"
    });

    const pending = data.tasks.filter(item => !item.completed).length;
    $("#daily-summary").textContent =
      pending === 0
        ? "Your schedule is clear. Make it count."
        : `You have ${pending} pending task${pending === 1 ? "" : "s"}.`;
  }

  /* DASHBOARD */

  function renderDashboard() {
    $("#task-count").textContent =
      data.tasks.filter(item => !item.completed).length;

    $("#note-count").textContent = data.notes.length;
    $("#profile-count").textContent = data.profiles.length;

    const income = data.transactions
      .filter(item => item.type === "income")
      .reduce((sum, item) => sum + Number(item.amount || 0), 0);

    const expenses = data.transactions
      .filter(item => item.type === "expense")
      .reduce((sum, item) => sum + Number(item.amount || 0), 0);

    $("#dashboard-balance").textContent = currency(income - expenses);
    $("#dashboard-income").textContent = currency(income);
    $("#dashboard-expenses").textContent = currency(expenses);

    const pending = data.tasks
      .filter(item => !item.completed)
      .sort((a, b) => (a.due || "").localeCompare(b.due || ""))
      .slice(0, 4);

    $("#dashboard-tasks").innerHTML = pending.length
      ? pending.map(item => taskHTML(item, true)).join("")
      : '<div class="empty-state">All clear. No pending tasks.</div>';

    const upcoming = [
      ...data.events.map(item => ({ ...item, kind: "Event" })),
      ...data.reminders.map(item => ({ ...item, kind: "Reminder" }))
    ]
      .filter(item => item.date >= todayISO())
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(0, 4);

    $("#dashboard-reminders").innerHTML = upcoming.length
      ? upcoming.map(item => `
        <div class="item-card">
          <div class="item-card-content">
            <h4>${escapeHTML(item.title)}</h4>
            <p>${escapeHTML(item.kind)} · ${formatDate(item.date)}</p>
          </div>
        </div>
      `).join("")
      : '<div class="empty-state">Nothing scheduled yet.</div>';

    const todayEvents = upcoming.length;
    $("#dashboard-agenda").textContent = todayEvents
      ? `${todayEvents} upcoming item${todayEvents === 1 ? "" : "s"} to keep an eye on.`
      : "No upcoming events or reminders.";
  }

  /* TASKS */

  function taskHTML(item, compact = false) {
    return `
      <div class="item-card" data-id="${escapeHTML(item.id)}">
        <input
          class="task-checkbox"
          type="checkbox"
          data-action="complete-task"
          data-id="${escapeHTML(item.id)}"
          ${item.completed ? "checked" : ""}
          aria-label="Complete task"
        >
        <div class="item-card-content">
          <h4 class="${item.completed ? "completed" : ""}">
            ${escapeHTML(item.title)}
          </h4>
          <p>${escapeHTML(item.due ? formatDate(item.due) : "No due date")}
            ${item.priority ? ` · ${escapeHTML(item.priority)}` : ""}
          </p>
        </div>
        ${compact ? "" : `
          <div class="item-card-actions">
            <button data-action="edit" data-type="task" data-id="${escapeHTML(item.id)}" aria-label="Edit">✎</button>
            <button data-action="delete" data-type="task" data-id="${escapeHTML(item.id)}" aria-label="Delete">×</button>
          </div>
        `}
      </div>
    `;
  }

  function renderTasks() {
    const tasks = data.tasks.filter(item => {
      if (taskFilter === "pending") return !item.completed;
      if (taskFilter === "completed") return item.completed;
      return true;
    });

    $("#task-list").innerHTML = tasks.length
      ? tasks.map(item => taskHTML(item)).join("")
      : '<div class="empty-state">Nothing here yet.</div>';
  }

  $("#task-filters").addEventListener("click", event => {
    const button = event.target.closest("[data-filter]");
    if (!button) return;

    taskFilter = button.dataset.filter;

    $$(".filter-button").forEach(item => {
      item.classList.toggle("active", item === button);
    });

    renderTasks();
  });

  /* NOTES */

  function renderNotes() {
    const query = $("#note-search").value.trim().toLowerCase();

    const notes = data.notes.filter(note =>
      `${note.title} ${note.content}`.toLowerCase().includes(query)
    );

    $("#note-list").innerHTML = notes.length
      ? notes.map(note => `
        <article class="note-card" data-id="${escapeHTML(note.id)}">
          <h4>${escapeHTML(note.title)}</h4>
          <p>${escapeHTML(note.content)}</p>
          <div class="item-card-actions">
            <button data-action="edit" data-type="note" data-id="${escapeHTML(note.id)}">Edit</button>
            <button data-action="delete" data-type="note" data-id="${escapeHTML(note.id)}">Delete</button>
          </div>
        </article>
      `).join("")
      : '<div class="empty-state">No matching notes found.</div>';
  }

  $("#note-search").addEventListener("input", renderNotes);

  /* CALENDAR */

  function renderCalendar() {
    const year = calendarDate.getFullYear();
    const month = calendarDate.getMonth();

    const firstDay = new Date(year, month, 1).getDay();
    const days = new Date(year, month + 1, 0).getDate();

    $("#calendar-month").textContent = calendarDate.toLocaleDateString(undefined, {
      month: "long",
      year: "numeric"
    });

    const weekdays = ["S", "M", "T", "W", "T", "F", "S"];

    let html = weekdays.map(day =>
      `<div class="calendar-day">${day}</div>`
    ).join("");

    for (let i = 0; i < firstDay; i++) {
      html += "<div></div>";
    }

    const eventDates = new Set([
      ...data.events.map(item => item.date),
      ...data.reminders.map(item => item.date)
    ]);

    for (let day = 1; day <= days; day++) {
      const date = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

      const today = date === todayISO();
      const selected = date === selectedCalendarDate;
      const hasEvent = eventDates.has(date);

      html += `
        <button
          class="calendar-date ${today ? "today" : ""} ${selected ? "selected" : ""} ${hasEvent ? "has-event" : ""}"
          data-date="${date}"
        >${day}</button>
      `;
    }

    $("#calendar-grid").innerHTML = html;

    const selectedDate = selectedCalendarDate || todayISO();

    const events = [
      ...data.events.map(item => ({ ...item, kind: "Event" })),
      ...data.reminders.map(item => ({ ...item, kind: "Reminder" }))
    ]
      .filter(item => item.date === selectedDate)
      .sort((a, b) => (a.time || "").localeCompare(b.time || ""));

    $("#event-list").innerHTML = events.length
      ? events.map(item => `
        <div class="item-card">
          <div class="item-card-content">
            <h4>${escapeHTML(item.title)}</h4>
            <p>${escapeHTML(item.kind)} · ${escapeHTML(item.time || "No time specified")}</p>
          </div>
          <div class="item-card-actions">
            <button data-action="edit" data-type="${item.kind.toLowerCase()}" data-id="${escapeHTML(item.id)}">Edit</button>
            <button data-action="delete" data-type="${item.kind.toLowerCase()}" data-id="${escapeHTML(item.id)}">×</button>
          </div>
        </div>
      `).join("")
      : `<div class="empty-state">Nothing scheduled for ${formatDate(selectedDate)}.</div>`;
  }

  $("#calendar-previous").addEventListener("click", () => {
    calendarDate.setMonth(calendarDate.getMonth() - 1);
    renderCalendar();
  });

  $("#calendar-next").addEventListener("click", () => {
    calendarDate.setMonth(calendarDate.getMonth() + 1);
    renderCalendar();
  });

  $("#calendar-grid").addEventListener("click", event => {
    const button = event.target.closest("[data-date]");
    if (!button) return;

    selectedCalendarDate = button.dataset.date;
    renderCalendar();
  });

  /* FINANCES */

  function renderFinance() {
    const income = data.transactions
      .filter(item => item.type === "income")
      .reduce((sum, item) => sum + Number(item.amount || 0), 0);

    const expenses = data.transactions
      .filter(item => item.type === "expense")
      .reduce((sum, item) => sum + Number(item.amount || 0), 0);

    $("#finance-balance").textContent = currency(income - expenses);
    $("#finance-income").textContent = currency(income);
    $("#finance-expenses").textContent = currency(expenses);

    $("#transaction-list").innerHTML = data.transactions.length
      ? [...data.transactions].reverse().slice(0, 30).map(item => `
        <div class="item-card">
          <div class="item-card-content">
            <h4>${escapeHTML(item.title)}</h4>
            <p>${escapeHTML(item.category || "Uncategorised")} · ${formatDate(item.date)}</p>
          </div>
          <strong>${item.type === "expense" ? "−" : "+"}${currency(item.amount)}</strong>
          <div class="item-card-actions">
            <button data-action="edit" data-type="transaction" data-id="${escapeHTML(item.id)}">Edit</button>
            <button data-action="delete" data-type="transaction" data-id="${escapeHTML(item.id)}">×</button>
          </div>
        </div>
      `).join("")
      : '<div class="empty-state">No transactions recorded.</div>';

    $("#budget-list").innerHTML = data.budgets.length
      ? data.budgets.map(item => {
        const spent = data.transactions
          .filter(tx => tx.type === "expense" && tx.category === item.category)
          .reduce((sum, tx) => sum + Number(tx.amount || 0), 0);

        const percentage = Math.min(100, item.amount > 0 ? spent / item.amount * 100 : 0);

        return `
          <div class="item-card">
            <div class="item-card-content">
              <h4>${escapeHTML(item.category)}</h4>
              <p>${currency(spent)} of ${currency(item.amount)}</p>
              <progress max="100" value="${percentage}"></progress>
            </div>
            <div class="item-card-actions">
              <button data-action="edit" data-type="budget" data-id="${escapeHTML(item.id)}">Edit</button>
              <button data-action="delete" data-type="budget" data-id="${escapeHTML(item.id)}">×</button>
            </div>
          </div>
        `;
      }).join("")
      : '<div class="empty-state">No budgets created.</div>';

    $("#savings-list").innerHTML = data.goals.length
      ? data.goals.map(item => {
        const percentage = Math.min(100, item.target > 0 ? item.saved / item.target * 100 : 0);

        return `
          <div class="item-card">
            <div class="item-card-content">
              <h4>${escapeHTML(item.title)}</h4>
              <p>${currency(item.saved)} of ${currency(item.target)}</p>
              <progress max="100" value="${percentage}"></progress>
            </div>
            <div class="item-card-actions">
              <button data-action="edit" data-type="goal" data-id="${escapeHTML(item.id)}">Edit</button>
              <button data-action="delete" data-type="goal" data-id="${escapeHTML(item.id)}">×</button>
            </div>
          </div>
        `;
      }).join("")
      : '<div class="empty-state">No savings goals yet.</div>';
  }

  /* PROFILES */

  function renderProfiles() {
    const query = $("#profile-search").value.trim().toLowerCase();

    const profiles = data.profiles.filter(profile =>
      `${profile.name} ${profile.category} ${profile.description}`
        .toLowerCase()
        .includes(query)
    );

    $("#profile-list").innerHTML = profiles.length
      ? profiles.map(profile => `
        <article class="profile-card">
          <div class="profile-avatar">${escapeHTML((profile.name || "?").slice(0, 1).toUpperCase())}</div>
          <h4>${escapeHTML(profile.name)}</h4>
          <p>${escapeHTML(profile.category || "General")}</p>
          <p>${escapeHTML(profile.description || "")}</p>
          <div class="item-card-actions">
            <button data-action="edit" data-type="profile" data-id="${escapeHTML(profile.id)}">Edit</button>
            <button data-action="delete" data-type="profile" data-id="${escapeHTML(profile.id)}">Delete</button>
          </div>
        </article>
      `).join("")
      : '<div class="empty-state">No matching profiles.</div>';
  }

  $("#profile-search").addEventListener("input", renderProfiles);

  /* EDITOR */

  const EDITOR_FIELDS = {
    task: [
      ["title", "Task name", "text", true],
      ["due", "Due date", "date"],
      ["priority", "Priority", "select", false, ["Low", "Normal", "High"]]
    ],
    note: [
      ["title", "Title", "text", true],
      ["content", "Your note", "textarea", true]
    ],
    event: [
      ["title", "Event name", "text", true],
      ["date", "Date", "date", true],
      ["time", "Time", "time"],
      ["description", "Description", "textarea"]
    ],
    reminder: [
      ["title", "Reminder", "text", true],
      ["date", "Date", "date", true],
      ["time", "Time", "time"],
      ["description", "Details", "textarea"]
    ],
    transaction: [
      ["title", "Description", "text", true],
      ["type", "Type", "select", true, ["expense", "income"]],
      ["amount", "Amount", "number", true],
      ["category", "Category", "text"],
      ["date", "Date", "date", true]
    ],
    budget: [
      ["category", "Budget category", "text", true],
      ["amount", "Budget limit", "number", true]
    ],
    goal: [
      ["title", "Goal name", "text", true],
      ["target", "Target amount", "number", true],
      ["saved", "Amount saved", "number", true]
    ],
    profile: [
      ["name", "Name", "text", true],
      ["category", "Category", "text", true],
      ["description", "Description", "textarea"],
      ["customFields", "Additional information", "textarea"]
    ]
  };

  function openEditor(type, existing = null) {
    if (!EDITOR_FIELDS[type]) return;

    editing = {
      type,
      id: existing?.id || null
    };

    $("#editor-title").textContent =
      `${existing ? "Edit" : "Create"} ${CATEGORIES[type]}`;

    $("#editor-fields").innerHTML = EDITOR_FIELDS[type].map(field => {
      const [name, label, inputType, required, options] = field;
      const value = existing?.[name] ?? (
        name === "date" ? todayISO() :
        name === "type" ? "expense" :
        name === "priority" ? "Normal" :
        name === "saved" ? 0 :
        ""
      );

      let input;

      if (inputType === "textarea") {
        input = `<textarea name="${name}" ${required ? "required" : ""}>${escapeHTML(value)}</textarea>`;
      } else if (inputType === "select") {
        input = `<select name="${name}" ${required ? "required" : ""}>
          ${options.map(option => `
            <option value="${escapeHTML(option)}" ${value === option ? "selected" : ""}>
              ${escapeHTML(option)}
            </option>
          `).join("")}
        </select>`;
      } else {
        input = `<input
          name="${name}"
          type="${inputType}"
          value="${escapeHTML(value)}"
          ${required ? "required" : ""}
          ${inputType === "number" ? 'min="0" step="any"' : ""}
        >`;
      }

      return `<label>${label}${input}</label>`;
    }).join("");

    $("#editor-overlay").hidden = false;
  }

  function closeEditor() {
    $("#editor-overlay").hidden = true;
    $("#editor-form").reset();
    editing = null;
  }

  $("#close-editor-button").addEventListener("click", closeEditor);
  $("#cancel-editor-button").addEventListener("click", closeEditor);

  $("#editor-overlay").addEventListener("click", event => {
    if (event.target === $("#editor-overlay")) closeEditor();
  });

  $("#editor-form").addEventListener("submit", async event => {
    event.preventDefault();
    if (!editing) return;

    const form = new FormData(event.target);
    const type = editing.type;
    const collection = type === "reminder" ? "reminders" : `${type}s`;

    const record = Object.fromEntries(form.entries());

    if (["amount", "target", "saved"].some(key => key in record)) {
      for (const key of ["amount", "target", "saved"]) {
        if (key in record) record[key] = Number(record[key]) || 0;
      }
    }

    const list = data[collection];
    const existingIndex = list.findIndex(item => item.id === editing.id);

    if (existingIndex >= 0) {
      list[existingIndex] = { ...list[existingIndex], ...record };
    } else {
      list.push({
        id: uid(),
        createdAt: new Date().toISOString(),
        completed: false,
        ...record
      });
    }

    try {
      await saveData();
      closeEditor();
      renderAll();
      toast(`${CATEGORIES[type]} saved.`);
    } catch (error) {
      toast(`Could not save: ${error.message}`);
    }
  });

  /* CREATE BUTTONS */

  const CREATE_BUTTONS = {
    "#add-task-button": "task",
    "#add-note-button": "note",
    "#add-event-button": "event",
    "#add-transaction-button": "transaction",
    "#add-budget-button": "budget",
    "#add-goal-button": "goal",
    "#add-profile-button": "profile"
  };

  Object.entries(CREATE_BUTTONS).forEach(([selector, type]) => {
    $(selector).addEventListener("click", () => openEditor(type));
  });

  /* QUICK ADD */

  $("#quick-add-button").addEventListener("click", () => {
    $("#quick-add-overlay").hidden = false;
  });

  $("#close-quick-add-button").addEventListener("click", () => {
    $("#quick-add-overlay").hidden = true;
  });

  $("#quick-add-overlay").addEventListener("click", event => {
    if (event.target === $("#quick-add-overlay")) {
      $("#quick-add-overlay").hidden = true;
    }
  });

  $("#quick-add-overlay").addEventListener("click", event => {
    const button = event.target.closest("[data-create]");
    if (!button) return;

    const type = button.dataset.create;
    $("#quick-add-overlay").hidden = true;

    if (type === "reminder") {
      openEditor("reminder");
    } else {
      openEditor(type);
    }
  });

  /* EDIT AND DELETE */

  document.addEventListener("click", async event => {
    const button = event.target.closest("[data-action]");
    if (!button || locked) return;

    const { action, type, id } = button.dataset;

    if (action === "edit") {
      const collection = type === "reminder" ? "reminders" : `${type}s`;
      const record = data[collection]?.find(item => item.id === id);
      if (record) openEditor(type, record);
    }

    if (action === "delete") {
      const collection = type === "reminder" ? "reminders" : `${type}s`;
      const index = data[collection]?.findIndex(item => item.id === id);

      if (index < 0) return;
      if (!confirm(`Delete this ${CATEGORIES[type]?.toLowerCase() || "item"}?`)) return;

      data[collection].splice(index, 1);

      try {
        await saveData();
        renderAll();
        toast("Item deleted.");
      } catch (error) {
        toast(error.message);
      }
    }
  });

  document.addEventListener("change", async event => {
    const checkbox = event.target.closest('[data-action="complete-task"]');
    if (!checkbox || locked) return;

    const task = data.tasks.find(item => item.id === checkbox.dataset.id);
    if (!task) return;

    task.completed = checkbox.checked;

    try {
      await saveData();
      renderAll();
    } catch (error) {
      toast(error.message);
    }
  });

  /* NAVIGATION */

  $$(".nav-item").forEach(button => {
    button.addEventListener("click", () => showPage(button.dataset.page));
  });

  document.addEventListener("click", event => {
    const button = event.target.closest("[data-page]");
    if (!button || button.classList.contains("nav-item")) return;

    showPage(button.dataset.page);
  });

  /* CUSTOMISATION */

  $("#theme-options").addEventListener("click", async event => {
    const button = event.target.closest("[data-theme]");
    if (!button) return;

    data.settings.theme = button.dataset.theme;
    applySettings();

    try {
      await saveData();
      toast(`${button.dataset.theme} theme applied.`);
    } catch (error) {
      toast(error.message);
    }
  });

  $("#logo-options").addEventListener("click", async event => {
    const button = event.target.closest("[data-logo]");
    if (!button) return;

    data.settings.logo = button.dataset.logo;
    applySettings();

    try {
      await saveData();
      toast("FRIDAY identity updated.");
    } catch (error) {
      toast(error.message);
    }
  });

  $("#accent-colour").addEventListener("input", event => {
    document.documentElement.style.setProperty("--accent", event.target.value);
  });

  $("#accent-colour").addEventListener("change", async event => {
    data.settings.accent = event.target.value;

    try {
      await saveData();
      toast("Accent colour saved.");
    } catch (error) {
      toast(error.message);
    }
  });

  $("#currency-setting").addEventListener("change", async event => {
    data.settings.currency = event.target.value;
    await updateSettings();
  });

  $("#date-format-setting").addEventListener("change", async event => {
    data.settings.dateFormat = event.target.value;
    await updateSettings();
  });

  $("#timezone-setting").addEventListener("change", async event => {
    data.settings.timezone = event.target.value;
    await updateSettings();
  });

  async function updateSettings() {
    applySettings();

    try {
      await saveData();
      renderAll();
      toast("Preference saved.");
    } catch (error) {
      toast(error.message);
    }
  }

  /* CHANGE PASSPHRASE */

  $("#change-password-button").addEventListener("click", async () => {
    const oldPassword = prompt("Enter your current passphrase.");
    if (oldPassword === null) return;

    const newPassword = prompt("Enter a new passphrase (at least 8 characters).");
    if (newPassword === null) return;

    if (newPassword.length < 8) {
      toast("The new passphrase must be at least 8 characters.");
      return;
    }

    const confirmation = prompt("Confirm your new passphrase.");
    if (confirmation !== newPassword) {
      toast("The passphrases do not match.");
      return;
    }

    try {
      await FridayVault.changePin(oldPassword, newPassword);
      toast("Passphrase changed successfully.");
    } catch (error) {
      toast(error.message);
    }
  });

  /* BACKUP PLACEHOLDERS */

  
  /* ENCRYPTED BACKUP AND RESTORE */

  $("#export-backup-button").addEventListener("click", async () => {
    if (!data || locked) return;

    const passphrase = prompt(
      "Create a backup passphrase (at least 12 characters).\nKeep it safe. FRIDAY cannot recover it."
    );

    if (passphrase === null) return;

    if (passphrase.length < 12) {
      toast("Backup passphrase must be at least 12 characters.");
      return;
    }

    const confirmation = prompt("Confirm your backup passphrase.");

    if (confirmation !== passphrase) {
      toast("The passphrases do not match.");
      return;
    }

    try {
      await saveQueue;
      const archive = await FridayBackup.create(data, passphrase);
      const url = URL.createObjectURL(archive);
      const link = document.createElement("a");

      link.href = url;
      link.download = `FRIDAY-Backup-${new Date()
        .toISOString()
        .slice(0, 10)}.zip`;

      document.body.appendChild(link);
      link.click();
      link.remove();

      setTimeout(() => URL.revokeObjectURL(url), 1000);

      toast("Encrypted backup created successfully.");
    } catch (error) {
      console.error("Backup export failed:", error);
      toast(error.message || "Could not create backup.");
    }
  });

  $("#import-backup-button").addEventListener("click", () => {
    if (!data || locked) return;

    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = ".zip,application/zip";
    fileInput.hidden = true;

    fileInput.addEventListener("change", async () => {
      const file = fileInput.files?.[0];
      fileInput.remove();

      if (!file) return;

      const confirmed = confirm(
        "Restoring this backup will replace your current FRIDAY data. Continue?"
      );

      if (!confirmed) return;

      const passphrase = prompt(
        "Enter the passphrase used when this backup was created."
      );

      if (passphrase === null) return;

      try {
        await saveQueue;

        const restored = await FridayBackup.restore(file, passphrase);
        const safeData = normaliseData(restored);

        await FridayVault.save(safeData);

        data = safeData;
        renderAll();

        toast("FRIDAY backup restored successfully.");
      } catch (error) {
        console.error("Backup restore failed:", error);
        toast(error.message || "Could not restore backup.");
      }
    });

    document.body.appendChild(fileInput);
    fileInput.click();
  });

  /* RENDER */

  function renderAll() {
    if (!data || locked) return;

    updateGreeting();
    renderDashboard();
    renderTasks();
    renderNotes();
    renderCalendar();
    renderFinance();
    renderProfiles();
    applySettings();
  }

  /* AUTOMATIC LOCK */

  let inactivityTimer;

  function resetInactivityTimer() {
    clearTimeout(inactivityTimer);

    if (locked) return;

    inactivityTimer = setTimeout(() => {
      showLockScreen();
    }, 5 * 60 * 1000);
  }

  ["pointerdown", "keydown", "touchstart"].forEach(name => {
    document.addEventListener(name, resetInactivityTimer, { passive: true });
  });



  /* STARTUP */

  async function start() {
    await initialiseSecurity();

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("./sw.js").catch(error => {
        console.warn("Service worker registration failed:", error);
      });
    }
  }

  start();

})();

const API = "";

// Role & permissions (loaded on startup)
let myRole = "viewer";
let myPerms = {};
let serverOnline = false;

const OFFLINE_MSG = "Server is offline. Start it from the Controls tab.";

async function loadMe() {
  const data = await api("/api/me");
  if (!data) return;
  myRole = data.role;
  myPerms = data.perms;

  // Role badge
  const badge = document.getElementById("roleBadge");
  badge.textContent = myRole;
  badge.className = `role-badge role-${myRole}`;
  badge.style.display = "inline-block";

  applyPermissions();
}

function applyPermissions() {
  if (!myPerms.console) hideByPanel("console");
  if (!myPerms.containerControl && !myPerms.quickActions && !myPerms.broadcast) {
    hideByPanel("controls");
  }

  if (!myPerms.configEdit) {
    document.querySelectorAll("[data-perm='configEdit']").forEach((el) =>
      el.classList.add("perm-hidden")
    );
  }
  if (!myPerms.playerKick && !myPerms.playerBan) {
    document.querySelectorAll("[data-perm='playerManage']").forEach((el) =>
      el.classList.add("perm-hidden")
    );
  }
  if (!myPerms.playerAdmin) {
    document.querySelectorAll("[data-perm='playerAdmin']").forEach((el) =>
      el.classList.add("perm-hidden")
    );
  }
  if (!myPerms.mapHost) {
    document.querySelectorAll("[data-perm='mapHost']").forEach((el) =>
      el.classList.add("perm-hidden")
    );
  }
  if (!myPerms.modManage) {
    document.querySelectorAll("[data-perm='modManage']").forEach((el) =>
      el.classList.add("perm-hidden")
    );
  }
  if (!myPerms.containerControl) {
    document.querySelectorAll("[data-perm='containerControl']").forEach((el) =>
      el.classList.add("perm-hidden")
    );
  }
  if (!myPerms.broadcast) {
    document.querySelectorAll("[data-perm='broadcast']").forEach((el) =>
      el.classList.add("perm-hidden")
    );
  }
  if (myPerms.quickActions === "limited") {
    document.querySelectorAll("[data-perm='quickAdmin']").forEach((el) =>
      el.classList.add("perm-hidden")
    );
  } else if (!myPerms.quickActions) {
    document.querySelectorAll("[data-perm='quickActions']").forEach((el) =>
      el.classList.add("perm-hidden")
    );
  }
}

function hideByPanel(panelName) {
  const navBtn = document.querySelector(`nav button[data-panel="${panelName}"]`);
  if (navBtn) navBtn.classList.add("perm-hidden");
}

// Update UI elements that depend on server online/offline state
function updateOnlineState(online) {
  const wasOffline = !serverOnline;
  serverOnline = online;

  // Console: disable/enable input
  const cmdInput = document.getElementById("cmdInput");
  const cmdBtn = cmdInput ? cmdInput.nextElementSibling : null;
  if (cmdInput) {
    cmdInput.disabled = !online;
    cmdInput.placeholder = online ? "e.g. status, help, players" : "Server is offline...";
  }
  if (cmdBtn) cmdBtn.disabled = !online;

  // Quick actions & broadcast: disable/enable buttons (but NOT container start/stop/restart)
  document.querySelectorAll("[data-perm='quickActions'] .btn").forEach((btn) => {
    btn.disabled = !online;
  });
  document.querySelectorAll("[data-perm='quickAdmin'] .btn").forEach((btn) => {
    btn.disabled = !online;
  });
  const sayInput = document.getElementById("sayInput");
  const sayBtn = sayInput ? sayInput.parentElement.querySelector(".btn") : null;
  if (sayInput) sayInput.disabled = !online;
  if (sayBtn) sayBtn.disabled = !online;

  const limitInput = document.getElementById("playerLimitInput");
  const limitBtn = limitInput ? limitInput.parentElement.querySelector(".btn") : null;
  if (limitInput) limitInput.disabled = !online;
  if (limitBtn) limitBtn.disabled = !online;

  // If server just came online, refresh the active panel
  if (online && wasOffline) {
    const activePanel = document.querySelector("nav button.active");
    if (activePanel) {
      const panel = activePanel.dataset.panel;
      if (panel === "config") loadConfig();
      else if (panel === "players") loadPlayers();
      else if (panel === "maps") loadMaps();
      else if (panel === "logs") loadLogs();
    }
    loadMapSelects();
  }
}

// Navigation
document.querySelectorAll("nav button").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("nav button").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".panel").forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById("panel-" + btn.dataset.panel).classList.add("active");

    const panel = btn.dataset.panel;
    if (panel === "config") loadConfig();
    else if (panel === "players") loadPlayers();
    else if (panel === "logs") loadLogs();
    else if (panel === "maps") loadMaps();
    else if (panel === "mods") loadModsTab();
  });
});

// Toast notification
function toast(msg, type = "success") {
  document.querySelectorAll(".toast").forEach((t) => t.remove());
  const el = document.createElement("div");
  el.className = "toast " + type;
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

async function api(url, opts = {}) {
  try {
    const res = await fetch(API + url, {
      headers: { "Content-Type": "application/json" },
      ...opts,
    });
    if (res.redirected || res.status === 401) {
      window.location.href = "/login";
      return null;
    }
    const data = await res.json();
    // Handle offline response from server
    if (data && data.offline) {
      return null;
    }
    return data;
  } catch (err) {
    toast("Request failed: " + err.message, "error");
    return null;
  }
}

// ── Dashboard ──
async function loadDashboard() {
  const data = await api("/api/status");
  if (!data) return;

  const badge = document.getElementById("statusBadge");
  if (data.running) {
    badge.textContent = "Online";
    badge.className = "status-badge online";
    document.getElementById("statStatus").textContent = "Online";
    document.getElementById("statStatus").style.color = "var(--green)";
    updateOnlineState(true);
  } else {
    badge.textContent = "Offline";
    badge.className = "status-badge offline";
    document.getElementById("statStatus").textContent = "Offline";
    document.getElementById("statStatus").style.color = "var(--red)";
    document.getElementById("gameStatusRaw").textContent = "Server is offline";
    ["statMap", "statWave", "statPlayers", "statFps", "statRam"].forEach(
      (id) => (document.getElementById(id).textContent = "--")
    );
    updateOnlineState(false);
    return;
  }

  const lines = data.gameStatus || [];
  const raw = lines.join("\n");
  document.getElementById("gameStatusRaw").textContent = raw || "No status info";

  for (const line of lines) {
    const s = line.replace(/\x1b\[[0-9;]*m/g, "").trim();

    const mapWave = s.match(/Playing on map (.+?) \/ Wave (\d+)/i);
    if (mapWave) {
      document.getElementById("statMap").textContent = mapWave[1];
      document.getElementById("statWave").textContent = mapWave[2];
    }

    const fpsRam = s.match(/(\d+)\s*FPS,\s*(\d+)\s*MB/i);
    if (fpsRam) {
      document.getElementById("statFps").textContent = fpsRam[1];
      document.getElementById("statRam").textContent = fpsRam[2] + " MB";
    }

    if (/No players connected/i.test(s)) {
      document.getElementById("statPlayers").textContent = "0";
    }
    const playerMatch = s.match(/^Players:\s*(.+)/i);
    if (playerMatch) {
      const count = playerMatch[1].split(",").length;
      document.getElementById("statPlayers").textContent = String(count);
    }
  }
}

// ── Config ──
async function loadConfig() {
  if (!serverOnline) {
    document.getElementById("configLoading").style.display = "none";
    document.getElementById("configTable").style.display = "none";
    document.getElementById("configList").innerHTML =
      `<div class="empty-state">${OFFLINE_MSG}</div>`;
    return;
  }

  document.getElementById("configLoading").style.display = "block";
  document.getElementById("configTable").style.display = "none";
  document.getElementById("configList").innerHTML = "";

  const data = await api("/api/config");
  if (!data || !data.configs) {
    document.getElementById("configLoading").style.display = "none";
    document.getElementById("configList").innerHTML =
      `<div class="empty-state">${serverOnline ? "Failed to load config" : OFFLINE_MSG}</div>`;
    return;
  }

  document.getElementById("configLoading").style.display = "none";
  document.getElementById("configTable").style.display = "table";

  const body = document.getElementById("configBody");
  body.innerHTML = "";
  const list = document.getElementById("configList");
  list.innerHTML = "";

  const canEdit = myPerms.configEdit;

  for (const cfg of data.configs) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><strong>${esc(cfg.name)}</strong></td>
      <td>
        <span class="cfg-display">${esc(cfg.value)}</span>
        ${canEdit ? `<input type="text" class="cfg-edit" value="${esc(cfg.value)}" style="display:none" onkeydown="if(event.key==='Enter')this.closest('tr').querySelector('.save-btn').click();if(event.key==='Escape')this.closest('tr').querySelector('.cancel-btn').click();">` : ""}
      </td>
      <td><span class="desc">${esc(cfg.description)}</span></td>
      <td>
        ${canEdit ? `<div class="cfg-actions">
          <button class="btn btn-secondary btn-sm edit-btn" onclick="editConfig(this)">Edit</button>
          <button class="btn btn-primary btn-sm save-btn" style="display:none" onclick="saveConfig(this, '${esc(cfg.name)}')">Save</button>
          <button class="btn btn-sm cancel-btn" style="display:none; background: rgba(255,255,255,0.1); color: var(--text2);" onclick="cancelConfig(this, '${esc(cfg.value)}')">Cancel</button>
        </div>` : ""}
      </td>
    `;
    body.appendChild(tr);

    const card = document.createElement("div");
    card.className = "config-item";
    card.innerHTML = `
      <div class="config-item-header">
        <span class="config-item-name">${esc(cfg.name)}</span>
        ${canEdit ? `<div class="cfg-actions">
          <button class="btn btn-secondary btn-sm edit-btn" onclick="editConfigMobile(this)">Edit</button>
          <button class="btn btn-primary btn-sm save-btn" style="display:none" onclick="saveConfigMobile(this, '${esc(cfg.name)}')">Save</button>
          <button class="btn btn-sm cancel-btn" style="display:none; background: rgba(255,255,255,0.1); color: var(--text2);" onclick="cancelConfigMobile(this, '${esc(cfg.value)}')">Cancel</button>
        </div>` : ""}
      </div>
      <div class="config-item-value cfg-display">${esc(cfg.value)}</div>
      <div class="config-item-desc">${esc(cfg.description)}</div>
      ${canEdit ? `<div class="config-item-edit">
        <input type="text" class="cfg-edit" value="${esc(cfg.value)}" onkeydown="if(event.key==='Enter')this.closest('.config-item').querySelector('.save-btn').click();if(event.key==='Escape')this.closest('.config-item').querySelector('.cancel-btn').click();">
      </div>` : ""}
    `;
    list.appendChild(card);
  }
}

// Desktop config edit/save/cancel
function editConfig(btn) {
  const tr = btn.closest("tr");
  tr.querySelector(".cfg-display").style.display = "none";
  tr.querySelector(".cfg-edit").style.display = "block";
  tr.querySelector(".edit-btn").style.display = "none";
  tr.querySelector(".save-btn").style.display = "inline-block";
  tr.querySelector(".cancel-btn").style.display = "inline-block";
  tr.querySelector(".cfg-edit").focus();
}

async function saveConfig(btn, name) {
  const tr = btn.closest("tr");
  const value = tr.querySelector(".cfg-edit").value;
  btn.disabled = true;
  btn.textContent = "...";

  const data = await api("/api/config", {
    method: "POST",
    body: JSON.stringify({ name, value }),
  });

  if (data && data.success) {
    toast(`${name} updated`);
    tr.querySelector(".cfg-display").textContent = value;
  } else {
    toast("Failed to update " + name, "error");
  }

  tr.querySelector(".cfg-display").style.display = "inline";
  tr.querySelector(".cfg-edit").style.display = "none";
  tr.querySelector(".edit-btn").style.display = "inline-block";
  tr.querySelector(".save-btn").style.display = "none";
  tr.querySelector(".cancel-btn").style.display = "none";
  btn.disabled = false;
  btn.textContent = "Save";
}

function cancelConfig(btn, originalValue) {
  const tr = btn.closest("tr");
  tr.querySelector(".cfg-edit").value = originalValue;
  tr.querySelector(".cfg-display").style.display = "inline";
  tr.querySelector(".cfg-edit").style.display = "none";
  tr.querySelector(".edit-btn").style.display = "inline-block";
  tr.querySelector(".save-btn").style.display = "none";
  tr.querySelector(".cancel-btn").style.display = "none";
}

// Mobile config edit/save/cancel
function editConfigMobile(btn) {
  const card = btn.closest(".config-item");
  card.querySelector(".cfg-display").style.display = "none";
  card.querySelector(".config-item-edit").style.display = "flex";
  card.querySelector(".edit-btn").style.display = "none";
  card.querySelector(".save-btn").style.display = "inline-block";
  card.querySelector(".cancel-btn").style.display = "inline-block";
  card.querySelector(".cfg-edit").focus();
}

async function saveConfigMobile(btn, name) {
  const card = btn.closest(".config-item");
  const value = card.querySelector(".cfg-edit").value;
  btn.disabled = true;
  btn.textContent = "...";

  const data = await api("/api/config", {
    method: "POST",
    body: JSON.stringify({ name, value }),
  });

  if (data && data.success) {
    toast(`${name} updated`);
    card.querySelector(".cfg-display").textContent = value;
  } else {
    toast("Failed to update " + name, "error");
  }

  card.querySelector(".cfg-display").style.display = "block";
  card.querySelector(".config-item-edit").style.display = "none";
  card.querySelector(".edit-btn").style.display = "inline-block";
  card.querySelector(".save-btn").style.display = "none";
  card.querySelector(".cancel-btn").style.display = "none";
  btn.disabled = false;
  btn.textContent = "Save";
}

function cancelConfigMobile(btn, originalValue) {
  const card = btn.closest(".config-item");
  card.querySelector(".cfg-edit").value = originalValue;
  card.querySelector(".cfg-display").style.display = "block";
  card.querySelector(".config-item-edit").style.display = "none";
  card.querySelector(".edit-btn").style.display = "inline-block";
  card.querySelector(".save-btn").style.display = "none";
  card.querySelector(".cancel-btn").style.display = "none";
}

// ── Players ──
async function loadPlayers() {
  const el = document.getElementById("playersList");
  if (!serverOnline) {
    el.innerHTML = `<div class="empty-state">${OFFLINE_MSG}</div>`;
    return;
  }

  const data = await api("/api/players");
  if (
    !data ||
    !data.players ||
    data.players.length === 0 ||
    (data.players.length === 1 && /no players/i.test(data.players[0]))
  ) {
    el.innerHTML = '<div class="empty-state">No players online</div>';
    return;
  }
  let html = '<ul class="player-list">';
  for (const p of data.players) {
    const stripped = p.replace(/\x1b\[[0-9;]*m/g, "").trim();
    if (stripped && !/^Players/i.test(stripped)) {
      const name = esc(stripped.split(" ")[0]);
      const hasActions = myPerms.playerKick || myPerms.playerBan || myPerms.playerAdmin;
      html += `<li>
        <span>${esc(stripped)}</span>
        ${hasActions ? `<div class="cfg-actions">
          ${myPerms.playerKick ? `<button class="btn btn-warning btn-sm" onclick="quickKick('${name}')">Kick</button>` : ""}
          ${myPerms.playerBan ? `<button class="btn btn-danger btn-sm" onclick="quickBan('${name}')">Ban</button>` : ""}
          ${myPerms.playerAdmin ? `<button class="btn btn-primary btn-sm" onclick="quickAdmin('${name}')">Admin</button>` : ""}
        </div>` : ""}
      </li>`;
    }
  }
  html += "</ul>";
  el.innerHTML = html;
}

// Player management actions
function showMgmtOutput(lines) {
  const el = document.getElementById("mgmtOutput");
  el.style.display = "block";
  el.textContent = lines.join("\n");
  el.scrollTop = el.scrollHeight;
}

function checkOnline() {
  if (!serverOnline) {
    toast("Server is offline", "error");
    return false;
  }
  return true;
}

async function kickPlayer() {
  if (!checkOnline()) return;
  const name = document.getElementById("kickInput").value.trim();
  if (!name) return toast("Enter a player name", "error");
  if (!confirm(`Kick "${name}"?`)) return;
  const data = await api("/api/command", {
    method: "POST",
    body: JSON.stringify({ command: `kick ${name}` }),
  });
  if (data && data.output) showMgmtOutput(data.output);
  toast(`Kick command sent for ${name}`);
  document.getElementById("kickInput").value = "";
  setTimeout(loadPlayers, 2000);
}

async function banPlayer() {
  if (!checkOnline()) return;
  const value = document.getElementById("banInput").value.trim();
  const type = document.getElementById("banType").value;
  if (!value) return toast("Enter a player name/ID/IP", "error");
  if (!confirm(`Ban "${value}" by ${type}?`)) return;
  const data = await api("/api/command", {
    method: "POST",
    body: JSON.stringify({ command: `ban ${type} ${value}` }),
  });
  if (data && data.output) showMgmtOutput(data.output);
  toast(`Ban command sent`);
  document.getElementById("banInput").value = "";
}

async function unbanPlayer() {
  if (!checkOnline()) return;
  const value = document.getElementById("unbanInput").value.trim();
  if (!value) return toast("Enter an IP or ID", "error");
  const data = await api("/api/command", {
    method: "POST",
    body: JSON.stringify({ command: `unban ${value}` }),
  });
  if (data && data.output) showMgmtOutput(data.output);
  toast("Unban command sent");
  document.getElementById("unbanInput").value = "";
}

async function adminPlayer(action) {
  if (!checkOnline()) return;
  const value = document.getElementById("adminInput").value.trim();
  if (!value) return toast("Enter a player name or ID", "error");
  const data = await api("/api/command", {
    method: "POST",
    body: JSON.stringify({ command: `admin ${action} ${value}` }),
  });
  if (data && data.output) showMgmtOutput(data.output);
  toast(`Admin ${action} sent for ${value}`);
  document.getElementById("adminInput").value = "";
}

async function searchPlayer() {
  if (!checkOnline()) return;
  const value = document.getElementById("searchInput").value.trim();
  if (!value) return toast("Enter a search term", "error");
  const data = await api("/api/command", {
    method: "POST",
    body: JSON.stringify({ command: `search ${value}` }),
  });
  if (data && data.output) showMgmtOutput(data.output);
}

async function infoPlayer() {
  if (!checkOnline()) return;
  const value = document.getElementById("searchInput").value.trim();
  if (!value) return toast("Enter a name, IP or UUID", "error");
  const data = await api("/api/command", {
    method: "POST",
    body: JSON.stringify({ command: `info ${value}` }),
  });
  if (data && data.output) showMgmtOutput(data.output);
}

async function loadBans() {
  if (!checkOnline()) return;
  const data = await api("/api/command", {
    method: "POST",
    body: JSON.stringify({ command: "bans" }),
  });
  const el = document.getElementById("bansOutput");
  if (data && data.output) {
    el.textContent = data.output.join("\n") || "No bans";
  }
}

async function loadAdmins() {
  if (!checkOnline()) return;
  const data = await api("/api/command", {
    method: "POST",
    body: JSON.stringify({ command: "admins" }),
  });
  const el = document.getElementById("adminsOutput");
  if (data && data.output) {
    el.textContent = data.output.join("\n") || "No admins";
  }
}

// Quick actions from player list
function quickKick(name) {
  if (!checkOnline()) return;
  if (!confirm(`Kick "${name}"?`)) return;
  api("/api/command", {
    method: "POST",
    body: JSON.stringify({ command: `kick ${name}` }),
  }).then(() => {
    toast(`Kicked ${name}`);
    setTimeout(loadPlayers, 2000);
  });
}

function quickBan(name) {
  if (!checkOnline()) return;
  if (!confirm(`Ban "${name}"?`)) return;
  api("/api/command", {
    method: "POST",
    body: JSON.stringify({ command: `ban name ${name}` }),
  }).then(() => {
    toast(`Banned ${name}`);
    setTimeout(loadPlayers, 2000);
  });
}

function quickAdmin(name) {
  if (!checkOnline()) return;
  if (!confirm(`Make "${name}" admin?`)) return;
  api("/api/command", {
    method: "POST",
    body: JSON.stringify({ command: `admin add ${name}` }),
  }).then(() => toast(`${name} is now admin`));
}

// ── Maps ──
let cachedMaps = [];

async function loadMapSelects() {
  if (!serverOnline) return;
  const data = await api("/api/maps/list");
  if (!data || !data.maps) return;
  cachedMaps = data.maps;

  const selects = [
    document.getElementById("hostMap"),
    document.getElementById("nextMapInput"),
  ];
  for (const sel of selects) {
    sel.innerHTML = "";
    const defaultOpt = document.createElement("option");
    defaultOpt.value = "";
    defaultOpt.textContent = "-- Select a map --";
    sel.appendChild(defaultOpt);

    const defaults = cachedMaps.filter((m) => m.type === "Default");
    const customs = cachedMaps.filter((m) => m.type === "Custom");

    if (defaults.length) {
      const group = document.createElement("optgroup");
      group.label = "Default Maps";
      for (const m of defaults) {
        const opt = document.createElement("option");
        opt.value = m.rawName;
        opt.textContent = `${m.name} (${m.size})`;
        group.appendChild(opt);
      }
      sel.appendChild(group);
    }
    if (customs.length) {
      const group = document.createElement("optgroup");
      group.label = "Custom Maps";
      for (const m of customs) {
        const opt = document.createElement("option");
        opt.value = m.rawName;
        opt.textContent = `${m.name} (${m.size})`;
        group.appendChild(opt);
      }
      sel.appendChild(group);
    }
  }
}

async function loadMaps() {
  const el = document.getElementById("mapsList");
  if (!serverOnline) {
    el.textContent = OFFLINE_MSG;
    return;
  }

  const filter = document.getElementById("mapFilter").value;
  const data = await api(`/api/maps?filter=${filter}`);
  if (data && data.maps) {
    el.textContent = data.maps.join("\n");
  } else {
    el.textContent = serverOnline ? "Failed to load maps" : OFFLINE_MSG;
  }
  await loadMapSelects();
}

async function hostMap() {
  if (!checkOnline()) return;
  const map = document.getElementById("hostMap").value;
  const mode = document.getElementById("hostMode").value;
  if (!map) {
    toast("Select a map", "error");
    return;
  }
  const mapName = map.replace(/_/g, " ");
  if (!confirm(`Host map "${mapName}" in ${mode} mode?`)) return;
  const data = await api("/api/host", {
    method: "POST",
    body: JSON.stringify({ map, mode }),
  });
  if (data) toast(`Hosting ${mapName}!`);
  setTimeout(loadDashboard, 2000);
}

async function setNextMap() {
  if (!checkOnline()) return;
  const map = document.getElementById("nextMapInput").value;
  if (!map) return toast("Select a map", "error");
  const mapName = map.replace(/_/g, " ");
  const data = await api("/api/command", {
    method: "POST",
    body: JSON.stringify({ command: `nextmap ${map}` }),
  });
  if (data) toast(`Next map set to ${mapName}`);
}

// ── Logs ──
async function loadLogs() {
  const el = document.getElementById("logViewer");
  const data = await api("/api/logs");
  if (data && data.logs && data.logs.length > 0) {
    el.innerHTML = data.logs
      .map((l) => {
        const stripped = l.replace(/\x1b\[[0-9;]*m/g, "");
        let cls = "";
        if (/\[I\]/.test(stripped)) cls = "log-info";
        else if (/\[W\]/.test(stripped)) cls = "log-warn";
        else if (/\[E\]/.test(stripped)) cls = "log-error";
        return `<div class="${cls}">${esc(stripped)}</div>`;
      })
      .join("");
    if (document.getElementById("autoScroll").checked) {
      el.scrollTop = el.scrollHeight;
    }
  } else {
    el.textContent = serverOnline ? "No logs available" : "No logs available (server is offline)";
  }
}

// ── Console ──
async function sendCmd() {
  if (!checkOnline()) return;
  const input = document.getElementById("cmdInput");
  const cmd = input.value.trim();
  if (!cmd) return;

  const output = document.getElementById("consoleOutput");
  output.textContent += `\n> ${cmd}\n`;
  input.value = "";

  const data = await api("/api/command", {
    method: "POST",
    body: JSON.stringify({ command: cmd }),
  });

  if (data && data.output) {
    output.textContent += data.output.join("\n") + "\n";
  } else if (data && data.error) {
    output.textContent += `Error: ${data.error}\n`;
  }
  output.scrollTop = output.scrollHeight;
}

// ── Controls ──
async function containerAction(action) {
  if (!confirm(`${action.charAt(0).toUpperCase() + action.slice(1)} the server?`))
    return;
  const data = await api(`/api/container/${action}`, { method: "POST" });
  if (data && data.success) {
    toast(`Server ${action}ed`);
    setTimeout(loadDashboard, 3000);
  } else {
    toast(`Failed to ${action}`, "error");
  }
}

async function sendQuick(cmd) {
  if (!checkOnline()) return;
  const data = await api("/api/command", {
    method: "POST",
    body: JSON.stringify({ command: cmd }),
  });
  if (data) toast("Command sent: " + cmd);
}

async function broadcastMsg() {
  if (!checkOnline()) return;
  const input = document.getElementById("sayInput");
  const msg = input.value.trim();
  if (!msg) return;
  await api("/api/command", {
    method: "POST",
    body: JSON.stringify({ command: "say " + msg }),
  });
  toast("Message sent");
  input.value = "";
}

async function setPlayerLimit() {
  if (!checkOnline()) return;
  const val = document.getElementById("playerLimitInput").value.trim();
  if (!val) return toast("Enter a number or 'off'", "error");
  const data = await api("/api/command", {
    method: "POST",
    body: JSON.stringify({ command: `playerlimit ${val}` }),
  });
  if (data) toast(`Player limit set to ${val}`);
  document.getElementById("playerLimitInput").value = "";
}

// ── Mods ──
let allBrowseMods = [];
let filteredMods = [];
let modsShown = 0;
const MODS_PER_PAGE = 20;
let installedModFiles = new Set();
let modSearchTimeout = null;
let isSearching = false;
let searchPage = 1;
let searchTotal = 0;
let lastSearchQuery = "";

function loadModsTab() {
  loadInstalledMods();
  if (allBrowseMods.length === 0) loadBrowseMods();
}

async function loadInstalledMods() {
  const el = document.getElementById("installedModsList");
  const data = await api("/api/mods/installed");
  if (!data || !data.mods || data.mods.length === 0) {
    el.innerHTML = '<div class="empty-state">No mods installed</div>';
    installedModFiles = new Set();
    return;
  }
  installedModFiles = new Set(data.mods.map((m) => m.file.toLowerCase()));
  let html = "";
  for (const m of data.mods) {
    html += `<div class="mod-installed-item">
      <div>
        <div class="mod-installed-name">${esc(m.name)}</div>
        <div class="mod-installed-file">${esc(m.file)} - ${esc(m.size)}</div>
      </div>
      ${myPerms.modManage ? `<button class="btn btn-danger btn-sm" onclick="uninstallMod('${esc(m.file)}')">Remove</button>` : ""}
    </div>`;
  }
  el.innerHTML = html;
  // Re-render browse list to update install status
  if (filteredMods.length > 0) renderBrowseMods();
}

async function loadBrowseMods() {
  const el = document.getElementById("browseModsList");
  el.innerHTML = '<div class="empty-state"><span class="loading"></span> Loading mod repository...</div>';
  const data = await api("/api/mods/browse");
  if (!data || !data.mods) {
    el.innerHTML = '<div class="empty-state">Failed to load mod repository</div>';
    return;
  }
  // Sort by stars descending
  allBrowseMods = data.mods.sort((a, b) => (b.stars || 0) - (a.stars || 0));
  filteredMods = allBrowseMods;
  modsShown = 0;
  document.getElementById("modCount").textContent = `${allBrowseMods.length} mods`;
  renderBrowseMods();
}

function filterBrowseMods() {
  const q = document.getElementById("modSearchInput").value.trim();

  if (modSearchTimeout) clearTimeout(modSearchTimeout);

  if (!q) {
    isSearching = false;
    applyModFilters();
    return;
  }

  // Debounce 400ms before hitting GitHub API
  modSearchTimeout = setTimeout(async () => {
    isSearching = true;
    searchPage = 1;
    lastSearchQuery = q;
    const el = document.getElementById("browseModsList");
    el.innerHTML = '<div class="empty-state"><span class="loading"></span> Searching GitHub...</div>';

    const sortBy = document.getElementById("modSort").value;
    const typeFilter = document.getElementById("modType").value;
    let searchUrl = `/api/mods/search?q=${encodeURIComponent(q)}&page=1&sort=${sortBy}`;
    if (typeFilter === "java") searchUrl += "&language=java";
    else if (typeFilter === "nonjava") searchUrl += "&language=javascript"; // non-Java approx
    const data = await api(searchUrl);
    if (!data || !data.mods) {
      el.innerHTML = '<div class="empty-state">Search failed</div>';
      return;
    }
    filteredMods = data.mods;
    searchTotal = data.total || 0;
    // Apply remaining local filters (version) on search results
    filteredMods = applyLocalFilters(filteredMods);
    modsShown = 0;
    document.getElementById("modCount").textContent = `${filteredMods.length} of ${searchTotal} results`;
    renderBrowseMods();
  }, 400);
}

async function applyModFilters() {
  const q = document.getElementById("modSearchInput").value.trim();
  const sortBy = document.getElementById("modSort").value;
  const typeFilter = document.getElementById("modType").value;

  // If searching or any non-default filter is set, call GitHub API
  if (q || isSearching) {
    filterBrowseMods();
    return;
  }

  // Check if sort or type filter needs server-side query
  const needsApi = sortBy === "updated" || typeFilter !== "all";
  if (needsApi) {
    isSearching = true;
    lastSearchQuery = "";
    searchPage = 1;
    const el = document.getElementById("browseModsList");
    el.innerHTML = '<div class="empty-state"><span class="loading"></span> Filtering...</div>';

    let searchUrl = `/api/mods/search?q=&page=1&sort=${sortBy}`;
    if (typeFilter === "java") searchUrl += "&language=java";
    else if (typeFilter === "nonjava") searchUrl += "&language=javascript";
    const data = await api(searchUrl);
    if (!data || !data.mods) {
      el.innerHTML = '<div class="empty-state">Filter failed</div>';
      return;
    }
    filteredMods = data.mods;
    searchTotal = data.total || 0;
    filteredMods = applyLocalFilters(filteredMods);
    modsShown = 0;
    document.getElementById("modCount").textContent = `${filteredMods.length} of ${searchTotal} results`;
    renderBrowseMods();
    return;
  }

  // Default: local filter on cached mods
  isSearching = false;
  filteredMods = applyLocalFilters(allBrowseMods);
  modsShown = 0;
  document.getElementById("modCount").textContent = `${filteredMods.length} mods`;
  renderBrowseMods();
}

function applyLocalFilters(mods) {
  const sortBy = document.getElementById("modSort").value;
  const typeFilter = document.getElementById("modType").value;
  const versionFilter = document.getElementById("modVersion").value;

  let result = [...mods];

  // Type filter
  if (typeFilter === "java") {
    result = result.filter((m) => m.hasJava);
  } else if (typeFilter === "nonjava") {
    result = result.filter((m) => !m.hasJava);
  }

  // Version filter
  if (versionFilter !== "all") {
    const minVer = parseInt(versionFilter);
    result = result.filter((m) => {
      const v = parseInt(m.minGameVersion);
      return !v || v >= minVer;
    });
  }

  // Sort
  if (sortBy === "stars") {
    result.sort((a, b) => (b.stars || 0) - (a.stars || 0));
  } else if (sortBy === "updated") {
    result.sort((a, b) => {
      const da = a.lastUpdated || a.updated || "";
      const db = b.lastUpdated || b.updated || "";
      return db.localeCompare(da);
    });
  } else if (sortBy === "name") {
    result.sort((a, b) => {
      const na = (a.name || a.repo || "").toLowerCase();
      const nb = (b.name || b.repo || "").toLowerCase();
      return na.localeCompare(nb);
    });
  }

  return result;
}

function renderBrowseMods() {
  const el = document.getElementById("browseModsList");
  const toShow = filteredMods.slice(0, modsShown + MODS_PER_PAGE);
  modsShown = toShow.length;

  if (toShow.length === 0) {
    el.innerHTML = '<div class="empty-state">No mods found</div>';
    document.getElementById("modLoadMore").style.display = "none";
    return;
  }

  let html = "";
  for (const m of toShow) {
    const isInstalled = isModInstalled(m);
    const repo = esc(m.repo);
    html += `<div class="mod-card" onclick="openModDetail('${repo}')" style="cursor:pointer;">
      <div class="mod-card-header">
        <div class="mod-card-name">${esc(m.name || m.repo)}</div>
        ${myPerms.modManage ? (isInstalled
          ? `<span class="mod-tag mod-tag-installed">Installed</span>`
          : `<button class="btn btn-primary btn-sm" onclick="event.stopPropagation();installMod('${repo}', this)">Install</button>`
        ) : ""}
      </div>
      <div class="mod-card-author">by ${esc(m.author || "Unknown")} - ${esc(m.repo)}</div>
      <div class="mod-card-desc">${esc(m.description || "No description")}</div>
      <div class="mod-card-meta">
        <span class="mod-tag mod-tag-stars">${m.stars || 0} stars</span>
        ${m.minGameVersion ? `<span class="mod-tag mod-tag-version">v${esc(m.minGameVersion)}+</span>` : ""}
        ${m.hasJava ? '<span class="mod-tag mod-tag-java">Java</span>' : ""}
      </div>
    </div>`;
  }
  el.innerHTML = html;

  const loadMore = document.getElementById("modLoadMore");
  const hasMore = isSearching
    ? filteredMods.length < searchTotal
    : modsShown < filteredMods.length;
  loadMore.style.display = hasMore ? "block" : "none";
}

async function showMoreMods() {
  if (isSearching) {
    // Load next page from GitHub search
    searchPage++;
    const sortBy = document.getElementById("modSort").value;
    const typeFilter = document.getElementById("modType").value;
    let moreUrl = `/api/mods/search?q=${encodeURIComponent(lastSearchQuery)}&page=${searchPage}&sort=${sortBy}`;
    if (typeFilter === "java") moreUrl += "&language=java";
    else if (typeFilter === "nonjava") moreUrl += "&language=javascript";
    const data = await api(moreUrl);
    if (data && data.mods) {
      filteredMods = filteredMods.concat(data.mods);
      modsShown = 0; // reset to re-render all
    }
  }
  renderBrowseMods();
}

function isModInstalled(m) {
  const repoName = (m.repo || "").split("/")[1] || "";
  const internalName = m.internalName || "";
  for (const f of installedModFiles) {
    const base = f.replace(/\.(jar|zip)$/i, "").toLowerCase();
    if (
      base === repoName.toLowerCase() ||
      base === internalName.toLowerCase() ||
      f.toLowerCase().includes(repoName.toLowerCase())
    ) {
      return true;
    }
  }
  return false;
}

async function installMod(repo, btn) {
  if (!confirm(`Install mod from ${repo}?\nServer restart required after install.`)) return;
  btn.disabled = true;
  btn.textContent = "Installing...";

  const data = await api("/api/mods/install", {
    method: "POST",
    body: JSON.stringify({ repo }),
  });

  if (data && data.success) {
    toast(data.message || "Mod installed!");
    loadInstalledMods();
  } else {
    toast("Install failed: " + (data ? data.error : "Unknown error"), "error");
    btn.disabled = false;
    btn.textContent = "Install";
  }
}

async function uninstallMod(filename) {
  if (!confirm(`Remove "${filename}"?\nServer restart required after removal.`)) return;
  const data = await api(`/api/mods/${encodeURIComponent(filename)}`, {
    method: "DELETE",
  });
  if (data && data.success) {
    toast(data.message || "Mod removed!");
    loadInstalledMods();
  } else {
    toast("Remove failed: " + (data ? data.error : "Unknown error"), "error");
  }
}

// ── Mod Detail Modal ──
async function openModDetail(repo) {
  const modal = document.getElementById("modModal");
  const title = document.getElementById("modModalTitle");
  const meta = document.getElementById("modModalMeta");
  const actions = document.getElementById("modModalActions");
  const body = document.getElementById("modModalBody");

  const name = repo.split("/")[1] || repo;
  title.textContent = name;
  meta.innerHTML = "";
  actions.innerHTML = "";
  body.innerHTML = '<div class="empty-state"><span class="loading"></span> Loading...</div>';
  modal.style.display = "flex";
  document.body.style.overflow = "hidden";

  const [owner, repoName] = repo.split("/");
  const data = await api(`/api/mods/readme/${encodeURIComponent(owner)}/${encodeURIComponent(repoName)}`);

  if (!data) {
    body.innerHTML = '<div class="empty-state">Failed to load mod details</div>';
    return;
  }

  // Title
  title.textContent = name.replace(/-/g, " ").replace(/mod$/i, " Mod");

  // Meta tags
  let metaHtml = "";
  if (data.stars != null) metaHtml += `<span class="mod-tag mod-tag-stars">${data.stars} stars</span>`;
  if (data.forks) metaHtml += `<span class="mod-tag mod-tag-version">${data.forks} forks</span>`;
  if (data.license) metaHtml += `<span class="mod-tag" style="background:rgba(255,255,255,0.04);color:var(--text2);">${esc(data.license)}</span>`;
  if (data.release) metaHtml += `<span class="mod-tag mod-tag-installed">${esc(data.release.tag)}</span>`;
  if (data.updated) {
    const d = new Date(data.updated);
    metaHtml += `<span style="font-size:0.72rem;color:var(--text3);">Updated ${d.toLocaleDateString()}</span>`;
  }
  meta.innerHTML = metaHtml;

  // Action buttons
  let actHtml = "";
  if (myPerms.modManage) {
    const installed = isModInstalled({ repo, internalName: repoName });
    if (installed) {
      actHtml += `<span class="mod-tag mod-tag-installed" style="padding:6px 14px;">Installed</span>`;
    } else {
      actHtml += `<button class="btn btn-primary btn-sm" onclick="installMod('${esc(repo)}', this)">Install Mod</button>`;
    }
  }
  if (data.repoUrl) {
    actHtml += `<a href="${esc(data.repoUrl)}" target="_blank" rel="noopener" class="btn btn-secondary btn-sm">View on GitHub</a>`;
  }
  if (data.release && data.release.assets && data.release.assets.length > 0) {
    const a = data.release.assets[0];
    const sizeKB = (a.size / 1024).toFixed(0);
    actHtml += `<span style="font-size:0.72rem;color:var(--text3);">${esc(a.name)} (${sizeKB} KB, ${a.downloads} downloads)</span>`;
  }
  actions.innerHTML = actHtml;

  // Render README
  if (data.readme) {
    const repoBase = `https://raw.githubusercontent.com/${repo}/${data.defaultBranch || "main"}/`;
    const rendered = renderMarkdown(data.readme, repoBase);
    body.innerHTML = `<div class="mod-readme">${rendered}</div>`;
  } else {
    body.innerHTML = '<div class="empty-state">No README available</div>';
  }
}

function closeModModal() {
  document.getElementById("modModal").style.display = "none";
  document.body.style.overflow = "";
}

// Simple markdown to HTML renderer
function renderMarkdown(md, baseUrl) {
  let html = md;

  // Escape HTML but preserve markdown syntax
  html = html.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  // Code blocks (``` ... ```)
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
    return `<pre><code>${code.trim()}</code></pre>`;
  });

  // Inline code
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");

  // Images ![alt](url)
  html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt, url) => {
    const fullUrl = url.startsWith("http") ? url : baseUrl + url;
    return `<img src="${fullUrl}" alt="${alt}" loading="lazy">`;
  });

  // Links [text](url)
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, text, url) => {
    const fullUrl = url.startsWith("http") ? url : baseUrl + url;
    return `<a href="${fullUrl}" target="_blank" rel="noopener">${text}</a>`;
  });

  // Headers
  html = html.replace(/^### (.+)$/gm, "<h3>$1</h3>");
  html = html.replace(/^## (.+)$/gm, "<h2>$1</h2>");
  html = html.replace(/^# (.+)$/gm, "<h1>$1</h1>");

  // Bold
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  // Italic
  html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");

  // Horizontal rule
  html = html.replace(/^---$/gm, "<hr>");

  // Blockquotes
  html = html.replace(/^&gt; (.+)$/gm, "<blockquote>$1</blockquote>");

  // Unordered lists
  html = html.replace(/^[*-] (.+)$/gm, "<li>$1</li>");
  html = html.replace(/(<li>.*<\/li>\n?)+/g, (match) => `<ul>${match}</ul>`);

  // Paragraphs: wrap loose lines
  html = html.replace(/^(?!<[hupblo]|<li|<hr|<pre|<img|<a |<block|<ul|<code)(.+)$/gm, "<p>$1</p>");

  // Clean up empty paragraphs
  html = html.replace(/<p>\s*<\/p>/g, "");

  return html;
}

function esc(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

// Close modal on Escape
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeModModal();
});

// Register service worker for PWA install
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}

// Init
loadMe().then(() => {
  loadDashboard();
  loadMapSelects();
});
setInterval(loadDashboard, 10000);

const express = require("express");
const crypto = require("crypto");
const Docker = require("dockerode");
const { execFile } = require("child_process");
const fs = require("fs");
const path = require("path");

const app = express();
const docker = new Docker({ socketPath: "/var/run/docker.sock" });
const CONTAINER_NAME = process.env.CONTAINER_NAME || "mindustry-server";
const LOG_PATH = process.env.LOG_PATH || "/logs/log-0.txt";
const PORT = process.env.PORT || 3000;

// Parse users from env: "user1:pass1:role1,user2:pass2:role2"
const USERS = {};
(process.env.USERS || "admin:changeme:admin").split(",").forEach((entry) => {
  const [username, password, role] = entry.trim().split(":");
  if (username && password && role) {
    USERS[username] = { password, role };
  }
});

// Role permissions
const ROLE_PERMS = {
  admin: {
    configEdit: true,
    playerKick: true,
    playerBan: true,
    playerAdmin: true,
    mapHost: true,
    modManage: true,
    console: true,
    containerControl: true,
    quickActions: true,
    broadcast: true,
  },
  mod: {
    configEdit: false,
    playerKick: true,
    playerBan: true,
    playerAdmin: false,
    mapHost: true,
    modManage: false,
    console: true,
    containerControl: false,
    quickActions: "limited", // save, pause only
    broadcast: true,
  },
  viewer: {
    configEdit: false,
    playerKick: false,
    playerBan: false,
    playerAdmin: false,
    mapHost: false,
    modManage: false,
    console: false,
    containerControl: false,
    quickActions: false,
    broadcast: false,
  },
};

const sessions = new Map();

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

function parseCookies(req) {
  const obj = {};
  const header = req.headers.cookie || "";
  header.split(";").forEach((c) => {
    const [k, ...v] = c.split("=");
    if (k) obj[k.trim()] = v.join("=").trim();
  });
  return obj;
}

function getSession(req) {
  const cookies = parseCookies(req);
  const sid = cookies.sid;
  if (sid && sessions.has(sid)) {
    const s = sessions.get(sid);
    if (Date.now() - s.created < 24 * 60 * 60 * 1000) return s;
    sessions.delete(sid);
  }
  return null;
}

function getPerms(req) {
  const session = getSession(req);
  if (!session) return null;
  return ROLE_PERMS[session.role] || ROLE_PERMS.viewer;
}

// Login page
app.get("/login", (req, res) => {
  const error = req.query.error ? "Invalid username or password" : "";
  res.send(loginHTML(error));
});

app.post("/login", (req, res) => {
  const { username, password } = req.body;
  const user = USERS[username];
  if (user && user.password === password) {
    const sid = crypto.randomBytes(24).toString("hex");
    sessions.set(sid, {
      user: username,
      role: user.role,
      created: Date.now(),
    });
    res.setHeader(
      "Set-Cookie",
      `sid=${sid}; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400`
    );
    return res.redirect("/");
  }
  res.redirect("/login?error=1");
});

app.post("/logout", (req, res) => {
  const cookies = parseCookies(req);
  if (cookies.sid) sessions.delete(cookies.sid);
  res.setHeader("Set-Cookie", "sid=; Path=/; HttpOnly; Max-Age=0");
  res.redirect("/login");
});

// Auth middleware
const PUBLIC_PATHS = ["/login", "/manifest.json", "/favicon.svg", "/icon-192.png", "/icon-512.png", "/sw.js"];
app.use((req, res, next) => {
  if (PUBLIC_PATHS.includes(req.path)) return next();
  const session = getSession(req);
  if (!session) {
    if (req.path.startsWith("/api/")) return res.status(401).json({ error: "Unauthorized" });
    return res.redirect("/login");
  }
  req.userRole = session.role;
  req.userName = session.user;
  next();
});

app.use(express.static(path.join(__dirname, "public")));

// API: Get current user role + permissions
app.get("/api/me", (req, res) => {
  res.json({
    user: req.userName,
    role: req.userRole,
    perms: ROLE_PERMS[req.userRole] || ROLE_PERMS.viewer,
  });
});

// Mutex for sequential command execution
let commandLock = Promise.resolve();

function dockerExec(command) {
  return new Promise((resolve, reject) => {
    execFile(
      "docker",
      [
        "exec",
        CONTAINER_NAME,
        "su",
        "mindustry",
        "-c",
        `screen -S Mindustry -p 0 -X stuff "${command}\n"`,
      ],
      { timeout: 10000 },
      (err, stdout, stderr) => {
        if (err) reject(new Error(stderr || err.message));
        else resolve(stdout);
      }
    );
  });
}

function readLogLines() {
  try {
    if (!fs.existsSync(LOG_PATH)) return [];
    const content = fs.readFileSync(LOG_PATH, "utf-8");
    return content.split("\n").filter((l) => l.trim());
  } catch {
    return [];
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function sendCommand(command) {
  return new Promise((resolve, reject) => {
    commandLock = commandLock.then(async () => {
      try {
        const linesBefore = readLogLines().length;
        await dockerExec(command);
        await sleep(1500);
        const allLines = readLogLines();
        const newLines = allLines.slice(linesBefore);
        resolve(
          newLines.map((l) =>
            l.replace(/^\[\d{2}-\d{2}-\d{4} \d{2}:\d{2}:\d{2}\] \[\w\] /, "")
          )
        );
      } catch (err) {
        reject(err);
      }
    });
  });
}

function getContainer() {
  return docker.getContainer(CONTAINER_NAME);
}

async function isContainerRunning() {
  try {
    const info = await getContainer().inspect();
    return info.State.Running;
  } catch {
    return false;
  }
}

function requireRunning(res) {
  return isContainerRunning().then((running) => {
    if (!running) {
      res.status(503).json({ error: "Server is offline", offline: true });
      return false;
    }
    return true;
  });
}

// Helper: require permission
function requirePerm(req, res, perm) {
  const perms = getPerms(req);
  if (!perms || !perms[perm]) {
    res.status(403).json({ error: "Permission denied" });
    return false;
  }
  return true;
}

// API: Server status (everyone)
app.get("/api/status", async (req, res) => {
  try {
    const container = getContainer();
    const info = await container.inspect();
    const running = info.State.Running;
    let gameStatus = [];
    if (running) {
      try {
        gameStatus = await sendCommand("status");
      } catch {}
    }
    res.json({ running, gameStatus });
  } catch (err) {
    res.json({ running: false, gameStatus: [], error: err.message });
  }
});

// API: Get config (everyone can read)
app.get("/api/config", async (req, res) => {
  try {
    if (!(await requireRunning(res))) return;
    const lines = await sendCommand("config");
    const configs = [];
    let current = null;
    for (const line of lines) {
      const stripped = line.replace(/\x1b\[[0-9;]*m/g, "").trim();
      if (
        stripped.startsWith("| ") &&
        stripped.includes(":") &&
        !stripped.startsWith("| |")
      ) {
        const match = stripped.match(/^\|\s+(\w+):\s*(.*)/);
        if (match) {
          if (current) configs.push(current);
          current = { name: match[1], value: match[2], description: "" };
        }
      } else if (stripped.startsWith("| |") && current) {
        current.description = stripped.replace(/^\|\s*\|\s*/, "").trim();
      }
    }
    if (current) configs.push(current);
    res.json({ configs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Set config (admin only)
app.post("/api/config", async (req, res) => {
  if (!requirePerm(req, res, "configEdit")) return;
  try {
    if (!(await requireRunning(res))) return;
    const { name, value } = req.body;
    if (!name || !/^\w+$/.test(name)) {
      return res.status(400).json({ error: "Invalid config name" });
    }
    const safeValue = String(value).replace(/["`$\\]/g, "");
    const lines = await sendCommand(`config ${name} ${safeValue}`);
    res.json({ success: true, output: lines });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Players (everyone can read)
app.get("/api/players", async (req, res) => {
  try {
    if (!(await requireRunning(res))) return;
    const lines = await sendCommand("players");
    res.json({ players: lines });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Logs (everyone)
app.get("/api/logs", async (req, res) => {
  try {
    const lines = readLogLines();
    const last = lines.slice(-200);
    res.json({ logs: last });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Send console command (admin + mod, with restrictions for mod)
app.post("/api/command", async (req, res) => {
  const perms = getPerms(req);
  if (!perms) return res.status(401).json({ error: "Unauthorized" });

  try {
    if (!(await requireRunning(res))) return;
    const { command } = req.body;
    if (!command || typeof command !== "string") {
      return res.status(400).json({ error: "Missing command" });
    }
    if (/[;|&`$()]/.test(command)) {
      return res.status(400).json({ error: "Invalid characters in command" });
    }

    const cmd = command.trim().toLowerCase();

    // Viewer: no console access at all
    if (!perms.console) {
      return res.status(403).json({ error: "Permission denied" });
    }

    // Mod restrictions
    if (req.userRole === "mod") {
      // Block dangerous commands for mods
      const blocked = ["exit", "stop", "config ", "js ", "fillitems", "gameover", "rules "];
      if (blocked.some((b) => cmd.startsWith(b))) {
        return res.status(403).json({ error: "Permission denied for this command" });
      }
      // Block admin add/remove for mods
      if (cmd.startsWith("admin")) {
        return res.status(403).json({ error: "Permission denied: admin management" });
      }
    }

    const lines = await sendCommand(command);
    res.json({ output: lines });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Container lifecycle (admin only)
app.post("/api/container/:action", async (req, res) => {
  if (!requirePerm(req, res, "containerControl")) return;
  try {
    const container = getContainer();
    const { action } = req.params;
    if (action === "start") await container.start();
    else if (action === "stop") await container.stop({ t: 10 });
    else if (action === "restart") await container.restart({ t: 10 });
    else return res.status(400).json({ error: "Invalid action" });
    res.json({ success: true, action });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Maps list (raw) (everyone)
app.get("/api/maps", async (req, res) => {
  try {
    if (!(await requireRunning(res))) return;
    const filter = req.query.filter || "all";
    const lines = await sendCommand(`maps ${filter}`);
    res.json({ maps: lines });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Parsed map names for dropdowns (everyone)
app.get("/api/maps/list", async (req, res) => {
  try {
    if (!(await requireRunning(res))) return;
    const lines = await sendCommand("maps all");
    const maps = [];
    for (const line of lines) {
      const stripped = line.replace(/\x1b\[[0-9;]*m/g, "").trim();
      const m = stripped.match(/^\s*(\S+):\s*(Default|Custom)\s*\/\s*(\S+)/);
      if (m) {
        maps.push({
          name: m[1].replace(/_/g, " "),
          rawName: m[1],
          type: m[2],
          size: m[3],
        });
      }
    }
    res.json({ maps });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Host map (admin + mod)
app.post("/api/host", async (req, res) => {
  if (!requirePerm(req, res, "mapHost")) return;
  try {
    if (!(await requireRunning(res))) return;
    const { map, mode } = req.body;
    const safeMap = String(map).replace(/["`$\\;|&]/g, "");
    const safeMode = String(mode || "survival").replace(/["`$\\;|&]/g, "");
    const lines = await sendCommand(`host ${safeMap} ${safeMode}`);
    res.json({ output: lines });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Mod Management ──
const MODS_PATH = process.env.MODS_PATH || "/mods";
const MODS_REPO_URL =
  "https://raw.githubusercontent.com/Anuken/MindustryMods/master/mods.json";

let modsCache = { data: null, ts: 0 };

async function fetchModRepo() {
  // Cache for 10 minutes
  if (modsCache.data && Date.now() - modsCache.ts < 10 * 60 * 1000) {
    return modsCache.data;
  }
  const https = require("https");
  return new Promise((resolve, reject) => {
    https
      .get(MODS_REPO_URL, (res) => {
        let body = "";
        res.on("data", (d) => (body += d));
        res.on("end", () => {
          try {
            const data = JSON.parse(body);
            modsCache = { data, ts: Date.now() };
            resolve(data);
          } catch (e) {
            reject(e);
          }
        });
      })
      .on("error", reject);
  });
}

// API: List installed mods (everyone)
app.get("/api/mods/installed", (req, res) => {
  try {
    const files = fs.readdirSync(MODS_PATH).filter((f) => {
      const ext = f.toLowerCase();
      return ext.endsWith(".jar") || ext.endsWith(".zip");
    });
    const mods = files.map((f) => {
      const stat = fs.statSync(path.join(MODS_PATH, f));
      return {
        file: f,
        name: f.replace(/\.(jar|zip)$/i, ""),
        size: (stat.size / 1024).toFixed(1) + " KB",
        modified: stat.mtime.toISOString(),
      };
    });
    res.json({ mods });
  } catch (err) {
    res.json({ mods: [] });
  }
});

// API: Browse mod repository (everyone)
app.get("/api/mods/browse", async (req, res) => {
  try {
    const mods = await fetchModRepo();
    res.json({ mods });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch mod repository" });
  }
});

// API: Search mods via GitHub (everyone)
app.get("/api/mods/search", async (req, res) => {
  try {
    const q = (req.query.q || "").trim();
    const page = parseInt(req.query.page) || 1;
    if (!q) return res.json({ mods: [], total: 0 });

    const https = require("https");
    const searchQuery = encodeURIComponent(`${q} topic:mindustry-mod`);
    const url = `https://api.github.com/search/repositories?q=${searchQuery}&sort=stars&per_page=20&page=${page}`;

    const data = await new Promise((resolve, reject) => {
      https
        .get(url, { headers: { "User-Agent": "MindustryAdmin" } }, (resp) => {
          let body = "";
          resp.on("data", (d) => (body += d));
          resp.on("end", () => {
            try {
              resolve(JSON.parse(body));
            } catch (e) {
              reject(e);
            }
          });
        })
        .on("error", reject);
    });

    const mods = (data.items || []).map((item) => ({
      repo: item.full_name,
      name: item.name,
      author: item.owner ? item.owner.login : "Unknown",
      description: item.description || "",
      stars: item.stargazers_count || 0,
      lastUpdated: item.updated_at,
      hasJava:
        (item.language || "").toLowerCase() === "java" ||
        (item.language || "").toLowerCase() === "kotlin",
      url: item.html_url,
    }));

    res.json({ mods, total: data.total_count || 0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Get mod detail from GitHub (everyone)
app.get("/api/mods/detail/:owner/:repo", async (req, res) => {
  try {
    const { owner, repo: repoName } = req.params;
    const https = require("https");
    const url = `https://api.github.com/repos/${owner}/${repoName}`;
    const data = await new Promise((resolve, reject) => {
      https
        .get(url, { headers: { "User-Agent": "MindustryAdmin" } }, (resp) => {
          let body = "";
          resp.on("data", (d) => (body += d));
          resp.on("end", () => {
            try {
              resolve(JSON.parse(body));
            } catch (e) {
              reject(e);
            }
          });
        })
        .on("error", reject);
    });
    res.json({
      name: data.name,
      description: data.description,
      stars: data.stargazers_count,
      topics: data.topics,
      license: data.license ? data.license.spdx_id : null,
      updated: data.updated_at,
      url: data.html_url,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Get mod README from GitHub (everyone)
app.get("/api/mods/readme/:owner/:repo", async (req, res) => {
  try {
    const { owner, repo: repoName } = req.params;
    const https = require("https");

    // Get README metadata
    const url = `https://api.github.com/repos/${owner}/${repoName}/readme`;
    const meta = await new Promise((resolve, reject) => {
      https
        .get(url, { headers: { "User-Agent": "MindustryAdmin" } }, (resp) => {
          let body = "";
          resp.on("data", (d) => (body += d));
          resp.on("end", () => {
            try {
              resolve(JSON.parse(body));
            } catch (e) {
              reject(e);
            }
          });
        })
        .on("error", reject);
    });

    if (!meta.download_url) {
      return res.json({ readme: "", html: "" });
    }

    // Fetch raw README content
    const raw = await new Promise((resolve, reject) => {
      const get = meta.download_url.startsWith("https") ? https : require("http");
      get
        .get(
          meta.download_url,
          { headers: { "User-Agent": "MindustryAdmin" } },
          (resp) => {
            let body = "";
            resp.on("data", (d) => (body += d));
            resp.on("end", () => resolve(body));
          }
        )
        .on("error", reject);
    });

    // Get repo info for additional metadata
    const repoUrl = `https://api.github.com/repos/${owner}/${repoName}`;
    const repoData = await new Promise((resolve, reject) => {
      https
        .get(
          repoUrl,
          { headers: { "User-Agent": "MindustryAdmin" } },
          (resp) => {
            let body = "";
            resp.on("data", (d) => (body += d));
            resp.on("end", () => {
              try {
                resolve(JSON.parse(body));
              } catch (e) {
                reject(e);
              }
            });
          }
        )
        .on("error", reject);
    });

    // Get latest release info
    let release = null;
    try {
      const relUrl = `https://api.github.com/repos/${owner}/${repoName}/releases/latest`;
      release = await new Promise((resolve, reject) => {
        https
          .get(
            relUrl,
            { headers: { "User-Agent": "MindustryAdmin" } },
            (resp) => {
              let body = "";
              resp.on("data", (d) => (body += d));
              resp.on("end", () => {
                try {
                  const d = JSON.parse(body);
                  if (d.tag_name) resolve(d);
                  else resolve(null);
                } catch {
                  resolve(null);
                }
              });
            }
          )
          .on("error", () => resolve(null));
      });
    } catch {}

    res.json({
      readme: raw,
      repoUrl: `https://github.com/${owner}/${repoName}`,
      defaultBranch: repoData.default_branch || "main",
      stars: repoData.stargazers_count || 0,
      forks: repoData.forks_count || 0,
      license: repoData.license ? repoData.license.spdx_id : null,
      topics: repoData.topics || [],
      updated: repoData.updated_at,
      openIssues: repoData.open_issues_count || 0,
      release: release
        ? {
            tag: release.tag_name,
            date: release.published_at,
            assets: (release.assets || []).map((a) => ({
              name: a.name,
              size: a.size,
              downloads: a.download_count,
            })),
          }
        : null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Install mod from GitHub (admin only)
app.post("/api/mods/install", async (req, res) => {
  if (!requirePerm(req, res, "modManage")) return;
  try {
    const { repo } = req.body;
    if (!repo || !/^[\w.-]+\/[\w.-]+$/.test(repo)) {
      return res.status(400).json({ error: "Invalid repo format" });
    }

    const https = require("https");

    // Get latest release
    const releaseUrl = `https://api.github.com/repos/${repo}/releases/latest`;
    const release = await new Promise((resolve, reject) => {
      https
        .get(
          releaseUrl,
          { headers: { "User-Agent": "MindustryAdmin" } },
          (resp) => {
            if (resp.statusCode === 302 || resp.statusCode === 301) {
              // Follow redirect
              https
                .get(
                  resp.headers.location,
                  { headers: { "User-Agent": "MindustryAdmin" } },
                  (r2) => {
                    let body = "";
                    r2.on("data", (d) => (body += d));
                    r2.on("end", () => {
                      try {
                        resolve(JSON.parse(body));
                      } catch (e) {
                        reject(e);
                      }
                    });
                  }
                )
                .on("error", reject);
              return;
            }
            let body = "";
            resp.on("data", (d) => (body += d));
            resp.on("end", () => {
              try {
                resolve(JSON.parse(body));
              } catch (e) {
                reject(e);
              }
            });
          }
        )
        .on("error", reject);
    });

    if (!release || !release.assets || release.assets.length === 0) {
      // No release assets, try downloading repo as zip
      const repoName = repo.split("/")[1];
      const zipUrl = `https://github.com/${repo}/archive/refs/heads/master.zip`;
      const destFile = path.join(MODS_PATH, `${repoName}.zip`);

      await downloadFile(zipUrl, destFile);
      return res.json({
        success: true,
        file: `${repoName}.zip`,
        type: "repo-zip",
        message: "Installed from repository archive (no release found). Restart server to load.",
      });
    }

    // Find .jar or .zip asset
    let asset =
      release.assets.find((a) => a.name.endsWith(".jar")) ||
      release.assets.find((a) => a.name.endsWith(".zip")) ||
      release.assets[0];

    const destFile = path.join(MODS_PATH, asset.name);
    await downloadFile(asset.browser_download_url, destFile);

    res.json({
      success: true,
      file: asset.name,
      version: release.tag_name,
      message: "Installed! Restart server to load the mod.",
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function downloadFile(url, dest) {
  const https = require("https");
  const http = require("http");
  return new Promise((resolve, reject) => {
    const get = url.startsWith("https") ? https.get : http.get;
    get(url, { headers: { "User-Agent": "MindustryAdmin" } }, (resp) => {
      if (resp.statusCode === 302 || resp.statusCode === 301) {
        return downloadFile(resp.headers.location, dest).then(resolve).catch(reject);
      }
      if (resp.statusCode !== 200) {
        return reject(new Error(`Download failed: HTTP ${resp.statusCode}`));
      }
      const file = fs.createWriteStream(dest);
      resp.pipe(file);
      file.on("finish", () => {
        file.close();
        resolve();
      });
      file.on("error", (err) => {
        fs.unlink(dest, () => {});
        reject(err);
      });
    }).on("error", reject);
  });
}

// API: Uninstall mod (admin only)
app.delete("/api/mods/:filename", (req, res) => {
  if (!requirePerm(req, res, "modManage")) return;
  try {
    const filename = req.params.filename;
    // Sanitize: only allow jar/zip files, no path traversal
    if (!/^[\w.-]+\.(jar|zip)$/i.test(filename)) {
      return res.status(400).json({ error: "Invalid filename" });
    }
    const filePath = path.join(MODS_PATH, filename);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: "Mod not found" });
    }
    fs.unlinkSync(filePath);
    res.json({
      success: true,
      message: "Mod removed. Restart server to apply changes.",
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function loginHTML(error) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Login - Mindustry Server</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', system-ui, sans-serif;
      background: #0f1117;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .login-container {
      width: 100%;
      max-width: 380px;
      padding: 20px;
    }
    .login-card {
      background: #1a1d28;
      border: 1px solid rgba(255,255,255,0.06);
      border-radius: 16px;
      padding: 44px 36px;
      box-shadow: 0 4px 24px rgba(0,0,0,0.4);
    }
    .login-header {
      text-align: center;
      margin-bottom: 36px;
    }
    .login-icon {
      width: 56px;
      height: 56px;
      background: linear-gradient(135deg, #6c63ff, #8b83ff);
      border-radius: 14px;
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0 auto 18px;
      font-size: 24px;
      box-shadow: 0 4px 16px rgba(108, 99, 255, 0.3);
    }
    .login-header h1 {
      color: #e8e9ed;
      font-size: 1.3rem;
      font-weight: 700;
      letter-spacing: -0.02em;
    }
    .login-header h1 span { color: #8b83ff; }
    .login-header p {
      color: #5c6070;
      font-size: 0.85rem;
      margin-top: 8px;
    }
    .form-group {
      margin-bottom: 20px;
    }
    .form-group label {
      display: block;
      color: #5c6070;
      font-size: 0.7rem;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      margin-bottom: 8px;
      font-weight: 500;
    }
    .form-group input {
      width: 100%;
      padding: 12px 16px;
      background: #0f1117;
      border: 1px solid rgba(255,255,255,0.06);
      border-radius: 10px;
      color: #e8e9ed;
      font-size: 0.9rem;
      transition: all 0.2s cubic-bezier(0.4,0,0.2,1);
      outline: none;
    }
    .form-group input:focus {
      border-color: #6c63ff;
      box-shadow: 0 0 0 3px rgba(108,99,255,0.15);
    }
    .form-group input::placeholder { color: #3a3d4a; }
    .error-msg {
      background: rgba(248, 113, 113, 0.1);
      border: 1px solid rgba(248, 113, 113, 0.2);
      color: #f87171;
      padding: 12px 16px;
      border-radius: 10px;
      font-size: 0.85rem;
      margin-bottom: 20px;
      text-align: center;
    }
    .login-btn {
      width: 100%;
      padding: 13px;
      background: #6c63ff;
      border: none;
      border-radius: 10px;
      color: #fff;
      font-size: 0.9rem;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s cubic-bezier(0.4,0,0.2,1);
      letter-spacing: 0.01em;
    }
    .login-btn:hover { background: #8b83ff; transform: translateY(-1px); box-shadow: 0 4px 12px rgba(108,99,255,0.3); }
    .login-btn:active { transform: translateY(0); }
    .footer {
      text-align: center;
      margin-top: 28px;
      color: #3a3d4a;
      font-size: 0.72rem;
      letter-spacing: 0.02em;
    }
  </style>
</head>
<body>
  <div class="login-container">
    <div class="login-card">
      <div class="login-header">
        <div class="login-icon">&#9881;</div>
        <h1><span>Mindustry</span> Server</h1>
        <p>Sign in to manage your server</p>
      </div>
      ${error ? '<div class="error-msg">' + error + "</div>" : ""}
      <form method="POST" action="/login">
        <div class="form-group">
          <label>Username</label>
          <input type="text" name="username" placeholder="Enter username" autocomplete="username" autofocus required>
        </div>
        <div class="form-group">
          <label>Password</label>
          <input type="password" name="password" placeholder="Enter password" autocomplete="current-password" required>
        </div>
        <button type="submit" class="login-btn">Sign In</button>
      </form>
      <div class="footer">Mindustry Server Panel</div>
    </div>
  </div>
</body>
</html>`;
}

app.listen(PORT, () => {
  console.log(`Mindustry Admin Panel running on port ${PORT}`);
  console.log(
    `Users: ${Object.entries(USERS)
      .map(([u, v]) => `${u} (${v.role})`)
      .join(", ")}`
  );
});

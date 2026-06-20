# OpsPilot · Incident Intelligence & RCA Platform

A production-ready incident management console inspired by enterprise EMS / RCA workflows. Built with vanilla web technologies on the frontend and Node.js + Express on the backend, with Postgres for persistent storage — **no React**.

> Editorial design, operations-room cinematography. Dark mode by default.

---

## Highlights

- **Node.js + Express backend** — all data persisted in Postgres (survives restarts/redeploys)
- **Vanilla frontend** — HTML5, CSS3, Tailwind (CDN), GSAP (CDN), plain JS
- **Full RCA workflow** — title, description, bridge details, steps, learnings, corrective actions, EMS-only fields, timeline events, tags, related work, approvals, attachments, comments
- **Operations dashboard** — KPIs, 12-week trend, severity breakdown, live activity timeline
- **Simple local login** — `EMS` / `Ems@1221` (operator) or `ADMIN` / `OnlyForAdmin@1331` (admin), persisted in `localStorage`
- **File uploads** — drag-and-drop attachments stored on disk, served from `/uploads`
- **Responsive** — desktop, tablet, mobile (collapsible sidebar)
- **Accessible** — keyboard navigation (`/` to focus search, `Cmd+S` to save, Enter to add steps)

---

## Quick start

```bash
# 1. Install
npm install

# 2. Set the database connection (see "Database setup" below)
# Replit: enable the Database pane — DATABASE_URL is set automatically.
# Anywhere else: export DATABASE_URL="postgres://user:pass@host:5432/dbname"

# 3. Run
npm start

# 4. Open
http://localhost:4000

# 5. Sign in
username: EMS
password: Ems@1221
```

The server creates its tables on first boot if they don't already exist. Incidents, team members, and settings all start empty until you create them through the app.

---

## Database setup

OpsPilot stores everything (incidents, team roster, settings, activity log) in Postgres, not on the local filesystem. This matters most on hosts like **Replit Autoscale deployments**, which reset the filesystem to the published snapshot whenever an idle instance restarts — anything saved only to a local file (the old design) was silently lost. Postgres is a separate, persistent service, so data survives restarts, redeploys, and instance churn.

### On Replit (recommended path)

1. Open the **Database** pane in your Repl (left sidebar) and create a Postgres database.
2. Replit automatically sets the `DATABASE_URL` environment variable/secret for you — no manual config needed.
3. Run the app (`npm start` or your existing Run button). On first boot it creates the required tables automatically.
4. If you have an existing Repl with real data still sitting in `server/data/*.json` (from before this migration), import it once:
   ```bash
   npm run migrate-json-to-db
   ```

### On any other host (Render, Railway, Fly.io, Supabase, Neon, your own VM, etc.)

1. Provision a Postgres database on that platform (or use a free hosted Postgres like Neon/Supabase from anywhere).
2. Set the `DATABASE_URL` environment variable on your deployment to that database's connection string, e.g.:
   ```bash
   DATABASE_URL="postgres://user:pass@host:5432/dbname"
   ```
3. Deploy/run the app as usual (`npm install && npm start`). Tables are created automatically on first boot.
4. If migrating real data from an old JSON-file deployment, copy `server/data/*.json` onto the new host once and run `npm run migrate-json-to-db` before serving traffic.

If your Postgres provider doesn't require/support SSL (e.g. a local Postgres for development), set `PGSSL=disable`.

---

## Sharing the server on your LAN (open it from another laptop)

`http://localhost:4000` only works *on the machine running the server*. To reach the same site from another device on the same Wi-Fi:

### 1. Get the LAN URL

When you run `npm start`, the banner prints it explicitly. Example:

```
Local:    http://localhost:4000
Network:  http://192.168.1.35:4000   (Wi-Fi)
```

The `Network:` line is the URL to open on your other laptop. Type **that** into the browser there (not `localhost`).

### 2. Allow Windows Firewall to let traffic through

On the **host** machine (where the server is running), open PowerShell **as Administrator** (right-click → "Run as administrator") and run:

```powershell
New-NetFirewallRule -DisplayName "OpsPilot EMS (4000)" `
  -Direction Inbound `
  -Action Allow `
  -Protocol TCP `
  -LocalPort 4000
```

That creates a one-time inbound rule. You only need to do this once per machine. To remove later: `Remove-NetFirewallRule -DisplayName "OpsPilot EMS (4000)"`.

If you can't / don't want to make a firewall rule, simpler one-shot option: when you first run `npm start`, Windows shows a "Windows Defender Firewall has blocked some features" dialog — tick **Private networks** and click **Allow access**.

### 3. Both devices must be on the same network

If the host laptop is on Wi-Fi-A and the other laptop is on Wi-Fi-B, they can't see each other. Check both are connected to the same router / SSID.

### 4. Troubleshooting checklist

| Symptom | Fix |
|---|---|
| `localhost:4000` works on host but not on other device | Use the LAN IP, not `localhost`. |
| LAN URL doesn't load anywhere | Check the host's banner — if it says "no LAN interface detected", the host has no network connection. |
| LAN URL loads on host but not other device | Windows Firewall is blocking — run the rule above. |
| Works on phone but not other laptop | Both devices need to be on the same network. Corporate / guest networks often isolate clients. |
| Different port | Pass `PORT=8080` to `npm start`: `$env:PORT = "8080"; npm start` |

---

## Project structure

```
.
├── package.json
├── server/
│   ├── server.js              # Express bootstrap
│   ├── routes/
│   │   ├── auth.js            # POST /api/auth/login
│   │   ├── incidents.js       # CRUD + comments + uploads
│   │   └── stats.js           # /api/stats (KPIs, trend, activity)
│   ├── middleware/
│   │   ├── validation.js      # payload validation
│   │   └── errorHandler.js    # 404 + error envelope
│   ├── utils/
│   │   ├── logger.js          # colourised stamped logger
│   │   ├── db.js              # Postgres pool + schema bootstrap
│   │   ├── storage.js         # Postgres-backed read/write helpers
│   │   └── seed.js            # initial (empty) dataset
│   ├── scripts/
│   │   └── migrate-json-to-db.js  # one-time import of legacy JSON files
│   └── data/
│       └── uploads/           # attachments (still on local disk)
└── public/
    ├── index.html             # login
    ├── dashboard.html         # KPIs + queue
    ├── incident.html          # detail / edit
    ├── new.html               # create incident
    ├── css/styles.css         # full design system
    ├── js/
    │   ├── api.js             # fetch wrapper
    │   ├── ui.js              # session, sidebar, toasts, formatters
    │   ├── dashboard.js
    │   ├── incident.js
    │   └── new.js
    └── assets/favicon.svg
```

---

## REST API

All endpoints respond with JSON. Errors use `{ error, message }` with HTTP status codes.

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/auth/login` | Validate `EMS / Pro1221`. Returns user profile. |
| `GET`  | `/api/incidents` | List incidents. Query: `q`, `state`, `severity`, `sort`, `dir`, `limit`. |
| `GET`  | `/api/incidents/:id` | Single incident. |
| `POST` | `/api/incidents` | Create. Required: `title`, `severity`. |
| `PUT`  | `/api/incidents/:id` | Partial update. |
| `DELETE` | `/api/incidents/:id` | Delete. |
| `POST` | `/api/incidents/:id/comments` | Post comment. |
| `POST` | `/api/incidents/:id/attachments` | Upload up to 8 files (multipart, 25 MB each). |
| `DELETE` | `/api/incidents/:id/attachments/:attachId` | Remove attachment. |
| `GET`  | `/api/stats` | Dashboard rollups + activity feed. |

### Example

```bash
curl -X POST http://localhost:4000/api/incidents \
  -H 'Content-Type: application/json' \
  -d '{"title":"PaymentGateway | EMS | Surge in 5xx","severity":"P1","state":"Live"}'
```

---

## Data storage

| Table / location | Purpose |
|---|---|
| `incidents` (Postgres) | Full incident records, one JSONB document per row. |
| `activity` (Postgres) | Append-only event log, capped at the 500 most recent entries. |
| `team_members` (Postgres) | Team roster. |
| `kv_store` (Postgres) | App settings (single `settings` row). |
| `server/data/uploads/` | Stored attachment files (local disk — see note below). |

Backup = `pg_dump` the database. Attachments still live on local disk, so on ephemeral hosts (Replit Autoscale, etc.) uploaded files can be lost on instance restart the same way the old JSON data was — if that matters for your deployment, move `UPLOADS_DIR` to object storage (S3, Replit Object Storage, etc.) as a follow-up.

---

## Configuration

Environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `4000` | HTTP port. |
| `DATABASE_URL` | *(required)* | Postgres connection string. See "Database setup" above. |
| `PGSSL` | enabled | Set to `disable` to turn off SSL (e.g. local Postgres without TLS). |

```bash
PORT=8080 npm start
```

---

## Production deployment

### Plain VM / bare metal

```bash
git clone <this-repo> /opt/opspilot
cd /opt/opspilot
npm ci --omit=dev
PORT=80 node server/server.js
```

Run it behind a process manager (`pm2`, `systemd`, `docker`). The server itself is stateless — all persistent data lives in Postgres (`DATABASE_URL`), plus uploaded attachments under `server/data/uploads/`.

### systemd unit (example)

```ini
[Unit]
Description=OpsPilot EMS
After=network.target

[Service]
WorkingDirectory=/opt/opspilot
ExecStart=/usr/bin/node server/server.js
Environment=PORT=4000
Restart=on-failure
User=opspilot

[Install]
WantedBy=multi-user.target
```

### Reverse proxy (nginx snippet)

```nginx
server {
  listen 443 ssl http2;
  server_name opspilot.example.com;
  client_max_body_size 30M;

  location / {
    proxy_pass http://127.0.0.1:4000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  }
}
```

### Docker (drop-in)

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
ENV PORT=4000
EXPOSE 4000
VOLUME ["/app/server/data"]
CMD ["node", "server/server.js"]
```

```bash
docker build -t opspilot .
docker run -p 4000:4000 -v opspilot-data:/app/server/data opspilot
```

---

## Design system at a glance

- **Typography** — *Instrument Serif* italic for editorial headings, *Geist* for body, *JetBrains Mono* for IDs / timestamps / metadata
- **Palette** — obsidian base `#07080d`, ember accent `#FF7A47`, severity ramp (P1 red → P4 cyan)
- **Motion** — GSAP for page-load reveals, CSS for micro-interactions, easing `cubic-bezier(.22,1,.36,1)`
- **Effects** — grain overlay, radial gradient washes, dotted grids, glassmorphic cards, animated orbs (login)

---

## Keyboard shortcuts

| Shortcut | Where | Action |
|----------|-------|--------|
| `/` | Dashboard | Focus search |
| `Cmd / Ctrl + S` | Incident detail | Save changes |
| `Enter` | Steps editor | Add next step |
| `Backspace` (empty) | Tag / service input | Remove last chip |

---

## Security notes

This is a single-tenant operator console with intentionally simple, hard-coded credentials. Before exposing publicly:

1. Put it behind a reverse proxy with TLS + IP allow-listing.
2. Change `USERNAME` / `PASSWORD` in `server/routes/auth.js` or wire it into your SSO.
3. Consider mounting `server/data/` on encrypted storage.
4. The server already sets `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, and `Permissions-Policy`.

---

## License

MIT

# PACBAS Cloud Attendance Backend

Cloud-native attendance backend for the PACBAS (Passive Attendance Check-in via Bluetooth Advertising System) deployed on **Render.com** (Free Web Service) with persistent storage on **Supabase** (Free Postgres).

---

## ⚡ Cold Start Handling (Teacher Workflow)

On Render's free tier, web services spin down (sleep) after 15 minutes of inactivity. When a request arrives at a sleeping service, Render spins up the container, which incurs a **30–50 second wake-up delay** on that first request.

> **Teacher Best Practice**:
> **Open the attendance web dashboard (`https://<your-service>.onrender.com`) approximately 1 minute before class begins.**
> Opening the dashboard automatically sends a wake-up ping (`GET /health`), ensuring the server and Postgres pool are warm and responsive the moment students start tapping check-in on their phones.

---

## Architecture & Endpoints

### Core Attendance API
- `POST /checkin` — Check-in validation and recording.
  - Body: `{ enrollmentNumber, studentId, beaconUuid, rssi, clientTimestamp, deviceId }`
  - Responses:
    - `201 Created`: Checked in (`present`)
    - `403 Forbidden`: Outside calibrated boundary (`rejected_out_of_range`)
    - `404 Not Found`: Unknown beacon or student not registered
    - `409 Conflict`: No active session, already checked in, or device already used
- `GET /checkin/history` — Query attendance history (optional `?enrollmentNumber=` or `?studentId=`)
- `GET /checkin/stats` — Metrics for live monitoring
- `GET /checkin/live` — Check-ins within the last N minutes (`?minutes=30`)
- `GET /checkin/beacons` & `POST /checkin/beacons` — Provision and inspect beacon rooms

### Session Gating API
- `POST /sessions/start` — Teacher opens attendance window for a beacon room
- `POST /sessions/end` — Teacher closes attendance window
- `GET /sessions/active` — Check if attendance is currently open (`?beaconUuid=...`)
- `GET /sessions` — List past class sessions

### Student Directory API
- `GET /students` — List all registered students
- `GET /students/:enrollmentNumber` — Student lookup
- `POST /students` — Register a student `{ enrollmentNumber, fullName, classSection }`

### Health & Monitoring
- `GET /health` — Lightweight health check endpoint with database connectivity status (used by Render health checks and dashboard warming)
- `GET /api/health` — Backward-compatible service status endpoint

---

## Local Development

1. Install dependencies:
   ```bash
   npm install
   ```

2. Copy environment template and fill in your Supabase credentials:
   ```bash
   cp .env.example .env
   ```

3. Run locally:
   ```bash
   npm start
   ```
   Server listens on `process.env.PORT` or `3000` by default.

---

## Custom Domain (Optional Future Step)

Render automatically provides a secure HTTPS hostname: `https://<service-name>.onrender.com`.
If you wish to attach a custom domain (e.g., `attendance.yourcollege.edu`):
1. In Render Dashboard, go to **Settings → Custom Domains**.
2. Click **Add Custom Domain** and enter your subdomain.
3. In your DNS provider (Cloudflare, GoDaddy, Namecheap, etc.), create a **CNAME** record:
   - **Type**: `CNAME`
   - **Host/Name**: `attendance` (or your chosen subdomain)
   - **Value/Target**: `<service-name>.onrender.com`
4. Render automatically provisions and renews a free Let's Encrypt SSL certificate.

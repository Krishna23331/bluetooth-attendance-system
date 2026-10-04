# PACBAS — End-to-End Setup & Deployment Guide

An ESP32 iBeacon → Android BLE Scanner → Node.js Cloud Backend attendance system with server-side RSSI boundary verification and session gating.

---

## Architecture Overview

```mermaid
flowchart TD
    subgraph Classroom["Classroom"]
        ESP32["ESP32 Beacon<br/>(broadcasts room UUID, offline, no Wi-Fi needed)"]
    end

    subgraph Student["Student's Phone"]
        BLE["BLE Scanner<br/>(reads RSSI & estimates distance)"]
        App["PACBAS Android App<br/>(Student Mode)"]
    end

    subgraph Teacher["Teacher's Phone / Laptop"]
        Dash["Modern Web Dashboard /<br/>PACBAS App (Teacher Mode)"]
    end

    subgraph Cloud["Public Cloud (Free Tier)"]
        Render["Render.com Web Service<br/>(https://your-service.onrender.com)"]
        Supabase[("Supabase Postgres<br/>(beacons, students, sessions, records)")]
    end

    ESP32 -- "BLE advertisement (one-way)" --> BLE
    BLE --> App
    App -- "HTTPS POST /checkin (Mobile Data or any Wi-Fi)" --> Render
    Dash -- "HTTPS POST /sessions/start, /sessions/end" --> Render
    Render <--> Supabase
```

> **Why Cloud Deployment?**
> Every device — student phones, teacher devices, and laptops — connects to the **same public HTTPS address** over mobile data or any Wi-Fi. Students and teachers **no longer need to share the same local Wi-Fi network**. The ESP32 remains 100% offline (it only broadcasts BLE advertisements).

---

## Prerequisites

| Component | Requirements | Notes |
|---|---|---|
| **ESP32 DevKit** | ESP32-WROOM-32 + Micro-USB cable | Any standard ESP32 board |
| **Arduino IDE 2.x** | Free from [arduino.cc](https://www.arduino.cc/en/software) | For flashing the beacon firmware |
| **Node.js** | Version 18+ or 20+ | `node -v` to verify |
| **Android Studio** | Hedgehog / Iguana / Ladybug or newer | For building the Android app |
| **Physical Android Phone** | Android 8.0+ (API 26+) | **BLE scanning does not work in Android emulators** |
| **Supabase Account** | Free tier at [supabase.com](https://supabase.com) | Persistent cloud Postgres database |
| **Render.com Account** | Free tier at [render.com](https://render.com) | Auto-deploying Node.js web hosting with free SSL |

---

## Phase 1: Database Setup (Supabase Free Postgres)

1. **Create Project**:
   - Log into [supabase.com](https://supabase.com).
   - Click **New Project** → Name: `pacbas-db` → Set a secure database password → Choose region → Plan: **Free**.
   - Wait ~2 minutes for provisioning.

2. **Execute Database Schema**:
   - Open **SQL Editor** in the Supabase left sidebar.
   - Click **New query**.
   - Copy and paste the contents of [`backend/supabase_schema.sql`](file:///var/home/krishnakumarpatel/Projects/Esp/backend/supabase_schema.sql).
   - Click **Run**.
   - This creates `beacons`, `students`, `sessions`, `attendance_records`, unique constraints, anti-proxy device binding indexes, and demo seed data.

3. **Copy Credentials**:
   - **Database Connection String**: **Project Settings** → **Database** → **Connection string** → Copy the **URI** (Pooled port `6543` or Direct port `5432`):
     ```
     postgresql://postgres.[PROJECT-REF]:[PASSWORD]@aws-0-[REGION].pooler.supabase.com:6543/postgres?pgbouncer=true
     ```
   - **API Credentials**: **Project Settings** → **API** → Copy **Project URL** and the secret **`service_role`** key.

---

## Phase 2: Cloud Backend Deployment (Render.com)

1. **Push Code to GitHub**:
   Ensure your code is committed and pushed to a GitHub repository:
   ```bash
   cd /var/home/krishnakumarpatel/Projects/Esp
   git init
   git add .
   git commit -m "feat: cloud backend migration"
   git branch -M main
   git remote add origin https://github.com/<YOUR-USERNAME>/<YOUR-REPO-NAME>.git
   git push -u origin main
   ```

2. **Deploy on Render**:
   - Log into [render.com](https://render.com).
   - Click **New +** → **Blueprint** → Select your repository.
   - Render automatically reads [`render.yaml`](file:///var/home/krishnakumarpatel/Projects/Esp/render.yaml) and creates the service `pacbas-backend`.
   *(Or click **New +** → **Web Service**, set Root Directory to `backend`, Build Command to `npm install`, Start Command to `node server.js`).*

3. **Configure Environment Variables**:
   In your Render Web Service dashboard, go to **Environment** and add:

   | Key | Value | Notes |
   |---|---|---|
   | `NODE_ENV` | `production` | Production mode |
   | `DATABASE_URL` | `postgresql://postgres.[REF]:[PASS]@...:6543/postgres?pgbouncer=true` | Supabase Postgres URI |
   | `SUPABASE_URL` | `https://[PROJECT-REF].supabase.co` | Supabase Project URL |
   | `SUPABASE_SERVICE_ROLE_KEY` | `eyJhbGciOi...` | Supabase `service_role` key |

4. **Verify Health**:
   Once Render shows **Live**, open your public address in your browser:
   ```
   https://<your-service-name>.onrender.com/health
   ```
   You should see:
   ```json
   {
     "status": "healthy",
     "service": "PACBAS Attendance Backend",
     "database": "connected"
   }
   ```

> ⚡ **Cold Start Tip (Free Render Tier)**:
> Render free services sleep after 15 minutes of inactivity. **The teacher should open the dashboard (`https://<your-service-name>.onrender.com`) 1 minute before class starts** to wake the container and database pool so that check-ins process instantly.

---

## Phase 3: Flash the ESP32 Beacon

1. **Install ESP32 Board Package in Arduino IDE**:
   - **File → Preferences → Additional Board Manager URLs**, add:
     ```
     https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json
     ```
   - **Tools → Board → Boards Manager** → Search `esp32` → Install **esp32 by Espressif Systems**.

2. **Open and Verify Sketch**:
   - Open [`esp32-beacon/PACBAS_Beacon/PACBAS_Beacon.ino`](file:///var/home/krishnakumarpatel/Projects/Esp/esp32-beacon/PACBAS_Beacon/PACBAS_Beacon.ino).
   - Default UUID and room parameters:
     ```cpp
     #define ROOM_UUID       "8ec76ea3-6668-48da-9866-75be8bc86f4d"
     #define ROOM_MAJOR      101
     #define ROOM_MINOR      1
     #define MEASURED_POWER  -59   // RSSI at exactly 1 meter
     ```

3. **Upload to ESP32**:
   - Plug the ESP32 into your computer via USB.
   - **Tools → Board → ESP32 Dev Module**.
   - **Tools → Port** → Select your USB serial port (`/dev/ttyUSB0` or `COMx`).
   - Click **Upload** (arrow icon).

4. **Verify in Serial Monitor**:
   - **Tools → Serial Monitor** → set baud rate to **115200**.
   - Press the **EN/RST** button on the ESP32.
   - You should see:
     ```
     === PACBAS Beacon starting ===
     Room UUID:  8ec76ea3-6668-48da-9866-75be8bc86f4d
     Major/Minor: 101 / 1
     Advertising started (fast discovery phase).
     [heartbeat] uptime=10s, advertising...
     ```
   - *Once flashed, the ESP32 can be powered by any USB wall charger or battery pack — it does not need a computer.*

---

## Phase 4: Build and Configure the Android App

1. **Open in Android Studio**:
   - Open Android Studio → **Open** → select [`android-app/`](file:///var/home/krishnakumarpatel/Projects/Esp/android-app).
   - Wait for Gradle sync to complete.

2. **Configure Base URL**:
   - In [`android-app/app/src/main/java/com/pacbas/attendance/network/ApiClient.kt`](file:///var/home/krishnakumarpatel/Projects/Esp/android-app/app/src/main/java/com/pacbas/attendance/network/ApiClient.kt#L26), set:
     ```kotlin
     private const val DEFAULT_BASE_URL = "https://<your-service-name>.onrender.com"
     ```
   *(You can also change the URL at any time directly inside the running app via the top-right **Server** button).*

3. **Install on Phone**:
   - Enable **Developer Options** and **USB Debugging** on your phone.
   - Connect phone via USB, select your device in Android Studio, and click **Run ▶**.

4. **Android Permissions**:
   - When prompted, grant **Bluetooth** (Nearby Devices) and **Location** permissions.
   - ⚠️ **CRITICAL**: **Turn ON Location (GPS) in your phone's quick settings.** Android requires GPS hardware to be toggled ON to receive BLE advertising packets.

---

## Phase 5: Check-in Flow & Testing

1. **Teacher Starts Attendance**:
   - Open the web dashboard: `https://<your-service-name>.onrender.com`
   - Select room **Room 101-1** and click **Start Session**.
   - A live session badge turns green.

2. **Student Check-In**:
   - In the Android app, enter a registered enrollment number (e.g., `IT2023001` or `STU-101`).
   - Tap **Start Scan**.
   - When near the ESP32 (< 3 meters), the card displays **IN RANGE** (green badge).
   - Tap **Check In**.
   - Result:
     - `✅ Present in Room 101-1` (HTTP 201 Created).
     - Duplicate tap: `ℹ️ Already checked in for this session` (HTTP 409 Conflict).
     - Stepping far away (> 5 meters): `⛔ Outside RSSI boundary` (HTTP 403 Forbidden).
     - Unregistered student: `⛔ Student not registered` (HTTP 404 Not Found).

---

## API Reference

| Method | Endpoint | Payload / Query | Description |
|---|---|---|---|
| `GET` | `/health` | — | Health check and database connection status |
| `POST` | `/sessions/start` | `{"beaconUuid": "..."}` | Opens active session, auto-closing previous session for room |
| `POST` | `/sessions/end` | `{"sessionId": 1}` or `{"beaconUuid": "..."}` | Closes active attendance window |
| `GET` | `/sessions/active` | `?beaconUuid=...` | Checks live attendance state and attendee count |
| `GET` | `/sessions` | — | Lists recent sessions with total present counts |
| `POST` | `/checkin` | `{"enrollmentNumber": "...", "beaconUuid": "...", "rssi": -60, "deviceId": "..."}` | Validates and records attendance attempt |
| `GET` | `/checkin/history` | `?enrollmentNumber=...` | Attendance records history |
| `GET` | `/checkin/stats` | — | Aggregated live metrics for dashboard |
| `GET` | `/checkin/live` | `?minutes=30` | Check-ins within rolling time window |
| `GET` | `/students` | — | Lists all registered students |
| `POST` | `/students` | `{"enrollmentNumber": "...", "fullName": "...", "classSection": "..."}` | Registers or updates a student |

---

## Troubleshooting

### 1. ESP32 Not Detected by App
- **Location / GPS toggled OFF**: Ensure phone's Location (GPS) toggle is turned ON. Android suppresses BLE scan packets if GPS is disabled.
- **Permissions**: Verify app has Location and Bluetooth / Nearby Devices permissions in Android Settings.
- **Serial Heartbeat**: Check Arduino Serial Monitor at 115200 baud to confirm `[heartbeat]` prints every 10 seconds.

### 2. Network Error in App
- Verify `https://<your-service-name>.onrender.com/health` returns `healthy` in your phone browser.
- Check Render service status: if it was idle for >15 minutes, allow ~30 seconds for container warm-up.

### 3. Check-In Rejected with HTTP 404
- **Student Not Found**: Student enrollment number must exist in the `students` table. Add students via `POST /students` or in Supabase Table Editor.
- **Unknown Beacon**: Beacon UUID must match an entry in the `beacons` table (both big-endian and little-endian UUIDs are pre-seeded in `supabase_schema.sql`).

### 4. Calibrating RSSI for Custom Rooms
1. Place ESP32 in its permanent position in the classroom.
2. Stand exactly **1 meter away** with your phone.
3. Observe the RSSI `dBm` reading for 15 seconds and take the average (e.g., `-62 dBm`).
4. Update `MEASURED_POWER` in `PACBAS_Beacon.ino` and re-upload.

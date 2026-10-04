-- ============================================================
-- PACBAS — Supabase Postgres Schema & Initial Seed Data
-- ============================================================
-- Instructions:
-- 1. In your Supabase Dashboard, open SQL Editor.
-- 2. Click "New query", paste the entire contents of this file, and click "Run".
-- ============================================================

-- Clean up any existing tables (in reverse dependency order)
-- DROP TABLE IF EXISTS attendance_records CASCADE;
-- DROP TABLE IF EXISTS sessions CASCADE;
-- DROP TABLE IF EXISTS students CASCADE;
-- DROP TABLE IF EXISTS beacons CASCADE;

-- 1. Beacons Table
CREATE TABLE IF NOT EXISTS beacons (
  beacon_uuid           TEXT PRIMARY KEY,
  room_name             TEXT NOT NULL,
  reference_rssi_a      INTEGER NOT NULL DEFAULT -59,   -- Calibrated RSSI @ 1 meter
  path_loss_exponent_n  REAL NOT NULL DEFAULT 2.7,      -- Environmental attenuation factor
  rssi_cutoff           INTEGER NOT NULL DEFAULT -75    -- Hard boundary RSSI floor
);

-- 2. Students Table
CREATE TABLE IF NOT EXISTS students (
  enrollment_number     TEXT PRIMARY KEY,
  full_name             TEXT NOT NULL,
  class_section         TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. Sessions Table
-- The ESP32 does not manage sessions; the backend checks if attendance is open.
CREATE TABLE IF NOT EXISTS sessions (
  session_id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  beacon_uuid           TEXT NOT NULL REFERENCES beacons(beacon_uuid) ON DELETE CASCADE,
  started_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at              TIMESTAMPTZ,
  status                TEXT NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active', 'closed'))
);

-- 4. Attendance Records Table
CREATE TABLE IF NOT EXISTS attendance_records (
  id                    BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  session_id            BIGINT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  enrollment_number     TEXT NOT NULL REFERENCES students(enrollment_number) ON DELETE CASCADE,
  beacon_uuid           TEXT NOT NULL REFERENCES beacons(beacon_uuid) ON DELETE CASCADE,
  rssi                  INTEGER NOT NULL,
  estimated_distance_m  DOUBLE PRECISION,
  status                TEXT NOT NULL
                        CHECK (status IN ('present', 'rejected_out_of_range')),
  client_timestamp      TIMESTAMPTZ,
  server_timestamp      TIMESTAMPTZ NOT NULL DEFAULT now(),
  face_verified         BOOLEAN,                        -- Reserved for future face-ID layer
  device_id             TEXT,                           -- Physical device fingerprint (anti-proxy)

  -- Guarantee: only one check-in per student per session
  UNIQUE (session_id, enrollment_number)
);

-- ------------------------------------------------------------
-- Performance & Anti-Proxy Indexes
-- ------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_attendance_session ON attendance_records(session_id);
CREATE INDEX IF NOT EXISTS idx_attendance_enrollment ON attendance_records(enrollment_number);
CREATE INDEX IF NOT EXISTS idx_sessions_beacon_active ON sessions(beacon_uuid, status);

-- Unique index enforcing that one physical device cannot submit multiple 'present' check-ins in the same session
CREATE UNIQUE INDEX IF NOT EXISTS ux_attendance_session_device
  ON attendance_records (session_id, device_id)
  WHERE status = 'present' AND device_id IS NOT NULL;

-- ------------------------------------------------------------
-- Seed Data
-- ------------------------------------------------------------
-- Default demo beacons (both big-endian and little-endian UUID representations
-- to accommodate ESP32 BLE memory byte order)
INSERT INTO beacons (beacon_uuid, room_name, reference_rssi_a, path_loss_exponent_n, rssi_cutoff)
VALUES
  ('8ec76ea3-6668-48da-9866-75be8bc86f4d', 'Room 101-1', -59, 2.7, -75),
  ('4d6fc88b-be75-6698-da48-6866a36ec78e', 'Room 101-1', -59, 2.7, -75)
ON CONFLICT (beacon_uuid) DO NOTHING;

-- Demo and test students
INSERT INTO students (enrollment_number, full_name, class_section)
VALUES
  ('IT2023001', 'Demo Student One', 'IT-3A'),
  ('IT2023002', 'Demo Student Two', 'IT-3A'),
  ('STU-001', 'Test Student 001', 'IT-3A'),
  ('STU-101', 'Test Student 101', 'IT-3A'),
  ('STU-102', 'Test Student 102', 'IT-3A'),
  ('STU-103', 'Test Student 103', 'IT-3A')
ON CONFLICT (enrollment_number) DO NOTHING;

const express = require("express");
const router = express.Router();
const db = require("../db");

// Reverses the byte endianness of a 128-bit UUID string.
// Resolves discrepancies between ESP32 BLE little-endian memory layout
// and standard big-endian network byte order.
function reverseUuidEndianness(uuidStr) {
  try {
    const clean = (uuidStr || "").replace(/[^a-fA-F0-9]/g, "");
    if (clean.length !== 32) return null;
    const bytes = [];
    for (let i = 0; i < 32; i += 2) {
      bytes.push(clean.slice(i, i + 2));
    }
    bytes.reverse();
    return [
      bytes.slice(0, 4).join(""),
      bytes.slice(4, 6).join(""),
      bytes.slice(6, 8).join(""),
      bytes.slice(8, 10).join(""),
      bytes.slice(10, 16).join(""),
    ]
      .join("-")
      .toLowerCase();
  } catch {
    return null;
  }
}

// POST /checkin
// Body: { studentId / enrollmentNumber, beaconUuid, rssi, clientTimestamp, deviceId }
//
// Validation flow:
// 1. Enrollment number exists and is registered in students table? (400 if empty, 404 if unregistered)
// 2. Beacon exists? (checks exact UUID and endian-reversed counterpart, 404 if not found)
// 3. Is there an active session for this beacon right now? If not -> reject 409
// 4. RSSI in range? If not -> reject 403
// 5. Has this student or device already checked into this session? If yes -> reject 409
// 6. Insert record tied to session_id, return 201 with session and distance info
router.post("/", async (req, res) => {
  try {
    let { studentId, enrollmentNumber, beaconUuid, rssi, clientTimestamp, deviceId } = req.body;

    // 1. Enrollment number validation
    const enrollment = (enrollmentNumber || studentId || "").toString().trim().slice(0, 64);
    if (!enrollment) {
      return res.status(400).json({ error: "Enrollment number is required and must be a non-empty string." });
    }

    // Device ID validation (identifies physical hardware to prevent proxy attendance)
    deviceId = (deviceId || "").toString().trim().slice(0, 128);
    if (!deviceId) {
      return res.status(400).json({ error: "deviceId is required.", code: "DEVICE_ID_REQUIRED" });
    }

    // Beacon UUID validation
    if (typeof beaconUuid !== "string" || !beaconUuid.trim()) {
      return res.status(400).json({ error: "beaconUuid is required and must be a valid string." });
    }
    beaconUuid = beaconUuid.trim().slice(0, 64);

    // RSSI validation
    if (typeof rssi !== "number" || !Number.isFinite(rssi) || rssi < -130 || rssi > 10) {
      return res.status(400).json({ error: "rssi must be a valid finite number between -130 and 0 dBm." });
    }

    // Check student in database
    const studentRes = await db.query(
      "SELECT enrollment_number, full_name, class_section FROM students WHERE LOWER(enrollment_number) = LOWER($1)",
      [enrollment]
    );

    if (studentRes.rows.length === 0) {
      return res.status(404).json({
        error: `Enrollment number "${enrollment}" is not registered. Please register with your instructor.`,
        code: "STUDENT_NOT_FOUND",
        enrollmentNumber: enrollment,
      });
    }
    const student = studentRes.rows[0];

    // 2. Beacon exists?
    // Resolve beacon by exact UUID or reversed byte-order UUID
    const reversedUuid = reverseUuidEndianness(beaconUuid);
    let beaconRes = await db.query(
      "SELECT * FROM beacons WHERE LOWER(beacon_uuid) = LOWER($1)",
      [beaconUuid]
    );
    if (beaconRes.rows.length === 0 && reversedUuid) {
      beaconRes = await db.query(
        "SELECT * FROM beacons WHERE LOWER(beacon_uuid) = LOWER($1)",
        [reversedUuid]
      );
    }

    if (beaconRes.rows.length === 0) {
      const knownBeacons = await db.query("SELECT beacon_uuid, room_name FROM beacons");
      console.warn(`[Check-In] ⚠️ Unknown beacon_uuid received: "${beaconUuid}". Provisioned:`, knownBeacons.rows);
      return res.status(404).json({
        error: `Unknown beacon_uuid "${beaconUuid}". Is this room provisioned in the beacons table?`,
        receivedBeaconUuid: beaconUuid,
        provisionedBeacons: knownBeacons.rows,
      });
    }
    const beacon = beaconRes.rows[0];

    // 3. Is there an active session for this beacon right now?
    const sessionRes = await db.query(
      `
      SELECT * FROM sessions
      WHERE (LOWER(beacon_uuid) = LOWER($1) OR LOWER(beacon_uuid) = LOWER($2) OR LOWER(beacon_uuid) = LOWER($3))
        AND status = 'active'
      ORDER BY started_at DESC
      LIMIT 1
    `,
      [beacon.beacon_uuid, beaconUuid, reversedUuid || beacon.beacon_uuid]
    );

    const activeSession = sessionRes.rows[0];
    if (!activeSession) {
      return res.status(409).json({
        error: "No active session — has your teacher started attendance?",
        code: "NO_ACTIVE_SESSION",
        roomName: beacon.room_name,
        beaconUuid: beacon.beacon_uuid,
      });
    }

    // Calculate distance: Log-Distance Path Loss Model
    // d = 10 ^ ((A - RSSI) / (10 * n))
    const exponent = (beacon.reference_rssi_a - rssi) / (10 * beacon.path_loss_exponent_n);
    const distance = Math.pow(10, exponent);

    // 4. RSSI in range?
    const inRange = rssi >= beacon.rssi_cutoff;
    if (!inRange) {
      return res.status(403).json({
        error: `Outside RSSI boundary (cutoff ${beacon.rssi_cutoff} dBm) -- move closer to the beacon.`,
        code: "OUT_OF_RANGE",
        status: "rejected_out_of_range",
        rssi,
        estimatedDistanceMeters: Number(distance.toFixed(2)),
        cutoffDbm: beacon.rssi_cutoff,
        roomName: beacon.room_name,
        sessionId: activeSession.session_id,
      });
    }

    // 5. Has this student already checked into this session?
    const existingRecordRes = await db.query(
      `
      SELECT * FROM attendance_records
      WHERE session_id = $1 AND LOWER(enrollment_number) = LOWER($2) AND status = 'present'
    `,
      [activeSession.session_id, student.enrollment_number]
    );

    if (existingRecordRes.rows.length > 0) {
      const existingRecord = existingRecordRes.rows[0];
      return res.status(409).json({
        error: "Already checked in for this session",
        code: "ALREADY_CHECKED_IN",
        sessionId: activeSession.session_id,
        roomName: beacon.room_name,
        sessionStartedAt: activeSession.started_at,
        recordedAt: existingRecord.server_timestamp,
      });
    }

    // 5b. Has THIS DEVICE already marked attendance in this session (for any enrollment number)?
    const deviceRecordRes = await db.query(
      `
      SELECT * FROM attendance_records
      WHERE session_id = $1 AND device_id = $2 AND status = 'present'
    `,
      [activeSession.session_id, deviceId]
    );

    if (deviceRecordRes.rows.length > 0) {
      const deviceRecord = deviceRecordRes.rows[0];
      return res.status(409).json({
        error: "This device has already marked attendance for this session.",
        code: "DEVICE_ALREADY_USED",
        sessionId: activeSession.session_id,
        roomName: beacon.room_name,
        recordedAt: deviceRecord.server_timestamp,
      });
    }

    // 6. Insert record tied to session_id, return session info
    try {
      const insertRes = await db.query(
        `
        INSERT INTO attendance_records (
          session_id,
          enrollment_number,
          beacon_uuid,
          rssi,
          estimated_distance_m,
          status,
          client_timestamp,
          device_id
        ) VALUES ($1, $2, $3, $4, $5, 'present', $6, $7)
        RETURNING id, server_timestamp
      `,
        [
          activeSession.session_id,
          student.enrollment_number,
          beaconUuid,
          rssi,
          distance,
          clientTimestamp || null,
          deviceId,
        ]
      );

      return res.status(201).json({
        recordId: insertRes.rows[0].id,
        status: "present",
        sessionId: activeSession.session_id,
        roomName: beacon.room_name,
        sessionStartedAt: activeSession.started_at,
        rssi,
        estimatedDistanceMeters: Number(distance.toFixed(2)),
        cutoffDbm: beacon.rssi_cutoff,
        faceVerified: null,
      });
    } catch (err) {
      // Postgres unique constraint violation (code 23505)
      if (err.code === "23505") {
        const isDeviceConflict =
          (err.constraint && err.constraint.includes("device")) ||
          (err.detail && err.detail.includes("device_id"));

        return res.status(409).json({
          error: isDeviceConflict
            ? "This device has already marked attendance for this session."
            : "Already checked in for this session",
          code: isDeviceConflict ? "DEVICE_ALREADY_USED" : "ALREADY_CHECKED_IN",
          sessionId: activeSession.session_id,
          roomName: beacon.room_name,
        });
      }
      console.error("[Check-In] Insert error:", err);
      return res.status(500).json({ error: "Internal server error during check-in." });
    }
  } catch (err) {
    console.error("[Check-In] Unexpected error:", err);
    return res.status(500).json({ error: "Internal server error." });
  }
});

// GET /checkin/history?studentId=xyz or ?enrollmentNumber=xyz
router.get("/history", async (req, res) => {
  try {
    const student = req.query.enrollmentNumber || req.query.studentId;
    const queryText = student
      ? `
        SELECT a.*, b.room_name, s.started_at as session_started_at, s.status as session_status
        FROM attendance_records a
        LEFT JOIN beacons b ON a.beacon_uuid = b.beacon_uuid
        LEFT JOIN sessions s ON a.session_id = s.session_id
        WHERE LOWER(a.enrollment_number) = LOWER($1)
        ORDER BY a.server_timestamp DESC
        LIMIT 200
      `
      : `
        SELECT a.*, b.room_name, s.started_at as session_started_at, s.status as session_status
        FROM attendance_records a
        LEFT JOIN beacons b ON a.beacon_uuid = b.beacon_uuid
        LEFT JOIN sessions s ON a.session_id = s.session_id
        ORDER BY a.server_timestamp DESC
        LIMIT 200
      `;

    const result = await db.query(queryText, student ? [student.trim()] : []);
    res.json(result.rows);
  } catch (err) {
    console.error("[Check-In History] Error:", err);
    res.status(500).json({ error: "Failed to retrieve attendance history." });
  }
});

// GET /checkin/stats (For real-time dashboard monitoring)
router.get("/stats", async (req, res) => {
  try {
    const [
      totalRes,
      presentRes,
      rejectedRes,
      beaconRes,
      activeSessRes,
      totalSessRes,
      recentRes,
    ] = await Promise.all([
      db.query("SELECT COUNT(*)::int as count FROM attendance_records"),
      db.query("SELECT COUNT(*)::int as count FROM attendance_records WHERE status = 'present'"),
      db.query("SELECT COUNT(*)::int as count FROM attendance_records WHERE status = 'rejected_out_of_range'"),
      db.query("SELECT COUNT(*)::int as count FROM beacons"),
      db.query("SELECT COUNT(*)::int as count FROM sessions WHERE status = 'active'"),
      db.query("SELECT COUNT(*)::int as count FROM sessions"),
      db.query(`
        SELECT a.*, b.room_name, s.started_at as session_started_at
        FROM attendance_records a
        LEFT JOIN beacons b ON a.beacon_uuid = b.beacon_uuid
        LEFT JOIN sessions s ON a.session_id = s.session_id
        ORDER BY a.server_timestamp DESC
        LIMIT 10
      `),
    ]);

    const totalCheckins = totalRes.rows[0].count;
    const presentCount = presentRes.rows[0].count;

    res.json({
      totalCheckins,
      presentCount,
      rejectedCount: rejectedRes.rows[0].count,
      beaconCount: beaconRes.rows[0].count,
      activeSessionsCount: activeSessRes.rows[0].count,
      totalSessionsCount: totalSessRes.rows[0].count,
      presentRate: totalCheckins > 0 ? Math.round((presentCount / totalCheckins) * 100) : 0,
      recent: recentRes.rows,
    });
  } catch (err) {
    console.error("[Check-In Stats] Error:", err);
    res.status(500).json({ error: "Failed to retrieve check-in statistics." });
  }
});

// GET /checkin/live — check-ins in the last N minutes
router.get("/live", async (req, res) => {
  try {
    const windowMinutes = parseInt(req.query.minutes, 10) || 30;
    const result = await db.query(
      `
      SELECT a.*, b.room_name, s.started_at as session_started_at
      FROM attendance_records a
      LEFT JOIN beacons b ON a.beacon_uuid = b.beacon_uuid
      LEFT JOIN sessions s ON a.session_id = s.session_id
      WHERE a.server_timestamp >= now() - ($1 || ' minutes')::interval
      ORDER BY a.server_timestamp DESC
      LIMIT 200
    `,
      [windowMinutes]
    );

    res.json({
      windowMinutes,
      count: result.rows.length,
      records: result.rows,
    });
  } catch (err) {
    console.error("[Check-In Live] Error:", err);
    res.status(500).json({ error: "Failed to retrieve live check-ins." });
  }
});

// GET /checkin/beacons (Provisioned beacons)
router.get("/beacons", async (req, res) => {
  try {
    const result = await db.query("SELECT * FROM beacons ORDER BY room_name ASC");
    res.json(result.rows);
  } catch (err) {
    console.error("[Check-In Beacons] Error:", err);
    res.status(500).json({ error: "Failed to fetch beacons." });
  }
});

// POST /checkin/beacons (Provision or update a beacon room)
// Body: { beaconUuid, roomName, referenceRssiA, pathLossExponentN, rssiCutoff }
router.post("/beacons", async (req, res) => {
  try {
    let { beaconUuid, roomName, referenceRssiA, pathLossExponentN, rssiCutoff } = req.body;
    if (!beaconUuid || typeof beaconUuid !== "string" || !roomName) {
      return res.status(400).json({ error: "beaconUuid and roomName are required." });
    }
    beaconUuid = beaconUuid.trim();
    const reversedUuid = reverseUuidEndianness(beaconUuid);

    const a = typeof referenceRssiA === "number" ? referenceRssiA : -59;
    const n = typeof pathLossExponentN === "number" ? pathLossExponentN : 2.7;
    const cutoff = typeof rssiCutoff === "number" ? rssiCutoff : -75;

    const upsertSql = `
      INSERT INTO beacons (beacon_uuid, room_name, reference_rssi_a, path_loss_exponent_n, rssi_cutoff)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (beacon_uuid) DO UPDATE SET
        room_name = EXCLUDED.room_name,
        reference_rssi_a = EXCLUDED.reference_rssi_a,
        path_loss_exponent_n = EXCLUDED.path_loss_exponent_n,
        rssi_cutoff = EXCLUDED.rssi_cutoff
    `;

    await db.query(upsertSql, [beaconUuid, roomName.trim(), a, n, cutoff]);
    if (reversedUuid && reversedUuid !== beaconUuid) {
      await db.query(upsertSql, [reversedUuid, roomName.trim(), a, n, cutoff]);
    }

    res.status(201).json({
      message: "Beacon provisioned successfully.",
      beaconUuid,
      reversedUuid,
      roomName: roomName.trim(),
    });
  } catch (err) {
    console.error("[Check-In Provision Beacon] Error:", err);
    res.status(500).json({ error: "Failed to provision beacon." });
  }
});

module.exports = router;
const express = require("express");
const router = express.Router();
const db = require("../db");

// Reverses the byte endianness of a 128-bit UUID string.
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

// POST /sessions/start
// Body: { beaconUuid }
// Closes any previously-open session for that beacon automatically
// (only one active session per room at a time), then opens a new active session atomically.
router.post("/start", async (req, res) => {
  try {
    let { beaconUuid } = req.body;

    if (typeof beaconUuid !== "string" || !beaconUuid.trim()) {
      return res.status(400).json({ error: "beaconUuid is required and must be a valid string." });
    }
    beaconUuid = beaconUuid.trim();

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
      return res.status(404).json({
        error: `Unknown beaconUuid "${beaconUuid}" -- is this room provisioned in the beacons table?`,
        receivedBeaconUuid: beaconUuid,
        provisionedBeacons: knownBeacons.rows,
      });
    }
    const beacon = beaconRes.rows[0];

    // Atomically close existing active sessions for this room and start new session
    const client = await db.getClient();
    let newSessionId;
    let previousClosedCount = 0;

    try {
      await client.query("BEGIN");

      const closeRes = await client.query(
        `
        UPDATE sessions
        SET status = 'closed', ended_at = now()
        WHERE (LOWER(beacon_uuid) = LOWER($1) OR LOWER(beacon_uuid) = LOWER($2) OR LOWER(beacon_uuid) = LOWER($3))
          AND status = 'active'
      `,
        [beacon.beacon_uuid, beaconUuid, reversedUuid || beacon.beacon_uuid]
      );
      previousClosedCount = closeRes.rowCount;

      const insertRes = await client.query(
        `
        INSERT INTO sessions (beacon_uuid, started_at, status)
        VALUES ($1, now(), 'active')
        RETURNING session_id
      `,
        [beacon.beacon_uuid]
      );
      newSessionId = insertRes.rows[0].session_id;

      await client.query("COMMIT");
    } catch (txErr) {
      await client.query("ROLLBACK");
      throw txErr;
    } finally {
      client.release();
    }

    const sessionRes = await db.query(
      `
      SELECT s.*, b.room_name
      FROM sessions s
      JOIN beacons b ON s.beacon_uuid = b.beacon_uuid
      WHERE s.session_id = $1
    `,
      [newSessionId]
    );
    const session = sessionRes.rows[0];

    res.status(201).json({
      message: "Session started successfully.",
      sessionId: session.session_id,
      beaconUuid: session.beacon_uuid,
      roomName: session.room_name,
      startedAt: session.started_at,
      status: session.status,
      previousSessionsClosed: previousClosedCount,
    });
  } catch (err) {
    console.error("[Sessions Start] Error:", err);
    res.status(500).json({ error: "Failed to start attendance session." });
  }
});

// POST /sessions/end
// Body: { sessionId } or { beaconUuid }
// Marks the session as closed and sets ended_at.
router.post("/end", async (req, res) => {
  try {
    const { sessionId, beaconUuid } = req.body;
    let targetSession = null;

    if (sessionId !== undefined && sessionId !== null) {
      const sessRes = await db.query("SELECT * FROM sessions WHERE session_id = $1", [sessionId]);
      if (sessRes.rows.length === 0) {
        return res.status(404).json({ error: `Session #${sessionId} not found.` });
      }
      targetSession = sessRes.rows[0];
    } else if (typeof beaconUuid === "string" && beaconUuid.trim()) {
      const trimmed = beaconUuid.trim();
      const reversed = reverseUuidEndianness(trimmed);
      const sessRes = await db.query(
        `
        SELECT * FROM sessions
        WHERE (LOWER(beacon_uuid) = LOWER($1) OR LOWER(beacon_uuid) = LOWER($2))
          AND status = 'active'
        ORDER BY started_at DESC
        LIMIT 1
      `,
        [trimmed, reversed || trimmed]
      );

      if (sessRes.rows.length === 0) {
        return res.status(404).json({ error: "No active session found for this beaconUuid." });
      }
      targetSession = sessRes.rows[0];
    } else {
      return res.status(400).json({ error: "Either sessionId or beaconUuid is required." });
    }

    if (targetSession.status === "closed") {
      return res.json({
        message: "Session was already closed.",
        sessionId: targetSession.session_id,
        beaconUuid: targetSession.beacon_uuid,
        startedAt: targetSession.started_at,
        endsAt: targetSession.ended_at || targetSession.ends_at,
        endedAt: targetSession.ended_at || targetSession.ends_at,
        status: targetSession.status,
      });
    }

    await db.query(
      `
      UPDATE sessions
      SET status = 'closed', ended_at = now()
      WHERE session_id = $1
    `,
      [targetSession.session_id]
    );

    const updatedRes = await db.query(
      `
      SELECT s.*, b.room_name,
        (SELECT COUNT(*)::int FROM attendance_records WHERE session_id = s.session_id AND status = 'present') as attendees_count
      FROM sessions s
      JOIN beacons b ON s.beacon_uuid = b.beacon_uuid
      WHERE s.session_id = $1
    `,
      [targetSession.session_id]
    );
    const updated = updatedRes.rows[0];

    res.json({
      message: "Session ended successfully.",
      sessionId: updated.session_id,
      beaconUuid: updated.beacon_uuid,
      roomName: updated.room_name,
      startedAt: updated.started_at,
      endsAt: updated.ended_at,
      endedAt: updated.ended_at,
      status: updated.status,
      totalPresent: updated.attendees_count,
    });
  } catch (err) {
    console.error("[Sessions End] Error:", err);
    res.status(500).json({ error: "Failed to end attendance session." });
  }
});

// GET /sessions/active?beaconUuid=
// Used by check-in flow and dashboard to query live session state.
router.get("/active", async (req, res) => {
  try {
    const { beaconUuid } = req.query;

    if (beaconUuid) {
      const trimmed = beaconUuid.trim();
      const reversed = reverseUuidEndianness(trimmed);

      const rowRes = await db.query(
        `
        SELECT s.*, b.room_name,
          (SELECT COUNT(*)::int FROM attendance_records WHERE session_id = s.session_id AND status = 'present') as attendees_count
        FROM sessions s
        JOIN beacons b ON s.beacon_uuid = b.beacon_uuid
        WHERE (LOWER(s.beacon_uuid) = LOWER($1) OR LOWER(s.beacon_uuid) = LOWER($2))
          AND s.status = 'active'
        ORDER BY s.started_at DESC
        LIMIT 1
      `,
        [trimmed, reversed || trimmed]
      );

      if (rowRes.rows.length === 0) {
        return res.json({
          active: false,
          session: null,
          message: "No active session for this beacon.",
        });
      }

      const row = rowRes.rows[0];
      return res.json({
        active: true,
        session: {
          sessionId: row.session_id,
          beaconUuid: row.beacon_uuid,
          roomName: row.room_name,
          startedAt: row.started_at,
          status: row.status,
          attendeesCount: row.attendees_count,
        },
      });
    }

    // Return all currently active sessions
    const activeSessionsRes = await db.query(`
      SELECT s.*, b.room_name,
        (SELECT COUNT(*)::int FROM attendance_records WHERE session_id = s.session_id AND status = 'present') as attendees_count
      FROM sessions s
      JOIN beacons b ON s.beacon_uuid = b.beacon_uuid
      WHERE s.status = 'active'
      ORDER BY s.started_at DESC
    `);

    res.json({
      active: activeSessionsRes.rows.length > 0,
      session: activeSessionsRes.rows[0] || null,
      activeSessions: activeSessionsRes.rows,
    });
  } catch (err) {
    console.error("[Sessions Active] Error:", err);
    res.status(500).json({ error: "Failed to query active session." });
  }
});

// GET /sessions — list recent sessions
router.get("/", async (req, res) => {
  try {
    const sessionsRes = await db.query(`
      SELECT s.*, b.room_name,
        (SELECT COUNT(*)::int FROM attendance_records WHERE session_id = s.session_id AND status = 'present') as attendees_count
      FROM sessions s
      JOIN beacons b ON s.beacon_uuid = b.beacon_uuid
      ORDER BY s.started_at DESC
      LIMIT 50
    `);

    res.json(sessionsRes.rows);
  } catch (err) {
    console.error("[Sessions List] Error:", err);
    res.status(500).json({ error: "Failed to list sessions." });
  }
});

module.exports = router;

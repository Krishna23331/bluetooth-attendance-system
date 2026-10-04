// Automated verification script for Phase 1, Phase 2, and Phase 5
const http = require("http");
const express = require("express");
const cors = require("cors");
const checkinRouter = require("./routes/checkin");
const sessionsRouter = require("./routes/sessions");
const db = require("./db");

const app = express();
app.use(cors());
app.use(express.json());
app.use("/checkin", checkinRouter);
app.use("/sessions", sessionsRouter);

const server = http.createServer(app);

async function runTests() {
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;
  console.log(`Test server running on ${baseUrl}`);

  const beaconUuid = "8ec76ea3-6668-48da-9866-75be8bc86f4d";

  function req(endpoint, options = {}) {
    return fetch(`${baseUrl}${endpoint}`, {
      headers: { "Content-Type": "application/json" },
      ...options
    }).then(async (res) => {
      const data = await res.json().catch(() => ({}));
      return { status: res.status, data };
    });
  }

  console.log("\n--- TEST 1: Check-in with NO active session (should reject 409) ---");
  // Ensure any active sessions are ended first
  db.prepare("UPDATE sessions SET status = 'closed', ends_at = datetime('now') WHERE beacon_uuid = ?").run(beaconUuid);

  let res = await req("/checkin", {
    method: "POST",
    body: JSON.stringify({ enrollmentNumber: "STU-001", beaconUuid, rssi: -60 })
  });
  console.log("Status:", res.status, "Response:", res.data);
  if (res.status !== 409 || !res.data.error.includes("No active session")) {
    throw new Error(`Expected 409 No Active Session, got: ${res.status} ${JSON.stringify(res.data)}`);
  }
  console.log("✅ Passed: Rejected with 409 when no session is active.");

  console.log("\n--- TEST 2: Start session via POST /sessions/start ---");
  res = await req("/sessions/start", {
    method: "POST",
    body: JSON.stringify({ beaconUuid })
  });
  console.log("Status:", res.status, "Response:", res.data);
  if (res.status !== 201 || !res.data.sessionId || res.data.status !== "active") {
    throw new Error(`Failed to start session: ${res.status} ${JSON.stringify(res.data)}`);
  }
  const sessionId = res.data.sessionId;
  console.log(`✅ Passed: Started active session #${sessionId}`);

  console.log("\n--- TEST 3: Query active session via GET /sessions/active?beaconUuid= ---");
  res = await req(`/sessions/active?beaconUuid=${beaconUuid}`);
  console.log("Status:", res.status, "Response:", res.data);
  if (res.status !== 200 || !res.data.active || res.data.session.sessionId !== sessionId) {
    throw new Error(`Active session mismatch: ${res.status} ${JSON.stringify(res.data)}`);
  }
  console.log("✅ Passed: Active session queried successfully.");

  console.log("\n--- TEST 4: Student 1 check-in (valid RSSI, in range) ---");
  res = await req("/checkin", {
    method: "POST",
    body: JSON.stringify({ enrollmentNumber: "STU-101", beaconUuid, rssi: -60 })
  });
  console.log("Status:", res.status, "Response:", res.data);
  if (res.status !== 201 || res.data.status !== "present" || res.data.sessionId !== sessionId || res.data.faceVerified !== null) {
    throw new Error(`Check-in failed: ${res.status} ${JSON.stringify(res.data)}`);
  }
  console.log("✅ Passed: Student STU-101 checked in with present status and faceVerified: null.");

  console.log("\n--- TEST 5: Student 1 duplicate check-in in same session (should reject 409) ---");
  res = await req("/checkin", {
    method: "POST",
    body: JSON.stringify({ enrollmentNumber: "STU-101", beaconUuid, rssi: -60 })
  });
  console.log("Status:", res.status, "Response:", res.data);
  if (res.status !== 409 || !res.data.error.includes("Already checked in")) {
    throw new Error(`Expected 409 Already Checked In, got: ${res.status} ${JSON.stringify(res.data)}`);
  }
  console.log("✅ Passed: Duplicate check-in in same session blocked with 409.");

  console.log("\n--- TEST 6: Student 2 check-in out of range (RSSI < cutoff, should reject 403) ---");
  res = await req("/checkin", {
    method: "POST",
    body: JSON.stringify({ enrollmentNumber: "STU-102", beaconUuid, rssi: -85 })
  });
  console.log("Status:", res.status, "Response:", res.data);
  if (res.status !== 403 || res.data.status !== "rejected_out_of_range") {
    throw new Error(`Expected 403 out of range, got: ${res.status} ${JSON.stringify(res.data)}`);
  }
  console.log("✅ Passed: Out of range rejected with 403 without recording present attendance.");

  console.log("\n--- TEST 7: Student 2 moves closer and checks in successfully ---");
  res = await req("/checkin", {
    method: "POST",
    body: JSON.stringify({ enrollmentNumber: "STU-102", beaconUuid, rssi: -62 })
  });
  console.log("Status:", res.status, "Response:", res.data);
  if (res.status !== 201 || res.data.status !== "present") {
    throw new Error(`Expected 201 present, got: ${res.status} ${JSON.stringify(res.data)}`);
  }
  console.log("✅ Passed: Student 2 was able to check in once within range.");

  console.log("\n--- TEST 8: Teacher ends session via POST /sessions/end ---");
  res = await req("/sessions/end", {
    method: "POST",
    body: JSON.stringify({ sessionId })
  });
  console.log("Status:", res.status, "Response:", res.data);
  if (res.status !== 200 || res.data.status !== "closed" || !res.data.endsAt) {
    throw new Error(`Expected session closed, got: ${res.status} ${JSON.stringify(res.data)}`);
  }
  console.log(`✅ Passed: Session #${sessionId} ended. Attendees: ${res.data.totalPresent}`);

  console.log("\n--- TEST 9: Student 3 attempts late check-in after session ended (should reject 409) ---");
  res = await req("/checkin", {
    method: "POST",
    body: JSON.stringify({ enrollmentNumber: "STU-103", beaconUuid, rssi: -60 })
  });
  console.log("Status:", res.status, "Response:", res.data);
  if (res.status !== 409 || !res.data.error.includes("No active session")) {
    throw new Error(`Expected 409 No Active Session, got: ${res.status} ${JSON.stringify(res.data)}`);
  }
  console.log("✅ Passed: Late check-in after teacher ended session was rejected.");

  console.log("\n--- TEST 10: Teacher starts NEW session and Student 1 can check in again ---");
  res = await req("/sessions/start", {
    method: "POST",
    body: JSON.stringify({ beaconUuid })
  });
  const newSessionId = res.data.sessionId;
  console.log(`Started new session #${newSessionId}`);

  res = await req("/checkin", {
    method: "POST",
    body: JSON.stringify({ enrollmentNumber: "STU-101", beaconUuid, rssi: -60 })
  });
  console.log("Status:", res.status, "Response:", res.data);
  if (res.status !== 201 || res.data.sessionId !== newSessionId) {
    throw new Error(`Expected 201 in new session, got: ${res.status} ${JSON.stringify(res.data)}`);
  }
  console.log("✅ Passed: Student 1 successfully checked in to the new session (dedup is per-session, not permanent)!");

  console.log("\n--- TEST 11: Auto-closing stale sessions on new start ---");
  res = await req("/sessions/start", {
    method: "POST",
    body: JSON.stringify({ beaconUuid })
  });
  console.log("Status:", res.status, "Response:", res.data);
  if (res.data.previousSessionsClosed !== 1) {
    throw new Error(`Expected 1 previous session closed, got: ${res.data.previousSessionsClosed}`);
  }
  console.log("✅ Passed: Stale session was auto-closed when new session was started.");

  server.close();
  console.log("\n🎉 ALL 11 TESTS PASSED PERFECTLY!");
}

runTests().catch((err) => {
  console.error("❌ Test failed:", err);
  server.close();
  process.exit(1);
});

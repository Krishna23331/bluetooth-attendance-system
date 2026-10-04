// Supabase Postgres Persistence Layer for PACBAS
// Connects to Supabase free-tier Postgres using node-postgres (pg Pool)
// and provides a wrapper for the @supabase/supabase-js client.

require("dotenv").config();
const { Pool } = require("pg");
const { createClient } = require("@supabase/supabase-js");

/**
 * Safely encodes special characters (e.g. '?', '+', '#') in the password portion
 * of a Postgres connection URI to prevent premature URL query parsing.
 */
function sanitizePostgresUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== "string") return rawUrl;
  const match = rawUrl.match(/^(postgres(?:ql)?:\/\/)([^:]+):(.*)@([^:/]+)(?::(\d+))?\/([^?]+)(\?.*)?$/);
  if (!match) return rawUrl;
  const [, protocol, user, pass, host, port, dbname, query] = match;
  try {
    const decodedPass = decodeURIComponent(pass);
    const encodedPass = encodeURIComponent(decodedPass);
    const portStr = port ? `:${port}` : "";
    const queryStr = query || "";
    return `${protocol}${user}:${encodedPass}@${host}${portStr}/${dbname}${queryStr}`;
  } catch {
    return rawUrl;
  }
}

const rawConnStr = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL;
const connectionString = sanitizePostgresUrl(rawConnStr);

let rawSupabaseUrl = process.env.SUPABASE_URL || "";
if (rawSupabaseUrl.endsWith("/rest/v1") || rawSupabaseUrl.endsWith("/rest/v1/")) {
  rawSupabaseUrl = rawSupabaseUrl.replace(/\/rest\/v1\/?$/, "");
}
if (rawSupabaseUrl.endsWith("/")) {
  rawSupabaseUrl = rawSupabaseUrl.slice(0, -1);
}
const supabaseUrl = rawSupabaseUrl;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY;

// Initialize Supabase JS client wrapper if URL and key are provided
let supabase = null;
if (supabaseUrl && supabaseKey) {
  supabase = createClient(supabaseUrl, supabaseKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

// Determine SSL requirements: Supabase requires SSL. Disable strict CA checks for hosted cloud DBs.
const isCloudDb = Boolean(
  connectionString &&
    (connectionString.includes("supabase.co") ||
      connectionString.includes("pooler.supabase.com") ||
      connectionString.includes("render.com") ||
      process.env.NODE_ENV === "production")
);

const poolConfig = connectionString
  ? {
      connectionString,
      ssl: isCloudDb ? { rejectUnauthorized: false } : false,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    }
  : {
      user: process.env.PGUSER || "postgres",
      host: process.env.PGHOST || "localhost",
      database: process.env.PGDATABASE || "postgres",
      password: process.env.PGPASSWORD || "postgres",
      port: parseInt(process.env.PGPORT || "5432", 10),
      ssl: isCloudDb ? { rejectUnauthorized: false } : false,
      max: 10,
    };

const pool = new Pool(poolConfig);

pool.on("error", (err) => {
  console.error("[Postgres Pool] Unexpected error on idle client:", err.message);
});

/**
 * Executes a parameterized SQL query on the pool.
 * @param {string} text - The SQL query text with $1, $2, etc. placeholders.
 * @param {Array} params - Array of parameter values.
 * @returns {Promise<{ rows: Array, rowCount: number }>}
 */
async function query(text, params = []) {
  const start = Date.now();
  const res = await pool.query(text, params);
  const duration = Date.now() - start;
  if (process.env.DEBUG_SQL === "true") {
    console.log(`[SQL ${duration}ms] ${text.trim().split("\n")[0]} | Rows: ${res.rowCount}`);
  }
  return res;
}

/**
 * Obtains an isolated client from the pool for multi-statement transactions.
 * Remember to release the client in a finally block!
 * @returns {Promise<import("pg").PoolClient>}
 */
async function getClient() {
  const client = await pool.connect();
  return client;
}

/**
 * Verifies connection and ensures seed beacons and students exist.
 */
async function initDb() {
  if (!connectionString && !process.env.PGHOST) {
    console.warn("[DB] ⚠️ Neither DATABASE_URL nor PGHOST is configured. Skipping startup seed check.");
    return false;
  }

  try {
    const test = await query("SELECT current_database() as db_name, now() as server_now");
    console.log(`[DB] ✅ Connected to Postgres database: "${test.rows[0].db_name}" at ${test.rows[0].server_now.toISOString()}`);

    // Seed default demo beacons (matching ESP32 default UUID in both endian orders)
    await query(`
      INSERT INTO beacons (beacon_uuid, room_name, reference_rssi_a, path_loss_exponent_n, rssi_cutoff)
      VALUES
        ('8ec76ea3-6668-48da-9866-75be8bc86f4d', 'Room 101-1', -59, 2.7, -75),
        ('4d6fc88b-be75-6698-da48-6866a36ec78e', 'Room 101-1', -59, 2.7, -75)
      ON CONFLICT (beacon_uuid) DO NOTHING;
    `);

    // Seed demo students matching the schema definition
    await query(`
      INSERT INTO students (enrollment_number, full_name, class_section)
      VALUES
        ('IT2023001', 'Demo Student One', 'IT-3A'),
        ('IT2023002', 'Demo Student Two', 'IT-3A'),
        ('STU-001', 'Test Student 001', 'IT-3A'),
        ('STU-101', 'Test Student 101', 'IT-3A'),
        ('STU-102', 'Test Student 102', 'IT-3A'),
        ('STU-103', 'Test Student 103', 'IT-3A')
      ON CONFLICT (enrollment_number) DO NOTHING;
    `);

    console.log("[DB] ✅ Default beacons and demo students verified in Supabase/Postgres.");
    return true;
  } catch (err) {
    console.error("[DB] ⚠️ Startup database check/seed failed:", err.message);
    console.error("     Make sure your Supabase project tables are created by running schema.sql in Supabase SQL Editor.");
    return false;
  }
}

module.exports = {
  query,
  getClient,
  pool,
  supabase,
  initDb,
};
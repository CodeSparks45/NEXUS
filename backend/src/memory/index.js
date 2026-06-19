/**
 * NEXUS — Memory Agent
 * Single write-gatekeeper for the local SQLite vault.
 * No other agent writes to disk directly.
 * Directive compliance: all data stays local, user-purgeable on demand.
 */

const sqlite3 = require("sqlite3").verbose();
const { open } = require("sqlite");
const path = require("path");

let db;

// ─── Boot ────────────────────────────────────────────────────────────────────

const initDB = async () => {
  try {
    db = await open({
      filename: path.join(__dirname, "nexus_memory.sqlite"),
      driver: sqlite3.Database,
    });

    console.log(`[MEMORY AGENT] 💾 Connected to Local SQLite Vault.`);

    await db.exec(`
      CREATE TABLE IF NOT EXISTS daily_schedule (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        task_name   TEXT    NOT NULL,
        duration    TEXT    NOT NULL,
        break_strategy TEXT,
        status      TEXT    DEFAULT 'pending',
        created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS action_log (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        trace_id    TEXT,
        agent       TEXT    NOT NULL,
        intent      TEXT    NOT NULL,
        payload     TEXT,
        unlogged    INTEGER DEFAULT 0,
        created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS contact_allowlist (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        contact     TEXT    NOT NULL UNIQUE,
        channel     TEXT    NOT NULL DEFAULT 'whatsapp',
        approved_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    console.log(`[MEMORY AGENT] 🗂️  Tables ready (schedule | action_log | contacts).`);
  } catch (err) {
    console.error(`[MEMORY AGENT] ❌ Database failed to initialize:`, err.message);
    throw err;
  }
};

// ─── Schedule ─────────────────────────────────────────────────────────────────

const logTaskToMemory = async (taskName, duration, breakStrategy = null) => {
  if (!db) return null;
  try {
    const result = await db.run(
      `INSERT INTO daily_schedule (task_name, duration, break_strategy) VALUES (?, ?, ?)`,
      [taskName, duration, breakStrategy]
    );
    console.log(`[MEMORY AGENT] ✅ Task saved (ID: ${result.lastID})`);
    return result.lastID;
  } catch (err) {
    console.error(`[MEMORY AGENT] ❌ Failed to save task:`, err.message);
    return null;
  }
};

const getSchedule = async () => {
  if (!db) return [];
  return db.all(
    `SELECT * FROM daily_schedule WHERE DATE(created_at) = DATE('now') ORDER BY created_at DESC`
  );
};

const clearSchedule = async () => {
  if (!db) return;
  await db.run(`DELETE FROM daily_schedule WHERE DATE(created_at) = DATE('now')`);
  console.log(`[MEMORY AGENT] 🗑️  Today's schedule cleared.`);
};

// ─── Action Log ───────────────────────────────────────────────────────────────

const logAction = async (traceId, agent, intent, payload, unlogged = false) => {
  if (!db) return;
  try {
    await db.run(
      `INSERT INTO action_log (trace_id, agent, intent, payload, unlogged) VALUES (?, ?, ?, ?, ?)`,
      [traceId, agent, intent, JSON.stringify(payload), unlogged ? 1 : 0]
    );
  } catch (err) {
    console.error(`[MEMORY AGENT] ❌ Action log failed (unlogged action):`, err.message);
  }
};

// ─── Contact Allow-list ───────────────────────────────────────────────────────

const isContactApproved = async (contact, channel = "whatsapp") => {
  if (!db) return false;
  const row = await db.get(
    `SELECT id FROM contact_allowlist WHERE contact = ? AND channel = ?`,
    [contact, channel]
  );
  return !!row;
};

const approveContact = async (contact, channel = "whatsapp") => {
  if (!db) return;
  await db.run(
    `INSERT OR IGNORE INTO contact_allowlist (contact, channel) VALUES (?, ?)`,
    [contact, channel]
  );
  console.log(`[MEMORY AGENT] ✅ Contact approved: ${contact} (${channel})`);
};

// ─── Purge (user-triggered "Clear Memory") ────────────────────────────────────

const purgeAll = async () => {
  if (!db) return;
  await db.run(`DELETE FROM daily_schedule`);
  await db.run(`DELETE FROM action_log`);
  console.log(`[MEMORY AGENT] 🗑️  Full memory purge complete.`);
};

module.exports = {
  initDB,
  logTaskToMemory,
  getSchedule,
  clearSchedule,
  logAction,
  isContactApproved,
  approveContact,
  purgeAll,
};
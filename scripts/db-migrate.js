const { ensureSchema, db } = require("../db");

async function run() {
  try {
    await ensureSchema();
    console.log("Database migration completed successfully.");
  } catch (error) {
    console.error("Database migration failed:", error.message);
    process.exitCode = 1;
  } finally {
    await db.destroy();
  }
}

run();

const { db, ensureSchema } = require("../db");

async function run() {
  try {
    const hasUsers = await db.schema.hasTable("users");
    if (hasUsers) {
      await db.schema.dropTable("users");
      console.log("Dropped users table.");
    }

    await ensureSchema();
    console.log("Database reset completed successfully.");
  } catch (error) {
    console.error("Database reset failed:", error.message);
    process.exitCode = 1;
  } finally {
    await db.destroy();
  }
}

run();

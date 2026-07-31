const sqlite3 = require("sqlite3").verbose();
const fs = require("fs");
const path = require("path");

const dbPath = path.join(__dirname, "../data/app.db");
const outPath = path.join(__dirname, "../data/users-export.sql");
const db = new sqlite3.Database(dbPath);

function run(sql, params) {
  return new Promise((res, rej) => db.all(sql, params || [], (e, r) => e ? rej(e) : res(r)));
}

async function main() {
  const tables = await run("SELECT name FROM sqlite_master WHERE type='table'");
  console.log("Tables:", tables.map(t => t.name).join(", "));

  let sql = "-- Users export from app.db\n-- Generated: " + new Date().toISOString() + "\n\n";

  for (const t of tables) {
    const name = t.name.toLowerCase();
    if (!name.includes("user") && !name.includes("admin") && !name.includes("account")) continue;

    const colDefs = await run("PRAGMA table_info(" + t.name + ")");
    const rows = await run("SELECT * FROM " + t.name);
    console.log(t.name + ": " + rows.length + " rows, cols: " + colDefs.map(c => c.name).join(", "));
    if (rows.length === 0) continue;

    const cols = colDefs.map(c => c.name);
    sql += "-- Table: " + t.name + " (" + rows.length + " rows)\n";
    sql += "CREATE TABLE IF NOT EXISTS `" + t.name + "` (\n";
    sql += colDefs.map(c => {
      let def = "  `" + c.name + "` " + (c.type || "TEXT");
      if (c.pk) def += " PRIMARY KEY";
      if (c.notnull) def += " NOT NULL";
      if (c.dflt_value !== null) def += " DEFAULT " + c.dflt_value;
      return def;
    }).join(",\n");
    sql += "\n);\n\n";

    rows.forEach(row => {
      const vals = cols.map(c => {
        const v = row[c];
        if (v === null || v === undefined) return "NULL";
        if (typeof v === "number") return v;
        return "'" + String(v).replace(/'/g, "''") + "'";
      });
      sql += "INSERT INTO `" + t.name + "` (`" + cols.join("`, `") + "`) VALUES (" + vals.join(", ") + ");\n";
    });
    sql += "\n";
  }

  fs.writeFileSync(outPath, sql);
  console.log("\nExported to: data/users-export.sql");
  db.close();
}

main().catch(e => { console.error(e); db.close(); });

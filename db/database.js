const Database = require("better-sqlite3");
const fs = require("fs");
const path = require("path");

const databasePath =
  process.env.DATABASE_PATH ||
  path.join(__dirname, "..", "data", "assignments.db");

const databaseDirectory = path.dirname(databasePath);

if (!fs.existsSync(databaseDirectory)) {
  fs.mkdirSync(databaseDirectory, { recursive: true });
}

const db = new Database(databasePath);

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

const schemaPath = path.join(__dirname, "schema.sql");
const schema = fs.readFileSync(schemaPath, "utf-8");

db.exec(schema);

module.exports = db;

// Is `DELETE FROM <fts>` valid on an fts5 EXTERNAL-CONTENT table? That is what
// sure-mail's core emits in emitFtsSync (imap/handlers.ts). Measure it.
const { DatabaseSync } = require("node:sqlite");

function fresh() {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE messages (
    account INTEGER NOT NULL, folder TEXT NOT NULL, uid INTEGER NOT NULL,
    subject TEXT, fromaddr TEXT, body_text TEXT, internaldate INTEGER,
    PRIMARY KEY (account, folder, uid))`);
  db.exec(`CREATE VIRTUAL TABLE messages_fts USING fts5(
    subject, fromaddr, body_text, content='messages', content_rowid='rowid',
    tokenize='unicode61')`);
  db.exec(`INSERT INTO messages VALUES
    (1,'INBOX',7,'Quarterly invoice','billing@vendor.com','Please find the invoice attached',1700000000)`);
  return db;
}

const t = (label, fn) => {
  try {
    const r = fn();
    console.log(`  OK   ${label}${r !== undefined ? "  -> " + JSON.stringify(r) : ""}`);
  } catch (e) {
    console.log(`  FAIL ${label}  :: ${String(e.message).split("\n")[0].slice(0, 90)}`);
  }
};

console.log("=== A. what the core emits today");
{
  const db = fresh();
  t("DELETE FROM messages_fts WHERE rowid IN (...)", () =>
    db.prepare("DELETE FROM messages_fts WHERE rowid IN (SELECT rowid FROM messages WHERE account=? AND folder=? AND uid=?)").run(1, "INBOX", 7));
  t("INSERT INTO messages_fts(rowid, ...) SELECT ...", () =>
    db.prepare("INSERT INTO messages_fts(rowid, subject, fromaddr, body_text) SELECT rowid, subject, fromaddr, body_text FROM messages WHERE account=? AND folder=? AND uid=?").run(1, "INBOX", 7));
  t("search after that", () =>
    db.prepare("SELECT m.uid FROM messages_fts f JOIN messages m ON m.rowid=f.rowid WHERE messages_fts MATCH ?").all('"invoice"'));
}

console.log("=== B. the documented external-content sync ('delete' command)");
{
  const db = fresh();
  t("INSERT INTO messages_fts(messages_fts,rowid,...) VALUES('delete',...)", () =>
    db.prepare("INSERT INTO messages_fts(messages_fts, rowid, subject, fromaddr, body_text) VALUES('delete', (SELECT rowid FROM messages WHERE account=? AND folder=? AND uid=?), '', '', '')").run(1, "INBOX", 7));
  t("INSERT INTO messages_fts(rowid, ...) SELECT ...", () =>
    db.prepare("INSERT INTO messages_fts(rowid, subject, fromaddr, body_text) SELECT rowid, subject, fromaddr, body_text FROM messages WHERE account=? AND folder=? AND uid=?").run(1, "INBOX", 7));
  t("search after that", () =>
    db.prepare("SELECT m.uid FROM messages_fts f JOIN messages m ON m.rowid=f.rowid WHERE messages_fts MATCH ?").all('"invoice"'));
}

console.log("=== C. plain insert only (no delete), then re-insert the same row");
{
  const db = fresh();
  t("INSERT ... SELECT (first)", () =>
    db.prepare("INSERT INTO messages_fts(rowid, subject, fromaddr, body_text) SELECT rowid, subject, fromaddr, body_text FROM messages WHERE account=? AND folder=? AND uid=?").run(1, "INBOX", 7));
  t("search", () =>
    db.prepare("SELECT m.uid FROM messages_fts f JOIN messages m ON m.rowid=f.rowid WHERE messages_fts MATCH ?").all('"invoice"'));
  t("INSERT ... SELECT again (duplicate)", () =>
    db.prepare("INSERT INTO messages_fts(rowid, subject, fromaddr, body_text) SELECT rowid, subject, fromaddr, body_text FROM messages WHERE account=? AND folder=? AND uid=?").run(1, "INBOX", 7));
  t("search after duplicate", () =>
    db.prepare("SELECT m.uid FROM messages_fts f JOIN messages m ON m.rowid=f.rowid WHERE messages_fts MATCH ?").all('"invoice"'));
}

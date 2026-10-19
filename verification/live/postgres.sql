-- Validate the PROPOSED Postgres dialect, so the contract is measured rather
-- than asserted. Everything the core would need instead of the SQLite shape.
DROP TABLE IF EXISTS messages CASCADE;
DROP TABLE IF EXISTS accounts CASCADE;

-- 1. identity: the SQLite rowid alias replaced
CREATE TABLE accounts (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  address TEXT NOT NULL,
  host TEXT NOT NULL
);
INSERT INTO accounts (address, host) VALUES ('a@b.c', 'mail.example');  -- no id
SELECT 'identity: insert without id ->' AS check, id, address FROM accounts;

-- 2. versioning: a table instead of PRAGMA user_version
CREATE TABLE IF NOT EXISTS _sure_store_meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);
INSERT INTO _sure_store_meta (k, v) VALUES ('schema_version', '4')
  ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v;
SELECT 'versioning: read back ->' AS check, v FROM _sure_store_meta WHERE k = 'schema_version';

-- 3. column probe: information_schema instead of pragma_table_info
SELECT 'column probe ->' AS check, count(*) AS found
FROM information_schema.columns
WHERE table_name = 'accounts' AND column_name = 'host';

-- 4. FTS: a generated tsvector + GIN, instead of an fts5 external-content table
CREATE TABLE messages (
  account BIGINT NOT NULL,
  folder TEXT NOT NULL,
  uid BIGINT NOT NULL,
  subject TEXT,
  fromaddr TEXT,
  body_text TEXT,
  internaldate BIGINT,
  PRIMARY KEY (account, folder, uid)
);
ALTER TABLE messages ADD COLUMN search_vec tsvector
  GENERATED ALWAYS AS (
    to_tsvector('simple',
      coalesce(subject,'') || ' ' || coalesce(fromaddr,'') || ' ' || coalesce(body_text,''))
  ) STORED;
CREATE INDEX messages_search_idx ON messages USING GIN (search_vec);

INSERT INTO messages (account, folder, uid, subject, fromaddr, body_text, internaldate)
VALUES (1,'INBOX',7,'Quarterly invoice','billing@vendor.com','Please find the invoice attached',1700000000),
       (1,'INBOX',8,'Renewal notice','billing@vendor.com','Your subscription renews',1700000001);

-- 5. the search: no sync statements needed (the generated column maintains itself)
SELECT 'search (tsquery &) ->' AS check, uid, subject
FROM messages
WHERE search_vec @@ to_tsquery('simple', 'invoice & attached')
ORDER BY internaldate DESC;

SELECT 'search (single term) ->' AS check, uid, subject
FROM messages
WHERE search_vec @@ to_tsquery('simple', 'renewal')
ORDER BY internaldate DESC;

-- 6. the semantic difference, made visible: stemming
SELECT 'stemming: simple vs english on "renewal"/"renews" ->' AS check,
       to_tsvector('simple','renews') @@ to_tsquery('simple','renewal') AS simple_matches,
       to_tsvector('english','renews') @@ to_tsquery('english','renewal') AS english_matches;

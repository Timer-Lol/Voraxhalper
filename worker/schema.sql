CREATE TABLE IF NOT EXISTS boards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  g TEXT NOT NULL,          -- game id made on the page
  n INTEGER NOT NULL,       -- board number within that game
  received INTEGER NOT NULL,
  data TEXT NOT NULL,
  UNIQUE (g, n)
);

-- debug reports: uploads counted per day, per sender (a salted hash, never the address) and in all ('*')
CREATE TABLE IF NOT EXISTS report_limits (
  day TEXT NOT NULL,
  who TEXT NOT NULL,
  n INTEGER NOT NULL,
  PRIMARY KEY (day, who)
);

-- cards the helper didn't recognise: one row per title (as read), how often seen, and its picture in R2
CREATE TABLE IF NOT EXISTS new_cards (
  id TEXT PRIMARY KEY,
  phase TEXT NOT NULL,
  text TEXT NOT NULL,
  seen INTEGER NOT NULL,
  first INTEGER NOT NULL,
  last INTEGER NOT NULL,
  picture TEXT
);

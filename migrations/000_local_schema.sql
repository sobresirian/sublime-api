CREATE TABLE IF NOT EXISTS productos (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    price_usd REAL NOT NULL DEFAULT 0,
    img TEXT DEFAULT '',
    sort INTEGER DEFAULT 0,
    visible INTEGER DEFAULT 1,
    updated_at TEXT DEFAULT '',
    category TEXT DEFAULT '',
    status TEXT DEFAULT 'active',
    fragrantica TEXT DEFAULT '',
    notes TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS config (
    key TEXT PRIMARY KEY,
    value TEXT DEFAULT ''
);
CREATE TABLE institutions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cnpj TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    address TEXT,
    responsible TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending'
);

CREATE TABLE bingos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    institution_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    prize TEXT,
    datetime TEXT NOT NULL,
    price REAL NOT NULL,
    max_cards INTEGER NOT NULL,
    per_person_limit INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    status TEXT NOT NULL DEFAULT 'draft',
    FOREIGN KEY (institution_id) REFERENCES institutions(id)
);

CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    password TEXT NOT NULL,
    role TEXT NOT NULL,
    token TEXT
);

-- Indexes for faster lookups
CREATE INDEX idx_institutions_cnpj ON institutions(cnpj);
CREATE INDEX idx_bingos_institution ON bingos(institution_id);
CREATE INDEX idx_bingos_status ON bingos(status);
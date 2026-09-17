PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL UNIQUE,
    start_date TEXT NOT NULL,
    archived INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS units (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL,
    unit_number INTEGER NOT NULL,
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,

    FOREIGN KEY (session_id)
        REFERENCES sessions (id)
        ON DELETE CASCADE,

    UNIQUE (session_id, unit_number)
);

CREATE TABLE IF NOT EXISTS courses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL,
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    archived INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (session_id)
        REFERENCES sessions (id),

    UNIQUE (session_id, code)
);

CREATE TABLE IF NOT EXISTS assignment_types (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    due_offset_days INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS assignments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    course_id INTEGER NOT NULL,
    unit_id INTEGER NOT NULL,
    type_id INTEGER NOT NULL,

    name TEXT,
    due_date TEXT NOT NULL,

    possible REAL,
    grade REAL,
    completed INTEGER NOT NULL DEFAULT 0,
    discussion_progress INTEGER NOT NULL DEFAULT 0,

    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (course_id)
        REFERENCES courses (id)
        ON DELETE CASCADE,

    FOREIGN KEY (unit_id)
        REFERENCES units(id),

    FOREIGN KEY (type_id)
        REFERENCES assignment_types (id)
);

INSERT OR IGNORE INTO assignment_types
    (name, due_offset_days)
VALUES
    ('Discussion', -4),
    ('Assignment', 0),
    ('Seminar', 0),
    ('Lab', 0), 
    ('Quiz', 0),
    ('Exam', 0),
    ('Journal', 0);
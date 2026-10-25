CREATE TABLE schema_migrations (
    version INTEGER PRIMARY KEY CHECK (version >= 0),
    name TEXT NOT NULL UNIQUE,
    checksum TEXT NOT NULL CHECK (checksum ~ '^[a-f0-9]{64}$'),
    applied_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

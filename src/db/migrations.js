// Ordered schema migrations. Migration N leaves the database at
// PRAGMA user_version N. Append new entries; never edit a shipped one.
export const migrations = [
  `
  CREATE TABLE events (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    language TEXT NOT NULL,
    cleanup_weeks INTEGER NOT NULL DEFAULT 4,
    theme_text TEXT,
    wish_options TEXT,
    theme_changed_at TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE groups (
    id INTEGER PRIMARY KEY,
    event_id INTEGER NOT NULL REFERENCES events (id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    exchange_date TEXT NOT NULL,
    exchange_time TEXT,
    exchange_place TEXT,
    auto_open_at TEXT,
    opened_at TEXT,
    invitations_sent_at TEXT,
    details_changed_at TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX groups_event_id ON groups (event_id);

  CREATE TABLE participants (
    id INTEGER PRIMARY KEY,
    group_id INTEGER NOT NULL REFERENCES groups (id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    email TEXT,
    language TEXT NOT NULL,
    token TEXT NOT NULL UNIQUE,
    receiver_id INTEGER REFERENCES participants (id) ON DELETE SET NULL,
    wishes TEXT,
    wishes_updated_at TEXT,
    invited_at TEXT,
    visited_at TEXT,
    drawn_at TEXT,
    receiver_changed_at TEXT,
    printed_at TEXT,
    notify_giver_due_at TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX participants_group_id ON participants (group_id);
  CREATE INDEX participants_receiver_id ON participants (receiver_id);

  CREATE TABLE outbox (
    id INTEGER PRIMARY KEY,
    participant_id INTEGER NOT NULL REFERENCES participants (id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    manual INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'pending'
      CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'gaveup')),
    attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TEXT NOT NULL,
    error_code TEXT,
    created_at TEXT NOT NULL,
    sent_at TEXT
  );
  CREATE INDEX outbox_status_next_attempt_at ON outbox (status, next_attempt_at);
  CREATE INDEX outbox_participant_id ON outbox (participant_id);
  `,
  // Wish form sections and the pet list; NULL means every default.
  'ALTER TABLE events ADD COLUMN form_config TEXT;',
  `
  ALTER TABLE events ADD COLUMN signup_deadline TEXT;
  ALTER TABLE events ADD COLUMN signup_sent_at TEXT;
  ALTER TABLE events ADD COLUMN signup_closed_at TEXT;
  ALTER TABLE events ADD COLUMN signup_done_at TEXT;
  ALTER TABLE participants ADD COLUMN signup TEXT CHECK (signup IN ('yes', 'no'));
  ALTER TABLE participants ADD COLUMN signup_at TEXT;
  ALTER TABLE participants ADD COLUMN signup_invited_at TEXT;
  `,
];

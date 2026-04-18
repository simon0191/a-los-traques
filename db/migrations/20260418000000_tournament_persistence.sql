-- migrate:up
ALTER TABLE profiles ADD COLUMN tournament_wins INTEGER DEFAULT 0;

CREATE TABLE active_sessions (
    id TEXT PRIMARY KEY,
    host_user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    status TEXT DEFAULT 'open' CHECK (status IN ('open', 'completed'))
);

CREATE TABLE session_participants (
    session_id TEXT NOT NULL REFERENCES active_sessions(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    joined_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (session_id, user_id)
);

-- migrate:down
DROP TABLE IF EXISTS session_participants;
DROP TABLE IF EXISTS active_sessions;
ALTER TABLE profiles DROP COLUMN IF EXISTS tournament_wins;

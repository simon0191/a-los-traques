-- migrate:up
CREATE TABLE fights (
    id UUID PRIMARY KEY,
    room_id TEXT NOT NULL,
    p1_user_id UUID REFERENCES profiles(id),
    p2_user_id UUID REFERENCES profiles(id),
    p1_fighter TEXT NOT NULL,
    p2_fighter TEXT NOT NULL,
    stage_id TEXT NOT NULL,
    started_at TIMESTAMPTZ DEFAULT NOW(),
    ended_at TIMESTAMPTZ,
    winner_slot SMALLINT,
    rounds_p1 SMALLINT DEFAULT 0,
    rounds_p2 SMALLINT DEFAULT 0,
    has_debug_bundle BOOLEAN DEFAULT FALSE,
    debug_bundle_expires_at TIMESTAMPTZ
);

CREATE INDEX idx_fights_started_at ON fights (started_at DESC);
CREATE INDEX idx_fights_debug ON fights (has_debug_bundle) WHERE has_debug_bundle = TRUE;

-- migrate:down
DROP TABLE IF EXISTS fights;

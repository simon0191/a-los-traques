-- migrate:up
CREATE TABLE tournament_matches (
    session_id TEXT NOT NULL REFERENCES active_sessions(id) ON DELETE CASCADE,
    round_index INTEGER NOT NULL,
    match_index INTEGER NOT NULL,
    winner_id UUID,
    loser_id UUID,
    reported_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (session_id, round_index, match_index)
);

CREATE INDEX idx_tournament_matches_session ON tournament_matches (session_id);

-- migrate:down
DROP TABLE IF EXISTS tournament_matches;

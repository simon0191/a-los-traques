-- migrate:up
CREATE TABLE profiles (
    id UUID PRIMARY KEY,
    nickname TEXT UNIQUE,
    wins INTEGER DEFAULT 0,
    losses INTEGER DEFAULT 0,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- migrate:down
DROP TABLE profiles;

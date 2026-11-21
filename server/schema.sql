CREATE TABLE IF NOT EXISTS teams (
  id SERIAL PRIMARY KEY,
  team_number INTEGER UNIQUE NOT NULL,
  name TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS matches (
  id SERIAL PRIMARY KEY,
  event_name TEXT NOT NULL DEFAULT 'BioBuzz',
  season TEXT NOT NULL DEFAULT '2026-27',
  match_number INTEGER NOT NULL,
  red_1 INTEGER,
  red_2 INTEGER,
  blue_1 INTEGER,
  blue_2 INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(event_name, season, match_number)
);

CREATE TABLE IF NOT EXISTS scouts (
  id SERIAL PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS scouting_records (
  id SERIAL PRIMARY KEY,
  event_name TEXT NOT NULL DEFAULT 'BioBuzz',
  season TEXT NOT NULL DEFAULT '2026-27',
  match_number INTEGER NOT NULL,
  team_id INTEGER NOT NULL,
  alliance TEXT NOT NULL CHECK (alliance IN ('RED','BLUE')),
  scout_name TEXT,
  pollen_auto INTEGER NOT NULL DEFAULT 0,
  nectar_auto INTEGER NOT NULL DEFAULT 0,
  tips_auto INTEGER NOT NULL DEFAULT 0,
  pollen_teleop INTEGER NOT NULL DEFAULT 0,
  nectar_teleop INTEGER NOT NULL DEFAULT 0,
  tips_teleop INTEGER NOT NULL DEFAULT 0,
  flower BOOLEAN NOT NULL DEFAULT FALSE,
  turret BOOLEAN NOT NULL DEFAULT FALSE,
  climber TEXT NOT NULL DEFAULT 'None',
  endgame TEXT NOT NULL DEFAULT 'None',
  rp INTEGER NOT NULL DEFAULT 0,
  result TEXT NOT NULL DEFAULT 'Unknown',
  driver_rating INTEGER NOT NULL DEFAULT 3,
  scoring_rating INTEGER NOT NULL DEFAULT 3,
  defense_rating INTEGER NOT NULL DEFAULT 3,
  reliability_rating INTEGER NOT NULL DEFAULT 3,
  notes TEXT,
  tags TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_scouting_team ON scouting_records(team_id);
CREATE INDEX IF NOT EXISTS idx_scouting_match ON scouting_records(match_number);
CREATE INDEX IF NOT EXISTS idx_scouting_event ON scouting_records(event_name, season);

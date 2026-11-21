import express from "express";
import pg from "pg";

const { Pool } = pg;
const app = express();
app.use(express.json({ limit: "1mb" }));

// Vercel routes this catch-all function under /api/*.
app.use((req, _res, next) => {
  if (req.url.startsWith("/api/")) req.url = req.url.slice(4);
  next();
});

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 1,
  idleTimeoutMillis: 10000,
  connectionTimeoutMillis: 10000
});

let schemaReady;
async function ensureSchema() {
  if (!schemaReady) {
    schemaReady = pool.query(`
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
        driver_rating INTEGER NOT NULL DEFAULT 0,
        scoring_rating INTEGER NOT NULL DEFAULT 0,
        defense_rating INTEGER NOT NULL DEFAULT 0,
        reliability_rating INTEGER NOT NULL DEFAULT 0,
        notes TEXT,
        tags TEXT[] NOT NULL DEFAULT '{}',
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_scouting_team ON scouting_records(team_id);
      CREATE INDEX IF NOT EXISTS idx_scouting_match ON scouting_records(match_number);
    `).catch(error => {
      schemaReady = undefined;
      throw error;
    });
  }
  await schemaReady;
}

app.get("/health", async (_req, res) => {
  try {
    await ensureSchema();
    await pool.query("SELECT 1");
    res.json({ ok: true, database: "connected" });
  } catch (error) {
    res.status(500).json({ ok: false, error: "Database connection failed" });
  }
});

app.get("/teams", async (_req, res) => {
  try {
    await ensureSchema();
    const result = await pool.query(`
      SELECT team_id AS id, COUNT(*) AS matches,
      ROUND(AVG(pollen_auto + pollen_teleop + nectar_auto + nectar_teleop), 1) AS avg_score
      FROM scouting_records GROUP BY team_id ORDER BY avg_score DESC
    `);
    res.json(result.rows);
  } catch {
    res.status(500).json({ error: "Could not load teams" });
  }
});

app.get("/analytics", async (_req, res) => {
  try {
    await ensureSchema();
    const result = await pool.query(`
      SELECT COUNT(*)::int AS matches, COUNT(DISTINCT team_id)::int AS teams,
      COALESCE(ROUND(AVG(pollen_auto + pollen_teleop + nectar_auto + nectar_teleop), 1), 0) AS avg_score,
      COALESCE(ROUND(AVG(rp), 1), 0) AS avg_rp
      FROM scouting_records
    `);
    res.json(result.rows[0]);
  } catch {
    res.status(500).json({ error: "Could not load analytics" });
  }
});

app.get("/leaderboard", async (_req, res) => {
  try {
    await ensureSchema();
    const result = await pool.query(`
      SELECT team_id AS id,
      ROUND(AVG(pollen_auto + pollen_teleop + nectar_auto + nectar_teleop), 1) AS score,
      ROUND(AVG(pollen_auto + nectar_auto), 1) AS auto,
      ROUND(AVG(pollen_teleop + nectar_teleop), 1) AS teleop,
      ROUND(AVG(rp), 1) AS rp,
      ROUND(AVG(reliability_rating), 1) AS reliability
      FROM scouting_records GROUP BY team_id ORDER BY score DESC
    `);
    res.json(result.rows);
  } catch {
    res.status(500).json({ error: "Could not load leaderboard" });
  }
});

app.get("/matches", async (_req, res) => {
  try {
    await ensureSchema();
    const result = await pool.query(
      "SELECT DISTINCT match_number FROM scouting_records ORDER BY match_number"
    );
    res.json(result.rows);
  } catch {
    res.status(500).json({ error: "Could not load matches" });
  }
});

app.post("/scouting", async (req, res) => {
  try {
    await ensureSchema();
    const d = req.body || {};
    const matchNumber = Number(d.match_number);
    const teamNumber = Number(d.team_id);
    if (!Number.isInteger(matchNumber) || matchNumber < 1 ||
        !Number.isInteger(teamNumber) || teamNumber < 1 ||
        !["RED", "BLUE"].includes(d.alliance)) {
      return res.status(400).json({ error: "Valid match, team, and alliance are required." });
    }

    await pool.query(`
      INSERT INTO scouting_records (
        match_number, team_id, alliance, scout_name, event_name, season,
        pollen_auto, nectar_auto, tips_auto, pollen_teleop, nectar_teleop, tips_teleop,
        flower, turret, climber, endgame, rp, result,
        driver_rating, scoring_rating, defense_rating, reliability_rating, notes, tags
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,
        $13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24
      )
    `, [
      matchNumber, teamNumber, d.alliance, d.scout_name || null,
      d.event_name || "BioBuzz", d.season || "2026-27",
      Number(d.pollen_auto) || 0, Number(d.nectar_auto) || 0, Number(d.tips_auto) || 0,
      Number(d.pollen_teleop) || 0, Number(d.nectar_teleop) || 0, Number(d.tips_teleop) || 0,
      Boolean(d.flower), Boolean(d.turret), d.climber || "None", d.endgame || "None",
      Number(d.rp) || 0, d.result || "Unknown",
      Number(d.driver_rating) || 0, Number(d.scoring_rating) || 0,
      Number(d.defense_rating) || 0, Number(d.reliability_rating) || 0,
      d.notes || "", Array.isArray(d.tags) ? d.tags.map(String).slice(0, 30) : []
    ]);
    res.status(201).json({ ok: true });
  } catch {
    res.status(500).json({ error: "Could not save scouting record." });
  }
});

export default app;

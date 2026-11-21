import express from "express";
import pg from "pg";
import { auth, ensureAuthSchema, roleForEmail } from "../auth.js";
import { toNodeHandler, fromNodeHeaders } from "better-auth/node";
const { Pool } = pg;
const app = express();
const authHandler = toNodeHandler(auth);
app.use(async (req, res, next) => {
  const pathname = (req.url || "").split("?")[0];
  const isAuthPath =
    pathname === "/api/auth" ||
    pathname.startsWith("/api/auth/") ||
    pathname === "/auth" ||
    pathname.startsWith("/auth/");

  if (!isAuthPath) return next();

  // Vercel may pass the catch-all function a path with /api removed.
  // Better Auth expects its configured /api/auth base path.
  if (pathname === "/auth" || pathname.startsWith("/auth/")) {
    req.url = `/api${req.url}`;
  }

  try {
    await ensureAuthSchema();
    return authHandler(req, res, next);
  } catch (error) {
    return next(error);
  }
});

app.use((req, _res, next) => {
  if (req.url.startsWith("/api/")) req.url = req.url.slice(4);
  next();
});
app.use(express.json({limit:"1mb"}));
const pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false},max:1,idleTimeoutMillis:10000,connectionTimeoutMillis:10000});
let schemaReady;
async function ensureSchema(){
 if(!schemaReady)schemaReady=pool.query(`
 CREATE TABLE IF NOT EXISTS scouting_records(
 id SERIAL PRIMARY KEY,event_name TEXT NOT NULL DEFAULT 'BioBuzz',season TEXT NOT NULL DEFAULT '2026-27',
 match_number INTEGER NOT NULL,team_id INTEGER NOT NULL,alliance TEXT NOT NULL CHECK(alliance IN('RED','BLUE')),
 scout_name TEXT,pollen_auto INTEGER NOT NULL DEFAULT 0,nectar_auto INTEGER NOT NULL DEFAULT 0,tips_auto INTEGER NOT NULL DEFAULT 0,
 pollen_teleop INTEGER NOT NULL DEFAULT 0,nectar_teleop INTEGER NOT NULL DEFAULT 0,tips_teleop INTEGER NOT NULL DEFAULT 0,
 flower BOOLEAN NOT NULL DEFAULT FALSE,turret BOOLEAN NOT NULL DEFAULT FALSE,mecanum BOOLEAN NOT NULL DEFAULT FALSE,hood BOOLEAN NOT NULL DEFAULT FALSE,parking BOOLEAN NOT NULL DEFAULT FALSE,
 endgame TEXT NOT NULL DEFAULT 'None',rp INTEGER NOT NULL DEFAULT 0,result TEXT NOT NULL DEFAULT 'Unknown',
 driver_rating INTEGER NOT NULL DEFAULT 0,scoring_rating INTEGER NOT NULL DEFAULT 0,defense_rating INTEGER NOT NULL DEFAULT 0,
 reliability_rating INTEGER NOT NULL DEFAULT 0,notes TEXT,tags TEXT[] NOT NULL DEFAULT '{}',created_by_email TEXT,created_at TIMESTAMPTZ DEFAULT NOW());
 ALTER TABLE scouting_records ADD COLUMN IF NOT EXISTS created_by_email TEXT;
 ALTER TABLE scouting_records ADD COLUMN IF NOT EXISTS mecanum BOOLEAN NOT NULL DEFAULT FALSE;
 ALTER TABLE scouting_records ADD COLUMN IF NOT EXISTS hood BOOLEAN NOT NULL DEFAULT FALSE;
 ALTER TABLE scouting_records ADD COLUMN IF NOT EXISTS parking BOOLEAN NOT NULL DEFAULT FALSE;
 CREATE INDEX IF NOT EXISTS idx_scouting_team ON scouting_records(team_id);
 CREATE INDEX IF NOT EXISTS idx_scouting_match ON scouting_records(match_number);
 CREATE INDEX IF NOT EXISTS idx_scouting_owner ON scouting_records(created_by_email);
 CREATE TABLE IF NOT EXISTS activity_logs(id BIGSERIAL PRIMARY KEY,actor_email TEXT NOT NULL,action TEXT NOT NULL,entity_type TEXT NOT NULL,entity_id TEXT,details JSONB,created_at TIMESTAMPTZ DEFAULT NOW());
 CREATE INDEX IF NOT EXISTS idx_activity_logs_created ON activity_logs(created_at DESC);
 `).catch(e=>{schemaReady=undefined;throw e;});
 await schemaReady;
}
async function requireUser(req,res,next){
 try {
  await ensureAuthSchema();
  const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
  const email = String(session?.user?.email || "").trim().toLowerCase();
  const role = roleForEmail(email);
  if (!email || !role) return res.status(401).json({error:"Sign in with an approved Google account to continue."});
  req.user={email,role,name:session.user.name||email,id:session.user.id};
  next();
 } catch (error) {
  next(error);
 }
}
app.use(requireUser);
app.get("/me",async(req,res)=>{try{const r=await pool.query('SELECT name,image FROM "user" WHERE lower(email)=lower($1) LIMIT 1',[req.user.email]);res.json({...req.user,name:r.rows[0]?.name||req.user.name,image:r.rows[0]?.image||null});}catch{res.status(500).json({error:"Could not load account."});}});
app.patch("/profile",async(req,res)=>{try{await ensureSchema();const name=String(req.body?.name||"").trim(),image=String(req.body?.image||"");if(name.length<2||name.length>60)return res.status(400).json({error:"Display name must be 2-60 characters."});if(image&&(!image.startsWith("data:image/")||image.length>500000))return res.status(400).json({error:"Image must be under 350 KB."});await pool.query('UPDATE "user" SET name=$1,image=$2,"updatedAt"=NOW() WHERE lower(email)=lower($3)',[name,image||null,req.user.email]);await pool.query("INSERT INTO activity_logs(actor_email,action,entity_type) VALUES($1,$2,$3)",[req.user.email,"profile_updated","account"]);res.json({ok:true,name,image:image||null});}catch{res.status(500).json({error:"Could not update account."});}});
app.get("/my-history",async(req,res)=>{try{const r=await pool.query("SELECT id,match_number,team_id,alliance,result,created_at FROM scouting_records WHERE lower(created_by_email)=lower($1) ORDER BY created_at DESC LIMIT 100",[req.user.email]);res.json(r.rows);}catch{res.status(500).json({error:"Could not load your history."});}});
app.get("/logs",async(req,res)=>{if(req.user.role!=="mentor")return res.status(403).json({error:"Mentor access required."});try{const r=await pool.query("SELECT id,actor_email,action,entity_type,entity_id,details,created_at FROM activity_logs ORDER BY created_at DESC LIMIT 500");res.json(r.rows);}catch{res.status(500).json({error:"Could not load activity logs."});}});
app.get("/health",async(_req,res)=>{try{await ensureSchema();await pool.query("SELECT 1");res.json({ok:true,database:"connected"});}catch{res.status(500).json({ok:false,error:"Database connection failed"});}});
app.get("/teams",async(_req,res)=>{try{await ensureSchema();const r=await pool.query("SELECT team_id AS id,COUNT(*) AS matches,ROUND(AVG(pollen_auto+pollen_teleop+nectar_auto+nectar_teleop),1) AS avg_score FROM scouting_records GROUP BY team_id ORDER BY avg_score DESC");res.json(r.rows);}catch{res.status(500).json({error:"Could not load teams"});}});
app.get("/analytics",async(_req,res)=>{try{await ensureSchema();const r=await pool.query("SELECT COUNT(*)::int AS matches,COUNT(DISTINCT team_id)::int AS teams,COALESCE(ROUND(AVG(pollen_auto+pollen_teleop+nectar_auto+nectar_teleop),1),0) AS avg_score,COALESCE(ROUND(AVG(rp),1),0) AS avg_rp FROM scouting_records");res.json(r.rows[0]);}catch{res.status(500).json({error:"Could not load analytics"});}});
app.get("/leaderboard",async(_req,res)=>{try{await ensureSchema();const r=await pool.query("SELECT team_id AS id,ROUND(AVG(pollen_auto+pollen_teleop+nectar_auto+nectar_teleop),1) AS score,ROUND(AVG(pollen_auto+nectar_auto),1) AS auto,ROUND(AVG(pollen_teleop+nectar_teleop),1) AS teleop,ROUND(AVG(rp),1) AS rp,ROUND(AVG(reliability_rating),1) AS reliability FROM scouting_records GROUP BY team_id ORDER BY score DESC");res.json(r.rows);}catch{res.status(500).json({error:"Could not load leaderboard"});}});
app.get("/matches",async(_req,res)=>{try{await ensureSchema();const r=await pool.query("SELECT DISTINCT match_number FROM scouting_records ORDER BY match_number");res.json(r.rows);}catch{res.status(500).json({error:"Could not load matches"});}});
app.get("/reports",async(req,res)=>{try{await ensureSchema();const q=String.fromCharCode(34);const sql="SELECT s.*, (s.created_by_email=$1 OR $2=$3) AS can_edit, u.name AS created_by_name, u.image AS created_by_image FROM scouting_records s LEFT JOIN "+q+"user"+q+" u ON lower(u.email)=lower(s.created_by_email) ORDER BY s.created_at DESC,s.id DESC LIMIT 500";const r=await pool.query(sql,[req.user.email,req.user.role,"mentor"]);res.json(r.rows);}catch{res.status(500).json({error:"Could not load reports"});}});
const fields=["match_number","team_id","alliance","scout_name","event_name","season","pollen_auto","nectar_auto","tips_auto","pollen_teleop","nectar_teleop","tips_teleop","flower","turret","mecanum","hood","parking","endgame","rp","result","driver_rating","scoring_rating","defense_rating","reliability_rating","notes","tags"];
function values(d){
 const match=Number(d.match_number),team=Number(d.team_id);
 if(!Number.isInteger(match)||match<1||!Number.isInteger(team)||team<1||!["RED","BLUE"].includes(d.alliance))throw Error("Valid match number, team number, and alliance are required.");
 const ns=fields.filter(k=>["match_number","team_id","pollen_auto","nectar_auto","tips_auto","pollen_teleop","nectar_teleop","tips_teleop","rp","driver_rating","scoring_rating","defense_rating","reliability_rating"].includes(k));
 for(const k of ns)if(d[k]!==undefined&&(!Number.isInteger(Number(d[k]))||Number(d[k])<0))throw Error("Invalid value for "+k+".");
 return [match,team,d.alliance,String(d.scout_name||"").slice(0,100)||null,String(d.event_name||"BioBuzz").slice(0,120),String(d.season||"2026-27").slice(0,30),Number(d.pollen_auto)||0,Number(d.nectar_auto)||0,Number(d.tips_auto)||0,Number(d.pollen_teleop)||0,Number(d.nectar_teleop)||0,Number(d.tips_teleop)||0,Boolean(d.flower),Boolean(d.turret),Boolean(d.mecanum),Boolean(d.hood),Boolean(d.parking),String(d.endgame||"None").slice(0,60),Number(d.rp)||0,String(d.result||"Unknown").slice(0,30),Number(d.driver_rating)||0,Number(d.scoring_rating)||0,Number(d.defense_rating)||0,Number(d.reliability_rating)||0,String(d.notes||"").slice(0,5000),Array.isArray(d.tags)?d.tags.map(String).slice(0,30):[]];
}
const cols=fields.join(",");
app.post("/scouting",async(req,res)=>{try{await ensureSchema();const v=values(req.body||{}),p=v.map((_,i)=>"$"+(i+1)).join(",");const saved=await pool.query("INSERT INTO scouting_records("+cols+",created_by_email) VALUES("+p+",$"+(v.length+1)+") RETURNING id",[...v,req.user.email]);await pool.query("INSERT INTO activity_logs(actor_email,action,entity_type,entity_id) VALUES($1,$2,$3,$4)",[req.user.email,"report_published","scouting_report",String(saved.rows[0].id)]);res.status(201).json({ok:true});}catch(e){res.status(400).json({error:e.message||"Could not save report."});}});
app.put("/scouting/:id",async(req,res)=>{try{await ensureSchema();const id=Number(req.params.id);if(!Number.isInteger(id)||id<1)return res.status(400).json({error:"Invalid report ID."});const old=await pool.query("SELECT created_by_email FROM scouting_records WHERE id=$1",[id]);if(!old.rowCount)return res.status(404).json({error:"Report not found."});if(req.user.role!=="mentor"&&old.rows[0].created_by_email!==req.user.email)return res.status(403).json({error:"Students can only edit their own reports."});const v=values(req.body||{}),set=fields.map((k,i)=>k+"=$"+(i+1)).join(",");await pool.query("UPDATE scouting_records SET "+set+" WHERE id=$"+(v.length+1),[...v,id]);await pool.query("INSERT INTO activity_logs(actor_email,action,entity_type,entity_id) VALUES($1,$2,$3,$4)",[req.user.email,"report_updated","scouting_report",String(id)]);res.json({ok:true});}catch(e){res.status(400).json({error:e.message||"Could not update report."});}});
export default app;

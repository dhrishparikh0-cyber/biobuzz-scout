import express from "express";
import pg from "pg";
import { toNodeHandler } from "better-auth/node";
import { auth, roleForEmail } from "../auth.js";
const { Pool } = pg;
const app = express();
app.use((req,_res,next)=>{if(req.url.startsWith("/api/"))req.url=req.url.slice(4);next();});
app.all("/auth/*splat",toNodeHandler(auth));
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
 flower BOOLEAN NOT NULL DEFAULT FALSE,turret BOOLEAN NOT NULL DEFAULT FALSE,climber TEXT NOT NULL DEFAULT 'None',
 endgame TEXT NOT NULL DEFAULT 'None',rp INTEGER NOT NULL DEFAULT 0,result TEXT NOT NULL DEFAULT 'Unknown',
 driver_rating INTEGER NOT NULL DEFAULT 0,scoring_rating INTEGER NOT NULL DEFAULT 0,defense_rating INTEGER NOT NULL DEFAULT 0,
 reliability_rating INTEGER NOT NULL DEFAULT 0,notes TEXT,tags TEXT[] NOT NULL DEFAULT '{}',created_by_email TEXT,created_at TIMESTAMPTZ DEFAULT NOW());
 ALTER TABLE scouting_records ADD COLUMN IF NOT EXISTS created_by_email TEXT;
 CREATE INDEX IF NOT EXISTS idx_scouting_team ON scouting_records(team_id);
 CREATE INDEX IF NOT EXISTS idx_scouting_match ON scouting_records(match_number);
 CREATE INDEX IF NOT EXISTS idx_scouting_owner ON scouting_records(created_by_email);
 `).catch(e=>{schemaReady=undefined;throw e;});
 await schemaReady;
}
async function requireUser(req,res,next){
 try{
  const session=await auth.api.getSession({headers:req.headers});
  if(!session?.user?.email)return res.status(401).json({error:"Please sign in to continue."});
  const email=session.user.email.trim().toLowerCase(),role=roleForEmail(email);
  if(!role)return res.status(403).json({error:"This email is not approved for BioBuzz Scout."});
  req.user={email,role,name:session.user.name||email};next();
 }catch(e){console.error("Session validation failed",e);res.status(401).json({error:"Your session could not be verified. Please sign in again."});}
}
app.use((req,res,next)=>{if(req.path.startsWith("/auth/"))return next();requireUser(req,res,next);});
app.get("/me",(req,res)=>res.json(req.user));
app.get("/health",async(_req,res)=>{try{await ensureSchema();await pool.query("SELECT 1");res.json({ok:true,database:"connected"});}catch{res.status(500).json({ok:false,error:"Database connection failed"});}});
app.get("/teams",async(_req,res)=>{try{await ensureSchema();const r=await pool.query("SELECT team_id AS id,COUNT(*) AS matches,ROUND(AVG(pollen_auto+pollen_teleop+nectar_auto+nectar_teleop),1) AS avg_score FROM scouting_records GROUP BY team_id ORDER BY avg_score DESC");res.json(r.rows);}catch{res.status(500).json({error:"Could not load teams"});}});
app.get("/analytics",async(_req,res)=>{try{await ensureSchema();const r=await pool.query("SELECT COUNT(*)::int AS matches,COUNT(DISTINCT team_id)::int AS teams,COALESCE(ROUND(AVG(pollen_auto+pollen_teleop+nectar_auto+nectar_teleop),1),0) AS avg_score,COALESCE(ROUND(AVG(rp),1),0) AS avg_rp FROM scouting_records");res.json(r.rows[0]);}catch{res.status(500).json({error:"Could not load analytics"});}});
app.get("/leaderboard",async(_req,res)=>{try{await ensureSchema();const r=await pool.query("SELECT team_id AS id,ROUND(AVG(pollen_auto+pollen_teleop+nectar_auto+nectar_teleop),1) AS score,ROUND(AVG(pollen_auto+nectar_auto),1) AS auto,ROUND(AVG(pollen_teleop+nectar_teleop),1) AS teleop,ROUND(AVG(rp),1) AS rp,ROUND(AVG(reliability_rating),1) AS reliability FROM scouting_records GROUP BY team_id ORDER BY score DESC");res.json(r.rows);}catch{res.status(500).json({error:"Could not load leaderboard"});}});
app.get("/matches",async(_req,res)=>{try{await ensureSchema();const r=await pool.query("SELECT DISTINCT match_number FROM scouting_records ORDER BY match_number");res.json(r.rows);}catch{res.status(500).json({error:"Could not load matches"});}});
app.get("/reports",async(req,res)=>{try{await ensureSchema();const r=await pool.query("SELECT *, (created_by_email=$1 OR $2='mentor') AS can_edit FROM scouting_records ORDER BY created_at DESC,id DESC LIMIT 500",[req.user.email,req.user.role]);res.json(r.rows);}catch{res.status(500).json({error:"Could not load reports"});}});
const fields=["match_number","team_id","alliance","scout_name","event_name","season","pollen_auto","nectar_auto","tips_auto","pollen_teleop","nectar_teleop","tips_teleop","flower","turret","climber","endgame","rp","result","driver_rating","scoring_rating","defense_rating","reliability_rating","notes","tags"];
function values(d){
 const match=Number(d.match_number),team=Number(d.team_id);
 if(!Number.isInteger(match)||match<1||!Number.isInteger(team)||team<1||!["RED","BLUE"].includes(d.alliance))throw Error("Valid match number, team number, and alliance are required.");
 const ns=fields.filter(k=>["match_number","team_id","pollen_auto","nectar_auto","tips_auto","pollen_teleop","nectar_teleop","tips_teleop","rp","driver_rating","scoring_rating","defense_rating","reliability_rating"].includes(k));
 for(const k of ns)if(d[k]!==undefined&&(!Number.isInteger(Number(d[k]))||Number(d[k])<0))throw Error("Invalid value for "+k+".");
 return [match,team,d.alliance,String(d.scout_name||"").slice(0,100)||null,String(d.event_name||"BioBuzz").slice(0,120),String(d.season||"2026-27").slice(0,30),Number(d.pollen_auto)||0,Number(d.nectar_auto)||0,Number(d.tips_auto)||0,Number(d.pollen_teleop)||0,Number(d.nectar_teleop)||0,Number(d.tips_teleop)||0,Boolean(d.flower),Boolean(d.turret),String(d.climber||"None").slice(0,40),String(d.endgame||"None").slice(0,60),Number(d.rp)||0,String(d.result||"Unknown").slice(0,30),Number(d.driver_rating)||0,Number(d.scoring_rating)||0,Number(d.defense_rating)||0,Number(d.reliability_rating)||0,String(d.notes||"").slice(0,5000),Array.isArray(d.tags)?d.tags.map(String).slice(0,30):[]];
}
const cols=fields.join(",");
app.post("/scouting",async(req,res)=>{try{await ensureSchema();const v=values(req.body||{}),p=v.map((_,i)=>"$"+(i+1)).join(",");await pool.query("INSERT INTO scouting_records("+cols+",created_by_email) VALUES("+p+",$"+(v.length+1)+")",[...v,req.user.email]);res.status(201).json({ok:true});}catch(e){res.status(400).json({error:e.message||"Could not save report."});}});
app.put("/scouting/:id",async(req,res)=>{try{await ensureSchema();const id=Number(req.params.id);if(!Number.isInteger(id)||id<1)return res.status(400).json({error:"Invalid report ID."});const old=await pool.query("SELECT created_by_email FROM scouting_records WHERE id=$1",[id]);if(!old.rowCount)return res.status(404).json({error:"Report not found."});if(req.user.role!=="mentor"&&old.rows[0].created_by_email!==req.user.email)return res.status(403).json({error:"Students can only edit their own reports."});const v=values(req.body||{}),set=fields.map((k,i)=>k+"=$"+(i+1)).join(",");await pool.query("UPDATE scouting_records SET "+set+" WHERE id=$"+(v.length+1),[...v,id]);res.json({ok:true});}catch(e){res.status(400).json({error:e.message||"Could not update report."});}});
export default app;

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
 CREATE TABLE IF NOT EXISTS scouting_events(id SERIAL PRIMARY KEY,name TEXT NOT NULL,season TEXT NOT NULL DEFAULT '2026-27',event_code TEXT,location TEXT,start_date DATE,end_date DATE,status TEXT NOT NULL DEFAULT 'upcoming',created_by_email TEXT,created_at TIMESTAMPTZ DEFAULT NOW());
 CREATE TABLE IF NOT EXISTS event_matches(id SERIAL PRIMARY KEY,event_id INTEGER NOT NULL REFERENCES scouting_events(id) ON DELETE CASCADE,match_type TEXT NOT NULL DEFAULT 'Q' CHECK(match_type IN('S','Q','P','F','PRACTICE')),match_number INTEGER NOT NULL,match_label TEXT NOT NULL,scheduled_at TIMESTAMPTZ,red_teams INTEGER[] NOT NULL DEFAULT '{}',blue_teams INTEGER[] NOT NULL DEFAULT '{}',created_at TIMESTAMPTZ DEFAULT NOW(),UNIQUE(event_id,match_type,match_number));
 ALTER TABLE scouting_records ADD COLUMN IF NOT EXISTS event_id INTEGER REFERENCES scouting_events(id) ON DELETE SET NULL;
 ALTER TABLE scouting_records ADD COLUMN IF NOT EXISTS match_type TEXT NOT NULL DEFAULT 'Q';
 ALTER TABLE scouting_records ADD COLUMN IF NOT EXISTS match_label TEXT;
 ALTER TABLE event_matches DROP CONSTRAINT IF EXISTS event_matches_match_type_check;
 ALTER TABLE event_matches ADD CONSTRAINT event_matches_match_type_check CHECK(match_type IN('S','Q','P','F','PRACTICE'));
 CREATE INDEX IF NOT EXISTS idx_event_matches_event ON event_matches(event_id,match_type,match_number);

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
app.get("/logs",async(req,res)=>{if(req.user.role!=="mentor")return res.status(403).json({error:"Mentor access required."});try{await ensureSchema();const q=String.fromCharCode(34);const sql="SELECT l.id,l.actor_email,l.action,l.entity_type,l.entity_id,l.details,l.created_at,u.name AS actor_name FROM activity_logs l LEFT JOIN "+q+"user"+q+" u ON lower(u.email)=lower(l.actor_email) ORDER BY l.created_at DESC LIMIT 1000";const r=await pool.query(sql);res.json(r.rows);}catch{res.status(500).json({error:"Could not load activity logs."});}});
app.get("/health",async(_req,res)=>{try{await ensureSchema();await pool.query("SELECT 1");res.json({ok:true,database:"connected"});}catch{res.status(500).json({ok:false,error:"Database connection failed"});}});
app.get("/teams",async(_req,res)=>{try{await ensureSchema();const r=await pool.query("SELECT team_id AS id,COUNT(*) AS matches,ROUND(AVG(pollen_auto+pollen_teleop+nectar_auto+nectar_teleop),1) AS avg_score FROM scouting_records GROUP BY team_id ORDER BY avg_score DESC");res.json(r.rows);}catch{res.status(500).json({error:"Could not load teams"});}});
app.get("/analytics",async(_req,res)=>{try{await ensureSchema();const r=await pool.query("SELECT COUNT(*)::int AS matches,COUNT(DISTINCT team_id)::int AS teams,COALESCE(ROUND(AVG(pollen_auto+pollen_teleop+nectar_auto+nectar_teleop),1),0) AS avg_score,COALESCE(ROUND(AVG(rp),1),0) AS avg_rp FROM scouting_records");res.json(r.rows[0]);}catch{res.status(500).json({error:"Could not load analytics"});}});
app.get("/leaderboard",async(_req,res)=>{try{await ensureSchema();const r=await pool.query("SELECT team_id AS id,ROUND(AVG(pollen_auto+pollen_teleop+nectar_auto+nectar_teleop),1) AS score,ROUND(AVG(pollen_auto+nectar_auto),1) AS auto,ROUND(AVG(pollen_teleop+nectar_teleop),1) AS teleop,ROUND(AVG(rp),1) AS rp,ROUND(AVG(reliability_rating),1) AS reliability FROM scouting_records GROUP BY team_id ORDER BY score DESC");res.json(r.rows);}catch{res.status(500).json({error:"Could not load leaderboard"});}});
app.get("/matches",async(_req,res)=>{try{await ensureSchema();const r=await pool.query("SELECT DISTINCT match_number FROM scouting_records ORDER BY match_number");res.json(r.rows);}catch{res.status(500).json({error:"Could not load matches"});}});
app.get("/reports",async(req,res)=>{try{await ensureSchema();const q=String.fromCharCode(34);const sql="SELECT s.*, (s.created_by_email=$1 OR $2=$3) AS can_edit, u.name AS created_by_name, u.image AS created_by_image FROM scouting_records s LEFT JOIN "+q+"user"+q+" u ON lower(u.email)=lower(s.created_by_email) ORDER BY s.created_at DESC,s.id DESC LIMIT 500";const r=await pool.query(sql,[req.user.email,req.user.role,"mentor"]);res.json(r.rows);}catch{res.status(500).json({error:"Could not load reports"});}});
app.get("/teams/:id/reports",async(req,res)=>{try{await ensureSchema();const team=Number(req.params.id);if(!Number.isInteger(team)||team<1)return res.status(400).json({error:"Invalid team number."});const q=String.fromCharCode(34);const sql="SELECT s.*,u.name AS created_by_name,u.image AS created_by_image FROM scouting_records s LEFT JOIN "+q+"user"+q+" u ON lower(u.email)=lower(s.created_by_email) WHERE s.team_id=$1 ORDER BY s.match_number ASC,s.created_at ASC,s.id ASC";const r=await pool.query(sql,[team]);res.json(r.rows);}catch{res.status(500).json({error:"Could not load team history."});}});

app.get("/events",async(_req,res)=>{try{await ensureSchema();const r=await pool.query("SELECT e.*,COUNT(m.id)::int AS match_count FROM scouting_events e LEFT JOIN event_matches m ON m.event_id=e.id GROUP BY e.id ORDER BY e.start_date DESC NULLS LAST,e.id DESC");res.json(r.rows);}catch{res.status(500).json({error:"Could not load events."});}});
app.post("/events",async(req,res)=>{if(req.user.role!=="mentor")return res.status(403).json({error:"Mentor access required."});try{await ensureSchema();const name=String(req.body?.name||"").trim(),season=String(req.body?.season||"2026-27").trim(),code=String(req.body?.event_code||"").trim(),location=String(req.body?.location||"").trim();if(name.length<2||name.length>120)return res.status(400).json({error:"Event name must be 2-120 characters."});const r=await pool.query("INSERT INTO scouting_events(name,season,event_code,location,start_date,end_date,created_by_email) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *",[name,season.slice(0,30),code.slice(0,30)||null,location.slice(0,120)||null,req.body.start_date||null,req.body.end_date||null,req.user.email]);await pool.query("INSERT INTO activity_logs(actor_email,action,entity_type,entity_id,details) VALUES($1,$2,$3,$4,$5::jsonb)",[req.user.email,"event_created","event",String(r.rows[0].id),JSON.stringify({name,season,code})]);res.status(201).json(r.rows[0]);}catch(e){res.status(400).json({error:e.message||"Could not create event."});}});
app.get("/events/:id/matches",async(req,res)=>{try{await ensureSchema();const id=Number(req.params.id);if(!Number.isInteger(id)||id<1)return res.status(400).json({error:"Invalid event."});const availableOnly=req.query.available==="1";const sql="SELECT m.*,COUNT(DISTINCT s.team_id)::int AS scouted_teams FROM event_matches m LEFT JOIN scouting_records s ON s.event_id=m.event_id AND s.match_label=m.match_label WHERE m.event_id=$1 GROUP BY m.id "+(availableOnly?"HAVING COUNT(DISTINCT s.team_id)<4 ":"")+"ORDER BY CASE m.match_type WHEN 'PRACTICE' THEN 0 WHEN 'S' THEN 1 WHEN 'Q' THEN 2 WHEN 'P' THEN 3 ELSE 4 END,m.match_number";const r=await pool.query(sql,[id]);res.json(r.rows);}catch{res.status(500).json({error:"Could not load event matches."});}});
app.post("/events/:id/matches",async(req,res)=>{if(req.user.role!=="mentor")return res.status(403).json({error:"Mentor access required."});try{await ensureSchema();const eventId=Number(req.params.id),matchNumber=Number(req.body?.match_number),type=String(req.body?.match_type||"Q").toUpperCase();if(!["S","Q","P","F","PRACTICE"].includes(type)||!Number.isInteger(matchNumber)||matchNumber<1)return res.status(400).json({error:"Choose a valid match type and positive match number."});const label=type==="PRACTICE"?"Practice "+matchNumber:type+matchNumber;const red=(Array.isArray(req.body.red_teams)?req.body.red_teams:[]).map(Number).filter(n=>Number.isInteger(n)&&n>0),blue=(Array.isArray(req.body.blue_teams)?req.body.blue_teams:[]).map(Number).filter(n=>Number.isInteger(n)&&n>0);if(red.length!==2||blue.length!==2)return res.status(400).json({error:"Every match must have exactly two Red and two Blue teams."});const r=await pool.query("INSERT INTO event_matches(event_id,match_type,match_number,match_label,scheduled_at,red_teams,blue_teams) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(event_id,match_type,match_number) DO UPDATE SET match_label=EXCLUDED.match_label,scheduled_at=EXCLUDED.scheduled_at,red_teams=EXCLUDED.red_teams,blue_teams=EXCLUDED.blue_teams RETURNING *",[eventId,type,matchNumber,label,req.body.scheduled_at||null,red,blue]);await pool.query("INSERT INTO activity_logs(actor_email,action,entity_type,entity_id,details) VALUES($1,$2,$3,$4,$5::jsonb)",[req.user.email,"schedule_match_saved","event_match",String(r.rows[0].id),JSON.stringify({event_id:eventId,match_label:label,red_teams:red,blue_teams:blue})]);res.status(201).json(r.rows[0]);}catch(e){res.status(400).json({error:e.message||"Could not save match."});}});
app.post("/events/:id/import",async(req,res)=>{if(req.user.role!=="mentor")return res.status(403).json({error:"Mentor access required."});try{await ensureSchema();const eventId=Number(req.params.id),items=Array.isArray(req.body?.matches)?req.body.matches:[];if(!items.length||items.length>2000)return res.status(400).json({error:"Import between 1 and 2,000 matches."});const client=await pool.connect();let count=0;try{await client.query("BEGIN");for(let rowIndex=0;rowIndex<items.length;rowIndex++){const item=items[rowIndex],type=String(item.match_type||"S").toUpperCase(),n=Number(item.match_number);if(!["S","Q","P","F","PRACTICE"].includes(type)||!Number.isInteger(n)||n<1)throw Error("Invalid match type or number on CSV row "+(rowIndex+2)+".");const label=type==="PRACTICE"?"Practice "+n:type+n;const parseTeams=v=>(Array.isArray(v)?v:String(v||"").split(/[;,| ]+/)).map(Number).filter(x=>Number.isInteger(x)&&x>0);const red=parseTeams(item.red_teams),blue=parseTeams(item.blue_teams);if(red.length!==2||blue.length!==2)throw Error("CSV row "+(rowIndex+2)+" must contain exactly two Red and two Blue team numbers.");await client.query("INSERT INTO event_matches(event_id,match_type,match_number,match_label,scheduled_at,red_teams,blue_teams) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(event_id,match_type,match_number) DO UPDATE SET match_label=EXCLUDED.match_label,scheduled_at=EXCLUDED.scheduled_at,red_teams=EXCLUDED.red_teams,blue_teams=EXCLUDED.blue_teams",[eventId,type,n,label,item.scheduled_at||null,red,blue]);count++;}await client.query("COMMIT");}catch(e){await client.query("ROLLBACK");throw e;}finally{client.release();}await pool.query("INSERT INTO activity_logs(actor_email,action,entity_type,entity_id,details) VALUES($1,$2,$3,$4,$5::jsonb)",[req.user.email,"schedule_imported","event",String(eventId),JSON.stringify({imported:count})]);res.json({ok:true,imported:count});}catch(e){res.status(400).json({error:e.message||"Could not import schedule."});}});
const fields=["match_number","team_id","alliance","scout_name","event_id","match_type","match_label","event_name","season","pollen_auto","nectar_auto","tips_auto","pollen_teleop","nectar_teleop","tips_teleop","flower","turret","mecanum","hood","parking","endgame","rp","result","driver_rating","scoring_rating","defense_rating","reliability_rating","notes","tags"];
function values(d){
 const match=Number(d.match_number),team=Number(d.team_id);
 if(!Number.isInteger(match)||match<1||!Number.isInteger(team)||team<1||!["RED","BLUE"].includes(d.alliance))throw Error("Valid match number, team number, and alliance are required.");
 if(d.event_id!==undefined&&d.event_id!==null&&d.event_id!==""&&(!Number.isInteger(Number(d.event_id))||Number(d.event_id)<1))throw Error("Invalid event.");
 if(d.match_type!==undefined&&!["S","Q","P","F","PRACTICE"].includes(String(d.match_type).toUpperCase()))throw Error("Invalid match type.");
 const ns=fields.filter(k=>["match_number","team_id","pollen_auto","nectar_auto","tips_auto","pollen_teleop","nectar_teleop","tips_teleop","rp","driver_rating","scoring_rating","defense_rating","reliability_rating"].includes(k));
 for(const k of ns)if(d[k]!==undefined&&(!Number.isInteger(Number(d[k]))||Number(d[k])<0))throw Error("Invalid value for "+k+".");
 return [match,team,d.alliance,String(d.scout_name||"").slice(0,100)||null,d.event_id?Number(d.event_id):null,String(d.match_type||"Q").slice(0,10),String(d.match_label||"").slice(0,30)||null,String(d.event_name||"BioBuzz").slice(0,120),String(d.season||"2026-27").slice(0,30),Number(d.pollen_auto)||0,Number(d.nectar_auto)||0,Number(d.tips_auto)||0,Number(d.pollen_teleop)||0,Number(d.nectar_teleop)||0,Number(d.tips_teleop)||0,Boolean(d.flower),Boolean(d.turret),Boolean(d.mecanum),Boolean(d.hood),Boolean(d.parking),String(d.endgame||"None").slice(0,60),Number(d.rp)||0,String(d.result||"Unknown").slice(0,30),Number(d.driver_rating)||0,Number(d.scoring_rating)||0,Number(d.defense_rating)||0,Number(d.reliability_rating)||0,String(d.notes||"").slice(0,5000),Array.isArray(d.tags)?d.tags.map(String).slice(0,30):[]];
}
const cols=fields.join(",");
app.post("/scouting",async(req,res)=>{try{await ensureSchema();const v=values(req.body||{}),p=v.map((_,i)=>"$"+(i+1)).join(",");const saved=await pool.query("INSERT INTO scouting_records("+cols+",created_by_email) VALUES("+p+",$"+(v.length+1)+") RETURNING id",[...v,req.user.email]);await pool.query("INSERT INTO activity_logs(actor_email,action,entity_type,entity_id,details) VALUES($1,$2,$3,$4,$5::jsonb)",[req.user.email,"report_published","scouting_report",String(saved.rows[0].id),JSON.stringify({team_id:v[1],match_number:v[0],alliance:v[2]})]);res.status(201).json({ok:true});}catch(e){res.status(400).json({error:e.message||"Could not save report."});}});
app.put("/scouting/:id",async(req,res)=>{try{await ensureSchema();const id=Number(req.params.id);if(!Number.isInteger(id)||id<1)return res.status(400).json({error:"Invalid report ID."});const old=await pool.query("SELECT created_by_email FROM scouting_records WHERE id=$1",[id]);if(!old.rowCount)return res.status(404).json({error:"Report not found."});if(req.user.role!=="mentor"&&old.rows[0].created_by_email!==req.user.email)return res.status(403).json({error:"Students can only edit their own reports."});const v=values(req.body||{}),set=fields.map((k,i)=>k+"=$"+(i+1)).join(",");await pool.query("UPDATE scouting_records SET "+set+" WHERE id=$"+(v.length+1),[...v,id]);await pool.query("INSERT INTO activity_logs(actor_email,action,entity_type,entity_id,details) VALUES($1,$2,$3,$4,$5::jsonb)",[req.user.email,"report_updated","scouting_report",String(id),JSON.stringify({team_id:v[1],match_number:v[0],alliance:v[2]})]);res.json({ok:true});}catch(e){res.status(400).json({error:e.message||"Could not update report."});}});
app.delete("/scouting/:id",async(req,res)=>{if(req.user.role!=="mentor")return res.status(403).json({error:"Only mentors can delete reports."});try{await ensureSchema();const id=Number(req.params.id);if(!Number.isInteger(id)||id<1)return res.status(400).json({error:"Invalid report ID."});const r=await pool.query("DELETE FROM scouting_records WHERE id=$1 RETURNING id,team_id,match_number",[id]);if(!r.rowCount)return res.status(404).json({error:"Report not found."});await pool.query("INSERT INTO activity_logs(actor_email,action,entity_type,entity_id,details) VALUES($1,$2,$3,$4,$5::jsonb)",[req.user.email,"report_deleted","scouting_report",String(id),JSON.stringify({team_id:r.rows[0].team_id,match_number:r.rows[0].match_number})]);res.json({ok:true});}catch{res.status(500).json({error:"Could not delete report."});}});
export default app;

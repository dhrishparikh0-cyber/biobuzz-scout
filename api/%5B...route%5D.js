import express from "express";
import pg from "pg";
import { auth, ensureAuthSchema, roleForEmail } from "../auth.js";
import { toNodeHandler, fromNodeHeaders } from "better-auth/node";
const { Pool } = pg;
const app = express();
const authHandler = toNodeHandler(auth);

// Reconstruct the original API path when Vercel forwards through api/index.js.
app.use((req, _res, next) => {
  const forwarded = req.query?.path;
  if (typeof forwarded === "string" && forwarded.length) {
    const parsed = new URL(req.url || "/", "http://localhost");
    parsed.searchParams.delete("path");
    req.url = "/api/" + forwarded.replace(/^\/+/, "") + parsed.search;
  }
  next();
});
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
 leave BOOLEAN NOT NULL DEFAULT FALSE,auto_park BOOLEAN NOT NULL DEFAULT FALSE,teleop_park BOOLEAN NOT NULL DEFAULT FALSE,
 drivetrain TEXT NOT NULL DEFAULT 'Mecanum',cell_elements INTEGER NOT NULL DEFAULT 0,flower_bottom_bonus INTEGER NOT NULL DEFAULT 0,flower_elements INTEGER NOT NULL DEFAULT 0,garden_elements INTEGER NOT NULL DEFAULT 0,
 fouls_minor INTEGER NOT NULL DEFAULT 0,fouls_major INTEGER NOT NULL DEFAULT 0,
 endgame TEXT NOT NULL DEFAULT 'None',rp INTEGER NOT NULL DEFAULT 0,result TEXT NOT NULL DEFAULT 'Unknown',
 driver_rating INTEGER NOT NULL DEFAULT 0,scoring_rating INTEGER NOT NULL DEFAULT 0,defense_rating INTEGER NOT NULL DEFAULT 0,
 reliability_rating INTEGER NOT NULL DEFAULT 0,notes TEXT,tags TEXT[] NOT NULL DEFAULT '{}',created_by_email TEXT,created_at TIMESTAMPTZ DEFAULT NOW());
 ALTER TABLE scouting_records ADD COLUMN IF NOT EXISTS created_by_email TEXT;
 ALTER TABLE scouting_records ADD COLUMN IF NOT EXISTS mecanum BOOLEAN NOT NULL DEFAULT FALSE;
 ALTER TABLE scouting_records ADD COLUMN IF NOT EXISTS hood BOOLEAN NOT NULL DEFAULT FALSE;
 ALTER TABLE scouting_records ADD COLUMN IF NOT EXISTS parking BOOLEAN NOT NULL DEFAULT FALSE;
 ALTER TABLE scouting_records ADD COLUMN IF NOT EXISTS leave BOOLEAN NOT NULL DEFAULT FALSE;
 ALTER TABLE scouting_records ADD COLUMN IF NOT EXISTS auto_park BOOLEAN NOT NULL DEFAULT FALSE;
 ALTER TABLE scouting_records ADD COLUMN IF NOT EXISTS teleop_park BOOLEAN NOT NULL DEFAULT FALSE;
 ALTER TABLE scouting_records ADD COLUMN IF NOT EXISTS drivetrain TEXT NOT NULL DEFAULT 'Mecanum';
 ALTER TABLE scouting_records ADD COLUMN IF NOT EXISTS cell_elements INTEGER NOT NULL DEFAULT 0;
 ALTER TABLE scouting_records ADD COLUMN IF NOT EXISTS flower_bottom_bonus INTEGER NOT NULL DEFAULT 0;
 ALTER TABLE scouting_records ADD COLUMN IF NOT EXISTS flower_elements INTEGER NOT NULL DEFAULT 0;
 ALTER TABLE scouting_records ADD COLUMN IF NOT EXISTS garden_elements INTEGER NOT NULL DEFAULT 0;
 ALTER TABLE scouting_records ADD COLUMN IF NOT EXISTS fouls_minor INTEGER NOT NULL DEFAULT 0;
 ALTER TABLE scouting_records ADD COLUMN IF NOT EXISTS fouls_major INTEGER NOT NULL DEFAULT 0;
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

async function ftcGet(path){const username=process.env.FTC_API_USERNAME,key=process.env.FTC_API_KEY;if(!username||!key)throw Error("FTC Events API credentials are not configured.");const token=Buffer.from(username+":"+key).toString("base64");const r=await fetch("https://ftc-api.firstinspires.org/v2.0/"+path,{headers:{Authorization:"Basic "+token,Accept:"application/json"}});const body=await r.text();let data={};try{data=body?JSON.parse(body):{}}catch{}if(!r.ok)throw Error(data.message||"FTC Events API request failed ("+r.status+").");return data}
const mapFtcEvent=e=>({name:e.name||e.eventName||e.code||"FTC Event",season:String(e.season||2027),event_code:e.code||e.eventCode||"",location:[e.venue,e.city,e.stateprov,e.country].filter(Boolean).join(", "),start_date:e.dateStart||e.startDate||null,end_date:e.dateEnd||e.endDate||null,status:"upcoming"});
const mapFtcMatch=m=>{const teams=v=>(Array.isArray(v)?v:[]).map(x=>Number(x.teamNumber||x.team||x));const red=teams(m.redTeams||m.redAlliance||m.red),blue=teams(m.blueTeams||m.blueAlliance||m);const n=Number(m.matchNumber||m.match||m.number);return {match_type:String(m.tournamentLevel||m.matchType||"Q").toUpperCase()==="PLAYOFF"?"P":"Q",match_number:n,match_label:m.description||("Q"+n),scheduled_at:m.startTime||m.scheduledTime||null,red_teams:red.slice(0,2),blue_teams:blue.slice(0,2)}};
app.get("/events",async(_req,res)=>{try{await ensureSchema();const season=Number(process.env.FTC_API_SEASON||2027);const data=await ftcGet(season+"/events");const list=Array.isArray(data.events)?data.events:[];for(const e of list){const m=mapFtcEvent(e);if(!m.event_code)continue;await pool.query("INSERT INTO scouting_events(name,season,event_code,location,start_date,end_date,status) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING",[m.name,m.season,m.event_code,m.location||null,m.start_date?String(m.start_date).slice(0,10):null,m.end_date?String(m.end_date).slice(0,10):null,"upcoming"]);}const r=await pool.query("SELECT e.*,COUNT(m.id)::int AS match_count FROM scouting_events e LEFT JOIN event_matches m ON m.event_id=e.id WHERE e.season=$1 GROUP BY e.id ORDER BY e.start_date DESC NULLS LAST,e.id DESC",[String(season)]);res.json(r.rows);}catch(e){res.status(500).json({error:e.message||"Could not load FTC events."});}});
app.post("/events",async(req,res)=>{if(req.user.role!=="mentor")return res.status(403).json({error:"Mentor access required."});try{await ensureSchema();const name=String(req.body?.name||"").trim(),season=String(req.body?.season||"2026-27").trim(),code=String(req.body?.event_code||"").trim(),location=String(req.body?.location||"").trim(),status=["upcoming","active","completed"].includes(String(req.body?.status||"upcoming"))?String(req.body.status):"upcoming";if(name.length<2||name.length>120)return res.status(400).json({error:"Event name must be 2-120 characters."});if(status==="active")await pool.query("UPDATE scouting_events SET status='upcoming' WHERE status='active'");const r=await pool.query("INSERT INTO scouting_events(name,season,event_code,location,start_date,end_date,status,created_by_email) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *",[name,season.slice(0,30),code.slice(0,30)||null,location.slice(0,120)||null,req.body.start_date||null,req.body.end_date||null,status,req.user.email]);await pool.query("INSERT INTO activity_logs(actor_email,action,entity_type,entity_id,details) VALUES($1,$2,$3,$4,$5::jsonb)",[req.user.email,"event_created","event",String(r.rows[0].id),JSON.stringify({name,season,code})]);res.status(201).json(r.rows[0]);}catch(e){res.status(400).json({error:e.message||"Could not create event."});}});
app.patch("/events/:id/status",async(req,res)=>{if(req.user.role!=="mentor")return res.status(403).json({error:"Mentor access required."});try{await ensureSchema();const id=Number(req.params.id),status=String(req.body?.status||"");if(!Number.isInteger(id)||id<1||!["upcoming","active","completed"].includes(status))return res.status(400).json({error:"Choose a valid event status."});if(status==="active")await pool.query("UPDATE scouting_events SET status='upcoming' WHERE status='active' AND id<>$1",[id]);const r=await pool.query("UPDATE scouting_events SET status=$1 WHERE id=$2 RETURNING *",[status,id]);if(!r.rowCount)return res.status(404).json({error:"Event not found."});await pool.query("INSERT INTO activity_logs(actor_email,action,entity_type,entity_id,details) VALUES($1,$2,$3,$4,$5::jsonb)",[req.user.email,"event_status_changed","event",String(id),JSON.stringify({status})]);res.json(r.rows[0]);}catch(e){res.status(400).json({error:e.message||"Could not update event."});}});
app.delete("/events/:id",async(req,res)=>{if(req.user.role!=="mentor")return res.status(403).json({error:"Mentor access required."});try{await ensureSchema();const id=Number(req.params.id);if(!Number.isInteger(id)||id<1)return res.status(400).json({error:"Invalid event ID."});const r=await pool.query("DELETE FROM scouting_events WHERE id=$1 RETURNING id,name,season",[id]);if(!r.rowCount)return res.status(404).json({error:"Event not found."});await pool.query("INSERT INTO activity_logs(actor_email,action,entity_type,entity_id,details) VALUES($1,$2,$3,$4,$5::jsonb)",[req.user.email,"event_deleted","event",String(id),JSON.stringify(r.rows[0])]);res.json({ok:true,deleted:r.rows[0]});}catch(e){res.status(500).json({error:e.message||"Could not delete event."});}});
app.get("/events/:id/matches",async(req,res)=>{try{await ensureSchema();const id=Number(req.params.id);if(!Number.isInteger(id)||id<1)return res.status(400).json({error:"Invalid event."});const ev=await pool.query("SELECT * FROM scouting_events WHERE id=$1",[id]);if(!ev.rowCount||!ev.rows[0].event_code)return res.status(404).json({error:"FTC event not found."});const e=ev.rows[0],data=await ftcGet(String(e.season)+"/schedule/"+encodeURIComponent(e.event_code)+"?tournamentLevel=qual");const list=Array.isArray(data.schedule)?data.schedule.map(mapFtcMatch).filter(m=>Number.isInteger(m.match_number)&&m.red_teams.length===2&&m.blue_teams.length===2):[];for(const m of list){await pool.query("INSERT INTO event_matches(event_id,match_type,match_number,match_label,scheduled_at,red_teams,blue_teams) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(event_id,match_type,match_number) DO UPDATE SET match_label=EXCLUDED.match_label,scheduled_at=EXCLUDED.scheduled_at,red_teams=EXCLUDED.red_teams,blue_teams=EXCLUDED.blue_teams",[id,m.match_type,m.match_number,m.match_label,m.scheduled_at||null,m.red_teams,m.blue_teams]);}const availableOnly=req.query.available==="1";const sql="SELECT m.*,COUNT(DISTINCT s.team_id)::int AS scouted_teams FROM event_matches m LEFT JOIN scouting_records s ON s.event_id=m.event_id AND s.match_label=m.match_label WHERE m.event_id=$1 GROUP BY m.id "+(availableOnly?"HAVING COUNT(DISTINCT s.team_id)<4 ":"")+"ORDER BY m.match_number";const r=await pool.query(sql,[id]);res.json(r.rows);}catch(e){res.status(500).json({error:e.message||"Could not load FTC schedule."});}});
app.post("/events/:id/matches",async(req,res)=>{if(req.user.role!=="mentor")return res.status(403).json({error:"Mentor access required."});try{await ensureSchema();const eventId=Number(req.params.id),matchNumber=Number(req.body?.match_number),type=String(req.body?.match_type||"Q").toUpperCase();if(!["S","Q","P","F","PRACTICE"].includes(type)||!Number.isInteger(matchNumber)||matchNumber<1)return res.status(400).json({error:"Choose a valid match type and positive match number."});const label=type==="PRACTICE"?"Practice "+matchNumber:type+matchNumber;const red=(Array.isArray(req.body.red_teams)?req.body.red_teams:[]).map(Number).filter(n=>Number.isInteger(n)&&n>0),blue=(Array.isArray(req.body.blue_teams)?req.body.blue_teams:[]).map(Number).filter(n=>Number.isInteger(n)&&n>0);if(red.length!==2||blue.length!==2||new Set([...red,...blue]).size!==4)return res.status(400).json({error:"Every match must have four different teams: two Red and two Blue."});const r=await pool.query("INSERT INTO event_matches(event_id,match_type,match_number,match_label,scheduled_at,red_teams,blue_teams) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(event_id,match_type,match_number) DO UPDATE SET match_label=EXCLUDED.match_label,scheduled_at=EXCLUDED.scheduled_at,red_teams=EXCLUDED.red_teams,blue_teams=EXCLUDED.blue_teams RETURNING *",[eventId,type,matchNumber,label,req.body.scheduled_at||null,red,blue]);await pool.query("INSERT INTO activity_logs(actor_email,action,entity_type,entity_id,details) VALUES($1,$2,$3,$4,$5::jsonb)",[req.user.email,"schedule_match_saved","event_match",String(r.rows[0].id),JSON.stringify({event_id:eventId,match_label:label,red_teams:red,blue_teams:blue})]);res.status(201).json(r.rows[0]);}catch(e){res.status(400).json({error:e.message||"Could not save match."});}});
app.post("/events/:id/import",async(req,res)=>{if(req.user.role!=="mentor")return res.status(403).json({error:"Mentor access required."});try{await ensureSchema();const eventId=Number(req.params.id),items=Array.isArray(req.body?.matches)?req.body.matches:[];if(!items.length||items.length>2000)return res.status(400).json({error:"Import between 1 and 2,000 matches."});const client=await pool.connect();let count=0;try{await client.query("BEGIN");for(let rowIndex=0;rowIndex<items.length;rowIndex++){const item=items[rowIndex],type=String(item.match_type||"S").toUpperCase(),n=Number(item.match_number);if(!["S","Q","P","F","PRACTICE"].includes(type)||!Number.isInteger(n)||n<1)throw Error("Invalid match type or number on CSV row "+(rowIndex+2)+".");const label=type==="PRACTICE"?"Practice "+n:type+n;const parseTeams=v=>(Array.isArray(v)?v:String(v||"").split(/[;,| ]+/)).map(Number).filter(x=>Number.isInteger(x)&&x>0);const red=parseTeams(item.red_teams),blue=parseTeams(item.blue_teams);if(red.length!==2||blue.length!==2||new Set([...red,...blue]).size!==4)throw Error("CSV row "+(rowIndex+2)+" must contain four different teams: two Red and two Blue.");await client.query("INSERT INTO event_matches(event_id,match_type,match_number,match_label,scheduled_at,red_teams,blue_teams) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(event_id,match_type,match_number) DO UPDATE SET match_label=EXCLUDED.match_label,scheduled_at=EXCLUDED.scheduled_at,red_teams=EXCLUDED.red_teams,blue_teams=EXCLUDED.blue_teams",[eventId,type,n,label,item.scheduled_at||null,red,blue]);count++;}await client.query("COMMIT");}catch(e){await client.query("ROLLBACK");throw e;}finally{client.release();}await pool.query("INSERT INTO activity_logs(actor_email,action,entity_type,entity_id,details) VALUES($1,$2,$3,$4,$5::jsonb)",[req.user.email,"schedule_imported","event",String(eventId),JSON.stringify({imported:count})]);res.json({ok:true,imported:count});}catch(e){res.status(400).json({error:e.message||"Could not import schedule."});}});
const fields=["match_number","team_id","alliance","scout_name","event_id","match_type","match_label","event_name","season","pollen_auto","nectar_auto","tips_auto","pollen_teleop","nectar_teleop","tips_teleop","cell_elements","flower_bottom_bonus","flower_elements","garden_elements","flower","turret","mecanum","hood","parking","leave","auto_park","teleop_park","drivetrain","endgame","fouls_minor","fouls_major","rp","result","driver_rating","scoring_rating","defense_rating","reliability_rating","notes"];
function values(d){
 const match=Number(d.match_number),team=Number(d.team_id);
 if(!Number.isInteger(match)||match<1||!Number.isInteger(team)||team<1||!["RED","BLUE"].includes(d.alliance))throw Error("Valid match number, team number, and alliance are required.");
 if(d.event_id!==undefined&&d.event_id!==null&&d.event_id!==""&&(!Number.isInteger(Number(d.event_id))||Number(d.event_id)<1))throw Error("Invalid event.");
 if(d.match_type!==undefined&&!["S","Q","P","F","PRACTICE"].includes(String(d.match_type).toUpperCase()))throw Error("Invalid match type.");
 const score=3*(d.leave?1:0)+5*(d.auto_park?1:0)+5*(d.teleop_park?1:0)+20*(Number(d.tips_auto||0)+Number(d.tips_teleop||0))+2*Number(d.cell_elements||0)+5*Number(d.flower_bottom_bonus||0)+2*Number(d.flower_elements||0)+Number(d.garden_elements||0);const computedRp=3*(d.result==="Win"?1:0)+1*(d.result==="Tie"?1:0)+(score>=16?1:0)+((Number(d.tips_auto||0)+Number(d.tips_teleop||0)>=4)?1:0)+((Number(d.tips_auto||0)+Number(d.tips_teleop||0)>=7)?1:0);d.rp=computedRp;const ns=fields.filter(k=>["match_number","team_id","pollen_auto","nectar_auto","tips_auto","pollen_teleop","nectar_teleop","tips_teleop","cell_elements","flower_bottom_bonus","flower_elements","garden_elements","fouls_minor","fouls_major","rp","driver_rating","scoring_rating","defense_rating","reliability_rating"].includes(k));
 for(const k of ns)if(d[k]!==undefined&&(!Number.isInteger(Number(d[k]))||Number(d[k])<0))throw Error("Invalid value for "+k+".");
 return [match,team,d.alliance,String(d.scout_name||"").slice(0,100)||null,d.event_id?Number(d.event_id):null,String(d.match_type||"Q").slice(0,10),String(d.match_label||"").slice(0,30)||null,String(d.event_name||"BioBuzz").slice(0,120),String(d.season||"2026-27").slice(0,30),Number(d.pollen_auto)||0,Number(d.nectar_auto)||0,Number(d.tips_auto)||0,Number(d.pollen_teleop)||0,Number(d.nectar_teleop)||0,Number(d.tips_teleop)||0,Number(d.cell_elements)||0,Number(d.flower_bottom_bonus)||0,Number(d.flower_elements)||0,Number(d.garden_elements)||0,Boolean(d.flower),Boolean(d.turret),Boolean(d.mecanum),Boolean(d.hood),Boolean(d.parking),Boolean(d.leave),Boolean(d.auto_park),Boolean(d.teleop_park),String(d.drivetrain||"Mecanum").slice(0,30),String(d.endgame||"None").slice(0,60),Number(d.fouls_minor)||0,Number(d.fouls_major)||0,Number(d.rp)||0,String(d.result||"Unknown").slice(0,30),Number(d.driver_rating)||0,Number(d.scoring_rating)||0,Number(d.defense_rating)||0,Number(d.reliability_rating)||0,String(d.notes||"").slice(0,5000)];
}
const cols=fields.join(",");
app.post("/scouting",async(req,res)=>{try{await ensureSchema();const active=await pool.query("SELECT id FROM scouting_events WHERE status=$1 LIMIT 1",["active"]);if(active.rowCount&&!req.body?.event_id)return res.status(400).json({error:"An active event is running. Select an event before submitting a scouting report."});if(req.body?.event_id){const ev=await pool.query("SELECT id FROM scouting_events WHERE id=$1",[Number(req.body.event_id)]);if(!ev.rowCount)return res.status(400).json({error:"Selected event was not found."});}const v=values(req.body||{}),p=v.map((_,i)=>"$"+(i+1)).join(",");const saved=await pool.query("INSERT INTO scouting_records("+cols+",created_by_email) VALUES("+p+",$"+(v.length+1)+") RETURNING id",[...v,req.user.email]);await pool.query("INSERT INTO activity_logs(actor_email,action,entity_type,entity_id,details) VALUES($1,$2,$3,$4,$5::jsonb)",[req.user.email,"report_published","scouting_report",String(saved.rows[0].id),JSON.stringify({team_id:v[1],match_number:v[0],alliance:v[2]})]);res.status(201).json({ok:true});}catch(e){res.status(400).json({error:e.message||"Could not save report."});}});
app.put("/scouting/:id",async(req,res)=>{try{await ensureSchema();const active=await pool.query("SELECT id FROM scouting_events WHERE status=$1 LIMIT 1",["active"]);if(active.rowCount&&!req.body?.event_id)return res.status(400).json({error:"An active event is running. Select an event before saving this scouting report."});if(req.body?.event_id){const ev=await pool.query("SELECT id FROM scouting_events WHERE id=$1",[Number(req.body.event_id)]);if(!ev.rowCount)return res.status(400).json({error:"Selected event was not found."});}const id=Number(req.params.id);if(!Number.isInteger(id)||id<1)return res.status(400).json({error:"Invalid report ID."});const old=await pool.query("SELECT created_by_email FROM scouting_records WHERE id=$1",[id]);if(!old.rowCount)return res.status(404).json({error:"Report not found."});if(req.user.role!=="mentor"&&old.rows[0].created_by_email!==req.user.email)return res.status(403).json({error:"Students can only edit their own reports."});const v=values(req.body||{}),set=fields.map((k,i)=>k+"=$"+(i+1)).join(",");await pool.query("UPDATE scouting_records SET "+set+" WHERE id=$"+(v.length+1),[...v,id]);await pool.query("INSERT INTO activity_logs(actor_email,action,entity_type,entity_id,details) VALUES($1,$2,$3,$4,$5::jsonb)",[req.user.email,"report_updated","scouting_report",String(id),JSON.stringify({team_id:v[1],match_number:v[0],alliance:v[2]})]);res.json({ok:true});}catch(e){res.status(400).json({error:e.message||"Could not update report."});}});
app.delete("/scouting/:id",async(req,res)=>{if(req.user.role!=="mentor")return res.status(403).json({error:"Only mentors can delete reports."});try{await ensureSchema();const id=Number(req.params.id);if(!Number.isInteger(id)||id<1)return res.status(400).json({error:"Invalid report ID."});const r=await pool.query("DELETE FROM scouting_records WHERE id=$1 RETURNING id,team_id,match_number",[id]);if(!r.rowCount)return res.status(404).json({error:"Report not found."});await pool.query("INSERT INTO activity_logs(actor_email,action,entity_type,entity_id,details) VALUES($1,$2,$3,$4,$5::jsonb)",[req.user.email,"report_deleted","scouting_report",String(id),JSON.stringify({team_id:r.rows[0].team_id,match_number:r.rows[0].match_number})]);res.json({ok:true});}catch{res.status(500).json({error:"Could not delete report."});}});

app.use((req,res)=>res.status(404).json({error:"API route not found.",path:req.path}));
app.use((error,req,res,next)=>{if(res.headersSent)return next(error);console.error("BioBuzz API error:",error);res.status(500).json({error:"The server could not complete this request."});});

export default app;

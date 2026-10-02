import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { rateLimit } from 'express-rate-limit';
import multer from 'multer';
import { z } from 'zod';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { query, tx, migrate, audit, seedOrg, pool } from './db.mjs';
import { seedDemo } from './demo.mjs';
import { encrypt, integration, msal, syncDirectory, graphToken, graphPages, validateLlmURL, transcribe, generateMinutes } from './providers.mjs';
import { can, canRead, ROLES, hashPassword, checkPassword, meetingPlatform, validateEvidence, nextState } from '../../packages/domain/index.mjs';
import { documentLines, exportDocx, exportPdf } from './exports.mjs';
import { correctSpeakers } from '../../packages/domain/speakers.mjs';
import { traditional, traditionalSegments } from '../../packages/domain/chinese.mjs';
import { newMinutes, saveTranscription, normalizeStoredTranscript } from './minutes-workflow.mjs';
import { templateRoutes } from './template-routes.mjs';
import { templateData, renderDocxTemplate, docxToPdf } from './docx-templates.mjs';
import {captureRoutes,webhookApp,queueCapture,queueCaptureStop,runCaptureJob,runCaptureEvents} from './capture.mjs';
import {directCaptureRoutes,captureSummary,pollDirectCaptures,selectedCaptureMethod} from './direct-capture.mjs';
import {brandRoutes,readBrand} from './branding.mjs';
import { accountRoutes } from './account.mjs';
import { newPasswordSchema } from './password-policy.mjs';
const app = express(),
  PORT = Number(process.env.PORT || 5000),
  PUBLIC = process.env.PUBLIC_URL || `http://localhost:${PORT}`;
const DATA = path.resolve(process.env.DATA_DIR || './data');
await mkdir(DATA, {
  recursive: true
});
await migrate();
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const fail = (status, message) => Object.assign(new Error(message), {
  status
});
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const hash = s => createHash('sha256').update(s).digest('hex');
const cookie = {
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.COOKIE_SECURE === 'true',
  path: '/'
};
const mobileOrigin = process.env.MOBILE_ORIGIN ? new URL(process.env.MOBILE_ORIGIN).origin : null;
if (mobileOrigin && !/^https:\/\/[a-z0-9.-]+\.ts\.net(?::\d+)?$/i.test(mobileOrigin)) throw new Error('MOBILE_ORIGIN must be the exact HTTPS Tailscale hostname.');
const loopbackOrigins = new Set((process.env.LOCAL_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean).map(value => {
  const origin = new URL(value).origin;
  if (!/^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(origin)) throw new Error('LOCAL_ORIGINS may only contain exact HTTP loopback origins.');
  return origin;
}));
const allowedOrigins = new Set([new URL(PUBLIC).origin, ...(mobileOrigin ? [mobileOrigin] : []), ...loopbackOrigins]);
const isLoopbackRequest = req => {
  try {
    return loopbackOrigins.has(new URL(`http://${req.get('host')}`).origin);
  } catch {
    return false;
  }
};
const sessionCookie = req => ({
  ...cookie,
  secure: cookie.secure && !isLoopbackRequest(req)
});
app.disable('x-powered-by');
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:'],
      fontSrc: ["'self'"],
      connectSrc: ["'self'"],
      mediaSrc: ["'self'", 'blob:'],
      upgradeInsecureRequests: process.env.COOKIE_SECURE === 'true' ? [] : null
    }
  }
}));
app.use(express.json({
  limit: '2mb'
}));
app.use(cookieParser());
app.use((req, res, next) => {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    const origin = req.get('origin');
    if (origin && !allowedOrigins.has(origin) || req.get('sec-fetch-site') === 'cross-site') return res.status(403).json({
      error: 'Cross-site request rejected.'
    });
  }
  next();
});
app.get('/api/health', wrap(async (req, res) => {
  await query('SELECT 1');
  res.json({
    status: 'ok',
    database: 'connected',
    version: '0.1.0'
  });
}));
app.get('/api/auth/config', wrap(async (req, res) => {
  res.set('Cache-Control','no-store');
  const real = await query('SELECT count(*) FROM organizations WHERE demo=false');
  const providers = await query("SELECT o.id,o.name FROM organizations o JOIN integrations i ON i.org_id=o.id WHERE o.demo=false AND i.provider='Microsoft 365' AND i.secret IS NOT NULL");
  res.json({
    setupRequired: Number(real.rows[0].count) === 0,
    demoEnabled: process.env.ENABLE_DEMO === 'true',
    microsoft: providers.rows,
    brand: Number(real.rows[0].count)===1 ? (await readBrand((await query('SELECT id FROM organizations WHERE demo=false LIMIT 1')).rows[0].id)).config : null
  });
}));
app.use('/api/auth', rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: 'draft-8',
  legacyHeaders: false
}));
async function session(user, res, expectedPasswordHash) {
  const token = randomBytes(32).toString('hex');
  await tx(async db => {
    const { rows } = await db.query('SELECT active,password_hash FROM users WHERE id=$1 FOR UPDATE', [user.id]);
    if (!rows[0]?.active || (expectedPasswordHash !== undefined && rows[0].password_hash !== expectedPasswordHash)) throw fail(401, 'Sign-in details changed. Please sign in again.');
    await db.query("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '12 hours')", [hash(token), user.id]);
  });
  res.cookie('minutes_session', token, {
    ...sessionCookie(res.req),
    maxAge: 12 * 60 * 60 * 1000
  });
}
app.post('/api/auth/setup', wrap(async (req, res) => {
  const v = z.object({
    company: z.string().min(2).max(100),
    name: z.string().min(2).max(100),
    email: z.email().max(200),
    password: newPasswordSchema
  }).parse(req.body);
  const user = await tx(async db => {
    await db.query('SELECT pg_advisory_xact_lock(17091602)');
    const existing = await db.query('SELECT id FROM organizations WHERE demo=false');
    if (existing.rowCount) throw fail(409, 'A company has already been set up. Sign in with your administrator account.');
    const org = randomUUID();
    const units = await seedOrg(db, org, v.company);
    const user = {
      id: randomUUID(),
      org_id: org,
      name: v.name,
      email: v.email.toLowerCase(),
      roles: ['ORG_ADMIN'],
      unit_ids: [units.department, units.team]
    };
    await db.query('INSERT INTO users(id,org_id,name,email,password_hash,roles,unit_ids) VALUES($1,$2,$3,$4,$5,$6,$7)', [user.id, org, user.name, user.email, hashPassword(v.password), user.roles, user.unit_ids]);
    await audit(db, user, 'organization.created');
    return user;
  });
  await session(user, res);
  res.status(201).json({
    ok: true
  });
}));
app.post('/api/auth/login', wrap(async (req, res) => {
  const v = z.object({
    email: z.email(),
    password: z.string().min(1).max(200)
  }).parse(req.body);
  const {
    rows
  } = await query('SELECT u.* FROM users u JOIN organizations o ON o.id=u.org_id WHERE lower(email)=$1 AND u.active=true AND o.demo=false', [v.email.toLowerCase()]);
  const user = rows.find(u => checkPassword(v.password, u.password_hash));
  if (!user) throw fail(401, 'Email or password is incorrect.');
  await session(user, res, user.password_hash);
  await audit(pool, user, 'auth.login');
  res.json({
    ok: true
  });
}));
app.post('/api/auth/demo', wrap(async (req, res) => {
  if (process.env.ENABLE_DEMO !== 'true') throw fail(404, 'Sample workspace is disabled.');
  const user = await seedDemo();
  await session(user, res);
  res.json({
    ok: true
  });
}));
app.post('/api/auth/logout', wrap(async (req, res) => {
  if (req.cookies.minutes_session) await query('DELETE FROM sessions WHERE token_hash=$1', [hash(req.cookies.minutes_session)]);
  res.clearCookie('minutes_session', cookie).json({
    ok: true
  });
}));
app.get('/api/auth/microsoft/:org', wrap(async (req, res) => {
  z.uuid().parse(req.params.org);
  const c = await integration(req.params.org, 'Microsoft 365');
  const state = randomBytes(32).toString('hex'),
    nonce = randomBytes(32).toString('hex'),
    verifier = randomBytes(32).toString('base64url');
  await query("INSERT INTO oauth_states(state,org_id,verifier,nonce,expires_at) VALUES($1,$2,$3,$4,now()+interval '10 minutes')", [state, req.params.org, encrypt(verifier), nonce]);
  res.cookie('oauth_state', state, {
    ...sessionCookie(req),
    maxAge: 600000
  });
  res.redirect(await msal(c).getAuthCodeUrl({
    scopes: ['openid', 'profile', 'email'],
    redirectUri: PUBLIC + '/api/auth/microsoft-callback',
    state,
    nonce,
    codeChallenge: createHash('sha256').update(verifier).digest('base64url'),
    codeChallengeMethod: 'S256'
  }));
}));
app.get('/api/auth/microsoft-callback', wrap(async (req, res) => {
  const state = String(req.query.state || '');
  if (!state || req.cookies.oauth_state !== state) throw fail(400, 'Microsoft sign-in state is invalid.');
  const {
    rows
  } = await query('DELETE FROM oauth_states WHERE state=$1 AND expires_at>now() RETURNING *', [state]);
  const saved = rows[0];
  if (!saved) throw fail(400, 'Microsoft sign-in expired.');
  const c = await integration(saved.org_id, 'Microsoft 365');
  const {
    decrypt
  } = await import('./providers.mjs');
  const result = await msal(c).acquireTokenByCode({
    code: String(req.query.code || ''),
    scopes: ['openid', 'profile', 'email'],
    redirectUri: PUBLIC + '/api/auth/microsoft-callback',
    codeVerifier: decrypt(saved.verifier)
  });
  const claims = result?.idTokenClaims;
  if (!claims || claims.tid !== c.config.tenantId || claims.nonce !== saved.nonce) throw fail(401, 'Microsoft identity validation failed.');
  const users = await query('SELECT * FROM users WHERE org_id=$1 AND external_tenant=$2 AND external_id=$3 AND active=true', [saved.org_id, claims.tid, claims.oid]);
  if (!users.rows[0]) throw fail(403, 'Ask your administrator to sync and enable your Microsoft account.');
  await session(users.rows[0], res);
  res.clearCookie('oauth_state', cookie).redirect('/');
}));
app.use('/api', wrap(async (req, res, next) => {
  const token = req.cookies.minutes_session;
  if (!token) throw fail(401, 'Please sign in.');
  const {
    rows
  } = await query('SELECT u.*,o.name AS organization,o.demo FROM sessions s JOIN users u ON s.user_id=u.id JOIN organizations o ON o.id=u.org_id WHERE s.token_hash=$1 AND s.expires_at>now() AND u.active=true', [hash(token)]);
  if (!rows[0]) throw fail(401, 'Your session expired. Please sign in.');
  req.user = rows[0];
  next();
}));
const requireRole = (...roles) => (req, res, next) => can(req.user, ...roles) ? next() : next(fail(403, 'Your role does not allow this action.'));
const admin = requireRole('ORG_ADMIN');
brandRoutes(app,{admin,wrap});
accountRoutes(app, { wrap, fail, sessionCookie });
async function meetingFor(user, id, db = pool, lock = false) {
  z.uuid().parse(id);
  const {
    rows
  } = await db.query('SELECT * FROM meetings WHERE id=$1 AND org_id=$2' + (lock ? ' FOR UPDATE' : ''), [id, user.org_id]);
  if (!rows[0] || !canRead(user, rows[0])) throw fail(404, 'Meeting not found.');
  return rows[0];
}
const visibility = "(m.owner_id=$2 OR m.reviewer_id=$2 OR m.unit_id=ANY($3::uuid[]) OR $4::boolean)";
app.get('/api/me', wrap(async (req, res) => {
  const {
    password_hash,
    ...user
  } = req.user;
  const units = await query('SELECT * FROM units WHERE org_id=$1 ORDER BY kind,name', [user.org_id]);
  res.json({
    user: { ...user, hasLocalPassword: Boolean(password_hash) },
    units: units.rows
  });
}));
app.get('/api/meetings', wrap(async (req, res) => {
  const {
    rows
  } = await query(`SELECT m.*,u.name AS unit_name,t.name AS template_name FROM meetings m LEFT JOIN units u ON u.id=m.unit_id LEFT JOIN templates t ON t.id=m.template_id WHERE m.org_id=$1 AND ${visibility} ORDER BY m.scheduled_at`, [req.user.org_id, req.user.id, req.user.unit_ids, can(req.user, 'ORG_ADMIN')]);
  res.json(rows);
}));
app.get('/api/meetings/:id', wrap(async (req, res) => {
  const m = await meetingFor(req.user, req.params.id);
  const [transcripts, minutes, usage, history] = await Promise.all([query('SELECT * FROM transcripts WHERE meeting_id=$1 ORDER BY version DESC', [m.id]), query('SELECT * FROM minutes WHERE meeting_id=$1 ORDER BY version DESC', [m.id]), query('SELECT * FROM usage WHERE meeting_id=$1 ORDER BY created_at', [m.id]), query('SELECT action,detail,created_at FROM audit WHERE meeting_id=$1 AND org_id=$2 ORDER BY created_at DESC LIMIT 100', [m.id, req.user.org_id])]);
  const doc = minutes.rows[0];
  res.json({
    ...m,
    capture: (await query("SELECT bot_id,state,stop_requested,recording_id,imported_at,COALESCE(config->>'captureMethod','recall') AS method,COALESCE(config->>'transcriptionProvider','elevenlabs') AS transcription_provider FROM capture_sessions WHERE meeting_id=$1",[m.id])).rows[0]||null,
    captureMethod: ['Teams','Zoom'].includes(m.platform)?await selectedCaptureMethod(pool,m.org_id,m.platform):null,
    transcripts: transcripts.rows.map(t=>({...t,segments:t.segments.map(s=>({...s,displayText:traditional(s.text)}))})),
    minutes: minutes.rows,
    usage: usage.rows,
    history: history.rows,
    validation: doc ? validateEvidence(doc.content, transcripts.rows.find(t => t.id === doc.transcript_id)?.segments || []) : []
  });
}));
const meetingSchema = z.object({
  title: z.string().min(2).max(200),
  referenceNumber: z.string().trim().max(80).optional().default(''),
  joinUrl: z.string().max(2000).optional().default(''),
  scheduledAt: z.iso.datetime({
    offset: true
  }),
  timezone: z.string().default('Asia/Hong_Kong'),
  durationMinutes: z.number().int().min(5).max(1440).default(60),
  unitId: z.uuid(),
  templateId: z.uuid(),
  reviewerId: z.uuid().nullable().optional(),
  consent: z.literal(true)
});
async function checkAssignments(user, v) {
  if (!can(user, 'ORG_ADMIN') && !user.unit_ids.includes(v.unitId)) throw fail(403, 'Choose one of your authorised teams.');
  const units = await query('SELECT id FROM units WHERE id=$1 AND org_id=$2', [v.unitId, user.org_id]);
  const templates = await query('SELECT id FROM templates WHERE id=$1 AND org_id=$2', [v.templateId, user.org_id]);
  if (!units.rowCount || !templates.rowCount) throw fail(400, 'Invalid team or template.');
  if (v.reviewerId) {
    const r = await query("SELECT id FROM users WHERE id=$1 AND org_id=$2 AND active=true AND (roles && ARRAY['REVIEWER','ORG_ADMIN'])", [v.reviewerId, user.org_id]);
    if (!r.rowCount) throw fail(400, 'Choose an active reviewer in your company.');
  }
  try {
    new Intl.DateTimeFormat('en', {
      timeZone: v.timezone
    });
  } catch {
    throw fail(400, 'Choose a valid IANA time zone.');
  }
}
app.post('/api/meetings', requireRole('MEETING_ORGANIZER'), wrap(async (req, res) => {
  const v = meetingSchema.parse(req.body);
  await checkAssignments(req.user, v);
  const platform = v.joinUrl ? meetingPlatform(v.joinUrl) : 'Upload';
  const id = randomUUID();
  const status = platform === 'Upload' ? 'DRAFT' : 'SETUP_REQUIRED';
  const error = platform === 'Upload' ? null : `${platform} capture worker is not connected. Your assignment is saved; no agent has joined.`;
  await tx(async db => {
    await db.query('INSERT INTO meetings(id,org_id,unit_id,owner_id,reviewer_id,title,reference_number,platform,join_url,scheduled_at,timezone,duration_minutes,template_id,consent,status,error,sample) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,true,$14,$15,$16)', [id, req.user.org_id, v.unitId, req.user.id, v.reviewerId || null, v.title, v.referenceNumber || null, platform, v.joinUrl, v.scheduledAt, v.timezone, v.durationMinutes, v.templateId, status, error, req.user.demo]);
    const created=(await db.query('SELECT * FROM meetings WHERE id=$1',[id])).rows[0];
    await queueCapture(db,created);
    await audit(db, req.user, 'meeting.created', id, {
      platform,
      status,
      referenceNumber: v.referenceNumber || null
    });
  });
  res.status(201).json({
    id,
    status: (await query('SELECT status FROM meetings WHERE id=$1',[id])).rows[0].status
  });
}));
app.patch('/api/meetings/:id', requireRole('MEETING_ORGANIZER'), wrap(async (req, res) => {
  const v = meetingSchema.extend({
    revision: z.number().int()
  }).parse(req.body);
  await checkAssignments(req.user, v);
  await tx(async db => {
    const m = await meetingFor(req.user, req.params.id, db, true);
    if (m.revision !== v.revision) throw fail(409, 'This meeting changed. Reload and try again.');
    if (!['DRAFT', 'SETUP_REQUIRED', 'SCHEDULED'].includes(m.status)) throw fail(409, 'This meeting can no longer be rescheduled.');
    if((await db.query('SELECT 1 FROM capture_sessions WHERE meeting_id=$1',[m.id])).rowCount)throw fail(409,'A bot has already been scheduled. Cancel its capture and create a new assignment with the updated details.');
    const platform = v.joinUrl ? meetingPlatform(v.joinUrl) : 'Upload';
    await db.query('UPDATE meetings SET title=$2,reference_number=$3,join_url=$4,scheduled_at=$5,timezone=$6,unit_id=$7,template_id=$8,reviewer_id=$9,duration_minutes=$10,platform=$11,revision=revision+1,updated_at=now() WHERE id=$1', [m.id, v.title, v.referenceNumber || null, v.joinUrl, v.scheduledAt, v.timezone, v.unitId, v.templateId, v.reviewerId || null, v.durationMinutes, platform]);
    await audit(db, req.user, 'meeting.rescheduled', m.id);
  });
  res.json({
    ok: true
  });
}));
const upload = multer({
  dest: DATA,
  limits: {
    fileSize: 250 * 1024 * 1024,
    files: 1
  },
  fileFilter: (req, file, cb) => {
    if (!/\.(mp3|mp4|m4a|wav|webm|ogg|flac)$/i.test(file.originalname)) return cb(fail(400, 'Choose an MP3, MP4, M4A, WAV, WEBM, OGG or FLAC file.'));
    cb(null, true);
  }
});
app.post('/api/meetings/:id/upload', requireRole('MEETING_ORGANIZER'), wrap(async (req, res, next) => {
  await meetingFor(req.user, req.params.id);
  next();
}), upload.single('file'), wrap(async (req, res) => {
  try {
    if (!req.file) throw fail(400, 'Choose a recording to upload.');
    await tx(async db => {
      const m = await meetingFor(req.user, req.params.id, db, true);
      if (!['DRAFT', 'SETUP_REQUIRED', 'UPLOADED'].includes(m.status)) throw fail(409, 'A recording cannot be replaced after processing starts.');
      if (m.file_path) throw fail(409, 'A recording is already attached. Create a new meeting for another recording.');
      await db.query("UPDATE meetings SET file_path=$2,file_name=$3,mime_type=$4,status='UPLOADED',error=NULL,revision=revision+1,updated_at=now() WHERE id=$1", [m.id, req.file.path, path.basename(req.file.originalname), {
        'mp3': 'audio/mpeg',
        'mp4': 'video/mp4',
        'm4a': 'audio/mp4',
        'wav': 'audio/wav',
        'webm': 'video/webm',
        'ogg': 'audio/ogg',
        'flac': 'audio/flac'
      }[path.extname(req.file.originalname).slice(1).toLowerCase()] || 'application/octet-stream']);
      await audit(db, req.user, 'recording.uploaded', m.id, {
        bytes: req.file.size
      });
    });
    res.json({
      ok: true
    });
  } catch (e) {
    if (req.file) await unlink(req.file.path).catch(() => {});
    throw e;
  }
}));
app.get('/api/meetings/:id/audio', wrap(async (req, res) => {
  const m = await meetingFor(req.user, req.params.id);
  if (!m.file_path) throw fail(404, 'No recording is attached.');
  res.type(m.mime_type || 'application/octet-stream').sendFile(path.resolve(m.file_path));
}));
app.post('/api/meetings/:id/process', requireRole('MEETING_ORGANIZER', 'REVIEWER'), wrap(async (req, res) => {
  if (req.user.demo) throw fail(409, 'External API calls are disabled in the sample workspace. Create your company to process real recordings.');
  await integration(req.user.org_id, 'ElevenLabs');
  await tx(async db => {
    const m = await meetingFor(req.user, req.params.id, db, true);
    if (!m.file_path) throw fail(409, 'Upload a recording first.');
    if (!['UPLOADED', 'FAILED'].includes(m.status)) throw fail(409, 'This recording is already processing or has a transcript.');
    await db.query("INSERT INTO jobs(id,meeting_id,type) VALUES($1,$2,'TRANSCRIBE')", [randomUUID(), m.id]);
    await db.query("UPDATE meetings SET status='TRANSCRIBING_FINAL',error=NULL,revision=revision+1 WHERE id=$1", [m.id]);
    await audit(db, req.user, 'transcription.queued', m.id);
  });
  res.status(202).json({
    ok: true
  });
}));
app.put('/api/meetings/:id/speakers', requireRole('REVIEWER','APPROVER'), wrap(async (req, res) => {
  const speakerKey = z.string().min(1).max(100);
  const v = z.object({
    revision: z.number().int(),
    transcriptId: z.uuid(),
    createRevision: z.boolean().optional().default(false),
    names: z.array(z.object({
      id: speakerKey,
      name: z.string().trim().min(1).max(100)
    })).max(200),
    corrections: z.array(z.object({
      segmentId: z.string().min(1).max(80),
      speakerId: speakerKey
    })).max(2000)
  }).parse(req.body);
  await tx(async db => {
    const m = await meetingFor(req.user, req.params.id, db, true);
    if (m.revision !== v.revision) throw fail(409, 'The meeting changed. Reload before saving speaker changes.');
    const locked=['IN_REVIEW','APPROVED'].includes(m.status);
    if(locked&&(!v.createRevision||!can(req.user,'APPROVER')))throw fail(409,'An approver must create a correction draft before changing speakers.');
    if(!locked&&!['READY_FOR_REVIEW','REJECTED'].includes(m.status))throw fail(409,'Wait for processing to finish before changing speakers.');
    if(!locked&&!can(req.user,'REVIEWER'))throw fail(403,'A reviewer must edit speakers in an existing draft.');
    const previous = (await db.query('SELECT * FROM transcripts WHERE meeting_id=$1 ORDER BY version DESC LIMIT 1', [m.id])).rows[0];
    if (!previous || previous.id !== v.transcriptId) throw fail(409, 'The transcript changed. Reload before editing speakers.');
    let segments;
    try {
      segments = correctSpeakers(previous.segments, v.names, v.corrections);
    } catch (e) {
      throw fail(400, e.message);
    }
    const tid = randomUUID();
    await db.query('INSERT INTO transcripts(id,meeting_id,version,segments,source) VALUES($1,$2,$3,$4,$5)', [tid, m.id, previous.version + 1, JSON.stringify(segments), 'Reviewer speaker correction']);
    const doc = (await db.query('SELECT * FROM minutes WHERE meeting_id=$1 ORDER BY version DESC LIMIT 1 FOR UPDATE', [m.id])).rows[0];
    if (doc) {
      if (doc.status === 'APPROVED'&&!locked) throw fail(409, 'Create a revised version before changing approved sources.');
      const content = {
        ...doc.content,
        items: doc.content.items.map(i => ({
          ...i,
          verified: false
        }))
      };
      if(locked)await newMinutes(db,m,tid,content);
      else await db.query("UPDATE minutes SET transcript_id=$2,content=$3,status='DRAFT',revision=revision+1,updated_at=now() WHERE id=$1", [doc.id, tid, content]);
    } else await newMinutes(db, m, tid, {
      summary: '',
      attendees: [],
      items: []
    });
    await db.query("UPDATE meetings SET status='READY_FOR_REVIEW',error=NULL,revision=revision+1,updated_at=now() WHERE id=$1", [m.id]);
    await audit(db, req.user, 'transcript.speakers_corrected', m.id, {
      previousTranscriptId: previous.id,
      transcriptId: tid,
      version: previous.version + 1,
      names: v.names,
      corrections: v.corrections
      ,createdCorrectionDraft:locked,previousDocumentId:doc?.id,previousMeetingStatus:m.status
    });
  });
  res.json({
    ok: true
  });
}));
const segmentSchema = z.object({
  id: z.string().min(1).max(80),
  speaker: z.string().max(100),
  speakerId: z.string().max(100).optional(),
  sourceSpeakerId: z.string().max(100).optional(),
  start: z.number().min(0),
  end: z.number().min(0).optional(),
  text: z.string().min(1).max(20000)
});
app.put('/api/meetings/:id/transcript', requireRole('REVIEWER'), wrap(async (req, res) => {
  const v = z.object({
    segments: z.array(segmentSchema).min(1).max(2000),
    revision: z.number().int()
  }).parse(req.body);
  if (new Set(v.segments.map(s => s.id)).size !== v.segments.length) throw fail(400, 'Transcript segment IDs must be unique.');
  v.segments = traditionalSegments(v.segments);
  await tx(async db => {
    const m = await meetingFor(req.user, req.params.id, db, true);
    if (m.revision !== v.revision) throw fail(409, 'The meeting changed. Reload before saving.');
    if (!['DRAFT', 'UPLOADED', 'SETUP_REQUIRED', 'READY_FOR_REVIEW', 'REJECTED', 'FAILED'].includes(m.status)) throw fail(409, 'Reopen or reject this version before changing the transcript.');
    const prior = await db.query('SELECT COALESCE(MAX(version),0)+1 AS version FROM transcripts WHERE meeting_id=$1', [m.id]);
    const tid = randomUUID();
    await db.query('INSERT INTO transcripts(id,meeting_id,version,segments,source) VALUES($1,$2,$3,$4,$5)', [tid, m.id, prior.rows[0].version, JSON.stringify(v.segments), 'Reviewer correction / supplied transcript']);
    const doc = await db.query('SELECT * FROM minutes WHERE meeting_id=$1 ORDER BY version DESC LIMIT 1', [m.id]);
    if (doc.rows[0]) {
      const content = doc.rows[0].content;
      content.items = content.items.map(i => ({
        ...i,
        verified: false
      }));
      await db.query("UPDATE minutes SET transcript_id=$2,content=$3,status='DRAFT',revision=revision+1 WHERE id=$1", [doc.rows[0].id, tid, content]);
    } else await newMinutes(db, m, tid, {
      summary: '',
      attendees: [],
      items: []
    });
    const autoGenerate=!doc.rows[0]&&!req.user.demo;
    if(autoGenerate)await db.query("INSERT INTO jobs(id,meeting_id,type) VALUES($1,$2,'GENERATE')",[randomUUID(),m.id]);
    await db.query('UPDATE meetings SET status=$2,error=NULL,revision=revision+1 WHERE id=$1', [m.id,autoGenerate?'GENERATING_MINUTES':'READY_FOR_REVIEW']);
    await audit(db, req.user, 'transcript.version_created', m.id, {
      version: prior.rows[0].version
    });
  });
  res.json({
    ok: true
  });
}));
app.post('/api/meetings/:id/generate', requireRole('REVIEWER'), wrap(async (req, res) => {
  if (req.user.demo) throw fail(409, 'External API calls are disabled in the sample workspace.');
  await integration(req.user.org_id, 'Minutes AI');
  await tx(async db => {
    const m = await meetingFor(req.user, req.params.id, db, true);
    if (!['READY_FOR_REVIEW', 'REJECTED'].includes(m.status)) throw fail(409, 'A final transcript is required before generating minutes.');
    await normalizeStoredTranscript(db, m);
    await db.query("INSERT INTO jobs(id,meeting_id,type) VALUES($1,$2,'GENERATE')", [randomUUID(), m.id]);
    await db.query("UPDATE meetings SET status='GENERATING_MINUTES',error=NULL,revision=revision+1 WHERE id=$1", [m.id]);
    await audit(db, req.user, 'minutes.generation_queued', m.id);
  });
  res.status(202).json({
    ok: true
  });
}));
app.post('/api/meetings/:id/traditional-chinese', requireRole('REVIEWER'), wrap(async (req, res) => {
  const v = z.object({
    revision: z.number().int()
  }).parse(req.body);
  const changed = await tx(async db => {
    const m = await meetingFor(req.user, req.params.id, db, true);
    if (m.revision !== v.revision) throw fail(409, 'Meeting changed. Reload and try again.');
    if (!['READY_FOR_REVIEW', 'REJECTED'].includes(m.status)) throw fail(409, 'Return or reopen the draft before changing its transcript.');
    const changed = await normalizeStoredTranscript(db, m);
    if (changed) await audit(db, req.user, 'transcript.traditional_chinese', m.id);
    return changed;
  });
  res.json({
    ok: true,
    changed
  });
}));
app.put('/api/meetings/:id/template', requireRole('REVIEWER'), wrap(async (req, res) => {
  const v = z.object({
    templateId: z.uuid(),
    revision: z.number().int()
  }).parse(req.body);
  await tx(async db => {
    const m = await meetingFor(req.user, req.params.id, db, true);
    if (m.revision !== v.revision) throw fail(409, 'Meeting changed. Reload and try again.');
    if (!['DRAFT', 'UPLOADED', 'SETUP_REQUIRED', 'READY_FOR_REVIEW', 'REJECTED'].includes(m.status)) throw fail(409, 'Return or reopen the draft before changing its layout.');
    const t = await db.query('SELECT id FROM templates WHERE id=$1 AND org_id=$2', [v.templateId, req.user.org_id]);
    if (!t.rowCount) throw fail(404, 'Template not found.');
    const doc = (await db.query('SELECT * FROM minutes WHERE meeting_id=$1 ORDER BY version DESC LIMIT 1', [m.id])).rows[0];
    if (doc?.status === 'APPROVED') throw fail(409, 'Create a revision first.');
    if (doc) await newMinutes(db, {
      ...m,
      template_id: v.templateId
    }, doc.transcript_id, doc.content);
    await db.query('UPDATE meetings SET template_id=$2,revision=revision+1 WHERE id=$1', [m.id, v.templateId]);
    await audit(db, req.user, 'minutes.template_changed', m.id, {
      templateId: v.templateId
    });
  });
  res.json({
    ok: true
  });
}));
const contentSchema = z.object({
  summary: z.string().max(20000),
  attendees: z.array(z.string().max(200)).max(200),
  nextMeeting: z.string().max(1000).optional(),
  items: z.array(z.object({
    type: z.enum(['discussion', 'decision', 'action', 'question']),
    text: z.string().max(20000),
    evidence: z.string().max(80),
    quote: z.string().max(20000),
    owner: z.string().max(200),
    dueDate: z.string().max(50),
    verified: z.boolean()
  })).max(200)
});
app.put('/api/meetings/:id/minutes', requireRole('REVIEWER'), wrap(async (req, res) => {
  const v = z.object({
    content: contentSchema,
    revision: z.number().int()
  }).parse(req.body);
  const result = await tx(async db => {
    const m = await meetingFor(req.user, req.params.id, db, true);
    if (!['READY_FOR_REVIEW', 'REJECTED'].includes(m.status)) throw fail(409, 'This version is read-only. Reopen approved minutes to create a new version.');
    const {
      rows
    } = await db.query('SELECT * FROM minutes WHERE meeting_id=$1 ORDER BY version DESC LIMIT 1 FOR UPDATE', [m.id]);
    const doc = rows[0];
    if (!doc || doc.revision !== v.revision) throw fail(409, 'Another reviewer changed this draft. Reload before saving.');
    await db.query('UPDATE minutes SET content=$2,revision=revision+1,updated_at=now() WHERE id=$1', [doc.id, v.content]);
    await audit(db, req.user, 'minutes.edited', m.id, {
      version: doc.version,
      before: doc.content,
      after: v.content
    });
    return {
      revision: doc.revision + 1
    };
  });
  res.json(result);
}));
app.post('/api/meetings/:id/actions/:action', wrap(async (req, res) => {
  const action = req.params.action;
  if (!can(req.user, ...(action === 'submit' ? ['REVIEWER'] : action === 'cancel' ? ['MEETING_ORGANIZER'] : ['APPROVER']))) throw fail(403, 'Your role does not allow this action.');
  const v = z.object({
    revision: z.number().int(),
    reason: z.string().max(2000).optional()
  }).parse(req.body);
  await tx(async db => {
    const m = await meetingFor(req.user, req.params.id, db, true);
    if (m.revision !== v.revision) throw fail(409, 'Meeting changed. Reload and try again.');
    let status;
    if(action==='cancel'&&await queueCaptureStop(db,m)){await audit(db,req.user,'capture.stop_requested',m.id);return;}
    try {
      status = nextState(m.status, action);
    } catch (e) {
      throw fail(409, e.message);
    }
    const {
      rows
    } = await db.query('SELECT * FROM minutes WHERE meeting_id=$1 ORDER BY version DESC LIMIT 1 FOR UPDATE', [m.id]);
    const doc = rows[0];
    if (action !== 'cancel' && !doc) throw fail(409, 'There are no minutes to review.');
    if (['submit', 'approve'].includes(action)) {
      const tr = await db.query('SELECT segments FROM transcripts WHERE id=$1', [doc.transcript_id]);
      const issues = validateEvidence(doc.content, tr.rows[0]?.segments || []);
      if (!doc.content.summary.trim() || !doc.content.items.length) issues.push('Add a summary and at least one minutes item.');
      if (issues.length) throw fail(422, issues.join(' '));
    }
    if (action === 'reopen') {
      await newMinutes(db, m, doc.transcript_id, {
        ...doc.content,
        items: doc.content.items.map(i => ({
          ...i,
          verified: false
        }))
      });
    } else if (action === 'approve') await db.query("UPDATE minutes SET status='APPROVED',approved_by=$2,approved_at=now(),revision=revision+1 WHERE id=$1", [doc.id, req.user.id]);else if (action === 'submit') await db.query("UPDATE minutes SET status='IN_REVIEW',revision=revision+1 WHERE id=$1", [doc.id]);else if (action === 'reject') {
      if (!v.reason?.trim()) throw fail(400, 'Give a reason for returning the draft.');
      await db.query("UPDATE minutes SET status='REJECTED',reviewer_comment=$2,revision=revision+1 WHERE id=$1", [doc.id, v.reason]);
    }
    await db.query('UPDATE meetings SET status=$2,revision=revision+1,updated_at=now() WHERE id=$1', [m.id, status]);
    await audit(db, req.user, `meeting.${action}`, m.id, {
      version: doc?.version,
      reason: v.reason
    });
  });
  res.json({
    ok: true
  });
}));
app.get('/api/meetings/:id/export/:format', wrap(async (req, res) => {
  const m = await meetingFor(req.user, req.params.id);
  const format = req.params.format;
  if (!['docx', 'pdf'].includes(format)) throw fail(400, 'Choose DOCX or PDF.');
  const doc = (await query('SELECT * FROM minutes WHERE meeting_id=$1 AND ($2::integer IS NULL OR version=$2) ORDER BY version DESC LIMIT 1', [m.id, req.query.version ? z.coerce.number().int().positive().parse(req.query.version) : null])).rows[0];
  if (!doc) throw fail(404, 'Generate minutes before exporting.');
  const segments = (await query('SELECT segments FROM transcripts WHERE id=$1', [doc.transcript_id])).rows[0]?.segments || [];
  const layout = doc.template_snapshot?.id ? (await query('SELECT docx_data FROM templates WHERE id=$1 AND org_id=$2', [doc.template_snapshot.id, m.org_id])).rows[0]?.docx_data : null;
  let buffer;
  if (layout) {
    const word = renderDocxTemplate(layout, templateData(m, doc, segments));
    buffer = format === 'docx' ? word : await docxToPdf(word);
  } else {
    const lines = documentLines(m, doc, segments);
    buffer = format === 'docx' ? await exportDocx(lines) : await exportPdf(lines);
  }
  await audit(pool, req.user, 'minutes.exported', m.id, {
    format,
    version: doc.version,
    status: doc.status,
    wordLayout: !!layout
  });
  res.setHeader('Content-Disposition', `attachment; filename="minutes-v${doc.version}-${doc.status.toLowerCase()}.${format}"`);
  res.type(format === 'docx' ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : 'application/pdf').send(buffer);
}));
templateRoutes(app, {
  wrap,
  admin,
  fail
});
app.get('/api/reviewers', wrap(async (req, res) => {
  res.json((await query("SELECT id,name FROM users WHERE org_id=$1 AND active=true AND roles && ARRAY['REVIEWER','ORG_ADMIN'] ORDER BY name", [req.user.org_id])).rows);
}));
app.get('/api/admin/users', admin, wrap(async (req, res) => {
  res.json((await query('SELECT id,name,email,roles,unit_ids,active,external_id,removed_at FROM users WHERE org_id=$1 ORDER BY name', [req.user.org_id])).rows);
}));
app.post('/api/admin/users', admin, wrap(async (req, res) => {
  const v = z.object({
    name: z.string().min(2).max(100),
    email: z.email(),
    password: newPasswordSchema,
    roles: z.array(z.enum(ROLES)).min(1),
    unitIds: z.array(z.uuid())
  }).parse(req.body);
  const allowed = (await query('SELECT id FROM units WHERE org_id=$1', [req.user.org_id])).rows.map(r => r.id);
  if (v.unitIds.some(id => !allowed.includes(id))) throw fail(400, 'Invalid team.');
  const id = randomUUID();
  await tx(async db => {
    await db.query('INSERT INTO users(id,org_id,name,email,password_hash,roles,unit_ids) VALUES($1,$2,$3,$4,$5,$6,$7)', [id, req.user.org_id, v.name, v.email.toLowerCase(), hashPassword(v.password), v.roles, v.unitIds]);
    await audit(db, req.user, 'user.created', null, {
      userId: id,
      roles: v.roles
    });
  });
  res.status(201).json({
    id
  });
}));
app.patch('/api/admin/users/:id', admin, wrap(async (req, res) => {
  const id = z.uuid().parse(req.params.id);
  const v = z.object({
    active: z.boolean(),
    roles: z.array(z.enum(ROLES)).min(1),
    unitIds: z.array(z.uuid())
  }).parse(req.body);
  if (id === req.user.id) throw fail(409, 'Use another administrator to change your own access.');
  const allowed = (await query('SELECT id FROM units WHERE org_id=$1', [req.user.org_id])).rows.map(r => r.id);
  if (v.unitIds.some(id => !allowed.includes(id))) throw fail(400, 'Invalid team.');
  await tx(async db => {
    const r = await db.query('UPDATE users SET active=$3,roles=$4,unit_ids=$5 WHERE id=$1 AND org_id=$2 RETURNING id', [id, req.user.org_id, v.active, v.roles, v.unitIds]);
    if (!r.rowCount) throw fail(404, 'User not found.');
    if (!v.active) await db.query('DELETE FROM sessions WHERE user_id=$1', [id]);
    await audit(db, req.user, 'user.access_changed', null, {
      userId: id,
      ...v
    });
  });
  res.json({
    ok: true
  });
}));
app.post('/api/admin/units', admin, wrap(async (req, res) => {
  const v = z.object({
    name: z.string().min(2).max(100),
    kind: z.enum(['department', 'team']),
    parentId: z.uuid().nullable()
  }).parse(req.body);
  if (v.kind === 'team' && !v.parentId) throw fail(400, 'Choose a parent department.');
  if (v.parentId) {
    const p = await query("SELECT id FROM units WHERE id=$1 AND org_id=$2 AND kind='department'", [v.parentId, req.user.org_id]);
    if (!p.rowCount) throw fail(400, 'Invalid department.');
  }
  const id = randomUUID();
  await query('INSERT INTO units(id,org_id,name,kind,parent_id) VALUES($1,$2,$3,$4,$5)', [id, req.user.org_id, v.name, v.kind, v.parentId]);
  await audit(pool, req.user, 'unit.created', null, {
    id,
    ...v
  });
  res.status(201).json({
    id
  });
}));
app.get('/api/admin/integrations', admin, wrap(async (req, res) => {
  const rows = (await query('SELECT provider,config,status,checked_at,secret IS NOT NULL AS has_secret FROM integrations WHERE org_id=$1', [req.user.org_id])).rows;
  const capture=await captureSummary(req.user.org_id);
  rows.push(...capture);
  res.json(['Microsoft 365', 'ElevenLabs', 'Minutes AI', 'Teams', 'Zoom'].map(provider => rows.find(r => r.provider === provider) || {
    provider,
    status: 'NOT_CONFIGURED',
    config: {},
    has_secret: false
  }));
}));
const integrationSchema = z.object({
  provider: z.enum(['Microsoft 365', 'ElevenLabs', 'Minutes AI']),
  config: z.object({
    tenantId: z.string().optional(),
    clientId: z.string().optional(),
    model: z.string().max(100).optional(),
    baseUrl: z.string().max(1000).optional()
  }),
  secret: z.string().max(10000).optional()
});
app.put('/api/admin/integrations', admin, wrap(async (req, res) => {
  if (req.user.demo) throw fail(403, 'Secrets cannot be saved in the shared sample workspace. Set up your company first.');
  const v = integrationSchema.parse(req.body);
  if (v.provider === 'Microsoft 365') {
    z.uuid().parse(v.config.tenantId);
    z.uuid().parse(v.config.clientId);
  }
  if (v.provider === 'Minutes AI') validateLlmURL(v.config.baseUrl);
  await query("INSERT INTO integrations(org_id,provider,config,secret,status) VALUES($1,$2,$3,$4,'CONFIGURED') ON CONFLICT(org_id,provider) DO UPDATE SET config=EXCLUDED.config,secret=COALESCE(EXCLUDED.secret,integrations.secret),status='CONFIGURED',checked_at=NULL", [req.user.org_id, v.provider, v.config, v.secret ? encrypt(v.secret) : null]);
  await audit(pool, req.user, 'integration.configured', null, {
    provider: v.provider
  });
  res.json({
    ok: true
  });
}));
app.post('/api/admin/sync-directory', admin, wrap(async (req, res) => {
  if (req.user.demo) throw fail(403, 'Directory sync is unavailable in the sample workspace.');
  res.json(await syncDirectory(req.user));
}));
app.post('/api/calendar/sync', requireRole('MEETING_ORGANIZER'), wrap(async (req, res) => {
  if (req.user.demo) throw fail(403, 'Calendar sync is unavailable in the sample workspace.');
  if (!req.user.external_id) throw fail(409, 'Sign in with a synced Microsoft account to import your calendar.');
  const c = await integration(req.user.org_id, 'Microsoft 365');
  const token = await graphToken(c);
  const start = new Date();
  const end = new Date(Date.now() + 30 * 86400000);
  const events = await graphPages(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(req.user.external_id)}/calendarView?startDateTime=${start.toISOString()}&endDateTime=${end.toISOString()}&$select=id,subject,start,end,onlineMeeting,isCancelled`, token);
  res.json({
    events: events.filter(e => !e.isCancelled).map(e => ({
      id: e.id,
      title: e.subject,
      start: e.start,
      joinUrl: e.onlineMeeting?.joinUrl || ''
    })),
    note: 'Select an event and explicitly assign a minutes taker. Importing does not record meetings.'
  });
}));
app.get('/api/admin/rates', admin, wrap(async (req, res) => {
  res.json((await query('SELECT * FROM rate_cards WHERE org_id=$1 ORDER BY effective_at DESC', [req.user.org_id])).rows);
}));
app.post('/api/admin/rates', admin, wrap(async (req, res) => {
  const v = z.object({
    provider: z.enum(['ElevenLabs', 'Minutes AI', 'Recall.ai']),
    model: z.string().min(1).max(100),
    unit: z.enum(['audio_minute', 'bot_minute', 'input_million_tokens', 'output_million_tokens']),
    usdRate: z.number().min(0).max(100000),
    hkdPerUsd: z.number().positive().max(100000),
    effectiveAt: z.iso.datetime({
      offset: true
    })
  }).parse(req.body);
  const id = randomUUID();
  await query('INSERT INTO rate_cards(id,org_id,provider,model,unit,usd_rate,hkd_per_usd,effective_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)', [id, req.user.org_id, v.provider, v.model, v.unit, v.usdRate, v.hkdPerUsd, v.effectiveAt]);
  await audit(pool, req.user, 'rate_card.published', null, v);
  res.status(201).json({
    id
  });
}));
app.get('/api/admin/audit', admin, wrap(async (req, res) => {
  res.json((await query('SELECT a.id,a.action,a.detail,a.created_at,u.name AS actor FROM audit a LEFT JOIN users u ON u.id=a.user_id WHERE a.org_id=$1 ORDER BY a.id DESC LIMIT 200', [req.user.org_id])).rows);
}));
app.get('/api/admin/usage', admin, wrap(async (req, res) => {
  res.json((await query('SELECT u.*,m.title FROM usage u JOIN meetings m ON m.id=u.meeting_id WHERE m.org_id=$1 ORDER BY u.created_at DESC LIMIT 500', [req.user.org_id])).rows);
}));
captureRoutes(app,{admin,wrap,meetingFor,requireRole});
directCaptureRoutes(app,{admin,wrap});
app.use('/api', (req, res) => res.status(404).json({
  error: 'API route not found.'
}));
app.use(express.static(path.join(ROOT, 'public')));
app.get('/{*path}', (req, res) => res.sendFile(path.join(ROOT, 'public/index.html')));
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  const status = err instanceof z.ZodError ? 400 : err.code === '23505' ? 409 : err.code === 'LIMIT_FILE_SIZE' ? 413 : err.status || 500;
  const message = err instanceof z.ZodError ? err.issues.map(i => `${i.path.join('.')}: ${i.message}`).join(' ') : err.code === '23505' ? 'This record already exists, or a job is already queued.' : err.code === 'LIMIT_FILE_SIZE' ? (req.path.startsWith('/api/templates')?'Template exceeds the 5 MB limit.':'Recording exceeds the 250 MB upload limit.') : status === 500 ? 'The request could not be completed. Check server logs.' : err.message;
  if (status === 500) console.error(err.name, err.message);
  res.status(status).json({
    error: message
  });
});

// Jobs interrupted during process restart require explicit retry to avoid duplicate provider charges.
await query("UPDATE jobs SET status='FAILED',error='Interrupted by server restart; review usage before retrying.' WHERE status='RUNNING'");
await query("UPDATE capture_sessions SET state='UNKNOWN' WHERE state='DISPATCHING' AND bot_id IS NULL");
await query("UPDATE meetings SET status='FAILED',error='Capture dispatch was interrupted. Use the recovery controls in the meeting workspace; capture may already exist.',revision=revision+1 WHERE id IN (SELECT meeting_id FROM capture_sessions WHERE state='UNKNOWN')");
await query("UPDATE meetings SET status=CASE WHEN status='GENERATING_MINUTES' THEN 'READY_FOR_REVIEW' ELSE 'FAILED' END,error='Processing was interrupted. Your saved transcript is retained. Review usage before retrying.' WHERE status IN ('TRANSCRIBING_FINAL','GENERATING_MINUTES') AND id IN (SELECT meeting_id FROM jobs WHERE status='FAILED') AND id NOT IN (SELECT meeting_id FROM jobs WHERE status='PENDING')");
let busy = false;
async function runJob() {
  if (busy) return;
  busy = true;
  let job;
  try {
    job = await tx(async db => {
      const {
        rows
      } = await db.query("SELECT * FROM jobs WHERE status='PENDING' AND run_at<=now() ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED");
      if (!rows[0]) return null;
      await db.query("UPDATE jobs SET status='RUNNING',locked_at=now(),attempts=attempts+1 WHERE id=$1", [rows[0].id]);
      return rows[0];
    });
    if (!job) return;
    const m = (await query('SELECT * FROM meetings WHERE id=$1', [job.meeting_id])).rows[0];
    if(job.type.startsWith('CAPTURE_')) {
      await runCaptureJob(job,m,DATA);
    } else if (job.type === 'TRANSCRIBE') {
      const segments = await transcribe(m);
      await tx(async db => saveTranscription(db, m, segments));
    } else {
      const t = (await query('SELECT * FROM transcripts WHERE meeting_id=$1 ORDER BY version DESC LIMIT 1', [m.id])).rows[0];
      const template = (await query('SELECT name,language,sections FROM templates WHERE id=$1', [m.template_id])).rows[0];
      const content = await generateMinutes(m, t.segments, template);
      await tx(async db => {
        await newMinutes(db, m, t.id, content);
        await db.query("UPDATE meetings SET status='READY_FOR_REVIEW',revision=revision+1,error=NULL WHERE id=$1", [m.id]);
      });
    }
    await query("UPDATE jobs SET status='COMPLETED' WHERE id=$1", [job.id]);
    await audit(pool, {
      org_id: m.org_id,
      id: m.owner_id
    }, 'processing.completed', m.id, {
      type: job.type
    });
  } catch (e) {
    console.error('Job failed:', e.message);
    if (job) {
      if(job.type.startsWith('CAPTURE_')&&e.retryAfter&&job.attempts<3){await query("UPDATE jobs SET status='PENDING',run_at=now()+$2*interval '1 second',error=$3 WHERE id=$1",[job.id,e.retryAfter+Math.ceil(Math.random()*5),e.message]);return;}
      await query("UPDATE jobs SET status='FAILED',error=$2 WHERE id=$1", [job.id, e.message]);
      // Billing retrieval must never turn a completed capture into a failed meeting.
      if(job.type!=='CAPTURE_USAGE')await query("UPDATE meetings SET status=$3,error=$2,revision=revision+1 WHERE id=$1 AND NOT ($4 AND status IN ('READY_FOR_REVIEW','IN_REVIEW','APPROVED','REJECTED','GENERATING_MINUTES','TRANSCRIBING_FINAL'))", [job.meeting_id, e.message, job.type === 'GENERATE' ? 'READY_FOR_REVIEW' : 'FAILED',job.type.startsWith('CAPTURE_')]);
    }
  } finally {
    busy = false;
  }
}
setInterval(runJob, 3000).unref();
setInterval(runCaptureEvents,2000).unref();
setInterval(()=>pollDirectCaptures().catch(()=>console.error('Direct capture status check failed.')),10000).unref();
setInterval(() => query('DELETE FROM sessions WHERE expires_at<now()').catch(console.error), 3600000).unref();
const server = app.listen(PORT, '0.0.0.0', () => console.log(`AI Minutes listening on ${PORT}`));
const callbacks=webhookApp().listen(Number(process.env.CAPTURE_WEBHOOK_PORT||5001),'0.0.0.0',()=>console.log('Capture webhook listener ready (no UI or login routes).'));
process.on('SIGTERM',()=>callbacks.close());
process.on('SIGTERM', () => server.close(async () => {
  await pool.end();
  process.exit(0);
}));

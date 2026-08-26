const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const bcrypt = require("bcryptjs");
const dotenv = require("dotenv");
const express = require("express");
const session = require("express-session");
const multer = require("multer");
const nodemailer = require("nodemailer");
const { PDFDocument, StandardFonts, rgb } = require("pdf-lib");
const fontkit = require("@pdf-lib/fontkit");
const xlsx = require("xlsx");
const ExcelJS = require("exceljs");
const { createTemplatedDocxBuffer } = require("./report-docx");

dotenv.config();

const { db, DB_CLIENT, ensureSchema } = require("./db");

const app = express();
app.disable("x-powered-by");
const PORT = Number(process.env.PORT || 3000);
const APP_BASE_URL = process.env.APP_BASE_URL || `http://localhost:${PORT}`;
const USE_SECURE_COOKIES = process.env.NODE_ENV === "production" || /^https:\/\//i.test(APP_BASE_URL);
if (USE_SECURE_COOKIES) app.set("trust proxy", 1);

const VERIFY_TOKEN_TTL_MS = Number(process.env.VERIFY_TOKEN_TTL_MS || 1000 * 60 * 30);
const RESEND_MIN_INTERVAL_MS = Number(process.env.RESEND_MIN_INTERVAL_MS || 1000 * 60);
const RESEND_WINDOW_MS = Number(process.env.RESEND_WINDOW_MS || 1000 * 60 * 15);
const RESEND_MAX_PER_WINDOW = Number(process.env.RESEND_MAX_PER_WINDOW || 3);
const MAX_LOGIN_FAILURES = Number(process.env.MAX_LOGIN_FAILURES || 5);
const LOCKOUT_DURATION_MS = Number(process.env.LOCKOUT_DURATION_MS || 1000 * 60 * 15);
const ADMIN_ACCESS_KEY = String(process.env.ADMIN_ACCESS_KEY || "").trim();
const ADMIN_EMAIL = normalizeEmail(process.env.ADMIN_EMAIL || "admin@adm.local");
const ADMIN_PASSWORD = String(process.env.ADMIN_PASSWORD || "Admin@12345!");
const ADMIN_FIRSTNAME = String(process.env.ADMIN_FIRSTNAME || "System").trim();
const ADMIN_LASTNAME = String(process.env.ADMIN_LASTNAME || "Administrator").trim();
const ADM_APPROVAL_PIN = "09912080396";
const DEFAULT_SMTP_FROM = String(process.env.SMTP_FROM || "adm.sdocebu@gmail.com").trim();
const DISTRICT_SCHOOL_XLSX_PATH = String(
  process.env.DISTRICT_SCHOOL_XLSX_PATH ||
    path.join(__dirname, "assets", "list of districts with schools.xlsx")
).trim();
const APPROVAL_REQUEST_UPLOAD_DIR = path.join(__dirname, "uploads", "approval-requests");
const ADM_APPROVAL_TEMPLATE_PATH = path.join(__dirname, "assets", "documents", "ADM-Approval.pdf");
const ADM_APPROVAL_FONT_PATH = path.join(__dirname, "assets", "fonts", "Bookman-Old-Style.ttf");
const ADM_APPROVAL_OUTPUT_DIR = path.join(__dirname, "uploads", "adm-approvals");
const PROFILE_IMAGE_UPLOAD_DIR = path.join(__dirname, "uploads", "profile-images");
const LEARNING_RESOURCE_UPLOAD_DIR = path.join(__dirname, "uploads", "learning-resources");
const DATABASE_RESET_EVENT = "reset-retain-configured-admin-2026-07-31-v1";

const districtSchoolReferenceCache = {
  sourceFile: "",
  mtimeMs: 0,
  districts: [],
  schoolsByDistrict: {}
};

fs.mkdirSync(APPROVAL_REQUEST_UPLOAD_DIR, { recursive: true });
fs.mkdirSync(ADM_APPROVAL_OUTPUT_DIR, { recursive: true });
fs.mkdirSync(PROFILE_IMAGE_UPLOAD_DIR, { recursive: true });
fs.mkdirSync(LEARNING_RESOURCE_UPLOAD_DIR, { recursive: true });

const approvalRequestUpload = multer({
  storage: multer.diskStorage({
    destination: function (req, file, cb) {
      cb(null, APPROVAL_REQUEST_UPLOAD_DIR);
    },
    filename: function (req, file, cb) {
      const ext = path.extname(String((file && file.originalname) || "")).toLowerCase();
      cb(null, `${Date.now()}-${crypto.randomUUID()}${ext}`);
    }
  }),
  limits: {
    fileSize: 10 * 1024 * 1024
  },
  fileFilter: function (req, file, cb) {
    const allowedExtensions = [".pdf", ".png", ".jpg", ".jpeg", ".doc", ".docx"];
    const ext = path.extname(String((file && file.originalname) || "")).toLowerCase();
    if (!allowedExtensions.includes(ext)) {
      cb(new Error("Invalid file type. Upload PDF, PNG, JPG, DOC, or DOCX."));
      return;
    }
    cb(null, true);
  }
});

const admRequestStreamClients = new Set();
const teacherAdmRequestStreamClients = new Set();

function broadcastAdmRequestUpdate(payload) {
  const message = `event: adm-request-created\ndata: ${JSON.stringify(payload || {})}\n\n`;
  for (const client of admRequestStreamClients) {
    try {
      client.write(message);
    } catch (error) {
      admRequestStreamClients.delete(client);
    }
  }
}

function broadcastTeacherAdmRequestStatusUpdate(requestorUserId, payload) {
  const targetUserId = String(requestorUserId || "").trim();
  if (!targetUserId) {
    return;
  }

  const message = `event: adm-request-updated\ndata: ${JSON.stringify(payload || {})}\n\n`;
  for (const client of teacherAdmRequestStreamClients) {
    if (!client || client.userId !== targetUserId) {
      continue;
    }

    try {
      client.response.write(message);
    } catch (error) {
      teacherAdmRequestStreamClients.delete(client);
    }
  }
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function createVerificationToken() {
  return crypto.randomBytes(32).toString("hex");
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function isStrongPassword(password) {
  const value = String(password || "");
  if (value.length < 8) return false;
  if (!/[A-Z]/.test(value)) return false;
  if (!/[a-z]/.test(value)) return false;
  if (!/[0-9]/.test(value)) return false;
  if (!/[^A-Za-z0-9]/.test(value)) return false;
  return true;
}

function formatDatabaseError(error, fallbackMessage) {
  const raw = String((error && error.message) || "").trim();
  if (!raw) return fallbackMessage;

  if (raw.includes("SQLITE_CONSTRAINT")) {
    if (raw.includes("UNIQUE constraint failed: users.email")) {
      return "Email is already registered.";
    }

    const notNullMatch = raw.match(/NOT NULL constraint failed: ([\w.]+)/i);
    if (notNullMatch) {
      const col = String(notNullMatch[1] || "").split(".").pop();
      return `Missing value for ${col}.`;
    }

    return "Database constraint violation.";
  }

  if (raw.includes("SQLITE_ERROR") && raw.toLowerCase().includes("no such column")) {
    return "Database schema is out of date. Please run migration.";
  }

  return fallbackMessage;
}

function deleteFileIfExists(filePath) {
  try {
    if (filePath && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (error) {
    // Best-effort cleanup only.
  }
}

function resolveApprovalUploadPath(documentPath) {
  const relativePath = String(documentPath || "").trim().replace(/^[/\\]+/, "");
  if (!relativePath) return "";
  const normalized = path.normalize(relativePath);
  const absolute = path.resolve(__dirname, normalized);
  const uploadsRoot = path.resolve(APPROVAL_REQUEST_UPLOAD_DIR);
  if (!absolute.startsWith(uploadsRoot)) {
    return "";
  }
  return absolute;
}

function sanitizeUser(user) {
  return {
    id: user.id,
    email: user.email,
    role: String(user.role || "teacher").trim().toLowerCase(),
    firstname: user.firstname,
    lastname: user.lastname,
    middlename: user.middlename,
    district: user.district,
    school: user.school,
	username: user.username || "",
	lrn: user.lrn || "",
	account_type: user.account_type || "school",
	school_id: user.school_id || "",
	profile_image: user.profile_image || "",
	extension_name: user.extension_name || "",
	gender: user.gender || "",
	birth_date: user.birth_date || "",
	current_residence: user.current_residence || "",
	religion: user.religion || "",
	mother_tongue: user.mother_tongue || "",
	ethnicity: user.ethnicity || "",
	mothers_maiden_name: user.mothers_maiden_name || "",
	fathers_name: user.fathers_name || "",
	guardian_name: user.guardian_name || "",
	guardian_contact: user.guardian_contact || "",
	created_at: user.created_at || "",
	updated_at: user.updated_at || "",
    verified: Boolean(user.verified),
    approved: Boolean(user.approved),
    theme_preference: String(user.theme_preference || "light").trim().toLowerCase()
  };
}

function normalizeReferenceCell(value) {
  return String(value == null ? "" : value).replace(/\s+/g, " ").trim();
}

function findHeaderIndex(rows) {
  for (let i = 0; i < rows.length; i += 1) {
    const row = Array.isArray(rows[i]) ? rows[i].map((cell) => normalizeReferenceCell(cell).toLowerCase()) : [];
    const districtIdx = row.findIndex((cell) => cell === "district" || cell.includes("district"));
    const schoolNameIdx = row.findIndex(
      (cell) => cell === "name of school" || (cell.includes("school") && !cell.includes("id"))
    );
    const schoolIdIdx = row.findIndex((cell) => cell === "school id" || (cell.includes("school") && cell.includes("id")));
    if (districtIdx >= 0 && schoolNameIdx >= 0) {
      return { rowIndex: i, districtIdx, schoolNameIdx, schoolIdIdx };
    }
  }

  return null;
}

function parseDistrictSchoolRows(rows) {
  const header = findHeaderIndex(rows);
  const districtToSchools = new Map();

  let startIndex = 0;
  let districtIdx = 0;
  let schoolNameIdx = 1;
  let schoolIdIdx = -1;

  if (header) {
    startIndex = header.rowIndex + 1;
    districtIdx = header.districtIdx;
    schoolNameIdx = header.schoolNameIdx;
    schoolIdIdx = header.schoolIdIdx;
  }

  for (let i = startIndex; i < rows.length; i += 1) {
    const row = Array.isArray(rows[i]) ? rows[i] : [];
    const district = normalizeReferenceCell(row[districtIdx]);
    const schoolName = normalizeReferenceCell(row[schoolNameIdx]);
    const schoolId = schoolIdIdx >= 0 ? normalizeReferenceCell(row[schoolIdIdx]) : "";

    if (!district || !schoolName) {
      continue;
    }

    if (!districtToSchools.has(district)) {
      districtToSchools.set(district, new Map());
    }

    const schoolMap = districtToSchools.get(district);
    if (!schoolMap.has(schoolName)) {
      schoolMap.set(schoolName, {
        id: schoolId,
        name: schoolName
      });
    }
  }

  const districts = Array.from(districtToSchools.keys()).sort((a, b) => a.localeCompare(b));
  const schoolsByDistrict = {};

  districts.forEach((district) => {
    schoolsByDistrict[district] = Array.from(districtToSchools.get(district).values()).sort((a, b) =>
      a.name.localeCompare(b.name)
    );
  });

  return { districts, schoolsByDistrict };
}

function loadDistrictSchoolReference() {
  if (!DISTRICT_SCHOOL_XLSX_PATH) {
    throw new Error("DISTRICT_SCHOOL_XLSX_PATH is not configured.");
  }

  const stat = fs.statSync(DISTRICT_SCHOOL_XLSX_PATH);
  if (
    districtSchoolReferenceCache.sourceFile === DISTRICT_SCHOOL_XLSX_PATH &&
    districtSchoolReferenceCache.mtimeMs === stat.mtimeMs
  ) {
    return {
      sourceFile: districtSchoolReferenceCache.sourceFile,
      districts: districtSchoolReferenceCache.districts,
      schoolsByDistrict: districtSchoolReferenceCache.schoolsByDistrict
    };
  }

  const workbook = xlsx.readFile(DISTRICT_SCHOOL_XLSX_PATH);
  const firstSheetName = workbook.SheetNames[0];

  if (!firstSheetName) {
    throw new Error("No worksheet found in district-school Excel file.");
  }

  const worksheet = workbook.Sheets[firstSheetName];
  const rows = xlsx.utils.sheet_to_json(worksheet, {
    header: 1,
    raw: false,
    defval: ""
  });

  const parsed = parseDistrictSchoolRows(rows);

  districtSchoolReferenceCache.sourceFile = DISTRICT_SCHOOL_XLSX_PATH;
  districtSchoolReferenceCache.mtimeMs = stat.mtimeMs;
  districtSchoolReferenceCache.districts = parsed.districts;
  districtSchoolReferenceCache.schoolsByDistrict = parsed.schoolsByDistrict;

  return {
    sourceFile: districtSchoolReferenceCache.sourceFile,
    districts: districtSchoolReferenceCache.districts,
    schoolsByDistrict: districtSchoolReferenceCache.schoolsByDistrict
  };
}

async function ensureAdminAccount() {
  const nowIso = new Date().toISOString();
  const existingAdmin = await db("users")
    .whereRaw("LOWER(email) = ?", [ADMIN_EMAIL])
    .first();

  const adminPayload = {
    email: ADMIN_EMAIL,
    password_hash: await bcrypt.hash(ADMIN_PASSWORD, 12),
    firstname: ADMIN_FIRSTNAME || "System",
    lastname: ADMIN_LASTNAME || "Administrator",
    middlename: "",
    district: "System",
    school: "System",
    role: "admin",
    verified: true,
    approved: true,
    verification_token_hash: null,
    verification_token_expires_at: null,
    verification_email_sent_at: null,
    resend_window_started_at: null,
    resend_count: 0,
    failed_login_count: 0,
    lockout_until: null,
    updated_at: nowIso
  };

  if (!existingAdmin) {
    await db("users").insert({
      id: crypto.randomUUID(),
      created_at: nowIso,
      ...adminPayload
    });
    console.log(`Admin account created: ${ADMIN_EMAIL}`);
    return;
  }

  await db("users")
    .where({ id: existingAdmin.id })
    .update({
      role: "admin",
      approved: true,
      verified: true,
      updated_at: nowIso
    });
}

function hasSmtpConfig() {
  const provider = String(process.env.SMTP_PROVIDER || "gmail").toLowerCase();

  if (provider === "gmail") {
    return Boolean(process.env.SMTP_USER && process.env.SMTP_PASS);
  }

  return (
    process.env.SMTP_HOST &&
    process.env.SMTP_PORT &&
    process.env.SMTP_USER &&
    process.env.SMTP_PASS
  );
}

function getTransporter() {
  const provider = String(process.env.SMTP_PROVIDER || "gmail").toLowerCase();

  if (provider === "gmail") {
    return nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      }
    });
  }

  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT),
    secure: String(process.env.SMTP_SECURE || "false") === "true",
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });
}

async function sendVerificationEmail({ email, firstname, token }) {
  const verifyLink = `${APP_BASE_URL}/verify.html?token=${encodeURIComponent(token)}&email=${encodeURIComponent(email)}`;

  const transporter = getTransporter();
  await transporter.sendMail({
    from: DEFAULT_SMTP_FROM,
    to: email,
    subject: "Verify your ADM Dashboard account",
    html: `
      <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #1f2a22;">
        <h2 style="margin-bottom: 8px;">Welcome${firstname ? `, ${firstname}` : ""}</h2>
        <p style="margin-top: 0;">Please verify your account by clicking the button below.</p>
        <p>
          <a href="${verifyLink}" style="display: inline-block; padding: 10px 18px; border-radius: 8px; background: #17603b; color: #ffffff; text-decoration: none; font-weight: 700;">
            Verify Account
          </a>
        </p>
        <p>If the button does not work, open this link:</p>
        <p><a href="${verifyLink}">${verifyLink}</a></p>
        <p>This link expires in 30 minutes.</p>
      </div>
    `
  });
}

async function sendApprovalRequestStatusEmail({ email, requestorName, learnerName, status, reviewNote }) {
  if (!hasSmtpConfig()) {
    return false;
  }

  const normalizedStatus = String(status || "pending").trim().toLowerCase() || "pending";
  const titleStatus = getStatusLabel(normalizedStatus);
  const transporter = getTransporter();

  await transporter.sendMail({
    from: DEFAULT_SMTP_FROM,
    to: email,
    subject: `ADM Request ${titleStatus}: ${learnerName}`,
    html: `
      <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #1f2a22;">
        <h2 style="margin-bottom: 8px;">ADM Request ${titleStatus}</h2>
        <p>Hello${requestorName ? ` ${requestorName}` : ""},</p>
        <p>Your ADM request for <strong>${learnerName}</strong> has been marked as <strong>${titleStatus}</strong>.</p>
        ${reviewNote ? `<p><strong>Result / Note:</strong> ${String(reviewNote).replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p>` : ""}
        <p>Please log in to the ADM system for the latest request details.</p>
      </div>
    `
  });

  return true;
}

async function sendAdmRequestStatusEmail({ email, requestorName, status, reviewNote, requestDate, district, school, admFocal, approvalPdfPath }) {
  if (!hasSmtpConfig()) {
    return false;
  }

  const titleStatus = getStatusLabel(status);
  const transporter = getTransporter();

  let subject = `ADM Request ${titleStatus}`;
  let htmlContent = `
      <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #1f2a22;">
        <h2 style="margin-bottom: 8px;">ADM Request ${titleStatus}</h2>
        <p>Hello${requestorName ? ` ${requestorName}` : ""},</p>
        <p>Your ADM request has been marked as <strong>${titleStatus}</strong>.</p>
        <p><strong>Date:</strong> ${String(requestDate || "N/A").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p>
        <p><strong>District:</strong> ${String(district || "N/A").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p>
        <p><strong>School:</strong> ${String(school || "N/A").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p>
        <p><strong>ADM Focal:</strong> ${String(admFocal || "N/A").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p>
        ${reviewNote ? `<p><strong>Result / Note:</strong> ${String(reviewNote).replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p>` : ""}
        <p>Please log in to the ADM system for the latest request details.</p>
      </div>
    `;

  // Use special approval template when status is approved
  if (String(status || "").trim().toLowerCase() === "approved") {
    subject = "APPROVAL OF REQUEST FOR ADM IMPLEMENTATION";
    htmlContent = `
      <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #1f2a22;">
        <p>Sir/Madam,</p>
        <p>Good day.</p>
        <p>This is to inform you that the request for the learner to be considered under the Alternative Delivery Mode (ADM) has been <strong>APPROVED</strong>. Please download the file on your ADM Account.</p>
        <p>The learner may now proceed with the necessary arrangements and comply with the requirements set by the school for the implementation of ADM. Please ensure close coordination with the assigned teacher/adviser to monitor the learner's progress and provide the necessary support throughout the process.</p>
        <p>Should you have any questions or require further clarification, please feel free to email <strong>adm.sdocebu@gmail.com</strong>.</p>
        <p>Thank you.</p>
        <br>
        <p>Sincerely,</p>
        <br>
        <p><strong>DR. JENNIFER O. ARTIAGA</strong><br>Education Program Supervisor - Filipino / ADM Coordinator<br><a href="mailto:jennifer.artiaga001@deped.gov.ph">jennifer.artiaga001@deped.gov.ph</a></p>
      </div>
    `;
  }

  const approvalAttachmentPath = approvalPdfPath
    ? path.join(__dirname, String(approvalPdfPath).replace(/^[/\\]+/, ""))
    : "";

  await transporter.sendMail({
    from: DEFAULT_SMTP_FROM,
    to: email,
    subject: subject,
    html: htmlContent,
    attachments: approvalAttachmentPath && fs.existsSync(approvalAttachmentPath)
      ? [{ filename: "ADM-Approval-Letter.pdf", path: approvalAttachmentPath, contentType: "application/pdf" }]
      : []
  });

  return true;
}

function formatIsoOrDateToLongDate(value) {
  if (!value) return "N/A";
  const d = new Date(value);
  if (!Number.isNaN(d.getTime())) {
    return d.toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric"
    });
  }

  const parts = String(value).split("-");
  if (parts.length === 3) {
    const parsed = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric"
      });
    }
  }

  return String(value);
}

async function createAdmApprovalPdf({ requestId, requestDate, approvedAt, requestorName, district, school, admFocal }) {
  if (!fs.existsSync(ADM_APPROVAL_TEMPLATE_PATH)) {
    throw new Error("ADM approval template PDF not found.");
  }

  if (!fs.existsSync(ADM_APPROVAL_FONT_PATH)) {
    throw new Error("Bookman Old Style font file not found.");
  }

  const templateBytes = fs.readFileSync(ADM_APPROVAL_TEMPLATE_PATH);
  const pdfDoc = await PDFDocument.load(templateBytes);
  pdfDoc.registerFontkit(fontkit);
  const pages = pdfDoc.getPages();
  const page = pages[0];
  const fontBytes = fs.readFileSync(ADM_APPROVAL_FONT_PATH);
  const bookmanFont = await pdfDoc.embedFont(fontBytes, { subset: true });

  // The official template reserves this line directly below the
  // "Office the Schools Division / Superintendent" heading.
  page.drawText(`Approved Date: ${formatIsoOrDateToLongDate(approvedAt)}`, {
    x: 54.025,
    y: 737,
    size: 12,
    font: bookmanFont,
    color: rgb(0, 0, 0)
  });

  const outputName = `adm-approval-${String(requestId)}.pdf`;
  const outputFsPath = path.join(ADM_APPROVAL_OUTPUT_DIR, outputName);
  const outputRelPath = path.posix.join("uploads", "adm-approvals", outputName);
  const outputBytes = await pdfDoc.save();
  fs.writeFileSync(outputFsPath, outputBytes);

  return outputRelPath;
}

function getRetryAfterSeconds(nextAllowedAtMs) {
  const seconds = Math.ceil((nextAllowedAtMs - Date.now()) / 1000);
  return seconds > 0 ? seconds : 1;
}

function getVerificationResendState(user) {
  const now = Date.now();
  const lastSent = Number(user.verification_email_sent_at || 0);
  const windowStart = Number(user.resend_window_started_at || 0);
  const currentCount = Number(user.resend_count || 0);

  if (lastSent > 0 && now - lastSent < RESEND_MIN_INTERVAL_MS) {
    return {
      allowed: false,
      reason: "cooldown",
      retryAfterSeconds: getRetryAfterSeconds(lastSent + RESEND_MIN_INTERVAL_MS)
    };
  }

  if (windowStart > 0 && now - windowStart < RESEND_WINDOW_MS) {
    if (currentCount >= RESEND_MAX_PER_WINDOW) {
      return {
        allowed: false,
        reason: "window-limit",
        retryAfterSeconds: getRetryAfterSeconds(windowStart + RESEND_WINDOW_MS)
      };
    }

    return {
      allowed: true,
      nextWindowStart: windowStart,
      nextCount: currentCount + 1
    };
  }

  return {
    allowed: true,
    nextWindowStart: now,
    nextCount: 1
  };
}

const STUDENT_ONLINE_WINDOW_MS = 75 * 1000;

function getStudentPresence(user, now = Date.now()) {
  const lastSeenAt = String((user && user.last_seen_at) || "").trim();
  const lastSeenTime = Date.parse(lastSeenAt);
  const hasActiveLogin = Boolean(String((user && user.active_session_id) || "").trim());
  const online = Boolean(hasActiveLogin && lastSeenAt && Number.isFinite(lastSeenTime) && now - lastSeenTime <= STUDENT_ONLINE_WINDOW_MS);
  return { online, last_seen_at: lastSeenAt || null };
}

class KnexSessionStore extends session.Store {
  get(sid, callback) {
    db("sessions").where({ sid }).first().then(async (row) => {
      if (!row) return callback(null, null);
      if (Number(row.expires_at || 0) <= Date.now()) {
        await db("sessions").where({ sid }).delete();
        return callback(null, null);
      }
      try {
        return callback(null, JSON.parse(row.data));
      } catch (error) {
        await db("sessions").where({ sid }).delete();
        return callback(null, null);
      }
    }).catch(callback);
  }

  set(sid, value, callback) {
    const expiresAt = value && value.cookie && value.cookie.expires
      ? new Date(value.cookie.expires).getTime()
      : Date.now() + 24 * 60 * 60 * 1000;
    const data = JSON.stringify(value);
    db("sessions").insert({ sid, data, expires_at: expiresAt }).onConflict("sid").merge({ data, expires_at: expiresAt })
      .then(() => callback && callback(null)).catch((error) => callback && callback(error));
  }

  destroy(sid, callback) {
    db("sessions").where({ sid }).delete().then(() => callback && callback(null)).catch((error) => callback && callback(error));
  }

  touch(sid, value, callback) {
    const expiresAt = value && value.cookie && value.cookie.expires
      ? new Date(value.cookie.expires).getTime()
      : Date.now() + 24 * 60 * 60 * 1000;
    db("sessions").where({ sid }).update({ expires_at: expiresAt })
      .then(() => callback && callback(null)).catch((error) => callback && callback(error));
  }
}

const sessionStore = new KnexSessionStore();
const expiredSessionCleanup = setInterval(() => {
  db("sessions").where("expires_at", "<=", Date.now()).delete().catch(() => {});
}, 60 * 60 * 1000);
expiredSessionCleanup.unref();

app.use(express.json({ limit: "10mb" }));
app.use(
  session({
    name: "adm.sid",
    secret: process.env.SESSION_SECRET || "dev-session-secret-change-me",
	store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: USE_SECURE_COOKIES,
      maxAge: 1000 * 60 * 60 * 24
    }
  })
);
const GENERATED_EXCEL_TEMPLATE_PATH = path.join(__dirname, "assets", "document-template-generated-excel.xlsx");

function excelColumnName(columnNumber) {
  let name = "";
  let number = Math.max(1, Number(columnNumber) || 1);
  while (number > 0) {
    const remainder = (number - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    number = Math.floor((number - 1) / 26);
  }
  return name;
}

async function hasActiveAccountSession(req) {
  const userId = String((req.session && req.session.userId) || "").trim();
  const loginToken = String((req.session && req.session.loginToken) || "").trim();
  if (!userId || !loginToken) return null;
  const user = await db("users").where({ id: userId }).first();
  if (!user || String(user.active_session_id || "") !== loginToken) return null;
  return user;
}

async function createTemplatedExcelBuffer({ title, sheetName, rows, emptyRow }) {
  return createTemplatedDocxBuffer({ title, rows, emptyRow });
}

app.get("/api/reference/district-schools", (req, res) => {
  try {
    const data = loadDistrictSchoolReference();
    return res.json(data);
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return res.status(404).json({
        message: "District-school Excel file not found.",
        expectedPath: DISTRICT_SCHOOL_XLSX_PATH
      });
    }

    return res.status(500).json({
      message: "Failed to load district-school reference data.",
      detail: error.message
    });
  }
});

const registrationWindows = new Map();
const registrationWindowCleanup = setInterval(() => {
  const cutoff = Date.now() - 15 * 60 * 1000;
  registrationWindows.forEach((value, key) => {
    if (Number(value.startedAt || 0) < cutoff) registrationWindows.delete(key);
  });
}, 15 * 60 * 1000);
registrationWindowCleanup.unref();
function limitRegistrationTraffic(req, res, next) {
  const now = Date.now();
  const windowMs = 15 * 60 * 1000;
  const maximumAttempts = 300;
  const key = String(req.ip || req.socket.remoteAddress || "unknown");
  const current = registrationWindows.get(key);
  if (!current || now - current.startedAt >= windowMs) {
    registrationWindows.set(key, { startedAt: now, count: 1 });
    return next();
  }
  current.count += 1;
  if (current.count > maximumAttempts) {
    res.setHeader("Retry-After", String(Math.max(1, Math.ceil((current.startedAt + windowMs - now) / 1000))));
    return res.status(429).json({ message: "Too many registration attempts. Please wait a few minutes and try again." });
  }
  return next();
}

app.post("/api/auth/register", limitRegistrationTraffic, async (req, res) => {
  try {
    const {
      email,
      password,
      confirmPassword,
      firstname,
      lastname,
      middlename,
      district,
      school,
	  isSupervisor,
	  accountType,
	  username,
	  lrn,
	  schoolId
    } = req.body || {};

	const normalizedAccountType = String(accountType || "school").trim().toLowerCase();
	if (!email || !password || !confirmPassword || !firstname || !lastname || !district || !school || !username) {
      return res.status(400).json({ message: "Missing required fields." });
    }
	if (!/^(school|student)$/.test(normalizedAccountType)) {
	  return res.status(400).json({ message: "Invalid account type." });
	}
	if (normalizedAccountType === "student" && !/^\d{12}$/.test(String(lrn || ""))) {
	  return res.status(400).json({ message: "LRN must contain exactly 12 digits." });
	}
	if (normalizedAccountType === "school" && !String(schoolId || "").trim()) {
	  return res.status(400).json({ message: "School ID is required." });
	}

    if (password !== confirmPassword) {
      return res.status(400).json({ message: "Password and confirm password do not match." });
    }

    if (!isStrongPassword(password)) {
      return res.status(400).json({
        message: "Password must be at least 8 characters and include uppercase, lowercase, number, and special character."
      });
    }

    const normalizedEmail = normalizeEmail(email);
    const requestedSupervisor =
      isSupervisor === true ||
      String(isSupervisor || "").trim().toLowerCase() === "yes" ||
      String(isSupervisor || "").trim().toLowerCase() === "true";
    const requestedRole = requestedSupervisor ? "supervisor" : "teacher";
    const existing = await db("users").where({ email: normalizedEmail }).first();
	const normalizedUsername = String(username || "").trim().toLowerCase();
	const usernameOwner = await db("users").whereRaw("LOWER(username) = ?", [normalizedUsername]).first();
	if (usernameOwner && (!existing || usernameOwner.id !== existing.id)) {
	  return res.status(409).json({ message: "Username is already registered." });
	}

    if (existing && Boolean(existing.approved)) {
      return res.status(409).json({ message: "Account already exists and is approved." });
    }

    const now = Date.now();
    const nowIso = new Date(now).toISOString();
    const passwordHash = await bcrypt.hash(password, 12);

    const basePayload = {
      email: normalizedEmail,
      password_hash: passwordHash,
      firstname: String(firstname).trim(),
      lastname: String(lastname).trim(),
      middlename: String(middlename || "").trim(),
      district: String(district).trim(),
      school: String(school).trim(),
	  account_type: normalizedAccountType,
	  username: normalizedUsername,
	  lrn: normalizedAccountType === "student" ? String(lrn).trim() : null,
	  school_id: normalizedAccountType === "school" ? String(schoolId).trim() : null,
	  role: normalizedAccountType === "student" ? "student" : requestedRole,
      verified: true,
      approved: false,
      verification_token_hash: null,
      verification_token_expires_at: null,
      verification_email_sent_at: null,
      resend_window_started_at: now,
        resend_count: 0,
      updated_at: nowIso
    };

    if (existing) {
      await db("users").where({ id: existing.id }).update(basePayload);
    } else {
      await db("users").insert({
        id: crypto.randomUUID(),
        ...basePayload,
        created_at: nowIso
      });
    }

    return res.json({
      message: "Account request submitted. Please wait for admin approval.",
      email: normalizedEmail
    });
  } catch (error) {
    return res.status(500).json({ message: formatDatabaseError(error, "Failed to register account."), detail: error.message });
  }
});

app.post("/api/auth/resend-verification", async (req, res) => {
  return res.status(410).json({ message: "Email verification is disabled. Await admin approval." });
});

app.post("/api/auth/verify", async (req, res) => {
  return res.status(410).json({ message: "Email verification is disabled. Await admin approval." });
});

app.post("/api/auth/login", async (req, res) => {
  const email = normalizeEmail((req.body || {}).email);
  const password = String((req.body || {}).password || "");

  if (!email || !password) {
    return res.status(400).json({ message: "Username or email and password are required." });
  }

	const user = await db("users")
	  .whereRaw("LOWER(email) = ?", [email])
	  .orWhereRaw("LOWER(username) = ?", [email])
	  .first();
  if (!user) {
    return res.status(401).json({ message: "Invalid credentials." });
  }

  const now = Date.now();
  const lockoutUntil = Number(user.lockout_until || 0);
  if (lockoutUntil > now) {
    return res.status(423).json({
      message: "Account is temporarily locked due to repeated failed login attempts.",
      retryAfterSeconds: Math.ceil((lockoutUntil - now) / 1000)
    });
  }

  const isMatch = await bcrypt.compare(password, user.password_hash);
  if (!isMatch) {
    const nextFailures = Number(user.failed_login_count || 0) + 1;

    if (nextFailures >= MAX_LOGIN_FAILURES) {
      const newLockoutUntil = now + LOCKOUT_DURATION_MS;
      await db("users")
        .where({ id: user.id })
        .update({
          failed_login_count: 0,
          lockout_until: newLockoutUntil,
          updated_at: new Date(now).toISOString()
        });

      return res.status(423).json({
        message: "Account is temporarily locked due to repeated failed login attempts.",
        retryAfterSeconds: Math.ceil(LOCKOUT_DURATION_MS / 1000)
      });
    }

    await db("users")
      .where({ id: user.id })
      .update({
        failed_login_count: nextFailures,
        updated_at: new Date(now).toISOString()
      });

    return res.status(401).json({
      message: "Invalid credentials.",
      attemptsRemaining: MAX_LOGIN_FAILURES - nextFailures
    });
  }

  const role = String(user.role || "teacher").trim().toLowerCase();

  if (role !== "admin" && !Boolean(user.approved)) {
    return res.status(403).json({ message: "Account is pending admin approval." });
  }

	const loginToken = crypto.randomBytes(32).toString("hex");
  await db("users")
    .where({ id: user.id })
    .update({
      failed_login_count: 0,
      lockout_until: null,
	  active_session_id: loginToken,
      updated_at: new Date(now).toISOString()
    });

  req.session.userId = user.id;
  req.session.role = role;
  req.session.loginToken = loginToken;
  return res.json({ message: "Logged in.", user: sanitizeUser(user) });
});

const learningResourceUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, LEARNING_RESOURCE_UPLOAD_DIR),
    filename: (req, file, cb) => cb(null, `${Date.now()}-${crypto.randomUUID()}${path.extname(String(file.originalname || "")).toLowerCase()}`)
  }),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = [".pdf", ".doc", ".docx", ".ppt", ".pptx", ".xls", ".xlsx", ".png", ".jpg", ".jpeg", ".zip"];
    const extension = path.extname(String(file.originalname || "")).toLowerCase();
    if (!allowed.includes(extension)) return cb(new Error("Upload a PDF, Office document, image, or ZIP file."));
    cb(null, true);
  }
});

app.get("/api/auth/me", async (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ message: "Not logged in." });
  }

  const user = await hasActiveAccountSession(req);
  if (!user) {
    req.session.destroy(() => {});
    return res.status(401).json({ message: "Session expired or this account was signed in on another device." });
  }

  return res.json({ user: sanitizeUser(user) });
});

app.post("/api/presence/heartbeat", requireLogin, async (req, res) => {
  try {
    const user = await db("users").where({ id: req.session.userId }).first("id", "role");
    if (!user || String(user.role || "").toLowerCase() !== "student") return res.json({ tracked: false });
    const lastSeenAt = new Date().toISOString();
    await db("users").where({ id: user.id }).update({ last_seen_at: lastSeenAt });
    return res.json({ tracked: true, online: true, last_seen_at: lastSeenAt });
  } catch (error) {
    return res.status(500).json({ message: "Unable to update student presence." });
  }
});

app.post("/api/auth/logout", async (req, res) => {
  const userId = String((req.session && req.session.userId) || "").trim();
  const loginToken = String((req.session && req.session.loginToken) || "").trim();
  if (userId && loginToken) {
    await db("users").where({ id: userId, active_session_id: loginToken }).update({ active_session_id: null, updated_at: new Date().toISOString() });
  }
  req.session.destroy(() => {
    res.clearCookie("adm.sid");
    res.json({ message: "Logged out." });
  });
});

app.post("/api/user/theme", async (req, res) => {
  try {
    if (!req.session.userId) {
      return res.status(401).json({ message: "Not logged in." });
    }

    const { theme_preference } = req.body || {};
    if (!theme_preference || !["light", "dark"].includes(theme_preference)) {
      return res.status(400).json({ message: "Invalid theme preference. Must be 'light' or 'dark'." });
    }

    const user = await db("users").where({ id: req.session.userId }).first();
    if (!user) {
      return res.status(404).json({ message: "User not found." });
    }

    await db("users")
      .where({ id: req.session.userId })
      .update({
        theme_preference: theme_preference,
        updated_at: new Date().toISOString()
      });

    return res.json({ message: "Theme preference updated.", theme_preference: theme_preference });
  } catch (error) {
    return res.status(500).json({ message: "Failed to update theme preference.", detail: error.message });
  }
});

async function requireAdmin(req, res, next) {
  if (req.session && req.session.userId) {
    try {
	  const sessionUser = await hasActiveAccountSession(req);
      const currentRole = String((sessionUser || {}).role || "").trim().toLowerCase();
      if (currentRole === "admin") {
        req.session.role = currentRole;
        return next();
      }
    } catch (error) {
      return res.status(500).json({ message: "Unable to verify administrator access.", detail: error.message });
    }
  }

  const headerKey = String(req.headers["x-admin-key"] || "");
  const queryKey = String(req.query.adminKey || "");
  const bodyKey = String((req.body || {}).adminKey || "");
  const provided = headerKey || queryKey || bodyKey;

  if (!provided || provided !== ADMIN_ACCESS_KEY) {
    return res.status(401).json({ message: "Unauthorized admin access." });
  }

  return next();
}

async function resolveAdminReviewerContext(req) {
  const sessionUserId = String((((req || {}).session || {}).userId) || "").trim();
  if (!sessionUserId) {
    return {
      reviewerName: "Administrator",
      reviewerUserId: null
    };
  }

  const adminUser = await db("users")
    .where({ id: sessionUserId })
    .first("firstname", "lastname", "middlename");
  const reviewerName = [
    String((adminUser || {}).lastname || "").trim(),
    String((adminUser || {}).firstname || "").trim(),
    String((adminUser || {}).middlename || "").trim()
  ]
    .filter(Boolean)
    .join(", ");

  return {
    reviewerName: reviewerName || "Administrator",
    reviewerUserId: sessionUserId
  };
}

async function requireSupervisorOrAdmin(req, res, next) {
  if (req.session && req.session.userId) {
	const sessionUser = await hasActiveAccountSession(req);
	const sessionRole = String((sessionUser || {}).role || "").trim().toLowerCase();
    if (sessionRole === "admin" || sessionRole === "supervisor") {
	  req.session.role = sessionRole;
      return next();
    }
  }

  const headerKey = String(req.headers["x-admin-key"] || "");
  const queryKey = String(req.query.adminKey || "");
  const bodyKey = String((req.body || {}).adminKey || "");
  const provided = headerKey || queryKey || bodyKey;

  if (!provided || provided !== ADMIN_ACCESS_KEY) {
    return res.status(401).json({ message: "Unauthorized access." });
  }

  return next();
}

app.get("/api/admin/pending-users", requireAdmin, async (req, res) => {
  const users = await db("users")
    .where({ approved: false })
    .select("id", "email", "firstname", "lastname", "middlename", "district", "school", "created_at")
    .orderBy("created_at", "asc");

  return res.json({ users });
});

app.get("/api/admin/pending-users/export", requireAdmin, async (req, res) => {
  try {
    const users = await db("users")
      .where({ approved: false })
      .select("firstname", "middlename", "lastname", "email", "district", "school", "created_at")
      .orderBy("created_at", "asc");

    const rows = users.map((user) => ({
      Firstname: String(user.firstname || "").trim(),
      Middlename: String(user.middlename || "").trim(),
      Lastname: String(user.lastname || "").trim(),
      Email: String(user.email || "").trim(),
      District: String(user.district || "").trim(),
      School: String(user.school || "").trim(),
      CreatedAt: String(user.created_at || "").trim()
    }));

    const fileBuffer = await createTemplatedExcelBuffer({
      title: "Pending User Accounts",
      sheetName: "Pending Users",
      rows,
      emptyRow: { Firstname: "", Middlename: "", Lastname: "", Email: "", District: "", School: "", CreatedAt: "" }
    });

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    res.setHeader("Content-Disposition", `attachment; filename="pending-users-${Date.now()}.docx"`);
    return res.send(fileBuffer);
  } catch (error) {
    return res.status(500).json({ message: "Failed to export pending users.", detail: error.message });
  }
});

app.post("/api/admin/preview-pending-users-from-excel", requireAdmin, async (req, res) => {
  try {
    const fileBase64 = String((req.body || {}).fileBase64 || "").trim();
    if (!fileBase64) {
      return res.status(400).json({ message: "fileBase64 is required." });
    }

    const fileBuffer = Buffer.from(fileBase64, "base64");
    const workbook = xlsx.read(fileBuffer, { type: "buffer" });
    const firstSheetName = workbook.SheetNames[0];

    if (!firstSheetName) {
      return res.status(400).json({ message: "No worksheet found in uploaded Excel file." });
    }

    const worksheet = workbook.Sheets[firstSheetName];
    const rows = xlsx.utils.sheet_to_json(worksheet, { raw: false, defval: "" });

    const users = [];
    const skippedRows = [];

    rows.forEach((row, index) => {
      const getValue = (keys) => {
        for (let i = 0; i < keys.length; i += 1) {
          const key = keys[i];
          if (Object.prototype.hasOwnProperty.call(row, key)) {
            return String(row[key] || "").trim();
          }
        }
        return "";
      };

      const firstname = getValue(["Firstname", "FirstName", "First Name", "firstname", "first_name"]);
      const middlename = getValue(["Middlename", "MiddleName", "Middle Name", "middlename", "middle_name"]);
      const lastname = getValue(["Lastname", "LastName", "Last Name", "lastname", "last_name"]);
      const email = normalizeEmail(getValue(["Email", "email"]));
      const district = getValue(["District", "district"]);
      const school = getValue(["School", "school"]);

      if (!firstname || !lastname || !email || !district || !school) {
        skippedRows.push({ rowNumber: index + 2, reason: "Missing required fields." });
        return;
      }

      users.push({
        id: `preview-${index + 1}`,
        firstname,
        middlename,
        lastname,
        email,
        district,
        school,
        created_at: new Date().toISOString()
      });
    });

    return res.json({
      users,
      totalRows: rows.length,
      validRows: users.length,
      skippedRows
    });
  } catch (error) {
    return res.status(400).json({ message: "Failed to read Excel file.", detail: error.message });
  }
});

app.get("/api/admin/users", requireAdmin, async (req, res) => {
  const users = await db("users")
    .select("id", "email", "firstname", "lastname", "middlename", "district", "school", "lrn", "account_type", "approved", "role", "created_at", "updated_at")
    .orderBy("created_at", "asc");

  return res.json({ users });
});

app.get("/api/admin/approved-users", requireAdmin, async (req, res) => {
  const users = await db("users")
    .where({ approved: true })
    .select("id", "email", "firstname", "lastname", "middlename", "district", "school", "created_at", "updated_at")
    .orderBy("created_at", "asc");

  return res.json({ users });
});

app.get("/api/admin/learner-summary", requireSupervisorOrAdmin, async (req, res) => {
  try {
    const summaryRows = await db("learners as l")
      .leftJoin("users as u", "l.user_id", "u.id")
      .select(
        "l.user_id",
        "u.firstname",
        "u.lastname",
        "u.middlename",
        "u.email",
        "l.district",
        "l.school"
      )
      .count({ learner_count: "l.id" })
      .groupBy(
        "l.user_id",
        "u.firstname",
        "u.lastname",
        "u.middlename",
        "u.email",
        "l.district",
        "l.school"
      )
      .orderBy("u.lastname", "asc")
      .orderBy("u.firstname", "asc")
      .orderBy("l.district", "asc")
      .orderBy("l.school", "asc");

    const totalRow = await db("learners").count({ total: "id" }).first();
    const totalLearners = Number((totalRow && totalRow.total) || 0);

    const summary = summaryRows.map((row) => ({
      user_id: String(row.user_id || "").trim(),
      firstname: String(row.firstname || "").trim(),
      lastname: String(row.lastname || "").trim(),
      middlename: String(row.middlename || "").trim(),
      email: String(row.email || "").trim(),
      district: String(row.district || "N/A").trim() || "N/A",
      school: String(row.school || "N/A").trim() || "N/A",
      learner_count: Number(row.learner_count || 0)
    }));

    return res.json({ summary, totalLearners });
  } catch (error) {
    return res.status(500).json({ message: "Failed to fetch learner summary.", detail: error.message });
  }
});

app.get("/api/admin/grade-level-summary", requireSupervisorOrAdmin, async (req, res) => {
  try {
    const rows = await db("learners as l")
      .select("l.district", "l.school", "l.grade")
      .count({ learner_count: "l.id" })
      .groupBy("l.district", "l.school", "l.grade")
      .orderBy("l.district", "asc")
      .orderBy("l.school", "asc")
      .orderBy("l.grade", "asc");

    const summary = rows.map((row) => ({
      district: String(row.district || "N/A").trim() || "N/A",
      school: String(row.school || "N/A").trim() || "N/A",
      grade: String(row.grade || "N/A").trim() || "N/A",
      learner_count: Number(row.learner_count || 0)
    }));

    return res.json({ summary });
  } catch (error) {
    return res.status(500).json({ message: "Failed to fetch grade-level summary.", detail: error.message });
  }
});

app.get("/api/admin/modality-summary", requireSupervisorOrAdmin, async (req, res) => {
  try {
    const selectedDistrict = String(req.query.district || "").trim();
    const selectedSchool = String(req.query.school || "").trim();

    let currentRole = "";
    let currentUserDistrict = "";
    if (req.session && req.session.userId) {
      currentRole = String(req.session.role || "").trim().toLowerCase();
      if (currentRole === "supervisor") {
        const supervisor = await db("users")
          .where({ id: req.session.userId })
          .first("district");
        currentUserDistrict = String((supervisor && supervisor.district) || "").trim() || "N/A";
      }
    }

    const query = db("learners as l")
      .select("l.district", "l.school", "l.modality")
      .count({ learner_count: "l.id" })
      .groupBy("l.district", "l.school", "l.modality");

    if (currentRole === "supervisor" && currentUserDistrict) {
      query.where("l.district", currentUserDistrict);
    } else if (selectedDistrict) {
      query.where("l.district", selectedDistrict);
    }

    if (selectedSchool) {
      query.where("l.school", selectedSchool);
    }

    const rows = await query
      .orderBy("l.district", "asc")
      .orderBy("l.school", "asc")
      .orderBy("l.modality", "asc");

    const summary = rows.map((row) => ({
      district: String(row.district || "N/A").trim() || "N/A",
      school: String(row.school || "N/A").trim() || "N/A",
      modality: String(row.modality || "N/A").trim() || "N/A",
      learner_count: Number(row.learner_count || 0)
    }));

    return res.json({ summary });
  } catch (error) {
    return res.status(500).json({ message: "Failed to fetch modality summary.", detail: error.message });
  }
});

app.get("/api/admin/assessment-pie-summary", requireSupervisorOrAdmin, async (req, res) => {
  try {
    const metric = String(req.query.metric || "").trim().toLowerCase();
    const selectedSchool = String(req.query.school || "").trim();

    const metricColumnByKey = {
      performance: "coalesce(nullif(trim(l.fourth_quarter_verbal), ''), nullif(trim(l.third_quarter_verbal), ''), nullif(trim(l.second_quarter_verbal), ''), nullif(trim(l.first_grading_verbal), ''), 'N/A')",
      "phil-iri": "coalesce(nullif(trim(l.phil_iri_result), ''), 'N/A')",
      crla: "coalesce(nullif(trim(l.ellna_result), ''), 'N/A')",
      rma: "coalesce(nullif(trim(l.rma_result), ''), 'N/A')"
    };

    const categoryExpression = metricColumnByKey[metric];
    if (!categoryExpression) {
      return res.status(400).json({ message: "Invalid metric. Use performance, phil-iri, crla, or rma." });
    }

    let currentRole = "";
    let currentUserDistrict = "";
    if (req.session && req.session.userId) {
      currentRole = String(req.session.role || "").trim().toLowerCase();
      if (currentRole === "supervisor") {
        const supervisor = await db("users")
          .where({ id: req.session.userId })
          .first("district");
        currentUserDistrict = String((supervisor && supervisor.district) || "").trim() || "N/A";
      }
    }

    const query = db("learners as l")
      .select(db.raw(categoryExpression + " as category"))
      .count({ learner_count: "l.id" })
      .groupBy(db.raw(categoryExpression));

    if (currentRole === "supervisor" && currentUserDistrict) {
      query.where("l.district", currentUserDistrict);
    }

    if (selectedSchool) {
      query.where("l.school", selectedSchool);
    }

    const rows = await query.orderBy("category", "asc");
    const summary = rows.map((row) => ({
      label: String(row.category || "N/A").trim() || "N/A",
      total: Number(row.learner_count || 0)
    }));

    return res.json({ summary });
  } catch (error) {
    return res.status(500).json({ message: "Failed to fetch assessment pie summary.", detail: error.message });
  }
});

app.get("/api/admin/export/adm-percentage-graph", requireSupervisorOrAdmin, async (req, res) => {
  try {
    const selectedDistrict = String(req.query.district || "").trim();

    let currentRole = "";
    let currentUserDistrict = "";
    if (req.session && req.session.userId) {
      currentRole = String(req.session.role || "").trim().toLowerCase();
      if (currentRole === "supervisor") {
        const currentUser = await db("users").where({ id: req.session.userId }).first("district");
        currentUserDistrict = String((currentUser || {}).district || "").trim();
      }
    }

    const summaryRows = await db("learners as l")
      .select("l.district", "l.school", "l.grade")
      .count({ learner_count: "l.id" })
      .groupBy("l.district", "l.school", "l.grade")
      .orderBy("l.district", "asc")
      .orderBy("l.school", "asc")
      .orderBy("l.grade", "asc");

    const scopedRows = currentRole === "supervisor"
      ? summaryRows.filter((row) => (String(row.district || "N/A").trim() || "N/A") === (currentUserDistrict || "N/A"))
      : summaryRows;

    const filteredRows = selectedDistrict
      ? scopedRows.filter((row) => {
        const district = String(row.district || "N/A").trim() || "N/A";
        return district === selectedDistrict;
      })
      : scopedRows;

    const exportRows = filteredRows.map((row) => ({
      District: String(row.district || "N/A").trim() || "N/A",
      School: String(row.school || "N/A").trim() || "N/A",
      GradeLevel: String(row.grade || "N/A").trim() || "N/A",
      Total: Number(row.learner_count || 0)
    }));

    const fileBuffer = await createTemplatedExcelBuffer({
      title: "ADM Percentage Graph Report",
      sheetName: "ADM Percentage Graph",
      rows: exportRows,
      emptyRow: { District: "", School: "", GradeLevel: "", Total: 0 }
    });

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    res.setHeader("Content-Disposition", `attachment; filename="adm-percentage-report-${Date.now()}.docx"`);
    return res.send(fileBuffer);
  } catch (error) {
    return res.status(500).json({ message: "Failed to export ADM percentage graph.", detail: error.message });
  }
});

app.get("/api/admin/export/grade-level-graph", requireSupervisorOrAdmin, async (req, res) => {
  try {
    const selectedSchool = String(req.query.school || "").trim();

    let currentRole = "";
    let currentUserDistrict = "";
    if (req.session && req.session.userId) {
      currentRole = String(req.session.role || "").trim().toLowerCase();
      if (currentRole === "supervisor") {
        const currentUser = await db("users").where({ id: req.session.userId }).first("district");
        currentUserDistrict = String((currentUser || {}).district || "").trim();
      }
    }

    const summaryRows = await db("learners as l")
      .select("l.district", "l.school", "l.grade")
      .count({ learner_count: "l.id" })
      .groupBy("l.district", "l.school", "l.grade")
      .orderBy("l.district", "asc")
      .orderBy("l.school", "asc")
      .orderBy("l.grade", "asc");

    const scopedRows = currentRole === "supervisor"
      ? summaryRows.filter((row) => (String(row.district || "N/A").trim() || "N/A") === (currentUserDistrict || "N/A"))
      : summaryRows;

    const gradeMap = new Map();
    scopedRows.forEach((row) => {
      const school = String(row.school || "N/A").trim() || "N/A";
      if (selectedSchool && school !== selectedSchool) {
        return;
      }
      const grade = String(row.grade || "N/A").trim() || "N/A";
      const count = Number(row.learner_count || 0);
      gradeMap.set(grade, (gradeMap.get(grade) || 0) + count);
    });

    const exportRows = Array.from(gradeMap.entries())
      .map((entry) => ({ Grade: entry[0], Learners: entry[1] }))
      .sort((a, b) => String(a.Grade).localeCompare(String(b.Grade)));

    const fileBuffer = await createTemplatedExcelBuffer({
      title: "Grade Level Graph Report",
      sheetName: "Grade Level Graph",
      rows: exportRows,
      emptyRow: { Grade: "", Learners: 0 }
    });

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    res.setHeader("Content-Disposition", `attachment; filename="grade-level-report-${Date.now()}.docx"`);
    return res.send(fileBuffer);
  } catch (error) {
    return res.status(500).json({ message: "Failed to export grade-level graph.", detail: error.message });
  }
});

app.get("/api/admin/export/graph-report", requireSupervisorOrAdmin, async (req, res) => {
  try {
    const graphType = String(req.query.graphType || "").trim().toLowerCase();
    const districtFilter = String(req.query.district || "").trim();
    const schoolFilter = String(req.query.school || "").trim();

    let currentRole = "";
    let currentUserDistrict = "";
    if (req.session && req.session.userId) {
      currentRole = String(req.session.role || "").trim().toLowerCase();
      if (currentRole === "supervisor") {
        const currentUser = await db("users").where({ id: req.session.userId }).first("district");
        currentUserDistrict = String((currentUser || {}).district || "").trim();
      }
    }

    if (graphType === "adm-percentage") {
      const rows = await db("learners as l")
        .select("l.district", "l.school", "l.grade")
        .count({ learner_count: "l.id" })
        .groupBy("l.district", "l.school", "l.grade")
        .orderBy("l.district", "asc")
        .orderBy("l.school", "asc")
        .orderBy("l.grade", "asc");

      const scopedRows = currentRole === "supervisor"
        ? rows.filter((row) => (String(row.district || "N/A").trim() || "N/A") === (currentUserDistrict || "N/A"))
        : rows;

      const filteredRows = scopedRows.filter((row) => {
        const district = String(row.district || "N/A").trim() || "N/A";
        if (districtFilter && district !== districtFilter) return false;
        return true;
      });

      const map = new Map();
      filteredRows.forEach((row) => {
        const district = String(row.district || "N/A").trim() || "N/A";
        const school = String(row.school || "N/A").trim() || "N/A";
        const count = Number(row.learner_count || 0);
        const label = districtFilter ? school : district;
        map.set(label, (map.get(label) || 0) + count);
      });

      const summaryRows = Array.from(map.entries()).map((entry) => ({ label: entry[0], total: entry[1] }));
      const totalAll = summaryRows.reduce((sum, row) => sum + Number(row.total || 0), 0) || 1;
      const exportRows = summaryRows.map((row) => ({
        [districtFilter ? "School" : "District"]: row.label,
        Total: Number(row.total || 0),
        Percentage: `${((Number(row.total || 0) / totalAll) * 100).toFixed(2)}%`
      }));

      const fileBuffer = await createTemplatedExcelBuffer({
        title: "ADM Percentage Graph Report",
        sheetName: "ADM Percentage Graph",
        rows: exportRows,
        emptyRow: { District: "", School: "", Total: 0, Percentage: "" }
      });

      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
      res.setHeader("Content-Disposition", `attachment; filename="adm-percentage-report-${Date.now()}.docx"`);
      return res.send(fileBuffer);
    }

    if (graphType === "grade-level") {
      const rows = await db("learners as l")
        .select("l.district", "l.school", "l.grade")
        .count({ learner_count: "l.id" })
        .groupBy("l.district", "l.school", "l.grade")
        .orderBy("l.district", "asc")
        .orderBy("l.school", "asc")
        .orderBy("l.grade", "asc");

      const scopedRows = currentRole === "supervisor"
        ? rows.filter((row) => (String(row.district || "N/A").trim() || "N/A") === (currentUserDistrict || "N/A"))
        : rows;

      const filteredRows = scopedRows.filter((row) => {
        const district = String(row.district || "N/A").trim() || "N/A";
        const school = String(row.school || "N/A").trim() || "N/A";
        if (districtFilter && district !== districtFilter) return false;
        if (schoolFilter && school !== schoolFilter) return false;
        return true;
      });

      const map = new Map();
      filteredRows.forEach((row) => {
        const grade = String(row.grade || "N/A").trim() || "N/A";
        const count = Number(row.learner_count || 0);
        map.set(grade, (map.get(grade) || 0) + count);
      });

      const summaryRows = Array.from(map.entries()).map((entry) => ({ label: entry[0], total: entry[1] }));
      const totalAll = summaryRows.reduce((sum, row) => sum + Number(row.total || 0), 0) || 1;
      const exportRows = summaryRows.map((row) => ({
        GradeLevel: row.label,
        Total: Number(row.total || 0),
        Percentage: `${((Number(row.total || 0) / totalAll) * 100).toFixed(2)}%`
      }));

      const fileBuffer = await createTemplatedExcelBuffer({
        title: "Grade Level Graph Report",
        sheetName: "Grade Level Graph",
        rows: exportRows,
        emptyRow: { GradeLevel: "", Total: 0, Percentage: "" }
      });

      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
      res.setHeader("Content-Disposition", `attachment; filename="grade-level-report-${Date.now()}.docx"`);
      return res.send(fileBuffer);
    }

    if (graphType === "modality") {
      const rows = await db("learners as l")
        .select("l.district", "l.school", "l.modality")
        .count({ learner_count: "l.id" })
        .groupBy("l.district", "l.school", "l.modality")
        .orderBy("l.district", "asc")
        .orderBy("l.school", "asc")
        .orderBy("l.modality", "asc");

      const scopedRows = currentRole === "supervisor"
        ? rows.filter((row) => (String(row.district || "N/A").trim() || "N/A") === (currentUserDistrict || "N/A"))
        : rows;

      const filteredRows = scopedRows.filter((row) => {
        const district = String(row.district || "N/A").trim() || "N/A";
        const school = String(row.school || "N/A").trim() || "N/A";
        if (districtFilter && district !== districtFilter) return false;
        if (schoolFilter && school !== schoolFilter) return false;
        return true;
      });

      const map = new Map();
      filteredRows.forEach((row) => {
        const modality = String(row.modality || "N/A").trim() || "N/A";
        const count = Number(row.learner_count || 0);
        map.set(modality, (map.get(modality) || 0) + count);
      });

      const summaryRows = Array.from(map.entries()).map((entry) => ({ label: entry[0], total: entry[1] }));
      const totalAll = summaryRows.reduce((sum, row) => sum + Number(row.total || 0), 0) || 1;
      const exportRows = summaryRows.map((row) => ({
        Modality: row.label,
        Total: Number(row.total || 0),
        Percentage: `${((Number(row.total || 0) / totalAll) * 100).toFixed(2)}%`
      }));

      const fileBuffer = await createTemplatedExcelBuffer({
        title: "Learning Modality Graph Report",
        sheetName: "Modality Graph",
        rows: exportRows,
        emptyRow: { Modality: "", Total: 0, Percentage: "" }
      });

      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
      res.setHeader("Content-Disposition", `attachment; filename="learning-modality-report-${Date.now()}.docx"`);
      return res.send(fileBuffer);
    }

    return res.status(400).json({ message: "Invalid graphType. Use adm-percentage, grade-level, or modality." });
  } catch (error) {
    return res.status(500).json({ message: "Failed to export graph report.", detail: error.message });
  }
});

app.post("/api/admin/export/custom-report", requireSupervisorOrAdmin, async (req, res) => {
  try {
    const title = String((req.body || {}).title || "Project i-Track Report").trim().slice(0, 120);
    const sourceRows = Array.isArray((req.body || {}).rows) ? req.body.rows.slice(0, 5000) : [];
    const rows = sourceRows.filter((row) => row && typeof row === "object" && !Array.isArray(row)).map((row) => {
      const normalized = {};
      Object.keys(row).slice(0, 40).forEach((key) => {
        const safeKey = String(key || "Field").trim().slice(0, 80) || "Field";
        const value = row[key];
        normalized[safeKey] = value == null ? "" : (typeof value === "object" ? JSON.stringify(value) : String(value));
      });
      return normalized;
    });
    const fileBuffer = await createTemplatedDocxBuffer({ title, rows, emptyRow: {} });
    const fileName = String(title || "project-itrack-report").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 70) || "project-itrack-report";
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}-${Date.now()}.docx"`);
    return res.send(fileBuffer);
  } catch (error) {
    return res.status(500).json({ message: "Failed to generate Project i-Track report.", detail: error.message });
  }
});

app.post("/api/admin/approve-user", requireAdmin, async (req, res) => {
  const userId = String((req.body || {}).userId || "").trim();
  if (!userId) {
    return res.status(400).json({ message: "userId is required." });
  }

  const updated = await db("users")
    .where({ id: userId })
    .update({ approved: true, updated_at: new Date().toISOString() });

  if (!updated) {
    return res.status(404).json({ message: "User not found." });
  }

  return res.json({ message: "User account approved." });
});

app.post("/api/admin/reject-user", requireAdmin, async (req, res) => {
  const userId = String((req.body || {}).userId || "").trim();
  if (!userId) {
    return res.status(400).json({ message: "userId is required." });
  }

  const deleted = await db("users").where({ id: userId, approved: false }).del();
  if (!deleted) {
    return res.status(404).json({ message: "Pending user not found." });
  }

  return res.json({ message: "User account rejected." });
});

app.delete("/api/admin/delete-user", requireAdmin, async (req, res) => {
  const userId = String((req.body || {}).userId || "").trim();
  if (!userId) {
    return res.status(400).json({ message: "userId is required." });
  }

  if (userId === String(req.session.userId || "").trim()) {
    return res.status(400).json({ message: "You cannot delete your own account." });
  }

  const targetUser = await db("users").where({ id: userId }).first();
  if (!targetUser) {
    return res.status(404).json({ message: "User not found." });
  }

  if (normalizeEmail(targetUser.email) === ADMIN_EMAIL) {
    return res.status(400).json({ message: "Default admin account cannot be deleted." });
  }

  await db.transaction(async (trx) => {
    await trx("learners").where({ user_id: userId }).del();
    await trx("users").where({ id: userId }).del();
  });

  return res.json({ message: "User account deleted." });
});

app.put("/api/admin/set-user-role", requireAdmin, async (req, res) => {
  const userId = String((req.body || {}).userId || "").trim();
  const role = String((req.body || {}).role || "").trim().toLowerCase();
  const validRoles = ["admin", "supervisor", "teacher", "student"];

  if (!userId || !validRoles.includes(role)) {
    return res.status(400).json({ message: "Invalid userId or role." });
  }

  const updated = await db("users")
    .where({ id: userId })
    .update({ role, updated_at: new Date().toISOString() });

  if (!updated) {
    return res.status(404).json({ message: "User not found." });
  }

  return res.json({ message: "Role updated successfully." });
});

async function requireLogin(req, res, next) {
  try {
	const sessionUser = await hasActiveAccountSession(req);
	if (!sessionUser) return res.status(401).json({ message: "Session expired or this account was signed in on another device." });
	req.session.role = String(sessionUser.role || "").trim().toLowerCase();
	return next();
  } catch (error) {
	return res.status(500).json({ message: "Unable to validate account session.", detail: error.message });
  }
}

async function requireTeacher(req, res, next) {
  try {
	const sessionUser = await hasActiveAccountSession(req);
	if (!sessionUser) return res.status(401).json({ message: "Session expired or this account was signed in on another device." });
	const role = String(sessionUser.role || "").trim().toLowerCase();
	if (role !== "teacher" && role !== "admin") return res.status(403).json({ message: "Teacher or administrator account access only." });
	req.session.role = role;
	return next();
  } catch (error) {
	return res.status(500).json({ message: "Unable to validate teacher or administrator session.", detail: error.message });
  }
}

function getStatusLabel(status) {
  const normalizedStatus = String(status || "pending").trim().toLowerCase() || "pending";
  const statusLabels = {
    approved: "Approved",
    rejected: "Rejected",
    revise: "Revised"
  };

  return statusLabels[normalizedStatus] || (normalizedStatus.charAt(0).toUpperCase() + normalizedStatus.slice(1));
}

app.post("/api/learners", requireTeacher, async (req, res) => {
  try {
    const {
      learner_code,
	  student_username,
	  student_password,
	  student_confirm_password,
      family_name,
      firstname,
      middlename,
      grade,
      district,
      school,
      modality,
      type_of_instruction,
      date_started,
      first_grading_grade,
      first_grading_verbal,
      first_grading_interpretation,
      second_quarter_grade,
      second_quarter_verbal,
      second_quarter_interpretation,
      third_quarter_grade,
      third_quarter_verbal,
      third_quarter_interpretation,
      intervention,
      phil_iri_result,
      rma_result,
      ellna_result,
      utilization_learning_gadgets
    } = req.body || {};

    const normalizedLrn = String(learner_code || "").trim();
    const normalizedStudentUsername = String(student_username || "").trim();
    if (!/^\d{12}$/.test(normalizedLrn)) {
      return res.status(400).json({ message: "Learner LRN must be exactly 12 digits." });
    }
	if (normalizedStudentUsername !== normalizedLrn) {
	  return res.status(400).json({ message: "Student username must be the learner's 12-digit LRN." });
	}
	if (String(student_password || "") !== String(student_confirm_password || "")) {
	  return res.status(400).json({ message: "Student password and confirmation do not match." });
	}
	if (!isStrongPassword(student_password)) {
	  return res.status(400).json({ message: "Student password must have 8+ characters with uppercase, lowercase, number, and special character." });
	}
	if (!String(family_name || "").trim() || !String(firstname || "").trim() || !String(grade || "").trim() || !String(district || "").trim() || !String(school || "").trim()) {
	  return res.status(400).json({ message: "LRN, learner name, grade, district, and school are required." });
	}

	const existingStudentAccount = await db("users")
	  .whereRaw("LOWER(username) = ?", [normalizedStudentUsername.toLowerCase()])
	  .orWhere({ lrn: normalizedLrn })
	  .first();
	if (existingStudentAccount) {
	  return res.status(409).json({ message: "A student account already exists for this LRN." });
	}
	const existingLearner = await db("learners").where({ learner_code: normalizedLrn }).first();
	if (existingLearner) {
	  return res.status(409).json({ message: "A learner record already exists for this LRN." });
	}

    const nowIso = new Date().toISOString();
	const studentUserId = crypto.randomUUID();
	const learnerId = crypto.randomUUID();
	const studentEmail = `${normalizedLrn}@student.itrack.local`;
	const adviser = await db("users").where({ id: req.session.userId }).first();
	const adviserName = [adviser && adviser.firstname, adviser && adviser.middlename, adviser && adviser.lastname].filter(Boolean).join(" ").trim() || "Assigned Teacher";
	const passwordHash = await bcrypt.hash(String(student_password), 12);
	await db.transaction(async (trx) => {
	  await trx("users").insert({
		id: studentUserId,
		email: studentEmail,
		password_hash: passwordHash,
		firstname: String(firstname).trim(),
		lastname: String(family_name).trim(),
		middlename: String(middlename || "").trim(),
		district: String(district).trim(),
		school: String(school).trim(),
		account_type: "student",
		username: normalizedStudentUsername,
		lrn: normalizedLrn,
		school_id: null,
		role: "student",
		verified: true,
		approved: true,
		verification_token_hash: null,
		verification_token_expires_at: null,
		verification_email_sent_at: null,
		resend_window_started_at: null,
		resend_count: 0,
		failed_login_count: 0,
		lockout_until: null,
		created_at: nowIso,
		updated_at: nowIso
	  });
	  await trx("learners").insert({
		id: learnerId,
		user_id: req.session.userId,
		adviser_user_id: req.session.userId,
		teacher_adviser: adviserName,
		learner_code: normalizedLrn,
		family_name: String(family_name).trim(),
		firstname: String(firstname).trim(),
		middlename: String(middlename || "").trim(),
		grade: String(grade || "").trim(),
		district: String(district || "").trim(),
		school: String(school || "").trim(),
		modality: String(modality || "").trim(),
		type_of_instruction: String(type_of_instruction || "").trim(),
		date_started: String(date_started || "").trim(),
		first_grading_grade: first_grading_grade != null ? parseInt(first_grading_grade, 10) || null : null,
		first_grading_verbal: String(first_grading_verbal || "").trim(),
		first_grading_interpretation: String(first_grading_interpretation || "").trim(),
		second_quarter_grade: second_quarter_grade != null ? parseInt(second_quarter_grade, 10) || null : null,
		second_quarter_verbal: String(second_quarter_verbal || "").trim(),
		second_quarter_interpretation: String(second_quarter_interpretation || "").trim(),
		third_quarter_grade: third_quarter_grade != null ? parseInt(third_quarter_grade, 10) || null : null,
		third_quarter_verbal: String(third_quarter_verbal || "").trim(),
		third_quarter_interpretation: String(third_quarter_interpretation || "").trim(),
		intervention: String(intervention || "").trim(),
		phil_iri_result: String(phil_iri_result || "").trim(),
		rma_result: String(rma_result || "").trim(),
		ellna_result: String(ellna_result || "").trim(),
		utilization_learning_gadgets: String(utilization_learning_gadgets || "").trim(),
		created_at: nowIso,
		updated_at: nowIso
	  });
	});

    return res.status(201).json({ message: "Learner record and approved student account created.", username: normalizedStudentUsername, account_type: "student" });
  } catch (error) {
    return res.status(500).json({ message: formatDatabaseError(error, "Failed to save learner record."), detail: error.message });
  }
});

app.put("/api/learners/:id", requireLogin, async (req, res) => {
  try {
    const learnerId = String(req.params.id || "").trim();
    const existing = await db("learners").where({ id: learnerId, user_id: req.session.userId }).first();
    if (!existing) {
      return res.status(404).json({ message: "Learner record not found." });
    }

    const {
      learner_code, family_name, firstname, middlename, grade, district, school,
      modality, type_of_instruction,
      date_started, first_grading_grade, first_grading_verbal, first_grading_interpretation,
      second_quarter_grade,
      second_quarter_verbal, second_quarter_interpretation,
      third_quarter_grade,
      third_quarter_verbal, third_quarter_interpretation,
      intervention,
      phil_iri_result, rma_result, ellna_result,
      utilization_learning_gadgets
    } = req.body || {};

    if (learner_code && !/^\d{12}$/.test(String(learner_code).trim())) {
      return res.status(400).json({ message: "Learner LRN must be exactly 12 digits." });
    }
	if (String(learner_code || "").trim() !== String(existing.learner_code || "").trim()) {
	  return res.status(400).json({ message: "LRN cannot be changed because it is linked to the student's login account." });
	}

    await db("learners").where({ id: learnerId, user_id: req.session.userId }).update({
      learner_code: String(learner_code).trim(),
      family_name: String(family_name || "").trim(),
      firstname: String(firstname || "").trim(),
      middlename: String(middlename || "").trim(),
      grade: String(grade || "").trim(),
      district: String(district || "").trim(),
      school: String(school || "").trim(),
      modality: String(modality || "").trim(),
      type_of_instruction: String(type_of_instruction || "").trim(),
      date_started: String(date_started || "").trim(),
      first_grading_grade: first_grading_grade != null && String(first_grading_grade).trim() !== "" ? parseInt(first_grading_grade, 10) || null : null,
      first_grading_verbal: String(first_grading_verbal || "").trim(),
      first_grading_interpretation: String(first_grading_interpretation || "").trim(),
      second_quarter_grade: second_quarter_grade != null && String(second_quarter_grade).trim() !== "" ? parseInt(second_quarter_grade, 10) || null : null,
      second_quarter_verbal: String(second_quarter_verbal || "").trim(),
      second_quarter_interpretation: String(second_quarter_interpretation || "").trim(),
      third_quarter_grade: third_quarter_grade != null && String(third_quarter_grade).trim() !== "" ? parseInt(third_quarter_grade, 10) || null : null,
      third_quarter_verbal: String(third_quarter_verbal || "").trim(),
      third_quarter_interpretation: String(third_quarter_interpretation || "").trim(),
      intervention: String(intervention || "").trim(),
      phil_iri_result: String(phil_iri_result || "").trim(),
      rma_result: String(rma_result || "").trim(),
      ellna_result: String(ellna_result || "").trim(),
      utilization_learning_gadgets: String(utilization_learning_gadgets || "").trim(),
      updated_at: new Date().toISOString()
    });

    return res.json({ message: "Learner record updated." });
  } catch (error) {
    return res.status(500).json({ message: formatDatabaseError(error, "Failed to update learner record."), detail: error.message });
  }
});

app.get("/api/learners", requireLogin, async (req, res) => {
  try {
    const learners = await db("learners")
      .where({ user_id: req.session.userId })
      .select("*")
      .orderBy("created_at", "desc");
    return res.json({ learners });
  } catch (error) {
    return res.status(500).json({ message: "Failed to fetch learner records.", detail: error.message });
  }
});

app.get("/api/learners/export", requireLogin, async (req, res) => {
  try {
    const learners = await db("learners")
      .where({ user_id: req.session.userId })
      .select("*")
      .orderBy("created_at", "desc");

    const rows = learners.map((item) => ({
      LRN: String(item.learner_code || "").trim(),
      FamilyName: String(item.family_name || "").trim(),
      FirstName: String(item.firstname || "").trim(),
      MiddleName: String(item.middlename || "").trim(),
      Grade: String(item.grade || "").trim(),
      District: String(item.district || "").trim(),
      School: String(item.school || "").trim(),
      TeacherAdviser: String(item.teacher_adviser || "").trim(),
      Modality: String(item.modality || "").trim(),
      TypeOfInstruction: String(item.type_of_instruction || "").trim(),
      DateStarted: String(item.date_started || "").trim(),
      FirstSemesterGrade: item.first_grading_grade == null ? "" : Number(item.first_grading_grade),
      SecondSemesterGrade: item.second_quarter_grade == null ? "" : Number(item.second_quarter_grade),
      ThirdSemesterGrade: item.third_quarter_grade == null ? "" : Number(item.third_quarter_grade),
      Intervention: String(item.intervention || "").trim(),
      PhilIriResult: String(item.phil_iri_result || "").trim(),
      RmaResult: String(item.rma_result || "").trim(),
      CrlaResult: String(item.ellna_result || "").trim(),
      LearningGadgets: String(item.utilization_learning_gadgets || "").trim(),
      CreatedAt: String(item.created_at || "").trim()
    }));

    const fileBuffer = await createTemplatedExcelBuffer({
      title: "Learner Records",
      sheetName: "Learner Records",
      rows,
      emptyRow: { LRN: "", FamilyName: "", FirstName: "", Grade: "", District: "", School: "" }
    });

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    res.setHeader("Content-Disposition", `attachment; filename="learner-records-${Date.now()}.docx"`);
    return res.send(fileBuffer);
  } catch (error) {
    return res.status(500).json({ message: "Failed to export learner records.", detail: error.message });
  }
});

app.get("/api/adm-requests", requireTeacher, async (req, res) => {
  try {
    const requests = await db("adm_requests")
      .where({ requestor_user_id: req.session.userId })
      .select(
        "id",
        "request_date",
        "district",
        "school",
        "adm_focal",
        "reason_for_adm",
        "duration_from",
        "duration_to",
        "requestor_name",
        "psds_endorsement_path",
        "secondary_document_path",
        "approval_pdf_path",
        "status",
        "review_note",
        "reviewed_by",
        "reviewed_at",
        "created_at",
        "updated_at"
      )
      .orderBy("created_at", "desc");

    return res.json({ requests });
  } catch (error) {
    return res.status(500).json({ message: "Failed to fetch ADM requests.", detail: error.message });
  }
});

app.get("/api/adm-deadline-alerts", requireLogin, async (req, res) => {
  try {
    const user = await db("users").where({ id: req.session.userId }).first("id", "role", "lrn");
    if (!user) return res.status(404).json({ message: "Account not found." });

    const role = String(user.role || "").trim().toLowerCase();
    let requestorIds = [];
    if (role === "student") {
      const learner = await db("learners")
        .where({ learner_code: String(user.lrn || "").trim() })
        .first("adviser_user_id");
      if (learner && learner.adviser_user_id) requestorIds = [learner.adviser_user_id];
    } else if (role === "teacher") {
      requestorIds = [user.id];
    }

    let query = db("adm_requests")
      .where({ status: "approved" })
      .whereNotNull("duration_to")
      .select("id", "reason_for_adm", "duration_from", "duration_to", "requestor_name", "school");
    if (role === "student" || role === "teacher") {
      if (!requestorIds.length) return res.json({ alerts: [] });
      query = query.whereIn("requestor_user_id", requestorIds);
    } else if (role !== "admin") {
      return res.json({ alerts: [] });
    }

    const today = new Intl.DateTimeFormat("sv-SE", {
      timeZone: "Asia/Manila",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(new Date());
    const toUtcDay = (value) => {
      const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
      return match ? Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : NaN;
    };
    const todayUtc = toUtcDay(today);
    const requests = await query.orderBy("duration_to", "asc");
    const alerts = requests.map((item) => ({
      ...item,
      days_remaining: Math.round((toUtcDay(item.duration_to) - todayUtc) / 86400000)
    })).filter((item) => Number.isFinite(item.days_remaining) && item.days_remaining >= 0 && item.days_remaining <= 7);

    return res.json({ alerts, role, warning_window_days: 7 });
  } catch (error) {
    return res.status(500).json({ message: "Failed to check ADM duration warnings.", detail: error.message });
  }
});

app.get("/api/adm-requests/:id/approval-pdf", requireTeacher, async (req, res) => {
  try {
    const requestId = String(req.params.id || "").trim();
    if (!requestId) {
      return res.status(400).json({ message: "ADM request id is required." });
    }

    const admRequest = await db("adm_requests")
      .where({ id: requestId, requestor_user_id: req.session.userId })
      .first(
        "id",
        "status",
        "request_date",
        "district",
        "school",
        "adm_focal",
        "reason_for_adm",
        "duration_from",
        "duration_to",
        "requestor_name",
        "reviewed_at"
      );

    if (!admRequest) {
      return res.status(404).json({ message: "ADM request not found." });
    }

    if (String(admRequest.status || "").trim().toLowerCase() !== "approved") {
      return res.status(409).json({ message: "The approval PDF is available only after this request is approved." });
    }

    const approvalPdfPath = await createAdmApprovalPdf({
      requestId: admRequest.id,
      requestDate: admRequest.request_date,
      approvedAt: admRequest.reviewed_at || new Date().toISOString(),
      requestorName: admRequest.requestor_name,
      district: admRequest.district,
      school: admRequest.school,
      admFocal: admRequest.adm_focal
    });

    await db("adm_requests")
      .where({ id: requestId, requestor_user_id: req.session.userId })
      .update({ approval_pdf_path: approvalPdfPath });

    const outputFsPath = path.join(__dirname, ...approvalPdfPath.split("/"));
    return res.download(outputFsPath, `Project-i-Track-ADM-Approval-${requestId}.pdf`);
  } catch (error) {
    return res.status(500).json({ message: "Failed to prepare the approval PDF.", detail: error.message });
  }
});

app.post(
  "/api/adm-requests",
  requireTeacher,
  approvalRequestUpload.fields([
    { name: "psdsEndorsement", maxCount: 1 },
    { name: "secondarySupportingDocument", maxCount: 1 }
  ]),
  async (req, res) => {
    const uploadedPsdsFile = req.files && req.files.psdsEndorsement && req.files.psdsEndorsement[0]
      ? req.files.psdsEndorsement[0]
      : null;
    const uploadedSecondaryFile = req.files && req.files.secondarySupportingDocument && req.files.secondarySupportingDocument[0]
      ? req.files.secondarySupportingDocument[0]
      : null;

    try {
      const requestDate = String((req.body || {}).requestDate || "").trim();
      const admFocal = String((req.body || {}).admFocal || "").trim();
      const reasonForAdm = String((req.body || {}).reasonForAdm || "").trim();
      const durationFrom = String((req.body || {}).durationFrom || "").trim();
      const durationTo = String((req.body || {}).durationTo || "").trim();
      const validDate = /^\d{4}-\d{2}-\d{2}$/;

      if (!requestDate) {
        deleteFileIfExists(uploadedPsdsFile && uploadedPsdsFile.path);
        deleteFileIfExists(uploadedSecondaryFile && uploadedSecondaryFile.path);
        return res.status(400).json({ message: "Request date is required." });
      }

      if (!admFocal) {
        deleteFileIfExists(uploadedPsdsFile && uploadedPsdsFile.path);
        deleteFileIfExists(uploadedSecondaryFile && uploadedSecondaryFile.path);
        return res.status(400).json({ message: "ADM focal is required." });
      }

      if (!reasonForAdm) {
        deleteFileIfExists(uploadedPsdsFile && uploadedPsdsFile.path);
        deleteFileIfExists(uploadedSecondaryFile && uploadedSecondaryFile.path);
        return res.status(400).json({ message: "Reason for ADM is required." });
      }

      if (reasonForAdm.length > 1200) {
        deleteFileIfExists(uploadedPsdsFile && uploadedPsdsFile.path);
        deleteFileIfExists(uploadedSecondaryFile && uploadedSecondaryFile.path);
        return res.status(400).json({ message: "Reason for ADM must be 1,200 characters or fewer." });
      }

      if (!validDate.test(durationFrom) || !validDate.test(durationTo)) {
        deleteFileIfExists(uploadedPsdsFile && uploadedPsdsFile.path);
        deleteFileIfExists(uploadedSecondaryFile && uploadedSecondaryFile.path);
        return res.status(400).json({ message: "Select valid From and To dates for the ADM duration period." });
      }

      if (durationTo < durationFrom) {
        deleteFileIfExists(uploadedPsdsFile && uploadedPsdsFile.path);
        deleteFileIfExists(uploadedSecondaryFile && uploadedSecondaryFile.path);
        return res.status(400).json({ message: "The To date cannot be earlier than the From date." });
      }

      if (!uploadedPsdsFile || !uploadedSecondaryFile) {
        deleteFileIfExists(uploadedPsdsFile && uploadedPsdsFile.path);
        deleteFileIfExists(uploadedSecondaryFile && uploadedSecondaryFile.path);
        return res.status(400).json({ message: "Both PSDS Endorsement and Secondary Supporting Document files are required." });
      }

      const user = await db("users")
        .where({ id: req.session.userId })
        .first("firstname", "lastname", "middlename", "district", "school");

      if (!user) {
        deleteFileIfExists(uploadedPsdsFile.path);
        deleteFileIfExists(uploadedSecondaryFile.path);
        return res.status(404).json({ message: "Teacher account not found." });
      }

      const requestorName = [String((user || {}).lastname || "").trim(), String((user || {}).firstname || "").trim(), String((user || {}).middlename || "").trim()]
        .filter(Boolean)
        .join(", ") || "N/A";
      const nowIso = new Date().toISOString();

      await db("adm_requests").insert({
        id: crypto.randomUUID(),
        requestor_user_id: req.session.userId,
        request_date: requestDate,
        district: String((user || {}).district || "N/A").trim() || "N/A",
        school: String((user || {}).school || "N/A").trim() || "N/A",
        adm_focal: admFocal,
        reason_for_adm: reasonForAdm,
        duration_from: durationFrom,
        duration_to: durationTo,
        requestor_name: requestorName,
        psds_endorsement_path: path.posix.join("uploads", "approval-requests", path.basename(String(uploadedPsdsFile.filename || "").trim())),
        secondary_document_path: path.posix.join("uploads", "approval-requests", path.basename(String(uploadedSecondaryFile.filename || "").trim())),
        status: "pending",
        created_at: nowIso,
        updated_at: nowIso
      });

      broadcastAdmRequestUpdate({ created_at: nowIso });

      return res.json({ message: "ADM request submitted." });
    } catch (error) {
      deleteFileIfExists(uploadedPsdsFile && uploadedPsdsFile.path);
      deleteFileIfExists(uploadedSecondaryFile && uploadedSecondaryFile.path);
      return res.status(500).json({ message: "Failed to create ADM request.", detail: error.message });
    }
  }
);

app.get("/api/admin/adm-requests", requireAdmin, async (req, res) => {
  try {
    const requests = await db("adm_requests as ar")
      .leftJoin("users as u", "u.id", "ar.requestor_user_id")
      .select(
        "ar.id",
        "ar.request_date",
        "ar.district",
        "ar.school",
        "ar.adm_focal",
        "ar.reason_for_adm",
        "ar.duration_from",
        "ar.duration_to",
        "ar.requestor_name",
        "ar.psds_endorsement_path",
        "ar.secondary_document_path",
        "ar.status",
        "ar.review_note",
        "ar.reviewed_by",
        "ar.reviewed_at",
        "ar.created_at",
        "u.email as requestor_email"
      )
      .orderBy("ar.created_at", "desc");

    return res.json({ requests });
  } catch (error) {
    return res.status(500).json({ message: "Failed to fetch admin ADM requests.", detail: error.message });
  }
});

app.get("/api/admin/approval-dashboard-requests", requireAdmin, async (req, res) => {
  try {
    const [learnerRequests, teacherRequests] = await Promise.all([
      db("approval_requests")
        .select(
          "id",
          "learner_id",
          "district",
          "school",
          "requestor_name",
          "learner_name",
          "document_path",
          "status",
          "review_note",
          "reviewed_by",
          "reviewed_at",
          "created_at",
          "updated_at"
        )
        .orderBy("created_at", "desc"),
      db("adm_requests as ar")
        .leftJoin("users as u", "u.id", "ar.requestor_user_id")
        .select(
          "ar.id",
          "ar.request_date",
          "ar.district",
          "ar.school",
          "ar.adm_focal",
          "ar.reason_for_adm",
          "ar.duration_from",
          "ar.duration_to",
          "ar.requestor_name",
          "ar.psds_endorsement_path",
          "ar.secondary_document_path",
          "ar.status",
          "ar.review_note",
          "ar.reviewed_by",
          "ar.reviewed_at",
          "ar.created_at",
          "ar.updated_at",
          "u.email as requestor_email"
        )
        .orderBy("ar.created_at", "desc")
    ]);

    const requests = learnerRequests
      .map((item) => Object.assign({}, item, { request_kind: "learner" }))
      .concat(teacherRequests.map((item) => Object.assign({}, item, { request_kind: "teacher" })))
      .sort((left, right) => {
        const leftDate = new Date(left.created_at || left.request_date || 0).getTime();
        const rightDate = new Date(right.created_at || right.request_date || 0).getTime();
        return rightDate - leftDate;
      });

    return res.json({ requests });
  } catch (error) {
    return res.status(500).json({ message: "Failed to fetch approval dashboard requests.", detail: error.message });
  }
});

app.get("/api/admin/adm-requests/stream", requireAdmin, (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  if (typeof res.flushHeaders === "function") {
    res.flushHeaders();
  }

  res.write("event: ping\\ndata: connected\\n\\n");
  admRequestStreamClients.add(res);

  req.on("close", () => {
    admRequestStreamClients.delete(res);
  });
});

app.get("/api/adm-requests/stream", requireTeacher, (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  if (typeof res.flushHeaders === "function") {
    res.flushHeaders();
  }

  const client = {
    userId: String(req.session.userId || "").trim(),
    response: res
  };

  res.write("event: ping\\ndata: connected\\n\\n");
  teacherAdmRequestStreamClients.add(client);

  req.on("close", () => {
    teacherAdmRequestStreamClients.delete(client);
  });
});

app.get("/api/admin/approval-requests/export", requireAdmin, async (req, res) => {
  try {
    const [learnerRequests, teacherRequests] = await Promise.all([
      db("approval_requests")
        .select(
          "id",
          "district",
          "school",
          "requestor_name",
          "learner_name",
          "document_path",
          "status",
          "review_note",
          "reviewed_by",
          "reviewed_at",
          "created_at"
        )
        .orderBy("created_at", "desc"),
      db("adm_requests")
        .select(
          "id",
          "request_date",
          "district",
          "school",
          "adm_focal",
          "requestor_name",
          "psds_endorsement_path",
          "secondary_document_path",
          "status",
          "review_note",
          "reviewed_by",
          "reviewed_at",
          "created_at"
        )
        .orderBy("created_at", "desc")
    ]);

    const exportRows = [];

    learnerRequests.forEach((item) => {
      exportRows.push({
        RequestType: "Learner Approval Request",
        DateRequested: String(item.created_at || "").trim(),
        District: String(item.district || "").trim(),
        School: String(item.school || "").trim(),
        Requestor: String(item.requestor_name || "").trim(),
        Details: String(item.learner_name || "").trim() ? `Learner: ${String(item.learner_name || "").trim()}` : "",
        DocumentsSubmitted: path.basename(String(item.document_path || "").trim()),
        DocumentPaths: String(item.document_path || "").trim(),
        Result: String(item.review_note || "").trim(),
        ReviewedBy: String(item.reviewed_by || "").trim(),
        ReviewedAt: String(item.reviewed_at || "").trim(),
        Status: getStatusLabel(item.status)
      });
    });

    teacherRequests.forEach((item) => {
      const psdsPath = String(item.psds_endorsement_path || "").trim();
      const secondaryPath = String(item.secondary_document_path || "").trim();
      exportRows.push({
        RequestType: "Teacher ADM Request",
        DateRequested: String(item.request_date || item.created_at || "").trim(),
        District: String(item.district || "").trim(),
        School: String(item.school || "").trim(),
        Requestor: String(item.requestor_name || "").trim(),
        Details: String(item.adm_focal || "").trim() ? `ADM Focal: ${String(item.adm_focal || "").trim()}` : "",
        DocumentsSubmitted: [path.basename(psdsPath), path.basename(secondaryPath)].filter(Boolean).join(" | "),
        DocumentPaths: [psdsPath, secondaryPath].filter(Boolean).join(" | "),
        Result: String(item.review_note || "").trim(),
        ReviewedBy: String(item.reviewed_by || "").trim(),
        ReviewedAt: String(item.reviewed_at || "").trim(),
        Status: getStatusLabel(item.status)
      });
    });

    exportRows.sort((left, right) => {
      const leftDate = new Date(left.DateRequested || 0).getTime();
      const rightDate = new Date(right.DateRequested || 0).getTime();
      return rightDate - leftDate;
    });

    const fileBuffer = await createTemplatedExcelBuffer({
      title: "ADM Approval Dashboard",
      sheetName: "ADM Approval Dashboard",
      rows: exportRows,
      emptyRow: { RequestType: "", DateRequested: "", District: "", School: "", Requestor: "", Details: "", DocumentsSubmitted: "", DocumentPaths: "", Result: "", ReviewedBy: "", ReviewedAt: "", Status: "" }
    });

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    res.setHeader("Content-Disposition", `attachment; filename="adm-approval-report-${Date.now()}.docx"`);
    return res.send(fileBuffer);
  } catch (error) {
    return res.status(500).json({ message: "Failed to export ADM approval dashboard.", detail: error.message });
  }
});

app.post("/api/admin/adm-requests/:id/status", requireAdmin, async (req, res) => {
  try {
    const requestId = String(req.params.id || "").trim();
    const status = String((req.body || {}).status || "").trim().toLowerCase();
    const pinCode = String((req.body || {}).pinCode || "").trim();
    const reviewNote = String((req.body || {}).reviewNote || "").trim();
    const validStatuses = ["approved", "revise"];

    if (!requestId || !validStatuses.includes(status)) {
      return res.status(400).json({ message: "Valid request id and status are required." });
    }

    if (status === "approved" && pinCode !== ADM_APPROVAL_PIN) {
      return res.status(403).json({ message: "Invalid approval PIN code." });
    }

    const admRequest = await db("adm_requests as ar")
      .leftJoin("users as u", "u.id", "ar.requestor_user_id")
      .where("ar.id", requestId)
      .first(
        "ar.id",
        "ar.status",
        "ar.request_date",
        "ar.district",
        "ar.school",
        "ar.adm_focal",
        "ar.reason_for_adm",
        "ar.duration_from",
        "ar.duration_to",
        "ar.requestor_name",
        "ar.requestor_user_id",
        "u.email as requestor_email"
      );

    if (!admRequest) {
      return res.status(404).json({ message: "ADM request not found." });
    }

    if (String(admRequest.status || "").trim().toLowerCase() === "approved" && status !== "approved") {
      return res.status(409).json({ message: "Approved ADM request can no longer be changed." });
    }

    const reviewerContext = await resolveAdminReviewerContext(req);
    const nowIso = new Date().toISOString();
    let approvalPdfPath = null;

    if (status === "approved") {
      approvalPdfPath = await createAdmApprovalPdf({
        requestId,
        requestDate: admRequest.request_date,
        approvedAt: nowIso,
        requestorName: admRequest.requestor_name,
        district: admRequest.district,
        school: admRequest.school,
        admFocal: admRequest.adm_focal
      });
    }

    const updated = await db("adm_requests")
      .where({ id: requestId })
      .update({
        status,
        approval_pdf_path: approvalPdfPath,
        review_note: reviewNote || null,
        reviewed_by: reviewerContext.reviewerName,
        reviewed_by_user_id: reviewerContext.reviewerUserId,
        reviewed_at: nowIso,
        updated_at: nowIso
      });

    if (!updated) {
      return res.status(404).json({ message: "ADM request not found." });
    }

    const recipientEmail = normalizeEmail((admRequest || {}).requestor_email || "");
    if (recipientEmail) {
      try {
        await sendAdmRequestStatusEmail({
          email: recipientEmail,
          requestorName: admRequest.requestor_name,
          status,
          reviewNote,
          requestDate: admRequest.request_date,
          district: admRequest.district,
          school: admRequest.school,
          admFocal: admRequest.adm_focal,
          approvalPdfPath
        });
      } catch (mailError) {
        console.warn("ADM request status email failed:", mailError.message);
      }
    }

    broadcastTeacherAdmRequestStatusUpdate(admRequest.requestor_user_id, {
      id: requestId,
      status,
      approval_pdf_path: approvalPdfPath,
      review_note: reviewNote || null,
      reviewed_by: reviewerContext.reviewerName,
      reviewed_at: nowIso
    });

    return res.json({
      message: status === "approved"
        ? "ADM request approved. The requester was notified and the approval PDF is ready."
        : "ADM request updated.",
      approval_pdf_path: approvalPdfPath
    });
  } catch (error) {
    return res.status(500).json({ message: "Failed to update ADM request.", detail: error.message });
  }
});

app.get("/api/approval-requests", requireLogin, async (req, res) => {
  try {
    const requests = await db("approval_requests")
      .where({ requestor_user_id: req.session.userId })
      .select("id", "learner_id", "district", "school", "requestor_name", "learner_name", "document_path", "status", "review_note", "reviewed_by", "reviewed_at", "created_at", "updated_at")
      .orderBy("created_at", "desc");

    return res.json({ requests });
  } catch (error) {
    return res.status(500).json({ message: "Failed to fetch approval requests.", detail: error.message });
  }
});

app.post("/api/approval-requests", requireLogin, approvalRequestUpload.single("document"), async (req, res) => {
  try {
    const learnerId = String((req.body || {}).learnerId || "").trim();
    if (!learnerId) {
      deleteFileIfExists(req.file && req.file.path);
      return res.status(400).json({ message: "learnerId is required." });
    }

    if (!req.file) {
      return res.status(400).json({ message: "Document file is required." });
    }

    const learner = await db("learners")
      .where({ id: learnerId, user_id: req.session.userId })
      .first("id", "district", "school", "family_name", "firstname", "middlename");

    if (!learner) {
      deleteFileIfExists(req.file && req.file.path);
      return res.status(404).json({ message: "Learner record not found." });
    }

    const existingPending = await db("approval_requests")
      .where({ learner_id: learnerId, requestor_user_id: req.session.userId, status: "pending" })
      .first("id");

    if (existingPending) {
      deleteFileIfExists(req.file && req.file.path);
      return res.status(409).json({ message: "An approval request for this learner is already pending." });
    }

    const user = await db("users")
      .where({ id: req.session.userId })
      .first("firstname", "lastname", "middlename");

    const requestorName = [String((user || {}).lastname || "").trim(), String((user || {}).firstname || "").trim(), String((user || {}).middlename || "").trim()]
      .filter(Boolean)
      .join(", ") || "N/A";
    const learnerName = [String(learner.family_name || "").trim(), String(learner.firstname || "").trim(), String(learner.middlename || "").trim()]
      .filter(Boolean)
      .join(", ") || "N/A";
    const nowIso = new Date().toISOString();

    await db("approval_requests").insert({
      id: crypto.randomUUID(),
      learner_id: learnerId,
      requestor_user_id: req.session.userId,
      district: String(learner.district || "N/A").trim() || "N/A",
      school: String(learner.school || "N/A").trim() || "N/A",
      requestor_name: requestorName,
      learner_name: learnerName,
      document_path: path.posix.join("uploads", "approval-requests", path.basename(String(req.file.filename || "").trim())),
      status: "pending",
      created_at: nowIso,
      updated_at: nowIso
    });

    return res.json({ message: "ADM approval request submitted." });
  } catch (error) {
    deleteFileIfExists(req.file && req.file.path);
    return res.status(500).json({ message: "Failed to create approval request.", detail: error.message });
  }
});

app.post("/api/approval-requests/:id/document", requireLogin, approvalRequestUpload.single("document"), async (req, res) => {
  try {
    const requestId = String(req.params.id || "").trim();
    if (!requestId) {
      deleteFileIfExists(req.file && req.file.path);
      return res.status(400).json({ message: "Request id is required." });
    }

    if (!req.file) {
      return res.status(400).json({ message: "Document file is required." });
    }

    const requestRow = await db("approval_requests")
      .where({ id: requestId, requestor_user_id: req.session.userId })
      .first("id", "status", "document_path");

    if (!requestRow) {
      deleteFileIfExists(req.file && req.file.path);
      return res.status(404).json({ message: "Approval request not found." });
    }

    const status = String(requestRow.status || "pending").trim().toLowerCase();
    if (status === "approved") {
      deleteFileIfExists(req.file && req.file.path);
      return res.status(400).json({ message: "Approved requests can no longer replace documents." });
    }

    const newDocumentPath = path.posix.join("uploads", "approval-requests", path.basename(String(req.file.filename || "").trim()));
    await db("approval_requests")
      .where({ id: requestId, requestor_user_id: req.session.userId })
      .update({
        document_path: newDocumentPath,
        updated_at: new Date().toISOString()
      });

    const oldUploadPath = resolveApprovalUploadPath(requestRow.document_path);
    if (oldUploadPath) {
      deleteFileIfExists(oldUploadPath);
    }

    return res.json({ message: "Approval request document replaced.", documentPath: newDocumentPath });
  } catch (error) {
    deleteFileIfExists(req.file && req.file.path);
    return res.status(500).json({ message: "Failed to replace approval request document.", detail: error.message });
  }
});

app.get("/api/admin/approval-requests", requireAdmin, async (req, res) => {
  try {
    const requests = await db("approval_requests")
      .select("id", "learner_id", "district", "school", "requestor_name", "learner_name", "document_path", "status", "review_note", "reviewed_by", "reviewed_at", "created_at", "updated_at")
      .orderBy([
        { column: "status", order: "asc" },
        { column: "created_at", order: "desc" }
      ]);

    return res.json({ requests });
  } catch (error) {
    return res.status(500).json({ message: "Failed to fetch admin approval requests.", detail: error.message });
  }
});

app.post("/api/admin/approval-requests/:id/status", requireAdmin, async (req, res) => {
  try {
    const requestId = String(req.params.id || "").trim();
    const status = String((req.body || {}).status || "").trim().toLowerCase();
    const pinCode = String((req.body || {}).pinCode || "").trim();
    const reviewNote = String((req.body || {}).reviewNote || "").trim();
    const validStatuses = ["approved", "revise"];

    if (!requestId || !validStatuses.includes(status)) {
      return res.status(400).json({ message: "Valid request id and status are required." });
    }

    if (status === "approved" && pinCode !== ADM_APPROVAL_PIN) {
      return res.status(403).json({ message: "Invalid approval PIN code." });
    }

    const approvalRequest = await db("approval_requests as ar")
      .leftJoin("users as u", "u.id", "ar.requestor_user_id")
      .where("ar.id", requestId)
      .first(
        "ar.id",
        "ar.status",
        "ar.requestor_name",
        "ar.learner_name",
        "ar.requestor_user_id",
        "u.email as requestor_email"
      );

    if (!approvalRequest) {
      return res.status(404).json({ message: "Approval request not found." });
    }

    if (String(approvalRequest.status || "").trim().toLowerCase() === "approved" && status !== "approved") {
      return res.status(409).json({ message: "Approved request can no longer be changed." });
    }

    const reviewerContext = await resolveAdminReviewerContext(req);
    const nowIso = new Date().toISOString();

    const updated = await db("approval_requests")
      .where({ id: requestId })
      .update({
        status,
        review_note: reviewNote || null,
        reviewed_by: reviewerContext.reviewerName,
        reviewed_by_user_id: reviewerContext.reviewerUserId,
        reviewed_at: nowIso,
        updated_at: nowIso
      });

    if (!updated) {
      return res.status(404).json({ message: "Approval request not found." });
    }

    const recipientEmail = normalizeEmail((approvalRequest || {}).requestor_email || "");
    if (recipientEmail) {
      try {
        await sendApprovalRequestStatusEmail({
          email: recipientEmail,
          requestorName: approvalRequest.requestor_name,
          learnerName: approvalRequest.learner_name,
          status,
          reviewNote
        });
      } catch (mailError) {
        console.warn("Approval status email failed:", mailError.message);
      }
    }

    return res.json({ message: "Approval request updated." });
  } catch (error) {
    return res.status(500).json({ message: "Failed to update approval request.", detail: error.message });
  }
});

function getLearningResourceElapsedSeconds(startedAt, endedAt) {
  const started = new Date(startedAt || "").getTime();
  const ended = new Date(endedAt || "").getTime();
  if (!Number.isFinite(started) || !Number.isFinite(ended) || ended < started) return null;
  return Math.floor((ended - started) / 1000);
}

function formatLearningResourceElapsed(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "Not started";
  const totalMinutes = Math.floor(seconds / 60);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days) return `${days}d ${hours}h ${minutes}m`;
  if (hours) return `${hours}h ${minutes}m`;
  if (minutes) return `${minutes}m`;
  return `${seconds}s`;
}

function safeTrackingFilenamePart(value, fallback) {
  const normalized = String(value || "").trim().replace(/[^A-Za-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
  return normalized || fallback;
}

function buildAnswerTrackingFilename(row, learner) {
  const originalExtension = path.extname(String(row.answer_original_name || "")) || ".pdf";
  const completed = new Date(row.submitted_at || "");
  let completedStamp = "Pending";
  if (!Number.isNaN(completed.getTime())) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Manila",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23"
    }).formatToParts(completed).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
    completedStamp = `${parts.year}${parts.month}${parts.day}-${parts.hour}${parts.minute}`;
  }
  const elapsedSeconds = getLearningResourceElapsedSeconds(row.started_at, row.submitted_at);
  const elapsed = formatLearningResourceElapsed(elapsedSeconds).replace(/\s+/g, "-");
  const learnerCode = safeTrackingFilenamePart(learner && learner.learner_code, "Student");
  const type = safeTrackingFilenamePart(row.resource_type, "Resource");
  return `${learnerCode}_T${Number(row.term || 1)}_${type}-${Number(row.module_number || 1)}_Completed-${completedStamp}_Elapsed-${elapsed}${originalExtension.toLowerCase()}`;
}

function serializeLearningResource(row, learner, student) {
  const elapsedSeconds = getLearningResourceElapsedSeconds(row.started_at, row.submitted_at || (row.status === "ongoing" ? new Date().toISOString() : null));
  return {
    id: row.id,
    resource_type: row.resource_type,
    title: row.title,
    subject: row.subject || "",
    description: row.description || "",
    term: Number(row.term || 1),
    module_number: Number(row.module_number || 1),
    status: String(row.status || "assigned"),
    started_at: row.started_at || null,
    submitted_at: row.submitted_at || null,
    elapsed_seconds: elapsedSeconds,
    elapsed_label: formatLearningResourceElapsed(elapsedSeconds),
    answer_original_name: row.answer_original_name || "",
    answer_tracking_name: row.answer_stored_path ? buildAnswerTrackingFilename(row, learner) : "",
    answer_file_size: Number(row.answer_file_size || 0),
    final_grade: row.final_grade == null ? null : Number(row.final_grade),
    graded_at: row.graded_at || null,
    original_name: row.original_name,
    mime_type: row.mime_type || "application/octet-stream",
    file_size: Number(row.file_size || 0),
    created_at: row.created_at,
    learner_id: row.learner_id,
    learner_lrn: learner ? learner.learner_code : "",
    learner_name: learner ? [learner.firstname, learner.middlename, learner.family_name].filter(Boolean).join(" ") : "",
    student_presence: getStudentPresence(student),
    preview_url: `/api/learning-resources/${encodeURIComponent(row.id)}/file?mode=preview`,
    download_url: `/api/learning-resources/${encodeURIComponent(row.id)}/file?mode=download`,
    answer_preview_url: row.answer_stored_path ? `/api/learning-resources/${encodeURIComponent(row.id)}/answer-file?mode=preview` : "",
    answer_download_url: row.answer_stored_path ? `/api/learning-resources/${encodeURIComponent(row.id)}/answer-file?mode=download` : ""
  };
}

app.get("/api/learning-resources", requireLogin, async (req, res) => {
  try {
    const user = await db("users").where({ id: req.session.userId }).first();
    const role = String((user && user.role) || "").toLowerCase();
    let query = db("learning_resources");
    if (role === "student") query = query.where({ student_user_id: user.id });
    else if (role === "teacher") query = query.where({ teacher_user_id: user.id });
    else if (role !== "admin") return res.status(403).json({ message: "Learning resource access is not available for this account." });
    const rows = await query.orderBy("created_at", "desc");
    const learnerIds = [...new Set(rows.map((row) => row.learner_id).filter(Boolean))];
    const learners = learnerIds.length ? await db("learners").whereIn("id", learnerIds) : [];
    const studentIds = [...new Set(rows.map((row) => row.student_user_id).filter(Boolean))];
    const students = studentIds.length ? await db("users").whereIn("id", studentIds).select("id", "last_seen_at", "active_session_id") : [];
    const learnerById = new Map(learners.map((learner) => [String(learner.id), learner]));
    const studentById = new Map(students.map((student) => [String(student.id), student]));
    return res.json({ resources: rows.map((row) => serializeLearningResource(row, learnerById.get(String(row.learner_id)), studentById.get(String(row.student_user_id)))), role });
  } catch (error) {
    return res.status(500).json({ message: "Unable to load learning resources.", detail: error.message });
  }
});

app.get("/api/admin/learning-resources-overview", requireAdmin, async (req, res) => {
  try {
    const [resources, teachers, students, learners] = await Promise.all([
      db("learning_resources").orderBy("created_at", "desc"),
      db("users").whereIn("role", ["teacher", "admin"]).orderBy("lastname", "asc"),
      db("users").where({ role: "student" }).orderBy("lastname", "asc"),
      db("learners").select("id", "learner_code", "firstname", "middlename", "family_name", "grade", "school")
    ]);
    const teacherAccounts = teachers.filter((user) => String(user.role || "").toLowerCase() === "teacher");
    const teacherById = new Map(teachers.map((user) => [String(user.id), user]));
    const studentById = new Map(students.map((user) => [String(user.id), user]));
    const learnerById = new Map(learners.map((learner) => [String(learner.id), learner]));
    const fullName = (user) => [user && user.firstname, user && user.middlename, user && user.lastname].filter(Boolean).join(" ").trim() || "—";
    const activity = resources.map((resource) => {
      const learner = learnerById.get(String(resource.learner_id));
      const teacher = teacherById.get(String(resource.teacher_user_id)) || {};
      const student = studentById.get(String(resource.student_user_id)) || {};
      return {
        ...serializeLearningResource(resource, learner, student),
        teacher_name: fullName(teacher),
        teacher_school: teacher.school || "",
        student_name: fullName(student),
        student_lrn: student.lrn || (learner && learner.learner_code) || ""
      };
    });
    const teacherSummary = teacherAccounts.map((teacher) => {
      const uploaded = resources.filter((resource) => String(resource.teacher_user_id) === String(teacher.id));
      return { id: teacher.id, name: fullName(teacher), school: teacher.school || "", district: teacher.district || "", uploads: uploaded.length, students: new Set(uploaded.map((item) => String(item.student_user_id))).size, completed: uploaded.filter((item) => item.status === "done").length };
    });
    const studentSummary = students.map((student) => {
      const assigned = resources.filter((resource) => String(resource.student_user_id) === String(student.id));
      return { id: student.id, name: fullName(student), lrn: student.lrn || "", school: student.school || "", district: student.district || "", assigned: assigned.length, ongoing: assigned.filter((item) => item.status === "ongoing").length, completed: assigned.filter((item) => item.status === "done").length, presence: getStudentPresence(student) };
    });
    const districtReference = loadDistrictSchoolReference();
    const districtNames = Array.from(new Set([
      ...(districtReference.districts || []),
      ...students.map((student) => String(student.district || "").trim()),
      ...teacherAccounts.map((teacher) => String(teacher.district || "").trim())
    ].filter(Boolean)));
    const districtKey = (value) => String(value || "").trim().toLocaleLowerCase("en-PH");
    const districts = districtNames.map((district) => {
      const key = districtKey(district);
      const districtStudents = students.filter((student) => districtKey(student.district) === key);
      const districtTeachers = teacherAccounts.filter((teacher) => districtKey(teacher.district) === key);
      const studentIds = new Set(districtStudents.map((student) => String(student.id)));
      const districtResources = resources.filter((resource) => studentIds.has(String(resource.student_user_id)));
      return {
        district,
        teachers: districtTeachers.length,
        students: districtStudents.length,
        assigned: districtResources.filter((item) => item.status === "assigned").length,
        ongoing: districtResources.filter((item) => item.status === "ongoing").length,
        completed: districtResources.filter((item) => item.status === "done").length
      };
    }).sort((a, b) => a.district.localeCompare(b.district, "en-PH"));
    return res.json({
      totals: { uploads: resources.length, teachers: teacherAccounts.length, students: students.length, assigned: resources.filter((item) => item.status === "assigned").length, ongoing: resources.filter((item) => item.status === "ongoing").length, completed: resources.filter((item) => item.status === "done").length },
      activity,
      teachers: teacherSummary,
      students: studentSummary,
      districts
    });
  } catch (error) {
    return res.status(500).json({ message: "Unable to load the administrator learning resources overview.", detail: error.message });
  }
});

app.post("/api/learning-resources", requireTeacher, learningResourceUpload.single("resource_file"), async (req, res) => {
  try {
    const learnerId = String((req.body || {}).learner_id || "").trim();
    const title = String((req.body || {}).title || "").trim();
    const resourceType = String((req.body || {}).resource_type || "").trim();
    const term = Number((req.body || {}).term || 0);
    const moduleNumber = Number((req.body || {}).module_number || 0);
    if (!req.file) return res.status(400).json({ message: "Select a learning resource file to upload." });
    if (!learnerId || !title || !["Module", "Learning Activity Sheet"].includes(resourceType) || ![1, 2, 3].includes(term) || !Number.isInteger(moduleNumber) || moduleNumber < 1 || moduleNumber > 100) {
      deleteFileIfExists(req.file.path);
      return res.status(400).json({ message: "Student, resource type, title, and file are required." });
    }
    const role = String(req.session.role || "").toLowerCase();
    let learnerQuery = db("learners").where({ id: learnerId });
    if (role !== "admin") learnerQuery = learnerQuery.andWhere({ user_id: req.session.userId });
    const learner = await learnerQuery.first();
    if (!learner) {
      deleteFileIfExists(req.file.path);
      return res.status(404).json({ message: "The selected learner is unavailable for this account." });
    }
    const student = await db("users").where({ lrn: String(learner.learner_code || "").trim(), role: "student" }).first();
    if (!student) {
      deleteFileIfExists(req.file.path);
      return res.status(409).json({ message: "The selected learner does not have a student account yet." });
    }
    const id = crypto.randomUUID();
    const row = {
      id,
      teacher_user_id: req.session.userId,
      student_user_id: student.id,
      learner_id: learner.id,
      resource_type: resourceType,
      term,
      module_number: moduleNumber,
      status: "assigned",
      title,
      subject: String((req.body || {}).subject || "").trim(),
      description: String((req.body || {}).description || "").trim(),
      original_name: path.basename(String(req.file.originalname || "learning-resource")),
      stored_path: path.relative(__dirname, req.file.path).replace(/\\/g, "/"),
      mime_type: String(req.file.mimetype || "application/octet-stream"),
      file_size: Number(req.file.size || 0),
      created_at: new Date().toISOString()
    };
    await db("learning_resources").insert(row);
    return res.status(201).json({ message: `${resourceType} assigned to ${learner.firstname} ${learner.family_name}.`, resource: serializeLearningResource(row, learner) });
  } catch (error) {
    if (req.file) deleteFileIfExists(req.file.path);
    return res.status(500).json({ message: "Unable to upload the learning resource.", detail: error.message });
  }
});

app.post("/api/learning-resources/:id/start", requireLogin, async (req, res) => {
  try {
    const user = await db("users").where({ id: req.session.userId }).first();
    if (!user || String(user.role || "").toLowerCase() !== "student") return res.status(403).json({ message: "Student account access only." });
    const resource = await db("learning_resources").where({ id: String(req.params.id || ""), student_user_id: user.id }).first();
    if (!resource) return res.status(404).json({ message: "Assigned learning resource not found." });
    if (String(resource.status || "assigned") === "done") return res.status(409).json({ message: "This activity has already been submitted." });
    const startedAt = resource.started_at || new Date().toISOString();
    await db("learning_resources").where({ id: resource.id }).update({ status: "ongoing", started_at: startedAt });
    return res.json({ message: "Answering started. Your teacher adviser has been notified.", status: "ongoing", started_at: startedAt });
  } catch (error) {
    return res.status(500).json({ message: "Unable to start the activity.", detail: error.message });
  }
});

app.post("/api/learning-resources/:id/submit", requireLogin, learningResourceUpload.single("answer_file"), async (req, res) => {
  try {
    const user = await db("users").where({ id: req.session.userId }).first();
    if (!user || String(user.role || "").toLowerCase() !== "student") {
      if (req.file) deleteFileIfExists(req.file.path);
      return res.status(403).json({ message: "Student account access only." });
    }
    const resource = await db("learning_resources").where({ id: String(req.params.id || ""), student_user_id: user.id }).first();
    if (!resource || !req.file) {
      if (req.file) deleteFileIfExists(req.file.path);
      return res.status(400).json({ message: "Select your completed Module/LAS answer file." });
    }
    if (resource.answer_stored_path) {
      const previous = path.resolve(__dirname, resource.answer_stored_path);
      if (previous.startsWith(path.resolve(LEARNING_RESOURCE_UPLOAD_DIR))) deleteFileIfExists(previous);
    }
    const submittedAt = new Date().toISOString();
    await db("learning_resources").where({ id: resource.id }).update({
      status: "done",
      started_at: resource.started_at || submittedAt,
      answer_original_name: path.basename(String(req.file.originalname || "student-answer")),
      answer_stored_path: path.relative(__dirname, req.file.path).replace(/\\/g, "/"),
      answer_mime_type: String(req.file.mimetype || "application/octet-stream"),
      answer_file_size: Number(req.file.size || 0),
      submitted_at: submittedAt
    });
    return res.json({ message: "Answer uploaded successfully. Your teacher adviser has been notified that you are done.", status: "done", submitted_at: submittedAt });
  } catch (error) {
    if (req.file) deleteFileIfExists(req.file.path);
    return res.status(500).json({ message: "Unable to submit the answer file.", detail: error.message });
  }
});

app.put("/api/learning-resources/:id/final-grade", requireTeacher, async (req, res) => {
  try {
    const finalGrade = Number((req.body || {}).final_grade);
    if (!Number.isInteger(finalGrade) || finalGrade < 60 || finalGrade > 100) {
      return res.status(400).json({ message: "Enter a whole-number final grade from 60 to 100." });
    }
    let query = db("learning_resources").where({ id: String(req.params.id || "") });
    if (String(req.session.role || "").toLowerCase() !== "admin") query = query.andWhere({ teacher_user_id: req.session.userId });
    const resource = await query.first();
    if (!resource) return res.status(404).json({ message: "Learning resource not found for this teacher/adviser." });
    if (String(resource.status || "") !== "done") return res.status(409).json({ message: "A final grade can be entered only after the student submits the completed answer." });
    const gradedAt = new Date().toISOString();
    await db("learning_resources").where({ id: resource.id }).update({ final_grade: finalGrade, graded_at: gradedAt, graded_by_user_id: req.session.userId });
    return res.json({ message: `Final grade ${finalGrade} saved successfully.`, final_grade: finalGrade, graded_at: gradedAt });
  } catch (error) {
    return res.status(500).json({ message: "Unable to save the final grade.", detail: error.message });
  }
});

app.get("/api/learning-resources/:id/answer-file", requireLogin, async (req, res) => {
  try {
    const resource = await db("learning_resources").where({ id: String(req.params.id || "") }).first();
    const user = await db("users").where({ id: req.session.userId }).first();
    const role = String((user && user.role) || "").toLowerCase();
    const allowed = resource && (role === "admin" || (role === "teacher" && resource.teacher_user_id === user.id) || (role === "student" && resource.student_user_id === user.id));
    if (!allowed) return res.status(403).json({ message: "You do not have access to this submitted answer." });
    const absolutePath = path.resolve(__dirname, String(resource.answer_stored_path || ""));
    if (!resource.answer_stored_path || !absolutePath.startsWith(path.resolve(LEARNING_RESOURCE_UPLOAD_DIR)) || !fs.existsSync(absolutePath)) return res.status(404).json({ message: "Submitted answer file not found." });
    const learner = await db("learners").where({ id: resource.learner_id }).first("learner_code");
    const trackingFilename = buildAnswerTrackingFilename(resource, learner);
    if (String(req.query.mode || "preview") === "download") return res.download(absolutePath, trackingFilename);
    res.type(resource.answer_mime_type || "application/octet-stream");
    res.setHeader("Content-Disposition", `inline; filename="${trackingFilename.replace(/["\r\n]/g, "")}"`);
    return res.sendFile(absolutePath);
  } catch (error) {
    return res.status(500).json({ message: "Unable to open the submitted answer.", detail: error.message });
  }
});

app.get("/api/learning-resources/:id/file", requireLogin, async (req, res) => {
  try {
    const resource = await db("learning_resources").where({ id: String(req.params.id || "") }).first();
    if (!resource) return res.status(404).json({ message: "Learning resource not found." });
    const user = await db("users").where({ id: req.session.userId }).first();
    const role = String((user && user.role) || "").toLowerCase();
    const allowed = role === "admin" || (role === "teacher" && resource.teacher_user_id === user.id) || (role === "student" && resource.student_user_id === user.id);
    if (!allowed) return res.status(403).json({ message: "You do not have access to this learning resource." });
    const absolutePath = path.resolve(__dirname, String(resource.stored_path || ""));
    const resourceRoot = path.resolve(LEARNING_RESOURCE_UPLOAD_DIR);
    if (!absolutePath.startsWith(resourceRoot) || !fs.existsSync(absolutePath)) return res.status(404).json({ message: "The uploaded file is unavailable." });
    if (String(req.query.mode || "preview") === "download") return res.download(absolutePath, resource.original_name);
    res.type(resource.mime_type || "application/octet-stream");
    res.setHeader("Content-Disposition", `inline; filename="${String(resource.original_name || "resource").replace(/["\r\n]/g, "")}"`);
    return res.sendFile(absolutePath);
  } catch (error) {
    return res.status(500).json({ message: "Unable to open the learning resource.", detail: error.message });
  }
});

app.delete("/api/learning-resources/:id", requireTeacher, async (req, res) => {
  try {
    let query = db("learning_resources").where({ id: String(req.params.id || "") });
    if (String(req.session.role || "").toLowerCase() !== "admin") query = query.andWhere({ teacher_user_id: req.session.userId });
    const resource = await query.first();
    if (!resource) return res.status(404).json({ message: "Learning resource not found." });
    await db("learning_resources").where({ id: resource.id }).del();
    const absolutePath = path.resolve(__dirname, String(resource.stored_path || ""));
    if (absolutePath.startsWith(path.resolve(LEARNING_RESOURCE_UPLOAD_DIR))) deleteFileIfExists(absolutePath);
    if (resource.answer_stored_path) {
      const answerPath = path.resolve(__dirname, resource.answer_stored_path);
      if (answerPath.startsWith(path.resolve(LEARNING_RESOURCE_UPLOAD_DIR))) deleteFileIfExists(answerPath);
    }
    return res.json({ message: "Learning resource removed." });
  } catch (error) {
    return res.status(500).json({ message: "Unable to remove the learning resource.", detail: error.message });
  }
});

app.get("/api/student/profile", requireLogin, async (req, res) => {
  try {
    const user = await db("users").where({ id: req.session.userId }).first();
    if (!user || String(user.role || "").toLowerCase() !== "student") return res.status(403).json({ message: "Student account access only." });
    const assignedResources = await db("learning_resources").where({ student_user_id: user.id }).orderBy([{ column: "term", order: "asc" }, { column: "module_number", order: "asc" }]);
    const modules = assignedResources.map((resource) => ({
      id: resource.id,
      term: Number(resource.term || 1),
      module_no: Number(resource.module_number || 1),
      module_title: resource.title,
      resource_type: resource.resource_type,
      status: resource.status === "done" ? "answered" : resource.status === "ongoing" ? "ongoing" : "not_answered",
      answered_at: resource.submitted_at || null,
      started_at: resource.started_at || null,
      assigned_at: resource.created_at || null,
      subject: resource.subject || "",
      description: resource.description || "",
      final_grade: resource.final_grade == null ? null : Number(resource.final_grade),
      graded_at: resource.graded_at || null
    }));
    const attendance = await db("student_attendance").where({ student_user_id: user.id }).orderBy("school_year", "desc");
    const learnerHistory = await db("learners")
      .where({ learner_code: String(user.lrn || "").trim() })
      .orderBy([{ column: "date_started", order: "desc" }, { column: "created_at", order: "desc" }]);
    const learner = learnerHistory[0] || null;
    const schoolYearFromDate = (value) => {
      const date = new Date(value || "");
      if (Number.isNaN(date.getTime())) return "Not specified";
      const year = date.getFullYear();
      return `${year}-${year + 1}`;
    };
    const enrollment = learnerHistory.map((record, index) => ({
      id: record.id,
      school_year: schoolYearFromDate(record.date_started),
      grade: record.grade || "",
      district: record.district || "",
      school: record.school || "",
      school_address: record.school_address || "",
      modality: record.modality || "Modular Distance Learning",
      type_of_instruction: record.type_of_instruction || "",
      date_started: record.date_started || record.created_at || null,
      teacher_adviser: record.teacher_adviser || "",
      status: index === 0 ? "Current" : "Previous"
    }));
    const schedule = assignedResources.map((resource) => ({
      id: resource.id,
      term: Number(resource.term || 1),
      module_number: Number(resource.module_number || 1),
      resource_type: resource.resource_type,
      title: resource.title,
      subject: resource.subject || "General",
      assigned_at: resource.created_at || null,
      started_at: resource.started_at || null,
      submitted_at: resource.submitted_at || null,
      status: resource.status || "assigned"
    }));
    const grades = learner ? [
      { term: "Term 1 Grade", grade: learner.first_grading_grade, descriptor: learner.first_grading_verbal || "", interpretation: learner.first_grading_interpretation || "" },
      { term: "Term 2 Grade", grade: learner.second_quarter_grade, descriptor: learner.second_quarter_verbal || "", interpretation: learner.second_quarter_interpretation || "" },
      { term: "Term 3 Grade", grade: learner.third_quarter_grade, descriptor: learner.third_quarter_verbal || "", interpretation: learner.third_quarter_interpretation || "" }
    ] : [];
    const moduleFinalGrades = assignedResources.map((resource) => Number(resource.final_grade)).filter((grade) => Number.isFinite(grade));
    if (moduleFinalGrades.length) {
      const finalModuleAverage = Math.round((moduleFinalGrades.reduce((sum, grade) => sum + grade, 0) / moduleFinalGrades.length) * 10) / 10;
      grades.push({ term: "Final Module Average", grade: finalModuleAverage, descriptor: `${moduleFinalGrades.length} graded completed ${moduleFinalGrades.length === 1 ? "activity" : "activities"}`, interpretation: "Teacher-entered Module/LAS final grades" });
    }
    const anecdotal = learnerHistory.flatMap((record) => {
      const entries = [
        ["Teacher intervention", record.intervention],
        ["Phil-IRI result", record.phil_iri_result],
        ["RMA result", record.rma_result],
        ["CRLA result", record.ellna_result],
        ["Academic recovery and reintegration", record.academic_recovery_reintegration],
        ["Parent and community engagement", record.parent_community_engagement]
      ];
      return entries.filter((entry) => String(entry[1] || "").trim()).map((entry) => ({
        category: entry[0],
        note: String(entry[1]).trim(),
        recorded_at: record.updated_at || record.created_at || null,
        recorded_by: record.teacher_adviser || "Teacher adviser"
      }));
    });
    return res.json({
      user: sanitizeUser(user),
      adviser: (learner && learner.teacher_adviser) || "",
      enrollment,
      schedule,
      modules,
      grades,
      attendance,
      prospectus: schedule,
      anecdotal
    });
  } catch (error) {
    return res.status(500).json({ message: "Failed to load student profile.", detail: error.message });
  }
});

const profileImageUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, PROFILE_IMAGE_UPLOAD_DIR),
    filename: (req, file, cb) => cb(null, `${Date.now()}-${crypto.randomUUID()}${path.extname(file.originalname).toLowerCase()}`)
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const accepted = new Set(["image/jpeg", "image/png", "image/webp"]);
    const valid = accepted.has(file.mimetype);
    cb(valid ? null : new Error("Upload a JPG, PNG, or WEBP image."), valid);
  }
});

app.put("/api/student/profile", requireLogin, async (req, res) => {
  try {
    const user = await db("users").where({ id: req.session.userId }).first();
    if (!user || String(user.role || "").toLowerCase() !== "student") return res.status(403).json({ message: "Student account access only." });
    const allowed = ["firstname", "lastname", "middlename", "extension_name", "gender", "birth_date", "current_residence", "religion", "mother_tongue", "ethnicity", "mothers_maiden_name", "fathers_name", "guardian_name", "guardian_contact"];
    const changes = { updated_at: new Date().toISOString() };
    allowed.forEach((key) => { if (Object.prototype.hasOwnProperty.call(req.body || {}, key)) changes[key] = String(req.body[key] || "").trim(); });
    if (!changes.firstname || !changes.lastname) return res.status(400).json({ message: "First name and last name are required." });
    await db("users").where({ id: user.id }).update(changes);
    return res.json({ message: "Profile updated.", user: sanitizeUser(await db("users").where({ id: user.id }).first()) });
  } catch (error) {
    return res.status(500).json({ message: "Failed to update profile.", detail: error.message });
  }
});

app.post("/api/student/profile-image", requireLogin, profileImageUpload.single("profileImage"), async (req, res) => {
  try {
    const user = await db("users").where({ id: req.session.userId }).first();
    if (!user || String(user.role || "").toLowerCase() !== "student") return res.status(403).json({ message: "Student account access only." });
    if (!req.file) return res.status(400).json({ message: "Select an image to upload." });
    const profileImage = `/uploads/profile-images/${req.file.filename}`;
    await db("users").where({ id: user.id }).update({ profile_image: profileImage, updated_at: new Date().toISOString() });
    return res.json({ message: "Profile image updated.", profile_image: profileImage });
  } catch (error) {
    return res.status(500).json({ message: "Failed to upload profile image.", detail: error.message });
  }
});

app.post("/api/student/reset-password", requireLogin, async (req, res) => {
  try {
    const user = await db("users").where({ id: req.session.userId }).first();
    if (!user || String(user.role || "").toLowerCase() !== "student") return res.status(403).json({ message: "Student account access only." });
    const currentPassword = String((req.body || {}).currentPassword || "");
    const newPassword = String((req.body || {}).newPassword || "");
    if (!(await bcrypt.compare(currentPassword, user.password_hash))) return res.status(400).json({ message: "Current password is incorrect." });
    if (!isStrongPassword(newPassword)) return res.status(400).json({ message: "New password must have 8+ characters with uppercase, lowercase, number, and special character." });
    await db("users").where({ id: user.id }).update({ password_hash: await bcrypt.hash(newPassword, 12), updated_at: new Date().toISOString() });
    return res.json({ message: "Password reset successfully." });
  } catch (error) {
    return res.status(500).json({ message: "Failed to reset password.", detail: error.message });
  }
});

app.get("/api/admin/student-monitoring", requireTeacher, async (req, res) => {
  try {
    let students = await db("users").where({ role: "student", approved: true }).select("*").orderBy(["district", "school", "lastname", "firstname"]);
    if (String(req.session.role || "").toLowerCase() === "teacher") {
      const [adviserLearners, teacherResources] = await Promise.all([
        db("learners").where({ adviser_user_id: req.session.userId }).select("learner_code"),
        db("learning_resources").where({ teacher_user_id: req.session.userId }).select("student_user_id")
      ]);
      const adviserLrns = new Set(adviserLearners.map((learner) => String(learner.learner_code || "").trim()).filter(Boolean));
      const resourceStudentIds = new Set(teacherResources.map((resource) => String(resource.student_user_id || "")).filter(Boolean));
      students = students.filter((student) => adviserLrns.has(String(student.lrn || "").trim()) || resourceStudentIds.has(String(student.id)));
    }
    const studentIds = students.map((student) => student.id);
    const lrns = students.map((student) => String(student.lrn || "").trim()).filter(Boolean);
    const progressRows = studentIds.length ? await db("student_module_progress").whereIn("student_user_id", studentIds).select("student_user_id", "status") : [];
    const resourceRows = studentIds.length ? await db("learning_resources").whereIn("student_user_id", studentIds).select("student_user_id", "status") : [];
    const learnerRows = lrns.length ? await db("learners").whereIn("learner_code", lrns).select("learner_code", "grade", "first_grading_grade", "second_quarter_grade", "third_quarter_grade", "fourth_quarter_grade") : [];
    const teachers = await db("users").where({ approved: true }).whereIn("role", ["teacher", "supervisor"]).select("firstname", "lastname", "email", "district", "school", "role");
    const progress = new Map();
    progressRows.forEach((row) => { const key = String(row.student_user_id); const item = progress.get(key) || { answered: 0 }; if (String(row.status) === "answered") item.answered += 1; progress.set(key, item); });
    const resourceProgress = new Map();
    resourceRows.forEach((row) => {
      const key = String(row.student_user_id);
      const item = resourceProgress.get(key) || { total: 0, assigned: 0, ongoing: 0, done: 0 };
      const status = String(row.status || "assigned").toLowerCase();
      item.total += 1;
      if (status === "ongoing") item.ongoing += 1;
      else if (status === "done") item.done += 1;
      else item.assigned += 1;
      resourceProgress.set(key, item);
    });
    const learnersByLrn = new Map(learnerRows.map((row) => [String(row.learner_code || "").trim(), row]));
    const teacherBySchool = new Map();
    teachers.forEach((teacher) => { const key = `${teacher.district || ""}|${teacher.school || ""}`.toLowerCase(); if (!teacherBySchool.has(key)) teacherBySchool.set(key, teacher); });
    const records = students.map((student) => {
      const legacyModule = progress.get(String(student.id)) || { answered: 0 };
      const assignedResources = resourceProgress.get(String(student.id));
      const module = assignedResources || { total: 10, assigned: Math.max(0, 10 - legacyModule.answered), ongoing: 0, done: legacyModule.answered };
      const learner = learnersByLrn.get(String(student.lrn || "").trim()) || {};
      const grades = [learner.first_grading_grade, learner.second_quarter_grade, learner.third_quarter_grade, learner.fourth_quarter_grade].map(Number).filter((grade) => Number.isFinite(grade) && grade > 0);
      const averageGrade = grades.length ? Math.round((grades.reduce((sum, grade) => sum + grade, 0) / grades.length) * 10) / 10 : null;
      const progressTarget = module.total >= 9 ? 3 : (module.total >= 2 ? 2 : 1);
      const completedAll = module.total > 0 && module.done === module.total;
      const onTrack = module.ongoing > 0 || completedAll || module.done >= progressTarget;
      const reasons = [];
      if (module.done === 0 && module.ongoing === 0) reasons.push("No answered modules");
      if (averageGrade !== null && averageGrade < 75) reasons.push("Failing grade");
      const teacher = teacherBySchool.get(`${student.district || ""}|${student.school || ""}`.toLowerCase()) || null;
      const learningStatus = module.ongoing > 0 ? "ongoing" : (completedAll ? "done" : (module.done > 0 ? "started" : "not_started"));
      return { id: student.id, name: [student.firstname, student.middlename, student.lastname].filter(Boolean).join(" "), lrn: student.lrn || "", district: student.district || "", school: student.school || "", gradeLevel: learner.grade || "", answeredModules: module.done, ongoingModules: module.ongoing, totalModules: module.total, progressPercent: module.total ? Math.round((module.done / module.total) * 100) : 0, progressTarget, onTrack, learningStatus, averageGrade, urgent: !onTrack && reasons.length > 0, alertReasons: reasons, studentEmail: student.email || "", studentContact: student.guardian_contact || "", presence: getStudentPresence(student), teacher: teacher ? { name: [teacher.firstname, teacher.lastname].filter(Boolean).join(" "), email: teacher.email || "", role: teacher.role } : null };
    });
    const districtSummary = Array.from(records.reduce((map, record) => { const item = map.get(record.district) || { district: record.district || "Unassigned", students: 0, urgent: 0 }; item.students += 1; if (record.urgent) item.urgent += 1; map.set(record.district, item); return map; }, new Map()).values());
    return res.json({ records, districtSummary, totals: { students: records.length, online: records.filter((record) => record.presence.online).length, urgent: records.filter((record) => record.urgent).length, noModules: records.filter((record) => record.answeredModules === 0 && record.ongoingModules === 0).length, failing: records.filter((record) => record.averageGrade !== null && record.averageGrade < 75).length } });
  } catch (error) {
    return res.status(500).json({ message: "Failed to load student monitoring dashboard.", detail: error.message });
  }
});

app.get("/api/admin/modular-tracking-summary", requireTeacher, async (req, res) => {
  try {
    let [students, resources] = await Promise.all([
      db("users").where({ role: "student", approved: true }).select("id", "firstname", "middlename", "lastname", "lrn", "district", "school", "last_seen_at", "active_session_id"),
      db("learning_resources").select("id", "student_user_id", "term", "module_number", "title", "status", "created_at", "started_at", "submitted_at").orderBy("created_at", "desc")
    ]);
    if (String(req.session.role || "").toLowerCase() === "teacher") {
      const [adviserLearners, teacherResources] = await Promise.all([
        db("learners").where({ adviser_user_id: req.session.userId }).select("learner_code"),
        db("learning_resources").where({ teacher_user_id: req.session.userId }).select("id", "student_user_id", "term", "module_number", "title", "status", "created_at", "started_at", "submitted_at").orderBy("created_at", "desc")
      ]);
      const adviserLrns = new Set(adviserLearners.map((learner) => String(learner.learner_code || "").trim()).filter(Boolean));
      const resourceStudentIds = new Set(teacherResources.map((resource) => String(resource.student_user_id || "")).filter(Boolean));
      students = students.filter((student) => adviserLrns.has(String(student.lrn || "").trim()) || resourceStudentIds.has(String(student.id)));
      const allowedStudentIds = new Set(students.map((student) => String(student.id)));
      resources = teacherResources.filter((resource) => allowedStudentIds.has(String(resource.student_user_id)));
    }
    const studentById = new Map(students.map((student) => [String(student.id), student]));
    const summarize = (term) => {
      const scoped = term ? resources.filter((resource) => Number(resource.term || 1) === term) : resources;
      const assigned = scoped.filter((resource) => String(resource.status || "assigned") === "assigned").length;
      const ongoing = scoped.filter((resource) => String(resource.status || "") === "ongoing").length;
      const completed = scoped.filter((resource) => String(resource.status || "") === "done").length;
      const participating = new Set(scoped.map((resource) => String(resource.student_user_id))).size;
      const studentsWithProgress = new Set(scoped.filter((resource) => ["ongoing", "done"].includes(String(resource.status || ""))).map((resource) => String(resource.student_user_id)));
      const studentsWithAssigned = new Set(scoped.filter((resource) => String(resource.status || "assigned") === "assigned").map((resource) => String(resource.student_user_id)));
      const needsFollowUp = Array.from(studentsWithAssigned).filter((id) => !studentsWithProgress.has(id)).length;
      return { total: scoped.length, assigned, ongoing, completed, participating, needsFollowUp, completionRate: scoped.length ? Math.round((completed / scoped.length) * 1000) / 10 : 0 };
    };
    const activity = resources.slice(0, 12).map((resource) => {
      const student = studentById.get(String(resource.student_user_id)) || {};
      return {
        id: resource.id,
        student: [student.firstname, student.middlename, student.lastname].filter(Boolean).join(" ") || "Student",
        lrn: student.lrn || "",
        school: student.school || "",
        term: Number(resource.term || 1),
        moduleNumber: Number(resource.module_number || 1),
        title: resource.title || "Module",
        status: resource.status || "assigned",
        activityAt: resource.submitted_at || resource.started_at || resource.created_at
      };
    });
    const studentContainers = students.map((student) => {
      const studentResources = resources.filter((resource) => String(resource.student_user_id) === String(student.id));
      const summarizeResources = (items) => ({
        total: items.length,
        assigned: items.filter((item) => String(item.status || "assigned") === "assigned").length,
        ongoing: items.filter((item) => String(item.status || "") === "ongoing").length,
        completed: items.filter((item) => String(item.status || "") === "done").length,
        completionRate: items.length ? Math.round((items.filter((item) => String(item.status || "") === "done").length / items.length) * 1000) / 10 : 0
      });
      return {
        id: student.id,
        name: [student.firstname, student.middlename, student.lastname].filter(Boolean).join(" ") || "Student",
        lrn: student.lrn || "",
        district: student.district || "",
        school: student.school || "",
        presence: getStudentPresence(student),
        all: summarizeResources(studentResources),
        terms: { 1: summarizeResources(studentResources.filter((item) => Number(item.term || 1) === 1)), 2: summarizeResources(studentResources.filter((item) => Number(item.term || 1) === 2)), 3: summarizeResources(studentResources.filter((item) => Number(item.term || 1) === 3)) },
        activities: studentResources.map((resource) => ({ id: resource.id, term: Number(resource.term || 1), moduleNumber: Number(resource.module_number || 1), title: resource.title || "Module", status: resource.status || "assigned", activityAt: resource.submitted_at || resource.started_at || resource.created_at }))
      };
    });
    return res.json({ all: summarize(0), terms: { 1: summarize(1), 2: summarize(2), 3: summarize(3) }, activity, students: studentContainers });
  } catch (error) {
    return res.status(500).json({ message: "Failed to load modular learning tracker.", detail: error.message });
  }
});

// Treat the API base URL as a friendly entry point. Hostinger preview links or
// saved browser bookmarks may open /api directly, which should lead users back
// to the website instead of displaying the JSON 404 fallback.
app.get(["/api", "/api/"], (req, res) => {
  return res.redirect(302, "/");
});

app.get("/api/health", async (req, res) => {
  try {
    await db.raw("SELECT 1");
    return res.json({ status: "ok", database: "connected", time: new Date().toISOString() });
  } catch (error) {
    return res.status(503).json({ status: "unavailable", database: "disconnected" });
  }
});

app.use("/api", (req, res) => {
  return res.status(404).json({ message: "API route not found." });
});

app.use((err, req, res, next) => {
  if (!req.path.startsWith("/api/")) {
    return next(err);
  }

  if (err instanceof multer.MulterError) {
    return res.status(400).json({ message: err.message || "File upload failed." });
  }

  if (String((err && err.message) || "").trim()) {
    if (String(err.message).includes("Invalid file type")) {
      return res.status(400).json({ message: err.message });
    }
  }

  if (err instanceof SyntaxError && err.status === 400 && "body" in err) {
    return res.status(400).json({ message: "Invalid JSON payload." });
  }

  console.error("API error:", err.message);
  return res.status(500).json({ message: "Internal server error." });
});

app.use(express.static(__dirname, {
  maxAge: "1h",
  setHeaders(res, filePath) {
    if (/\.(?:html|css|js)$/i.test(filePath)) res.setHeader("Cache-Control", "no-cache, must-revalidate");
  }
}));

async function startServer() {
  try {
    if (!ADMIN_ACCESS_KEY) {
      throw new Error("ADMIN_ACCESS_KEY is required in environment configuration.");
    }

    await ensureSchema();
    await ensureAdminAccount();
    await resetDatabaseRetainingAdministratorOnce();
    await removePlaceholderLearners();

    app.listen(PORT, () => {
      console.log(`Server running at ${APP_BASE_URL}`);
      console.log(`Database client: ${DB_CLIENT}`);
      console.log("Registration mode: admin approval (email verification disabled).");
    });
  } catch (error) {
    console.error("Failed to initialize server:", error.message);
    process.exit(1);
  }
}

app.get("/api/student/profile", requireLogin, async (req, res) => {
  try {
    const user = await db("users").where({ id: req.session.userId }).first();
    if (!user || String(user.role || "").toLowerCase() !== "student") return res.status(403).json({ message: "Student account access only." });
    const savedModules = await db("student_module_progress").where({ student_user_id: user.id }).orderBy("module_no", "asc");
    const savedByNumber = new Map(savedModules.map((row) => [Number(row.module_no), row]));
    const modules = Array.from({ length: 10 }, (_, index) => {
      const number = index + 1;
      const saved = savedByNumber.get(number);
      return saved || { module_no: number, module_title: `Learning Module ${number}`, status: "not_answered", answered_at: null };
    });
    const attendance = await db("student_attendance").where({ student_user_id: user.id }).orderBy("school_year", "desc");
    return res.json({ user: sanitizeUser(user), modules, attendance });
  } catch (error) {
    return res.status(500).json({ message: "Failed to load student profile.", detail: error.message });
  }
});

app.get("/api/admin/student-attention", requireAdmin, async (req, res) => {
  try {
    const students = await db("users").where({ role: "student" }).andWhere({ approved: true }).select("id", "firstname", "lastname", "lrn", "school");
    const answeredRows = await db("student_module_progress").where({ status: "answered" }).select("student_user_id").count({ answered_count: "id" }).groupBy("student_user_id");
    const answeredMap = new Map(answeredRows.map((row) => [String(row.student_user_id), Number(row.answered_count) || 0]));
    const needsAttention = students.filter((student) => !answeredMap.get(String(student.id))).map((student) => ({ id: student.id, name: `${student.firstname || ""} ${student.lastname || ""}`.trim(), lrn: student.lrn || "", school: student.school || "" }));
    return res.json({ count: needsAttention.length, students: needsAttention });
  } catch (error) {
    return res.status(500).json({ message: "Failed to load student attention alerts.", detail: error.message });
  }
});

async function resetDatabaseRetainingAdministratorOnce() {
  const resetTableExists = await db.schema.hasTable("maintenance_events");
  if (!resetTableExists) {
    await db.schema.createTable("maintenance_events", (table) => {
      table.string("event_key", 120).primary();
      table.string("completed_at", 40).notNullable();
      table.text("details").nullable();
    });
  }

  const backupTableExists = await db.schema.hasTable("maintenance_reset_backup");
  if (!backupTableExists) {
    await db.schema.createTable("maintenance_reset_backup", (table) => {
      table.increments("backup_id").primary();
      table.string("batch_id", 80).notNullable();
      table.string("table_name", 80).notNullable();
      table.string("record_id", 120).nullable();
      table.text("record_json").notNullable();
      table.string("backed_up_at", 40).notNullable();
      table.index(["batch_id", "table_name"], "idx_reset_backup_batch_table");
    });
  }

  const completedReset = await db("maintenance_events").where({ event_key: DATABASE_RESET_EVENT }).first();
  if (completedReset) {
    return;
  }

  const administrator = await db("users").where({ email: normalizeEmail(ADMIN_EMAIL) }).first("id", "email");
  if (!administrator) {
    throw new Error("Database reset stopped because the configured administrator account was not found.");
  }

  const counts = {};
  const backupBatchId = `reset-${Date.now()}`;
  await db.transaction(async (trx) => {
    const recordsToBackup = {
      approval_requests: await trx("approval_requests").select("*"),
      adm_requests: await trx("adm_requests").select("*"),
      learners: await trx("learners").select("*"),
      users: await trx("users").whereNot({ id: administrator.id }).select("*")
    };

    const backupRows = Object.entries(recordsToBackup).flatMap(([tableName, records]) =>
      records.map((record) => ({
        batch_id: backupBatchId,
        table_name: tableName,
        record_id: String(record.id || ""),
        record_json: JSON.stringify(record),
        backed_up_at: new Date().toISOString()
      }))
    );

    if (backupRows.length) {
      for (let index = 0; index < backupRows.length; index += 100) {
        await trx("maintenance_reset_backup").insert(backupRows.slice(index, index + 100));
      }
    }

    counts.approvalRequests = await trx("approval_requests").del();
    counts.admRequests = await trx("adm_requests").del();
    counts.learners = await trx("learners").del();
    counts.nonAdministratorUsers = await trx("users").whereNot({ id: administrator.id }).del();

    await trx("users").where({ id: administrator.id }).update({
      role: "admin",
      approved: true,
      verified: true,
      failed_login_count: 0,
      lockout_until: null,
      updated_at: new Date().toISOString()
    });

    await trx("maintenance_events").insert({
      event_key: DATABASE_RESET_EVENT,
      completed_at: new Date().toISOString(),
      details: JSON.stringify({ retainedAdministrator: administrator.email, deleted: counts, backupBatchId })
    });
  });

  console.log("Recoverable one-time database reset completed; configured administrator retained.", { counts, backupBatchId });
}

async function removePlaceholderLearners() {
  const normalize = (value) => String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
  const placeholderCodes = new Set(["na", "n/a", "not applicable"]);
  const placeholderNames = new Set(["na", "n/a", "na learner", "n/a learner", "not applicable", "not applicable learner"]);

  try {
    const learners = await db("learners").select("id", "learner_code", "family_name", "firstname", "middlename");
    const placeholderIds = learners
      .filter((learner) => {
        const learnerCode = normalize(learner.learner_code);
        const fullName = normalize([learner.family_name, learner.firstname, learner.middlename].filter(Boolean).join(" "));
        return placeholderCodes.has(learnerCode) || placeholderNames.has(fullName);
      })
      .map((learner) => learner.id);

    if (!placeholderIds.length) {
      return;
    }

    await db.transaction(async (trx) => {
      await trx("approval_requests").whereIn("learner_id", placeholderIds).del();
      await trx("learners").whereIn("id", placeholderIds).del();
    });
    console.log(`Removed ${placeholderIds.length} placeholder learner record(s).`);
  } catch (error) {
    console.error("Placeholder learner cleanup failed:", error.message);
  }
}

startServer();

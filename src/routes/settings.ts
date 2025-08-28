import { Router } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { z } from "zod";
import { PrismaClient } from "../../generated/prisma/index.js";
import { authenticate } from "../utils/jwtAuth.js";
import { encryptString, decryptString } from "../utils/crypto.js";

const prisma = new PrismaClient();
const router = Router();

// Multer setup
const logosDir = path.join(process.cwd(), "uploads", "settings", "logos");
const certsDir = path.join(process.cwd(), "uploads", "settings", "certifications");
if (!fs.existsSync(logosDir)) fs.mkdirSync(logosDir, { recursive: true });
if (!fs.existsSync(certsDir)) fs.mkdirSync(certsDir, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      if (file.fieldname === "logo") return cb(null, logosDir);
      return cb(null, certsDir);
    },
    filename: (req, file, cb) => {
      const unique = Date.now() + "-" + Math.round(Math.random() * 1e9);
      const ext = path.extname(file.originalname);
      cb(null, `${unique}${ext}`);
    },
  }),
  limits: { fileSize: 50 * 1024 * 1024 },
});

async function logAudit(userId: string | undefined, action: string, module: string) {
  try {
    await prisma.auditLog.create({ data: { userId: userId ?? null, action, module } });
  } catch {
    // ignore
  }
}

// 1. Company Information
const companyInfoSchema = z.object({
  companyName: z.string().min(1),
  address: z.string().min(1),
  postalCode: z.string().min(1),
  city: z.string().min(1),
  country: z.string().min(1),
  contactPerson: z.string().min(1),
  email: z.string().email(),
  phone: z.string().min(1),
});

router.get("/company", authenticate, async (req, res) => {
  const existing = await prisma.companyInfo.findFirst({ orderBy: { updatedAt: "desc" } });
  return res.json({ data: existing });
});

router.post(
  "/company",
  authenticate,
  upload.single("logo"),
  async (req, res) => {
    try {
      const parsed = companyInfoSchema.parse(req.body);
      const logoPath = req.file ? `/uploads/settings/logos/${req.file.filename}` : undefined;
      const existing = await prisma.companyInfo.findFirst({ orderBy: { updatedAt: "desc" } });
      let saved;
      if (existing) {
        saved = await prisma.companyInfo.update({
          where: { id: existing.id },
          data: { ...parsed, logoPath: logoPath ?? existing.logoPath ?? null },
        });
      } else {
        saved = await prisma.companyInfo.create({ data: { ...parsed, logoPath: logoPath ?? null } });
      }
      await logAudit((req as any).userId, "update_company_info", "settings");
      return res.json({ data: saved });
    } catch (e: any) {
      return res.status(400).json({ message: e.message });
    }
  }
);

// 2. User & Role Management
const userCreateSchema = z.object({
  name: z.string().optional(),
  email: z.string().email(),
  password: z.string().min(6),
  role: z.enum(["super_admin", "admin", "qa_team"]).default("admin"),
});
const userUpdateSchema = z.object({
  name: z.string().optional(),
  email: z.string().email().optional(),
  password: z.string().min(6).optional(),
  role: z.enum(["super_admin", "admin", "qa_team"]).optional(),
});

import bcrypt from "bcrypt";

router.get("/users", authenticate, async (req, res) => {
  const users = await prisma.user.findMany({ select: { id: true, name: true, email: true, role: true, createdAt: true, updatedAt: true } });
  return res.json({ data: users });
});

router.post("/users", authenticate, async (req, res) => {
  try {
    const parsed = userCreateSchema.parse(req.body);
    const existing = await prisma.user.findUnique({ where: { email: parsed.email } });
    if (existing) return res.status(409).json({ message: "Email already exists" });
    const hash = await bcrypt.hash(parsed.password, 10);
    const created = await prisma.user.create({ data: { name: parsed.name ?? null, email: parsed.email, password: hash, role: parsed.role } });
    await logAudit((req as any).userId, "create_user", "settings");
    return res.status(201).json({ data: { id: created.id, name: created.name, email: created.email, role: created.role } });
  } catch (e: any) {
    return res.status(400).json({ message: e.message });
  }
});

router.put("/users/:id", authenticate, async (req, res) => {
  try {
    const id = req.params.id;
    const parsed = userUpdateSchema.parse(req.body);
    const exists = await prisma.user.findUnique({ where: { id } });
    if (!exists) return res.status(404).json({ message: "User not found" });
    let password: string | undefined;
    if (parsed.password) password = await bcrypt.hash(parsed.password, 10);
    const updated = await prisma.user.update({
      where: { id },
      data: { name: parsed.name ?? exists.name, email: parsed.email ?? exists.email, role: parsed.role ?? exists.role, ...(password ? { password } : {}) },
    });
    await logAudit((req as any).userId, "update_user", "settings");
    return res.json({ data: { id: updated.id, name: updated.name, email: updated.email, role: updated.role } });
  } catch (e: any) {
    return res.status(400).json({ message: e.message });
  }
});

router.delete("/users/:id", authenticate, async (req, res) => {
  const id = req.params.id;
  const exists = await prisma.user.findUnique({ where: { id } });
  if (!exists) return res.status(404).json({ message: "User not found" });
  await prisma.user.delete({ where: { id } });
  await logAudit((req as any).userId, "delete_user", "settings");
  return res.status(204).send();
});

// 3. COA Processing Settings
const coaSettingsSchema = z.object({
  defaultColumnMapping: z.record(z.any()).optional(),
  extractionRules: z.record(z.any()).optional(),
  fileProcessingLimits: z.record(z.any()).optional(),
});

router.get("/coa", authenticate, async (req, res) => {
  const cfg = await prisma.cOASettings.findFirst();
  return res.json({ data: cfg });
});
router.post("/coa", authenticate, async (req, res) => {
  try {
    const body = coaSettingsSchema.parse(req.body);
    const existing = await prisma.cOASettings.findFirst();
    const saved = existing
      ? await prisma.cOASettings.update({ where: { id: existing.id }, data: body })
      : await prisma.cOASettings.create({ data: body });
    await logAudit((req as any).userId, "update_coa_settings", "settings");
    return res.json({ data: saved });
  } catch (e: any) {
    return res.status(400).json({ message: e.message });
  }
});

// 4. Import/Export Analysis Settings
const importExportSettingsSchema = z.object({
  hsCodes: z.array(z.string()).optional(),
  competitorMapping: z.record(z.any()).optional(),
  currencyPreferences: z.record(z.any()).optional(),
  filterPresets: z.record(z.any()).optional(),
});

router.get("/import-export", authenticate, async (req, res) => {
  const cfg = await prisma.importExportSettings.findFirst();
  return res.json({ data: cfg });
});
router.post("/import-export", authenticate, async (req, res) => {
  try {
    const body = importExportSettingsSchema.parse(req.body);
    const existing = await prisma.importExportSettings.findFirst();
    const saved = existing
      ? await prisma.importExportSettings.update({ where: { id: existing.id }, data: body })
      : await prisma.importExportSettings.create({ data: body });
    await logAudit((req as any).userId, "update_import_export_settings", "settings");
    return res.json({ data: saved });
  } catch (e: any) {
    return res.status(400).json({ message: e.message });
  }
});

// 5. Questionnaire Automation Settings
const qSettingsSchema = z.object({
  predefinedAnswers: z.record(z.any()).optional(),
  skipLogicRules: z.record(z.any()).optional(),
});

router.get("/questionnaires", authenticate, async (req, res) => {
  const cfg = await prisma.questionnaireSettings.findFirst();
  return res.json({ data: cfg });
});

router.post(
  "/questionnaires",
  authenticate,
  upload.array("certifications", 10),
  async (req, res) => {
    try {
      const raw: any = req.body || {};
      const coerced = {
        predefinedAnswers: typeof raw.predefinedAnswers === "string" ? JSON.parse(raw.predefinedAnswers) : raw.predefinedAnswers,
        skipLogicRules: typeof raw.skipLogicRules === "string" ? JSON.parse(raw.skipLogicRules) : raw.skipLogicRules,
      };
      const body = qSettingsSchema.parse(coerced);
      const uploaded = (req.files as Express.Multer.File[] | undefined)?.map(f => `/uploads/settings/certifications/${f.filename}`) ?? [];
      const existing = await prisma.questionnaireSettings.findFirst();
      let saved;
      if (existing) {
        saved = await prisma.questionnaireSettings.update({
          where: { id: existing.id },
          data: { ...body, certifications: uploaded.length ? uploaded : existing.certifications },
        });
      } else {
        saved = await prisma.questionnaireSettings.create({ data: { ...body, certifications: uploaded } });
      }
      await logAudit((req as any).userId, "update_questionnaire_settings", "settings");
      return res.json({ data: saved });
    } catch (e: any) {
      return res.status(400).json({ message: e.message });
    }
  }
);

// 6. API & AI Settings
const aiSettingsSchema = z.object({
  openAiKey: z.string().min(1).optional(),
  model: z.string().min(1),
  confidenceThreshold: z.coerce.number().min(0).max(1),
});
router.get("/ai", authenticate, async (req, res) => {
  const cfg = await prisma.aISettings.findFirst();
  if (!cfg) return res.json({ data: null });
  const masked = cfg.openAiKey ? "********" : null;
  return res.json({ data: { id: cfg.id, openAiKey: masked, model: cfg.model, confidenceThreshold: cfg.confidenceThreshold } });
});
router.post("/ai", authenticate, async (req, res) => {
  try {
    const body = aiSettingsSchema.parse(req.body);
    const existing = await prisma.aISettings.findFirst();
    const toSave: any = { model: body.model, confidenceThreshold: body.confidenceThreshold };
    if (body.openAiKey) toSave.openAiKey = encryptString(body.openAiKey);
    const saved = existing
      ? await prisma.aISettings.update({ where: { id: existing.id }, data: toSave })
      : await prisma.aISettings.create({ data: toSave });
    await logAudit((req as any).userId, "update_ai_settings", "settings");
    return res.json({ data: { id: saved.id, openAiKey: saved.openAiKey ? "********" : null, model: saved.model, confidenceThreshold: saved.confidenceThreshold } });
  } catch (e: any) {
    return res.status(400).json({ message: e.message });
  }
});

// 7. System Preferences
const systemPreferencesSchema = z.object({
  dateFormat: z.string().min(1),
  language: z.string().min(1),
  defaultExportFormat: z.enum(["xlsx", "csv", "pdf"]),
  backupConfig: z.record(z.any()).optional(),
});
router.get("/system", authenticate, async (req, res) => {
  const cfg = await prisma.systemPreferences.findFirst();
  return res.json({ data: cfg });
});
router.post("/system", authenticate, async (req, res) => {
  try {
    const body = systemPreferencesSchema.parse(req.body);
    const existing = await prisma.systemPreferences.findFirst();
    const saved = existing
      ? await prisma.systemPreferences.update({ where: { id: existing.id }, data: body })
      : await prisma.systemPreferences.create({ data: body });
    await logAudit((req as any).userId, "update_system_preferences", "settings");
    return res.json({ data: saved });
  } catch (e: any) {
    return res.status(400).json({ message: e.message });
  }
});

// 8. Audit Logs
router.get("/audit", authenticate, async (req, res) => {
  const { userId, module, from, to } = req.query as { userId?: string; module?: string; from?: string; to?: string };
  const where: any = {};
  if (userId) where.userId = userId;
  if (module) where.module = module;
  if (from || to) {
    where.timestamp = {};
    if (from) where.timestamp.gte = new Date(from);
    if (to) where.timestamp.lte = new Date(to);
  }
  const logs = await prisma.auditLog.findMany({ where, orderBy: { timestamp: "desc" } });
  return res.json({ data: logs });
});

export default router;



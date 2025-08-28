import { Router } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { processUploadedFiles, processQuestionnaire, getQuestionnaireById, saveDraft, getQuestionnaires, deleteQuestionnaire } from "../services/questionnaireService.js";
import { authenticate } from "../utils/jwtAuth.js";

const router = Router();

const uploadDir = path.join(process.cwd(), "uploads", "questionnaires");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const unique = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, `${unique}${path.extname(file.originalname)}`);
  },
});

function fileFilter(_req: any, file: Express.Multer.File, cb: multer.FileFilterCallback) {
  const allowed = [".pdf", ".docx", ".xlsx"];
  const ext = path.extname(file.originalname).toLowerCase();
  if (!allowed.includes(ext)) return cb(new Error("Only PDF, DOCX, XLSX allowed"));
  cb(null, true);
}

const upload = multer({ storage, fileFilter, limits: { fileSize: 25 * 1024 * 1024 } });

router.post("/upload", authenticate, upload.array("files", 10), async (req, res) => {
  try {
    const files = (req.files as Express.Multer.File[]) || [];
    if (files.length === 0) return res.status(400).json({ message: "No files uploaded" });
    const result = await processUploadedFiles(files, (req as any).userId as string);
    return res.status(201).json(result);
  } catch (err: any) {
    return res.status(500).json({ message: err.message || "Upload failed" });
  }
});

router.post("/process", authenticate, async (req, res) => {
  try {
    const { questionnaireId, parsedQuestions } = req.body as { questionnaireId: string; parsedQuestions: any[] };
    if (!questionnaireId || !Array.isArray(parsedQuestions)) {
      return res.status(400).json({ message: "questionnaireId and parsedQuestions are required" });
    }
    const result = await processQuestionnaire(questionnaireId, parsedQuestions, (req as any).userId as string);
    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ message: err.message || "Process failed" });
  }
});

// Stats route MUST come before /:id route to avoid conflicts
router.get("/stats", authenticate, async (req, res) => {
  try {
    const userId = (req as any).userId as string;
    const { questionnaires, stats } = await getQuestionnaires(userId, "all", 1000);
    
    // Calculate additional stats
    const totalProcessed = stats.processed;
    const totalQuestions = stats.totalAnswers;
    const totalFromDatabase = stats.totalFromDatabase;
    const totalFromAI = stats.totalFromAI;
    
    const avgAutoAnswered = totalQuestions > 0 
      ? Math.round(((totalFromDatabase + totalFromAI) / totalQuestions) * 100)
      : 0;

    // Get last processed questionnaire
    const lastProcessed = questionnaires.find(q => q.status === 'processed');

    res.json({
      totalProcessed,
      avgAutoAnswered: `${avgAutoAnswered}%`,
      lastProcessedDate: lastProcessed?.updatedAt || null,
      totalDrafts: stats.draft,
      totalQuestions,
      databaseAnswers: totalFromDatabase,
      aiAnswers: totalFromAI
    });
  } catch (error) {
    console.error("Questionnaire stats error:", error);
    res.status(500).json({ message: "Failed to fetch questionnaire statistics" });
  }
});

router.get("/", authenticate, async (req, res) => {
  try {
    const { status = "all", limit = "20" } = req.query as { status?: string; limit?: string };
    const questionnaires = await getQuestionnaires((req as any).userId as string, status, parseInt(limit));
    return res.json(questionnaires);
  } catch (err: any) {
    return res.status(500).json({ message: err.message || "Failed to fetch questionnaires" });
  }
});

router.get("/:id", authenticate, async (req, res) => {
  try {
    const data = await getQuestionnaireById(req.params.id);
    if (!data) return res.status(404).json({ message: "Not found" });
    return res.json(data);
  } catch (err: any) {
    return res.status(500).json({ message: err.message || "Failed" });
  }
});

router.patch("/:id/draft", authenticate, async (req, res) => {
  try {
    const { answers } = req.body as { answers: { questionId: string; answer: string }[] };
    if (!answers || !Array.isArray(answers)) {
      return res.status(400).json({ message: "answers array is required" });
    }
    const result = await saveDraft(req.params.id, answers, (req as any).userId as string);
    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ message: err.message || "Save draft failed" });
  }
});

router.delete("/:id", authenticate, async (req, res) => {
  try {
    await deleteQuestionnaire(req.params.id, (req as any).userId as string);
    return res.json({ message: "Questionnaire deleted successfully" });
  } catch (err: any) {
    return res.status(500).json({ message: err.message || "Delete failed" });
  }
});

export default router;



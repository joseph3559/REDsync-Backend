import path from "path";
import fs from "fs";
import { PrismaClient } from "../../generated/prisma/index.js";
import { PDFDocument, rgb } from "pdf-lib";
import * as XLSX from "xlsx";
import { generateAnswerForQuestion } from "./questionnaireAi.js";

const prisma = new PrismaClient();

export type ParsedQuestion = { id: string; text: string; context?: string };

export async function processUploadedFiles(files: Express.Multer.File[], userId: string) {
  // Create a Questionnaire record per upload batch (first file reference kept)
  const first = files[0];
  const q = await prisma.questionnaire.create({
    data: { originalFile: first.path, status: "uploaded", userId },
  });

  // Parse questions from each file and combine
  const allQuestions: ParsedQuestion[] = [];
  for (const f of files) {
    const ext = path.extname(f.originalname).toLowerCase();
    try {
      if (ext === ".pdf") {
        const qs = await extractQuestionsFromPdf(f.path);
        allQuestions.push(...qs);
      } else if (ext === ".docx") {
        const qs = await extractQuestionsFromDocx(f.path);
        allQuestions.push(...qs);
      } else if (ext === ".xlsx") {
        const qs = await extractQuestionsFromXlsx(f.path);
        allQuestions.push(...qs);
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(`Failed to parse ${f.originalname}:`, (e as any)?.message || e);
      continue;
    }
  }
  return { questionnaireId: q.id, parsedQuestions: allQuestions };
}

export async function processQuestionnaire(questionnaireId: string, parsedQuestions: ParsedQuestion[], userId: string) {
  const questionnaire = await prisma.questionnaire.findUnique({ where: { id: questionnaireId } });
  if (!questionnaire) throw new Error("Questionnaire not found");

  await prisma.questionnaire.update({ where: { id: questionnaireId }, data: { status: "processing" } });

  const company = await prisma.companyInfo.findFirst();
  const companyInfo: { key: string; value: string }[] = [];
  if (company) {
    const entries: [string, string | null | undefined][] = [
      ["companyname", company.companyName ?? null],
      ["address", company.address ?? null],
      ["postalcode", company.postalCode ?? null],
      ["city", company.city ?? null],
      ["country", company.country ?? null],
      ["contactperson", company.contactPerson ?? null],
      ["email", company.email ?? null],
      ["phone", company.phone ?? null],
    ];
    for (const [k, v] of entries) {
      if (v && String(v).trim()) companyInfo.push({ key: k, value: String(v).trim() });
    }
  }
  const keyToValue = Object.fromEntries(companyInfo.map((c) => [c.key.toLowerCase(), c.value]));
  const certifications = await prisma.certification.findMany();
  const previousAnswers = await prisma.questionnaireAnswer.findMany({ orderBy: { createdAt: "desc" }, take: 1000 });

  const answersToSave: { question: string; answer: string | null; source: string }[] = [];

  for (const q of parsedQuestions) {
    const lower = q.text.toLowerCase();
    let matched: string | null = null;
    let source = "ai";

    // exact key match
    for (const key of Object.keys(keyToValue)) {
      if (lower.includes(key)) {
        matched = keyToValue[key];
        source = "company_info";
        break;
      }
    }

    // skip logic by certifications
    if (!matched && shouldSkipQuestion(lower, certifications.map((c) => c.name.toLowerCase()))) {
      answersToSave.push({ question: q.text, answer: null, source: "skip" });
      continue;
    }

    // reuse previous answer if similar
    if (!matched) {
      const reused = previousAnswers.find((a) => similarity(a.question.toLowerCase(), lower) > 0.9 && a.answer);
      if (reused) {
        matched = reused.answer as string;
        source = "ai";
      }
    }

    if (!matched) {
      matched = await generateAnswerForQuestion(q.text, { companyInfo, certifications, previousAnswers });
      source = "ai";
    }

    answersToSave.push({ question: q.text, answer: matched, source });
  }

  const saved = await prisma.$transaction([
    prisma.questionnaireAnswer.deleteMany({ where: { questionnaireId } }),
    ...answersToSave.map((a) =>
      prisma.questionnaireAnswer.create({
        data: { questionnaireId, question: a.question, answer: a.answer ?? null, source: a.source },
      })
    ),
  ]);

  // Merge answers into document and produce signed PDF
  const processedPath = await mergeAnswersAndSign(questionnaire.originalFile, answersToSave);
  await prisma.questionnaire.update({ where: { id: questionnaireId }, data: { status: "processed", processedFile: processedPath } });

  return { questionnaireId, processedFile: processedPath, answersCount: answersToSave.length };
}

export async function getQuestionnaireById(id: string) {
  const q = await prisma.questionnaire.findUnique({ where: { id }, include: { answers: true } });
  if (!q) return null;
  return q;
}

export async function saveDraft(questionnaireId: string, answers: { questionId: string; answer: string }[], userId: string) {
  const questionnaire = await prisma.questionnaire.findUnique({ where: { id: questionnaireId } });
  if (!questionnaire) throw new Error("Questionnaire not found");
  if (questionnaire.userId !== userId) throw new Error("Unauthorized");

  // Update answers
  for (const answerData of answers) {
    await prisma.questionnaireAnswer.upsert({
      where: { id: answerData.questionId },
      update: { answer: answerData.answer },
      create: {
        questionnaireId,
        question: "Draft question", // This would need proper question text in real implementation
        answer: answerData.answer,
        source: "manual"
      }
    });
  }

  // Update questionnaire status to draft
  await prisma.questionnaire.update({
    where: { id: questionnaireId },
    data: { status: "draft" }
  });

  return { questionnaireId, status: "draft", answersUpdated: answers.length };
}

export async function getQuestionnaires(userId: string, status: string = "all", limit: number = 20) {
  const where = status === "all" ? { userId } : { userId, status };
  
  const questionnaires = await prisma.questionnaire.findMany({
    where,
    include: {
      answers: true,
      _count: {
        select: { answers: true }
      }
    },
    orderBy: { createdAt: "desc" },
    take: limit
  });

  return {
    questionnaires,
    total: questionnaires.length,
    stats: {
      processed: questionnaires.filter(q => q.status === "processed").length,
      draft: questionnaires.filter(q => q.status === "draft").length,
      processing: questionnaires.filter(q => q.status === "processing").length,
      failed: questionnaires.filter(q => q.status === "failed").length,
      totalAnswers: questionnaires.reduce((sum, q) => sum + q.answers.length, 0),
      totalFromDatabase: questionnaires.reduce((sum, q) => sum + q.answers.filter(a => a.source === "company_info").length, 0),
      totalFromAI: questionnaires.reduce((sum, q) => sum + q.answers.filter(a => a.source === "ai").length, 0)
    }
  };
}

export async function deleteQuestionnaire(questionnaireId: string, userId: string) {
  const questionnaire = await prisma.questionnaire.findUnique({ where: { id: questionnaireId } });
  if (!questionnaire) throw new Error("Questionnaire not found");
  if (questionnaire.userId !== userId) throw new Error("Unauthorized");

  // Delete associated answers first (cascade should handle this, but being explicit)
  await prisma.questionnaireAnswer.deleteMany({ where: { questionnaireId } });
  
  // Delete questionnaire
  await prisma.questionnaire.delete({ where: { id: questionnaireId } });

  // Clean up files if they exist
  if (questionnaire.processedFile && fs.existsSync(questionnaire.processedFile)) {
    fs.unlinkSync(questionnaire.processedFile);
  }

  return { deleted: true };
}

function shouldSkipQuestion(lowerQuestion: string, certs: string[]): boolean {
  // Basic skip logic examples; can be expanded
  if (certs.includes("fsma") && lowerQuestion.includes("fsma")) return true;
  if (certs.includes("haccp") && lowerQuestion.includes("haccp")) return true;
  if (certs.includes("fssc22000") && lowerQuestion.includes("fssc")) return true;
  if (certs.includes("kosher") && lowerQuestion.includes("kosher")) return true;
  if (certs.includes("halal") && lowerQuestion.includes("halal")) return true;
  return false;
}

function similarity(a: string, b: string): number {
  if (a === b) return 1;
  const setA = new Set(a.split(/[\s,.;:]+/));
  const setB = new Set(b.split(/[\s,.;:]+/));
  const inter = new Set([...setA].filter((x) => setB.has(x))).size;
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 0 : inter / union;
}

async function extractQuestionsFromPdf(filePath: string): Promise<ParsedQuestion[]> {
  const buf = await fs.promises.readFile(filePath);
  // dynamic import for pdf-parse to avoid type woes
  const pdfParse = (await import("pdf-parse")).default;
  const data = await pdfParse(buf);
  const lines = data.text.split(/\n+/).map((l: string) => l.trim()).filter(Boolean);
  return lines
    .filter((l: string) => isQuestionLine(l))
    .map((text: string, idx: number) => ({ id: `pdf-${idx}`, text }));
}

async function extractQuestionsFromDocx(filePath: string): Promise<ParsedQuestion[]> {
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({ path: filePath });
  const lines = result.value.split(/\n+/).map((l: string) => l.trim()).filter(Boolean);
  return lines
    .filter((l: string) => isQuestionLine(l))
    .map((text: string, idx: number) => ({ id: `docx-${idx}`, text }));
}

async function extractQuestionsFromXlsx(filePath: string): Promise<ParsedQuestion[]> {
  const wb = XLSX.readFile(filePath);
  const all: ParsedQuestion[] = [];
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    const rows = XLSX.utils.sheet_to_json<any>(ws, { header: 1, raw: false }) as any[];
    rows.forEach((row, rIdx) => {
      const cells = Array.isArray(row) ? row : [];
      cells.forEach((cell: any, cIdx: number) => {
        const text = String(cell || "").trim();
        if (isQuestionLine(text)) {
          all.push({ id: `xlsx-${name}-${rIdx}-${cIdx}`, text });
        }
      });
    });
  }
  return all;
}

function isQuestionLine(text: string): boolean {
  if (!text) return false;
  const qMarks = text.endsWith("?") || /^\d+\./.test(text) || /^Q\d+/i.test(text);
  const minLen = text.split(" ").length >= 3;
  return qMarks && minLen;
}

async function mergeAnswersAndSign(originalPath: string, answers: { question: string; answer: string | null }[]) {
  const processedDir = path.join(process.cwd(), "processed", "questionnaires");
  if (!fs.existsSync(processedDir)) fs.mkdirSync(processedDir, { recursive: true });

  const ext = path.extname(originalPath).toLowerCase();
  let pdfPath = originalPath;

  if (ext === ".pdf") {
    // Annotate answers as an appended summary page for simplicity
    pdfPath = await annotatePdfWithAnswers(originalPath, answers);
  } else if (ext === ".docx" || ext === ".xlsx") {
    // Convert to simple PDF listing Q&A due to layout variability
    pdfPath = await generateAnswersPdf(answers);
  }

  const signedPdf = await signPdf(pdfPath);
  const outPath = path.join(processedDir, path.basename(signedPdf));
  if (signedPdf !== outPath) await fs.promises.copyFile(signedPdf, outPath);
  return outPath;
}

async function annotatePdfWithAnswers(pdfPath: string, answers: { question: string; answer: string | null }[]) {
  const bytes = await fs.promises.readFile(pdfPath);
  const pdfDoc = await PDFDocument.load(bytes);
  const page = pdfDoc.addPage();
  const { width, height } = page.getSize();
  let y = height - 50;
  page.drawText("Questionnaire Answers", { x: 50, y, size: 16, color: rgb(0, 0, 0) });
  y -= 24;
  const wrapWidth = width - 100;
  for (const a of answers) {
    const q = `Q: ${a.question}`;
    const ans = `A: ${a.answer ?? "Not Applicable"}`;
    const lines = wrapText(`${q}\n${ans}`, 90);
    for (const line of lines) {
      if (y < 50) {
        y = height - 50;
        pdfDoc.addPage();
      }
      pdfDoc.getPages()[pdfDoc.getPages().length - 1].drawText(line, { x: 50, y, size: 10 });
      y -= 12;
    }
    y -= 8;
  }
  const outBytes = await pdfDoc.save();
  const tempOut = path.join(process.cwd(), "uploads", `annotated-${Date.now()}.pdf`);
  await fs.promises.writeFile(tempOut, outBytes);
  return tempOut;
}

async function generateAnswersPdf(answers: { question: string; answer: string | null }[]) {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage();
  const { width, height } = page.getSize();
  let y = height - 50;
  page.drawText("Questionnaire Answers", { x: 50, y, size: 16, color: rgb(0, 0, 0) });
  y -= 24;
  for (const a of answers) {
    const text = `Q: ${a.question}\nA: ${a.answer ?? "Not Applicable"}`;
    const lines = wrapText(text, 90);
    for (const line of lines) {
      if (y < 50) {
        y = height - 50;
        pdfDoc.addPage();
      }
      pdfDoc.getPages()[pdfDoc.getPages().length - 1].drawText(line, { x: 50, y, size: 10 });
      y -= 12;
    }
    y -= 8;
  }
  const outBytes = await pdfDoc.save();
  const tempOut = path.join(process.cwd(), "uploads", `answers-${Date.now()}.pdf`);
  await fs.promises.writeFile(tempOut, outBytes);
  return tempOut;
}

async function signPdf(pdfPath: string) {
  const sigPath = path.join(process.cwd(), "assets", "signature.png");
  let bytes = await fs.promises.readFile(pdfPath);
  const pdfDoc = await PDFDocument.load(bytes);
  const png = await fs.promises.readFile(sigPath).catch(() => null);
  if (png) {
    const sigImage = await pdfDoc.embedPng(png);
    const pages = pdfDoc.getPages();
    const last = pages[pages.length - 1];
    const { width } = last.getSize();
    const scaled = sigImage.scale(0.5);
    last.drawImage(sigImage, { x: width - scaled.width - 50, y: 40, width: scaled.width, height: scaled.height });
  }
  const outBytes = await pdfDoc.save();
  const out = path.join(process.cwd(), "uploads", `signed-${Date.now()}.pdf`);
  await fs.promises.writeFile(out, outBytes);
  return out;
}

function wrapText(text: string, maxCharsPerLine: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const w of words) {
    if ((current + " " + w).trim().length > maxCharsPerLine) {
      lines.push(current.trim());
      current = w;
    } else {
      current += " " + w;
    }
  }
  if (current.trim()) lines.push(current.trim());
  return lines;
}



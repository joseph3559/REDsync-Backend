import OpenAI from "openai";
import { getOpenAIApiKey } from "../utils/apiKeys.js";

type AiContext = {
  companyInfo: { key: string; value: string }[];
  certifications: { name: string; details?: string | null }[];
  previousAnswers: { question: string; answer: string | null }[];
};

export async function generateAnswerForQuestion(question: string, ctx: AiContext): Promise<string> {
  // Get API key from database or environment
  const apiKey = await getOpenAIApiKey();
  if (!apiKey) {
    throw new Error("OpenAI API key not configured. Please add it in Settings > API & AI.");
  }

  const client = new OpenAI({ apiKey });
  const sys = `You are an assistant that completes supplier/compliance questionnaires for a food ingredients company (RED B.V.).
Use only the provided context. If the question is not applicable due to certifications or scope, respond with "Not Applicable".
Prefer concise, professional answers.`;
  const company = ctx.companyInfo.map((c) => `- ${c.key}: ${c.value}`).join("\n");
  const certs = ctx.certifications.map((c) => `- ${c.name}${c.details ? ": " + c.details : ""}`).join("\n");
  const prev = ctx.previousAnswers.slice(0, 50).map((p) => `Q: ${p.question}\nA: ${p.answer ?? ""}`).join("\n\n");
  const user = `Question: ${question}\n\nCompany Info:\n${company}\n\nCertifications:\n${certs}\n\nPrevious Answers:\n${prev}`;
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  const res = await client.chat.completions.create({
    model,
    temperature: 0.2,
    messages: [
      { role: "system", content: sys },
      { role: "user", content: user },
    ],
  });
  const txt = res.choices[0]?.message?.content?.trim() || "Not Applicable";
  return txt;
}



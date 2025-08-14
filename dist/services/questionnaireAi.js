import OpenAI from "openai";
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
export async function generateAnswerForQuestion(question, ctx) {
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

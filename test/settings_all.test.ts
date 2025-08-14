import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import { app } from "../src/app";

let token: string;

describe("All Settings Endpoints", () => {
  beforeAll(async () => {
    const email = "settings_admin@example.com";
    const password = "StrongP@ssw0rd";
    try {
      await request(app).post("/api/auth/register").send({ email, password, role: "super_admin" });
    } catch {}
    const res = await request(app).post("/api/auth/login").send({ email, password });
    token = res.body.token;
  });

  it("user CRUD", async () => {
    const create = await request(app)
      .post("/api/settings/users")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "QA", email: "qa@example.com", password: "Qa123456", role: "qa_team" });
    expect(create.status).toBe(201);
    const userId = create.body.data.id as string;

    const list = await request(app)
      .get("/api/settings/users")
      .set("Authorization", `Bearer ${token}`);
    expect(list.status).toBe(200);
    expect(Array.isArray(list.body.data)).toBe(true);

    const update = await request(app)
      .put(`/api/settings/users/${userId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "QA Team" });
    expect(update.status).toBe(200);

    const del = await request(app)
      .delete(`/api/settings/users/${userId}`)
      .set("Authorization", `Bearer ${token}`);
    expect(del.status).toBe(204);
  });

  it("COA settings set/get", async () => {
    const post = await request(app)
      .post("/api/settings/coa")
      .set("Authorization", `Bearer ${token}`)
      .send({ defaultColumnMapping: { ai: "Acetone Insoluble" }, extractionRules: { missingValue: "blank" }, fileProcessingLimits: { maxSizeMB: 50 } });
    expect(post.status).toBe(200);
    const get = await request(app)
      .get("/api/settings/coa")
      .set("Authorization", `Bearer ${token}`);
    expect(get.status).toBe(200);
    expect(get.body.data.defaultColumnMapping.ai).toBe("Acetone Insoluble");
  });

  it("Import/Export settings set/get", async () => {
    const post = await request(app)
      .post("/api/settings/import-export")
      .set("Authorization", `Bearer ${token}`)
      .send({ hsCodes: ["29232000", "292320"], competitorMapping: { A: "Alpha" }, currencyPreferences: { base: "USD" }, filterPresets: { price: { min: 0 } } });
    expect(post.status).toBe(200);
    const get = await request(app)
      .get("/api/settings/import-export")
      .set("Authorization", `Bearer ${token}`);
    expect(get.status).toBe(200);
    expect(get.body.data.hsCodes).toContain("29232000");
  });

  it("Questionnaire settings set/get", async () => {
    const post = await request(app)
      .post("/api/settings/questionnaires")
      .set("Authorization", `Bearer ${token}`)
      .field("predefinedAnswers", JSON.stringify({ countryOfOrigin: "USA" }))
      .field("skipLogicRules", JSON.stringify({ fsma: true }));
    expect(post.status).toBe(200);
    const get = await request(app)
      .get("/api/settings/questionnaires")
      .set("Authorization", `Bearer ${token}`);
    expect(get.status).toBe(200);
    expect(get.body.data.predefinedAnswers.countryOfOrigin).toBe("USA");
  });

  it("AI settings set/get with masking", async () => {
    const post = await request(app)
      .post("/api/settings/ai")
      .set("Authorization", `Bearer ${token}`)
      .send({ openAiKey: "sk-test", model: "gpt-4o", confidenceThreshold: 0.7 });
    expect(post.status).toBe(200);
    expect(post.body.data.openAiKey).toBe("********");
    const get = await request(app)
      .get("/api/settings/ai")
      .set("Authorization", `Bearer ${token}`);
    expect(get.status).toBe(200);
    expect(get.body.data.openAiKey).toBe("********");
  });

  it("System preferences set/get", async () => {
    const post = await request(app)
      .post("/api/settings/system")
      .set("Authorization", `Bearer ${token}`)
      .send({ dateFormat: "YYYY-MM-DD", language: "en", defaultExportFormat: "xlsx", backupConfig: { freq: "daily" } });
    expect(post.status).toBe(200);
    const get = await request(app)
      .get("/api/settings/system")
      .set("Authorization", `Bearer ${token}`);
    expect(get.status).toBe(200);
    expect(get.body.data.defaultExportFormat).toBe("xlsx");
  });

  it("Audit logs filter", async () => {
    const res = await request(app)
      .get("/api/settings/audit?module=settings")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});



import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import { app } from "../src/app";
import { PrismaClient } from "../generated/prisma";

const prisma = new PrismaClient();

let token: string;

describe("Settings API", () => {
  beforeAll(async () => {
    const email = "settings_test@example.com";
    const password = "StrongP@ssw0rd";
    try {
      await request(app).post("/api/auth/register").send({ email, password, role: "super_admin" });
    } catch {}
    const res = await request(app).post("/api/auth/login").send({ email, password });
    token = res.body.token;
  });

  it("updates and fetches company info", async () => {
    const res = await request(app)
      .post("/api/settings/company")
      .set("Authorization", `Bearer ${token}`)
      .field("companyName", "RedSync LLC")
      .field("address", "123 Main St")
      .field("postalCode", "10001")
      .field("city", "NYC")
      .field("country", "USA")
      .field("contactPerson", "Admin")
      .field("email", "admin@redsync.test")
      .field("phone", "+1234567");
    expect(res.status).toBe(200);
    const getRes = await request(app)
      .get("/api/settings/company")
      .set("Authorization", `Bearer ${token}`);
    expect(getRes.status).toBe(200);
    expect(getRes.body.data.companyName).toBe("RedSync LLC");
  });
});



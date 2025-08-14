import crypto from "crypto";
const RAW_SECRET = process.env.CRYPTO_SECRET || process.env.JWT_SECRET || "";
function getKey() {
    if (!RAW_SECRET) {
        throw new Error("CRYPTO_SECRET or JWT_SECRET must be set for encryption");
    }
    // Derive a 32-byte key from the secret
    return crypto.createHash("sha256").update(RAW_SECRET).digest();
}
export function encryptString(plaintext) {
    const iv = crypto.randomBytes(12);
    const key = getKey();
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, enc]).toString("base64");
}
export function decryptString(ciphertextB64) {
    const buf = Buffer.from(ciphertextB64, "base64");
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const enc = buf.subarray(28);
    const key = getKey();
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
    return dec.toString("utf8");
}

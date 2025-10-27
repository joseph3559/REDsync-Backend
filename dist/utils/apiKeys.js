import { PrismaClient } from "../../generated/prisma/index.js";
import { decryptString } from "./crypto.js";
const prisma = new PrismaClient();
// Cache API keys in memory to avoid database hits on every request
let apiKeysCache = null;
let cacheTimestamp = 0;
const CACHE_DURATION = 60000; // 1 minute
/**
 * Get API key for a specific provider from database or environment
 * Priority: Database > Environment Variable
 * @param provider - The AI provider name (openai, gemini, anthropic, cohere)
 * @returns The decrypted API key or null if not found
 */
export async function getApiKey(provider) {
    // Check if cache is still valid
    const now = Date.now();
    if (apiKeysCache && (now - cacheTimestamp) < CACHE_DURATION) {
        return apiKeysCache[provider] || null;
    }
    try {
        // Fetch from database
        const settings = await prisma.aISettings.findFirst({
            orderBy: { updatedAt: "desc" },
        });
        if (settings && settings.apiKeys) {
            const apiKeys = settings.apiKeys;
            const decryptedKeys = {};
            // Decrypt all stored keys
            for (const [key, encryptedValue] of Object.entries(apiKeys)) {
                if (encryptedValue && typeof encryptedValue === "string") {
                    try {
                        decryptedKeys[key] = decryptString(encryptedValue);
                    }
                    catch (error) {
                        console.error(`Failed to decrypt API key for ${key}:`, error);
                    }
                }
            }
            // Update cache
            apiKeysCache = decryptedKeys;
            cacheTimestamp = now;
            return decryptedKeys[provider] || null;
        }
    }
    catch (error) {
        console.error("Failed to fetch API keys from database:", error);
    }
    // Fallback to environment variables
    if (provider === "openai") {
        return process.env.OPENAI_API_KEY || null;
    }
    else if (provider === "gemini") {
        return process.env.GEMINI_API_KEY || null;
    }
    else if (provider === "anthropic") {
        return process.env.ANTHROPIC_API_KEY || null;
    }
    else if (provider === "cohere") {
        return process.env.COHERE_API_KEY || null;
    }
    return null;
}
/**
 * Get the OpenAI API key specifically
 * This is a convenience function for the most commonly used provider
 */
export async function getOpenAIApiKey() {
    return getApiKey("openai");
}
/**
 * Clear the API keys cache
 * Call this after updating API keys in the database
 */
export function clearApiKeysCache() {
    apiKeysCache = null;
    cacheTimestamp = 0;
}
/**
 * Get all configured API keys
 * Returns decrypted keys from database with fallback to environment
 */
export async function getAllApiKeys() {
    const keys = {};
    const providers = ["openai", "gemini", "anthropic", "cohere"];
    for (const provider of providers) {
        const key = await getApiKey(provider);
        if (key) {
            keys[provider] = key;
        }
    }
    return keys;
}

# API Key Management System

## Overview

The system now supports managing OpenAI and other AI provider API keys directly from the Settings UI instead of requiring manual `.env` file updates. This is especially useful for deployment scenarios where you want to configure API keys without redeploying the application.

## Features

✅ **Multiple AI Providers**: Support for OpenAI, Google Gemini, Anthropic Claude, and Cohere  
✅ **Secure Storage**: API keys are encrypted in the database using AES-256-GCM encryption  
✅ **Priority System**: Database keys take precedence over environment variables  
✅ **Caching**: Keys are cached in memory for 1 minute to minimize database hits  
✅ **Fallback**: Automatically falls back to environment variables if database keys are not configured  
✅ **UI Management**: Easy-to-use Settings interface for adding/updating keys  

## How to Use

### For Super Admins

1. **Navigate to Settings**
   - Log in to the dashboard
   - Go to **Settings** → **API & AI** tab

2. **Configure OpenAI API Key**
   - Click "Configure" button on the OpenAI provider card
   - Enter your OpenAI API key (format: `sk-proj-...` or `sk-...`)
   - Optionally select a preferred model (GPT-4o, GPT-4o Mini, etc.)
   - Click "Save API Key"

3. **Verify Configuration**
   - After saving, you should see a green checkmark (✓) indicating the key is configured
   - The actual key value is masked for security (`********`)

4. **Test the Integration**
   - Try uploading a COA PDF file
   - Try processing a questionnaire
   - The system will now use your database-configured API key instead of the `.env` file

### For Developers

#### System Architecture

```
┌─────────────────┐
│   Frontend UI   │
│   (Settings)    │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Backend API    │
│ /api/settings/ai│
└────────┬────────┘
         │
         ▼
┌─────────────────┐      ┌──────────────┐
│   Encryption    │──────▶│  PostgreSQL  │
│   (AES-256)     │      │  AISettings  │
└─────────────────┘      └──────────────┘
         │
         ▼
┌─────────────────┐
│  API Key Cache  │
│   (1 min TTL)   │
└────────┬────────┘
         │
         ▼
┌─────────────────────────────────────┐
│         Services                     │
│  • COA Processing (Python)          │
│  • Questionnaire AI                 │
│  • Import/Export Analysis           │
└─────────────────────────────────────┘
```

#### Database Schema

```sql
model AISettings {
  id                  String   @id @default(uuid())
  apiKeys             Json?    // { openai: "encrypted_key", gemini: "...", ... }
  model               String   // Default AI model
  confidenceThreshold Float    @default(0.0)
  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt
}
```

#### Using API Keys in Your Code

```typescript
import { getOpenAIApiKey, getApiKey } from "./utils/apiKeys.js";

// For OpenAI specifically
const openaiKey = await getOpenAIApiKey();
if (!openaiKey) {
  throw new Error("OpenAI API key not configured");
}

// For other providers
const geminiKey = await getApiKey("gemini");
const anthropicKey = await getApiKey("anthropic");
const cohereKey = await getApiKey("cohere");
```

#### Priority Order

1. **Database** (highest priority) - Keys configured via Settings UI
2. **Environment Variables** (fallback) - Keys in `.env` file

Example:
- If `OPENAI_API_KEY` exists in `.env` AND a key is configured in the database
- The database key will be used
- If database key is deleted, system falls back to `.env`

#### Encryption Details

- **Algorithm**: AES-256-GCM
- **Key Derivation**: SHA-256 hash of `JWT_SECRET` or `CRYPTO_SECRET`
- **IV**: 12 bytes (randomly generated per encryption)
- **Auth Tag**: 16 bytes (for integrity verification)

The encryption/decryption functions are located in `/backend/src/utils/crypto.ts`

#### Cache Management

The system caches decrypted API keys for 60 seconds to avoid excessive database queries:

```typescript
// Cache is automatically cleared when:
// 1. Keys are updated via Settings API
// 2. Cache TTL expires (60 seconds)

// Manual cache clearing
import { clearApiKeysCache } from "./utils/apiKeys.js";
clearApiKeysCache();
```

## API Endpoints

### GET `/api/settings/ai`

Retrieve current AI settings (API keys are masked for security)

**Response:**
```json
{
  "data": {
    "id": "uuid",
    "apiKeys": {
      "openai": "********",
      "gemini": "********"
    },
    "model": "gpt-4o-mini",
    "confidenceThreshold": 0.5
  }
}
```

### POST `/api/settings/ai`

Save or update AI settings including API keys

**Request:**
```json
{
  "apiKeys": {
    "openai": "sk-proj-your-actual-key-here",
    "gemini": "AIza-your-gemini-key"
  },
  "model": "gpt-4o",
  "confidenceThreshold": 0.7
}
```

**Response:**
```json
{
  "data": {
    "id": "uuid",
    "apiKeys": {
      "openai": "********",
      "gemini": "********"
    },
    "model": "gpt-4o",
    "confidenceThreshold": 0.7
  }
}
```

## Deployment Guide

### 1. Initial Deployment (Without API Keys in .env)

```bash
# .env file (minimal)
DATABASE_URL="postgresql://user:pass@host:5432/db"
JWT_SECRET="your-secret-key"
PORT=4000
```

Deploy the application, then:
1. Log in as super admin
2. Navigate to Settings > API & AI
3. Configure API keys through the UI

### 2. Migration from .env to Database

If you currently have `OPENAI_API_KEY` in your `.env`:

1. Deploy the updated code
2. Log in to Settings > API & AI
3. Configure the OpenAI key in the UI
4. (Optional) Remove `OPENAI_API_KEY` from `.env` after verification
5. Redeploy if you removed the env variable

The system will automatically use database keys if configured.

### 3. Security Considerations

- **Never expose the JWT_SECRET**: It's used for API key encryption
- **HTTPS Only**: Always use HTTPS in production
- **Access Control**: Only super admins should access Settings
- **Audit Logging**: All API key changes are logged in `AuditLog` table
- **Regular Rotation**: Rotate API keys periodically

## Troubleshooting

### Issue: "OpenAI API key not configured"

**Solutions:**
1. Check Settings > API & AI - ensure key is configured
2. Verify key format starts with `sk-` or `sk-proj-`
3. Check database: `SELECT * FROM "AISettings";`
4. Check environment: `echo $OPENAI_API_KEY`

### Issue: Keys not taking effect

**Solutions:**
1. Wait 60 seconds for cache to expire, OR
2. Restart the backend server to clear cache
3. Verify key was saved: Check for green checkmark in UI

### Issue: Encryption errors

**Solutions:**
1. Ensure `JWT_SECRET` is set in `.env`
2. Verify secret hasn't changed (would invalidate existing keys)
3. Check backend logs for detailed error messages

## Testing

### Manual Testing

1. Configure API key in Settings
2. Try COA upload:
   ```bash
   curl -X POST http://localhost:4000/api/coa/upload \
     -H "Authorization: Bearer YOUR_TOKEN" \
     -F "files=@sample.pdf" \
     -F "phase=1"
   ```

3. Try questionnaire processing
4. Try import/export analysis

### Automated Testing

```typescript
// Test API key retrieval
import { getOpenAIApiKey } from './utils/apiKeys';

const key = await getOpenAIApiKey();
console.log(key ? 'Key configured ✓' : 'Key not found ✗');
```

## Support

For issues or questions:
1. Check backend logs: `npm run dev` output
2. Check database: `SELECT * FROM "AISettings";`
3. Verify audit logs: `SELECT * FROM "AuditLog" WHERE module = 'settings';`

## Future Enhancements

- [ ] API usage tracking and cost monitoring
- [ ] Multiple key profiles (dev/staging/prod)
- [ ] Key rotation automation
- [ ] Provider health checks
- [ ] Usage limit warnings


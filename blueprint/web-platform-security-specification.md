# Capcraft Web Platform — Security Specification
## Blueprint v3 Supplement: Authentication, Authorization, Data Protection, Compliance

> **STATUS: PLANNING ONLY — NO CODE CHANGES**

---

# 1. AUTHENTICATION

## 1.1 Auth Flow

```
SIGNUP:
1. User submits email + password (or OAuth click)
2. POST /api/auth/signup → Supabase Auth.createUser()
3. Supabase sends verification email
4. User clicks verification link → account activated
5. JWT issued (access token: 1 hour, refresh token: 30 days)
6. Refresh token stored in httpOnly secure cookie
7. Access token stored in memory only (NOT localStorage)

LOGIN:
1. User submits email + password (or OAuth)
2. POST /api/auth/login → Supabase Auth.signIn()
3. On success: JWT issued
4. Refresh token → httpOnly secure cookie
5. Access token → memory (React state / Zustand store)
6. Redirect to dashboard

TOKEN REFRESH:
1. Access token expires (1 hour)
2. API client detects 401 response
3. POST /api/auth/refresh with refresh token cookie
4. New access token returned → update in memory
5. Retry original request
6. If refresh token also expired → redirect to login

LOGOUT:
1. POST /api/auth/logout → Supabase Auth.signOut()
2. Clear refresh token cookie
3. Clear access token from memory
4. Clear all Zustand stores
5. Redirect to login page
```

## 1.2 OAuth Providers

| Provider | Client ID Source | Scopes | Notes |
|---|---|---|---|
| Google | env.GOOGLE_CLIENT_ID | email, profile | Most popular for creators |
| GitHub | env.GITHUB_CLIENT_ID | read:user, user:email | Developer audience |

## 1.3 JWT Structure

```json
{
  "sub": "user-uuid",
  "email": "user@example.com",
  "plan": "pro",
  "iat": 1704067200,
  "exp": 1704070800
}
```

- `sub`: User UUID (matches Supabase auth.users.id)
- `plan`: Current subscription plan (checked on every request)
- `iat`: Issued at
- `exp`: Expires at (1 hour from issuance)

---

# 2. AUTHORIZATION

## 2.1 API Route Protection

```typescript
// Middleware pattern (applied to ALL API routes except /api/auth/*)
async function authMiddleware(req: Request): Promise<Response | null> {
  const token = extractBearerToken(req);
  if (!token) return unauthorizedResponse();
  
  const payload = verifyJWT(token);
  if (!payload || payload.exp < Date.now() / 1000) {
    return unauthorizedResponse(); // Token expired
  }
  
  // Attach user to request context
  req.context = { userId: payload.sub, plan: payload.plan };
  return null; // Continue to handler
}
```

## 2.2 Resource Ownership Validation

```typescript
// EVERY resource access MUST validate ownership
// Pattern used in all resource-specific endpoints:

async function getProject(req: Request) {
  const { userId } = req.context;
  const projectId = req.params.id;
  
  const project = await db.projects.findOne({ id: projectId, user_id: userId });
  if (!project) {
    // Could be "not found" OR "not yours" — don't reveal which
    return notFoundResponse();
  }
  
  return okResponse(project);
}

// This applies to:
// - Projects (user_id check)
// - Media (user_id check)
// - Export jobs (user_id check)
// - Transcription jobs (user_id check)
// - Caption presets (user_id check)
```

## 2.3 Plan-Based Authorization

```typescript
// Check plan limits before allowing actions
async function checkExportLimit(userId: string, plan: string): Promise<boolean> {
  const usage = await getUsage(userId);
  
  switch (plan) {
    case 'free':
      return usage.exportMinutesThisMonth < 10;
    case 'pro':
      return true; // Unlimited
    case 'business':
      return true; // Unlimited
    default:
      return false;
  }
}

// Applied before:
// - Starting export job
// - Starting transcription job
// - Uploading media (storage limit)
// - Creating project (project count limit for free)
```

---

# 3. INPUT VALIDATION

## 3.1 Zod Schema Pattern

```typescript
// Every API endpoint validates input with Zod
import { z } from 'zod';

const createProjectSchema = z.object({
  name: z.string().min(1).max(200),
  width: z.number().int().min(100).max(7680),
  height: z.number().int().min(100).max(7680),
  fps: z.enum([24, 30, 60]),
  backgroundColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  aspectRatio: z.enum(['16:9', '9:16', '1:1', '4:5', '4:3']).optional()
});

// Validate in route handler
const body = createProjectSchema.safeParse(await req.json());
if (!body.success) {
  return badRequestResponse({
    error: 'Validation failed',
    fields: body.error.flatten().fieldErrors
  });
}
```

## 3.2 Validation Rules Per Endpoint

| Endpoint | Key Validations |
|---|---|
| POST /api/projects | name: 1-200 chars, width/height: 100-7680, fps: 24/30/60 |
| POST /api/projects/:id/save | state: valid JSON, max 50MB after serialization |
| POST /api/media/upload/initiate | fileName: 1-500 chars, fileSize: 1 byte - 5GB, mimeType: whitelist |
| POST /api/export/start | preset: valid enum, codec: valid enum, fps: 24/30/60, all arrays same length |
| POST /api/transcribe/start | language: valid ISO code or 'auto', scope: clip/track/timeline |
| POST /api/auth/signup | email: valid format, password: 8-128 chars |

## 3.3 MIME Type Whitelist

```typescript
const ALLOWED_MEDIA_TYPES = [
  'video/mp4',
  'video/quicktime',       // .mov
  'video/webm',
  'video/x-matroska',      // .mkv
  'video/avi',
  'video/x-msvideo',       // .avi
  'audio/mpeg',            // .mp3
  'audio/mp4',             // .m4a
  'audio/wav',
  'audio/x-wav',
  'audio/ogg',
  'audio/flac',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif'
];
```

---

# 4. FILE UPLOAD SECURITY

## 4.1 Presigned Upload Flow

```
1. Client requests upload URL:
   POST /api/media/upload/initiate
   → Server validates: user authenticated, storage limit not exceeded
   → Server generates presigned POST with conditions:
     - key: users/{userId}/media/{mediaId}/original
     - content-length-range: 1 - 5,368,709,120 (5GB)
     - success_action_status: 201
   → URL expires in 1 hour

2. Client uploads directly to R2:
   POST https://capcraft-media.r2.cloudflarestorage.com/
   → R2 validates presigned conditions
   → File stored in R2

3. Client notifies server:
   POST /api/media/upload/complete
   → Server validates: mediaId belongs to user
   → Server queues probe job
   → Probe worker validates actual file type matches claimed MIME type
   → If mismatch: mark media as invalid, notify user
```

## 4.2 Upload Validation

```
Server-side checks AFTER upload completes:
1. File size matches claimed size (±1% tolerance)
2. File type matches claimed MIME type (magic bytes check)
3. File is not corrupted (ffprobe can read it)
4. File doesn't exceed plan storage limit

If any check fails:
- Delete file from R2
- Mark media record as 'invalid'
- Notify user via WebSocket 'media:error'
```

---

# 5. RATE LIMITING

## 5.1 Implementation

```typescript
// Hono rate limiter middleware
// Uses Redis for distributed rate limiting across server instances

const rateLimiter = async (c: Context, next: Next) => {
  const userId = c.context.userId;
  const endpoint = c.req.path;
  const key = `ratelimit:${userId}:${endpoint}`;
  
  const limits = getLimitForEndpoint(endpoint, c.context.plan);
  const current = await redis.incr(key);
  
  if (current === 1) {
    await redis.expire(key, 60); // 1-minute window
  }
  
  if (current > limits.perMinute) {
    c.header('Retry-After', '60');
    return c.json({ error: 'Rate limit exceeded', retryAfter: 60 }, 429);
  }
  
  await next();
};
```

## 5.2 Limits Per Plan

| Endpoint Category | Free | Pro | Business |
|---|---|---|---|
| General API | 60/min | 300/min | 1000/min |
| Media upload | 5/min | 20/min | 50/min |
| Export start | 2/min | 10/min | 30/min |
| Transcription start | 2/min | 10/min | 30/min |
| Project save | 5/min | 20/min | 60/min |
| Auth (login/signup) | 10/min | 10/min | 10/min |

---

# 6. DATA PROTECTION

## 6.1 Encryption

| Data | At Rest | In Transit |
|---|---|---|
| User passwords | Supabase Auth (bcrypt) | TLS 1.3 |
| JWT tokens | N/A (memory only) | TLS 1.3 |
| Refresh tokens | httpOnly + Secure + SameSite=Lax | TLS 1.3 |
| Project state (JSONB) | Supabase encryption at rest | TLS 1.3 |
| Media files in R2 | R2 server-side encryption (AES-256) | TLS 1.3 |
| Database backups | Supabase encrypted backups | N/A |

## 6.2 Cookie Security

```
Set-Cookie: refresh_token=xxx;
  HttpOnly;          ← Not accessible via JavaScript
  Secure;            ← Only sent over HTTPS
  SameSite=Lax;      ← CSRF protection
  Path=/api/auth;    ← Only sent to auth endpoints
  Max-Age=2592000    ← 30 days
```

## 6.3 Content Security Policy

```
Content-Security-Policy:
  default-src 'self';
  script-src 'self' 'unsafe-inline' 'unsafe-eval';
  style-src 'self' 'unsafe-inline';
  img-src 'self' data: https://cdn.capcraft.app;
  media-src https://cdn.capcraft.app blob:;
  connect-src 'self' wss://api.capcraft.app https://cdn.capcraft.app;
  font-src https://cdn.capcraft.app;
  worker-src 'self' blob:;
  frame-ancestors 'none';
  base-uri 'self';
  form-action 'self';
```

## 6.4 CORS Configuration

```typescript
const corsConfig = {
  origin: [
    'https://capcraft.app',
    'https://www.capcraft.app',
    'https://cdn.capcraft.app'
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  maxAge: 86400 // 24 hours
};
```

---

# 7. DATA PRIVACY

## 7.1 User Data Collected

| Data | Purpose | Retention |
|---|---|---|
| Email | Account identification, login | Until account deletion |
| Name | Display in UI | Until account deletion |
| Avatar | Display in UI | Until account deletion |
| Project state | Editor functionality | Until project deletion |
| Media files | Editing + export | Until media deletion or account deletion |
| Usage metrics | Billing, limits enforcement | 12 months rolling |
| Analytics (anonymous) | Product improvement | 24 months |

## 7.2 What We DON'T Collect

- No IP logging (Cloudflare strips by default)
- No browser fingerprinting
- No third-party tracking cookies
- No video content analysis (except Whisper transcription which is user-initiated)
- No export content stored after download (R2 export files auto-delete after 30 days)

## 7.3 Account Deletion

```
User requests deletion:
1. POST /api/account/delete (requires password confirmation)
2. 7-day grace period (cancelable)
3. After 7 days:
   - Delete all media from R2
   - Delete all projects from PostgreSQL
   - Delete all export jobs
   - Delete all transcription jobs
   - Delete user record from Supabase Auth
   - Delete user record from PostgreSQL
4. Confirmation email sent
```

---

# 8. SECURITY HEADERS

```typescript
// Applied to ALL responses
const securityHeaders = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'X-XSS-Protection': '0', // Modern browsers use CSP instead
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(self), microphone=(self), geolocation=()',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Resource-Policy': 'same-origin'
};
```

---

# 9. API SECURITY PATTERNS

## 9.1 Preventing IDOR (Insecure Direct Object Reference)

```
EVERY endpoint that takes a resource ID must validate:
1. Resource exists
2. Resource belongs to authenticated user
3. User has permission for this action on this resource

❌ BAD: GET /api/media/:id (just checks if media exists)
✅ GOOD: GET /api/media/:id WHERE user_id = $auth.uid
```

## 9.2 Preventing Mass Assignment

```
Only accept explicitly allowed fields in create/update:

❌ BAD: await db.projects.insert(req.body) // User could set user_id, plan, etc.
✅ GOOD: await db.projects.insert({
  user_id: req.context.userId,  // From JWT, not from body
  name: body.name,              // Explicitly allowed
  width: body.width,
  // ... only allowed fields
})
```

## 9.3 Preventing Denial of Service

```
1. Request size limit: 50MB (for project state uploads)
2. File upload limit: 5GB (enforced by R2 presigned conditions)
3. Query pagination: Max 100 items per page
4. Nested query depth: Max 3 levels
5. WebSocket message size: Max 1MB
6. Concurrent connections per user: Max 10
```

---

# 10. MONITORING & INCIDENT RESPONSE

## 10.1 Security Monitoring

| Alert | Trigger | Action |
|---|---|---|
| Brute force login | 10 failed logins from same IP in 5 min | Block IP for 1 hour |
| Token abuse | 100 refresh requests in 1 hour | Revoke all tokens for user |
| Unusual upload pattern | 50+ uploads in 10 min from new account | Flag for review |
| SQL injection attempt | Suspicious patterns in request | Block + log + alert |
| XSS attempt | Script tags in input | Block + sanitize + log |
| Rate limit abuse | Persistent 429 responses | Temporary account suspension |

## 10.2 Incident Response Plan

```
Severity 1 (Data breach):
  → Immediate: Revoke all active sessions
  → Within 1 hour: Identify scope of breach
  → Within 24 hours: Notify affected users
  → Within 72 hours: Regulatory notification (GDPR)
  → Post-mortem within 1 week

Severity 2 (Unauthorized access):
  → Immediate: Revoke affected user's sessions
  → Within 4 hours: Audit logs review
  → Within 24 hours: Patch vulnerability
  → Post-mortem within 3 days

Severity 3 (DDoS):
  → Immediate: Enable Cloudflare "Under Attack" mode
  → Within 1 hour: Identify attack vector
  → Within 24 hours: Update WAF rules
  → Post-mortem within 1 week
```

## 10.3 Audit Logging

```
Log ALL security-relevant events:
- Authentication (login, logout, signup, password reset)
- Authorization failures (401, 403 responses)
- Resource access (project load, media download, export download)
- State mutations (project save, media delete, export start)
- Admin actions (user suspension, plan changes)
- Rate limit triggers
- Error spikes

Retention: 90 days in hot storage, 1 year in cold storage
```

---

# 11. COMPLIANCE

## 11.1 GDPR Considerations

| Requirement | Implementation |
|---|---|
| Right to access | GET /api/account/data-export (downloads all user data) |
| Right to rectification | User can edit all their data in-app |
| Right to erasure | POST /api/account/delete (7-day grace period) |
| Data portability | .ecp export format (standard JSON) |
| Consent management | Cookie banner for analytics (optional) |
| Privacy policy | /privacy page with clear data usage description |
| Terms of service | /terms page |

## 11.2 PCI DSS (if handling payments directly)

```
NOT APPLICABLE — Stripe handles all card data.
Capcraft never sees, stores, or processes card numbers.
Stripe Elements / Checkout handles PCI scope.
```

# LendLoop - Neighborhood Tool-Lending Board

**Borrow what you need. Lend what you don't.**

LendLoop is a full-stack neighborhood tool-lending application built with **Next.js (App Router)**, **Clerk**, **Convex**, **TypeScript**, and self-hosted **n8n** workflow automation via Docker Compose.

---

## Architecture Overview

```
+-----------------------+        Clerk JWT         +-------------------------------+
| Next.js App Router    | -----------------------> | Convex Backend & DB           |
| (React + Tailwind)    |                          | - Server-enforced RBAC        |
| - Public Tool Board   | <----------------------- | - Sanitized Public Queries    |
| - Authenticated Tabs  |   Reactive Queries       | - Loan State Machine          |
+-----------------------+                          +-------------------------------+
                                                        |                     ^
                                    Signed Webhook      |                     | Signed HTTP +
                                    (HMAC-SHA256 +      |                     | Idempotency Key
                                     5m Timestamp)      v                     |
                                                   +-------------------------------+
                                                   | n8n (Docker Compose)          |
                                                   | 1. Request/Status Notifier    |
                                                   | 2. Daily Overdue Reminders    |
                                                   | 3. Global Error Handler       |
                                                   +-------------------------------+
```

### Data Model (`convex/schema.ts`)
- **`users`**: Clerk subject (`clerkId`), `email`, `name`, `role` (`"admin" | "user"`), `isTrustedLender`.
- **`tools`**: `name`, `category`, `condition`, `description`, `ownerId`, `isAvailable`, indexed by `by_owner`, `by_category`, and `by_available`.
- **`loanRequests`**: `toolId`, `lenderId`, `borrowerId`, `startDate`, `endDate`, `status` (`"pending" | "approved" | "declined" | "returned"`), `reminderCount`, `lastReminderSentAt`.
- **`automationEvents`**: Audit log tracking n8n webhook deliveries, overdue reminders (with unique `idempotencyKey` lookup), and workflow errors, surfaced directly on each loan card in the UI.

---

## Security & Data-Minimization Decisions

1. **Server-Side RBAC & Identity Derivation (`convex/lib/rbac.ts`)**
   - Every Convex mutation and authenticated query derives the caller strictly from `ctx.auth.getUserIdentity()` (`identity.subject`) and looks up the record via `by_clerk_id`. Client arguments never supply `userId` or `role`.
   - **`user` role**: Can create/edit/delete only their own listings, borrow available tools belonging to other neighbors, approve/decline incoming requests only on their own tools, and mark active loans involving themselves as returned.
   - **`admin` role**: Enforced via `requireAdmin(ctx)` on `adminRemoveTool`, `adminListAllLoans`, `adminListUsers`, and `adminSetTrustedLender`.
   - **Concurrency guard**: Approving a pending borrow request marks `tool.isAvailable = false` and declines competing pending requests on that tool inside the same atomic Convex transaction.

2. **Public Endpoint Data Minimization (`convex/tools.ts` -> `listPublic`)**
   - The unauthenticated public query runs all documents through `sanitizePublicTool()`, returning strictly `{ _id, name, category, isAvailable }`. Owner IDs, names, emails, descriptions, and conditions are stripped on the server so no PII leaks over the network.
   - Outbound n8n webhook payloads (`convex/automations.ts`) send only the fields necessary for the recipient notification (e.g., never exposing user IDs or internal metadata).

3. **Bidirectional HMAC-SHA256 + Replay Protection (`convex/lib/hmac.ts`, `convex/http.ts`)**
   - **Convex -> n8n**: `dispatchLoanWebhook` signs `${timestamp}.${rawBody}` with `N8N_WEBHOOK_HMAC_SECRET` and sends `X-LendLoop-Timestamp` and `X-LendLoop-Signature`. The n8n Code node rejects stale timestamps outside a 5-minute window and validates signatures using `crypto.timingSafeEqual`.
   - **n8n -> Convex**: Both `GET /api/n8n/overdue-loans`, `POST /api/n8n/reminder-callback`, and `POST /api/n8n/error-report` verify `X-LendLoop-Timestamp` (<= 5 min skew) and `X-LendLoop-Signature` via constant-time comparison over the exact raw request body.

4. **Idempotency & Error Visibility**
   - Overdue reminders generate deterministic daily keys (`overdue:${loanId}:${YYYY-MM-DD}`). `recordOverdueReminderInternal` checks the `by_idempotency_key` index before mutating `reminderCount` or writing an event, making retries completely safe.
   - Failed webhook calls in Convex retry up to 3 times with backoff before logging a `webhook_failed` event; failed n8n runs trigger `3-automation-error-handler.json` to emit structured error logs and post a signed failure report back to `/api/n8n/error-report`.

5. **Zero Hardcoded Secrets**
   - All exported workflows in `n8n/workflows/` read `$env.N8N_WEBHOOK_HMAC_SECRET` and `$env.CONVEX_HTTP_URL` from Docker environment variables rather than embedding secrets inside workflow JSON.

---

## Local Setup

### 1. Prerequisites
- Node.js 20+
- Docker & Docker Compose
- Free accounts on [Clerk](https://clerk.com) and [Convex](https://convex.dev)

### 2. Configure Environment Variables
```bash
cp .env.example .env.local
```
Generate a 32-byte secret for `N8N_WEBHOOK_HMAC_SECRET` and `N8N_ENCRYPTION_KEY`:
```bash
openssl rand -hex 32
```
In Clerk Dashboard:
- Create a **JWT Template** named `convex` and copy the Issuer URL into `CLERK_JWT_ISSUER_DOMAIN`.
- Put `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY` in `.env.local`.

In Convex Dashboard (Settings -> Environment Variables):
- Set `CLERK_JWT_ISSUER_DOMAIN`
- Set `N8N_WEBHOOK_HMAC_SECRET`
- Set `N8N_LOAN_EVENT_WEBHOOK_URL` (e.g., an ngrok/tunnel URL pointing to `http://localhost:5678/webhook/lendloop-loan-event` when calling from Convex cloud, or your hosted n8n URL)
- Optionally set `INITIAL_ADMIN_EMAIL` to auto-promote your test admin account on first sign-in.

### 3. Install & Start Convex + Next.js
```bash
npm install
npx convex dev      # Terminal 1: pushes schema/functions & populates NEXT_PUBLIC_CONVEX_URL
npm run dev         # Terminal 2: runs Next.js at http://localhost:3000
```

### 4. Start n8n with Docker Compose & Import Workflows
```bash
docker compose --env-file .env.local up -d
```
1. Open n8n at `http://localhost:5678` and complete initial owner setup.
2. Import the three workflow files from `n8n/workflows/`:
   - `1-loan-request-notification.json`
   - `2-daily-overdue-reminders.json`
   - `3-automation-error-handler.json`
3. In workflows `1` and `2`, select **LendLoop - Global Automation Error Handler** under Workflow Settings -> *Error Workflow*, then **Activate** all three workflows.

### 5. Run Verification & Security Tests
```bash
npm test            # Runs HMAC, replay window, PII stripping, and RBAC unit tests
npm run typecheck   # Validates TypeScript across Next.js + Convex backend
npm run build       # Production Next.js App Router build check
```

---

## What I Would Change for Production

1. **Secrets Management & Key Rotation:** Store `N8N_WEBHOOK_HMAC_SECRET`, Clerk secrets, and SMTP/Slack API credentials in AWS Secrets Manager / Vault with dual-key rotation support so secrets can rotate with zero webhook downtime.
2. **Webhook Outbox & Dead-Letter Queue:** Persist outbound notification intents in an outbox table processed by scheduled Convex cron sweeps in addition to immediate `ctx.scheduler.runAfter`, ensuring transient multi-hour n8n outages never drop an event.
3. **Abuse Prevention & Rate Limiting:** Enforce per-user rate limits on `createTool` and `requestBorrow`, plus strict IP rate limiting on Convex HTTP endpoints ahead of HMAC verification.
4. **Notification Channel Upgrade:** Swap the console-logged mock notification Code node in n8n for authenticated SMTP (Postmark/SES) or Slack/Discord Credential nodes, keeping full PII out of container stdout logs.
5. **Pagination & Query Scaling:** Switch `listAuthenticated` and `adminListAllLoans` to Convex cursor-based `.paginate()` and add compound category + availability indexes as listings scale.
6. **Hardened HTTP Headers:** Add strict `Content-Security-Policy` headers tailored to Clerk/Convex origins and terminate TLS with mutual TLS or private VPC ingress for the self-hosted n8n instance.

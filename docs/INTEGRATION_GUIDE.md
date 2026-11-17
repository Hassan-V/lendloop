# LendLoop Full Running & Integration Guide

This guide walks through setting up, connecting, and verifying every component of **LendLoop** from scratch: **Next.js (App Router)**, **Clerk Authentication**, **Convex Cloud Backend**, and **Self-Hosted n8n (Docker Compose)**.

---

## Prerequisites

- **Node.js 20+** and **npm 10+**
- **Docker** and **Docker Compose**
- Free accounts on [Clerk](https://clerk.com) and [Convex](https://convex.dev)
- Optional (for receiving live Convex Cloud -> local n8n webhooks): `cloudflared` or `ngrok`

---

## Step 1: Clone & Install Dependencies

```bash
git clone <your-repo-url> lendloop
cd lendloop
npm install
cp .env.example .env.local
```

Generate cryptographically strong secrets for bidirectional HMAC webhook signing (`N8N_WEBHOOK_HMAC_SECRET`) and n8n credential encryption (`N8N_ENCRYPTION_KEY`):

```bash
openssl rand -hex 32   # Put into N8N_WEBHOOK_HMAC_SECRET
openssl rand -hex 16   # Put into N8N_ENCRYPTION_KEY
```

---

## Step 2: Configure Clerk Authentication & JWT Template

1. Create a new application in the [Clerk Dashboard](https://dashboard.clerk.com) (enable Email/Password or Google sign-in).
2. Go to **Configure -> API keys** and copy into `.env.local`:
   - `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...`
   - `CLERK_SECRET_KEY=sk_test_...`
3. Create the Convex JWT integration:
   - Go to **Configure -> JWT templates -> New template -> Convex**.
   - Keep the template name strictly as **`convex`**.
   - Copy the **Issuer** URL (e.g., `https://<your-clerk-domain>.clerk.accounts.dev`) and click **Save**.
4. Put that Issuer URL in `.env.local`:
   ```env
   CLERK_JWT_ISSUER_DOMAIN=https://<your-clerk-domain>.clerk.accounts.dev
   ```
5. Set an initial neighborhood admin email (automatically promoted on first login):
   ```env
   INITIAL_ADMIN_EMAIL=you@example.com
   ```

---

## Step 3: Provision Convex & Deploy Backend Functions

Run the interactive Convex CLI inside the project root:

```bash
npx convex dev
```

1. Authenticate via browser and create/select a project (`lendloop`).
2. `npx convex dev` will automatically write `CONVEX_DEPLOYMENT`, `NEXT_PUBLIC_CONVEX_URL` (`https://<deployment>.convex.cloud`), and `NEXT_PUBLIC_CONVEX_SITE_URL` (`https://<deployment>.convex.site`) into `.env.local`.
3. Update `CONVEX_HTTP_URL` in `.env.local` to match your `.convex.site` URL so Docker n8n can reach Convex HTTP Actions:
   ```env
   CONVEX_HTTP_URL=https://<deployment>.convex.site
   ```
4. Set the server-side environment variables inside Convex Cloud (so `auth.config.ts`, `automations.ts`, and `http.ts` can read them securely):
   ```bash
   npx convex env set CLERK_JWT_ISSUER_DOMAIN "https://<your-clerk-domain>.clerk.accounts.dev"
   npx convex env set INITIAL_ADMIN_EMAIL "you@example.com"
   npx convex env set N8N_WEBHOOK_HMAC_SECRET "<same-64-char-hex-secret-from-.env.local>"
   ```

Verify deployment with `npx convex dev --once` (or leave `npx convex dev` running in Terminal 1).

---

## Step 4: Launch Self-Hosted n8n via Docker Compose

Start n8n in detached mode using `.env.local`:

```bash
docker compose --env-file .env.local up -d
```

Verify the container is healthy:

```bash
docker compose --env-file .env.local ps
curl -i http://localhost:5678/healthz
```

### Import & Wire the 3 Workflows

1. Open [http://localhost:5678](http://localhost:5678) and create your local n8n owner account.
2. Import each JSON file from `n8n/workflows/` (**Workflows -> Add workflow -> Import from File**):
   - `1-loan-request-notification.json`
   - `2-daily-overdue-reminders.json`
   - `3-automation-error-handler.json`
3. Attach error visibility:
   - Open workflow **1** and workflow **2**, open **Workflow Settings (gear icon) -> Error Workflow**, and select **LendLoop - Global Automation Error Handler**.
4. **Activate** all three workflows (toggle **Inactive -> Active** in the top-right bar).

### Connect Convex Cloud Webhooks to Local n8n

Because `dispatchLoanWebhook` runs inside Convex Cloud, Convex cannot call `http://localhost:5678` on your machine without an HTTPS tunnel (or hosting n8n on a public VPS):

```bash
# Option A: Quick tunnel using Cloudflare Tunnel (or ngrok http 5678)
cloudflared tunnel --url http://localhost:5678
```

Take the public HTTPS tunnel URL (e.g., `https://random-words.trycloudflare.com`) and configure it in Convex:

```bash
npx convex env set N8N_LOAN_EVENT_WEBHOOK_URL "https://random-words.trycloudflare.com/webhook/lendloop-loan-event"
```

*(Note: If you run n8n without setting `N8N_LOAN_EVENT_WEBHOOK_URL` first, LendLoop degrades gracefully and logs a failed/skipped webhook event on the loan card without breaking user mutations.)*

---

## Step 5: Run Next.js & Verify Every Requirement

Start the Next.js development server in Terminal 2:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and run through this verification checklist:

### A. Public View & Data Minimization
- Visit `http://localhost:3000` **while signed out**.
- Confirm only tool names, categories, and availability appear (no owner names, emails, descriptions, or conditions).
- Confirm **"Sign in to lend or borrow"** opens Clerk login.

### B. User Workflows (`user` Role)
- Sign in with two separate Clerk test accounts (Account A = standard `user`, Account B = `INITIAL_ADMIN_EMAIL` `admin`):
  1. As Account A, open **My Listings** and publish a tool.
  2. Switch to Account B, browse the board, and click **Request to Borrow** with a date range (`startDate` to `endDate`).
  3. Confirm n8n Workflow 1 receives the signed POST webhook (`X-LendLoop-Timestamp` + `X-LendLoop-Signature`) and emits the minimized notification log.
  4. Back in Account A under **Incoming Requests**, click **Approve** -> confirm the tool flips to **On Loan**, competing pending requests are auto-declined, and a status-change webhook fires.
  5. Click **Mark Returned** -> confirm the tool returns to **Available**.

### C. Admin Governance (`admin` Role)
- Sign in with `INITIAL_ADMIN_EMAIL` and open the **Admin** tab:
  - Toggle **Mark as Trusted Lender** on Account A and confirm the **Trusted Lender** badge appears on Account A's listings and loans.
  - Inspect **All Neighborhood Loans & Automation Logs**.
  - Test **Remove Listing** moderation.
- Attempt calling `adminRemoveTool` or `adminSetTrustedLender` from a non-admin session -> rejected server-side by `requireAdmin(ctx)`.

### D. Overdue Reminder & Idempotency Test
1. Trigger Workflow 2 manually inside n8n (**Test workflow**).
2. Confirm it signs `GET /api/n8n/overdue-loans`, loops overdue loans (`status === "approved"` and `endDate < today`), sends reminders, and writes back to `POST /api/n8n/reminder-callback` with `idempotencyKey = overdue:<loanId>:<YYYY-MM-DD>`.
3. Trigger Workflow 2 a **second time on the same day** -> confirm Convex returns `{ "ok": true, "deduplicated": true }` and `reminderCount` does **not** increment twice.
4. Check the loan card in the UI -> confirm recent automation activity renders (e.g., `"Reminder sent just now (1 total)"`).

---

## Step 6: Run Automated Tests & Static Checks

```bash
npm test          # Runs 8 unit tests covering HMAC, replay window, PII stripping, & RBAC
npm run typecheck # Runs tsc --noEmit across Next.js & Convex
npm run build     # Verifies production Next.js App Router bundle
```

Sanitized outputs captured from these runs are saved under `demo-logs/`.

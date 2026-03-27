# RFC 0004: Backend Decoupling & Persistent User Statistics

## Status
Proposed

## Context
PR #54 introduced Supabase Authentication and basic statistics. However, the current implementation couples the client directly to Supabase's database features (PostgREST/RPC) and relies on Supabase-specific triggers and RLS. To improve testability, portability, and security, we need to decouple the database access through an API layer and modernize the migration management.

## Proposed Changes

### 1. Architecture: API Layer (Vercel Functions)
Introduce a **Vercel Functions backend** (Node.js) to act as the API layer between the browser and the database.

**Key Components:**
- **Directory**: `api/` for route handlers, `api/_lib/` for shared middleware/utilities (not exposed as routes).
- **Authentication**: Client-side remains coupled to Supabase Auth. Server-side will verify Supabase JWTs using the `jose` library and the `SUPABASE_JWT_SECRET` environment variable.
- **Database Access**: Use a standard Postgres client (e.g., `pg`) on the server instead of the Supabase SDK.
- **Endpoints**:
  - `POST /api/profile`: Upserts a user profile (id, nickname) on sign-in.
  - `GET /api/profile`: Retrieves the authenticated user's stats.
  - `POST /api/stats`: Updates wins/losses atomically.

### 2. Migration Management: dbmate
Replace `supabase/migrations/` with `dbmate` for portable, pure-Postgres migrations.
- **Benefits**: Support for local Docker Postgres, CI testing (Testcontainers), and production Supabase without vendor lock-in.
- **Scope**: Single migration file for the `profiles` table. Remove Supabase triggers and RLS policies (authorization is now handled in the API middleware).

### 3. Local Development Bypass
Support testing the backend without an Identity Provider (IdP).
- **Mechanism**: If `SUPABASE_JWT_SECRET` is missing and `NODE_ENV !== 'production'`, the middleware will accept a mock user ID via the `X-Dev-User-Id` header.

### 4. Security & Code-level Improvements
- **XSS Prevention**: Replace `innerHTML` with `textContent` or proper escaping in `LoginScene.js` for email display.
- **Atomicity**: `updateStats` logic moves to the backend where it will perform atomic SQL updates (`UPDATE ... SET wins = wins + 1`), eliminating current client-side race conditions.
- **Cleanup**: 
  - Remove all `supabase.from()` and `supabase.rpc()` calls from the client.
  - Fix mixed language strings (e.g., "Estadísticas no disponibles").
  - Remove unnecessary production logging and dead code (e.g., unused registry keys).

## Methodology

### Profile Creation Flow
Instead of a database trigger, the client will call `POST /api/profile` upon a successful `SIGNED_IN` event from `onAuthStateChange`. The backend will perform an idempotent insert:
```sql
INSERT INTO profiles (id, nickname) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING;
```

### Authorization Middleware
The `api/_lib/handler.js` will wrap every protected route to:
1. Extract the Bearer token or Dev header.
2. Verify the JWT against the secret (if in production).
3. Inject a `db` connection and `userId` into the handler context.

## Implementation Plan
1. Initialize `dbmate` and create the initial migration.
2. Implement `api/_lib/` with JWT verification and DB pooling.
3. Create `api/profile.js` and `api/stats.js`.
4. Refactor `src/services/supabase.js` to remove DB-specific logic.
5. Update UI scenes to fetch data from the new `/api` endpoints.
6. Apply security and grammar fixes.

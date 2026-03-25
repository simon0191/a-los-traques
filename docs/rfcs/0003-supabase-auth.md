# RFC 0003: Account System with Supabase

## Status
Proposed

## Context
Implement user authentication and persistent accounts to enable personalized experiences (profiles, statistics, friend lists) and secure online play.

## Why Supabase?
Supabase is an open-source Firebase alternative based on PostgreSQL, making it an ideal fit for a Phaser and Vite project:
- **Plug & Play Authentication**: Native support for email/password and OAuth (Google, Discord).
- **Relational Database**: Leverages PostgreSQL for complex game data (win streaks, history).
- **JavaScript SDK**: Seamless integration via `@supabase/supabase-js`.
- **Generous Free Tier**: Perfect for initial development and scaling.

## Proposed Development Plan

### Phase 1: Initial Configuration and Infrastructure
- **Project Setup**: Initialize Supabase project and obtain `SUPABASE_URL` and `SUPABASE_ANON_KEY`.
- **Environment Security**: Store credentials in Vite `.env` files.
- **Service Bridge**: Create `src/services/supabase.js` to centralize authentication logic (login, signup, logout).

### Phase 2: Authentication Logic and Global State
- **Session Management**: Implement persistent session checking on game launch.
- **Auth Listener**: Use `onAuthStateChange` to handle login/logout events dynamically.
- **Global State**: Store authenticated user data in the Phaser Registry or a dedicated state manager for access across all scenes.

### Phase 3: Phaser User Interface (UI)
- **LoginScene**: Implement a new entry scene using Phaser DOM elements for email and password inputs.
- **Action Flow**:
    - "Login" and "Register" for account users.
    - "Play as Guest" for immediate local gameplay.
- **Phaser Config**: Enable `parent: 'game-container'` and DOM element support in game configuration.
- **Visual Feedback**: Real-time error handling (e.g., "Invalid credentials") and loading states.

### Phase 4: Profile Database and Integration
- **Profiles Table**: Automated profile creation via Supabase SQL triggers on registration.
- **Nickname Integration**: Replace generic IDs with user-defined nicknames in `TitleScene` and `NetworkManager`.
- **Statistics**: Store and retrieve persistent match data (wins, losses, preferred characters).

## Alternatives Considered
- **Firebase**: Rejected in favor of Supabase's SQL-based architecture which is more suited for relational game data.
- **Custom Backend**: Rejected to minimize infrastructure management and development time.

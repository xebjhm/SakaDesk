# Anonymous Analytics System Design

> **Created:** 2026-01-13
> **Status:** Approved

## Overview

A privacy-first analytics system that collects de-identified (去識別化) subscription data from users who opt-in, enabling community statistics, public rankings, and personalized yearly summaries.

## Goals

1. **Community insights** - Public dashboard with member popularity rankings, trends, and fun statistics
2. **Personal analytics** - Local summaries (monthly/yearly) of user's own message activity
3. **Yearly Wrapped** - Shareable cards comparing user's stats to community (like Spotify Wrapped)
4. **User acquisition** - Public stats and shareable cards drive discovery and virality

## Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   HakoDesk      │     │    Supabase     │     │  Public Website │
│   (Desktop)     │────▶│   (Backend)     │────▶│  (Stats + DL)   │
│                 │     │                 │     │                 │
│ - Collect local │     │ - User linking  │     │ - Rankings      │
│ - Upload stats  │     │ - Aggregate     │     │ - Trends        │
│ - Show Wrapped  │     │ - Store anon    │     │ - App intro     │
└─────────────────┘     └─────────────────┘     └─────────────────┘
```

## Anonymous Identification Strategy

### Server-Side Linking

Users are identified anonymously using a combination of:
- **Hardware hash** - Primary identifier, stable on same machine
- **Credential hashes** - SHA256 of service user IDs, enables cross-device linking

```python
hardware_id = SHA256(machine_id + "hakodesk-analytics-salt")
credential_hash = SHA256(service_user_id + "hakodesk-analytics-salt")
```

### Linking Logic

```
1. User uploads data with hardware_id + credential_hashes
2. Server checks: "Have I seen this hardware_id?"
   → Yes: Same user, update record
   → No: Check credential_hashes
3. Server checks: "Have I seen any of these credential_hashes?"
   → Yes: Same user (different device/reinstall), link records
   → No: New user, create record
```

This enables:
- Stable tracking across reinstalls
- Cross-device recognition
- Cross-group statistics (Hinata + Nogi + Saku)

## Consent Model

### Opt-in Flow
1. **First launch** - Dialog explaining anonymous stats, asking to opt-in
2. **On upgrade** - Reminder for users who previously skipped (if not "never ask again")
3. **Settings** - Toggle anytime under Settings > Privacy

### User Messaging
- Clear explanation: "No personal data - only anonymized subscription info"
- Show their anonymous ID in settings if curious
- Emphasize: "We cannot reverse this to identify you"

### Options
- "Yes, contribute my stats"
- "Not now"
- "Never ask me again"

## Data Collection

### Uploaded (Subscription Data)

```json
{
  "hardware_id_hash": "sha256...",
  "credential_hashes": ["sha256_hina...", "sha256_nogi..."],
  "app_version": "1.2.0",
  "subscriptions": [
    {
      "member_id": "hinata_001",
      "group": "hinatazaka",
      "subscribed_at": "2025-03-15",
      "is_active": true
    }
  ]
}
```

### Local Only (Engagement Data)
- Message counts (total, voice, photo, video)
- Sync history
- Personal usage patterns

### Never Collected
- Actual credentials/tokens
- Message content
- User's real name or account name
- IP addresses (Supabase configured to not log)

### Upload Triggers
- After each sync (debounced, max once per day)
- On app startup if >24h since last upload

## Community Statistics (Public Dashboard)

### Rankings & Insights

| Statistic | Description |
|-----------|-------------|
| Member popularity | Most subscribed members overall |
| Group distribution | % users per group |
| Loyalty rankings | Longest average subscription duration |
| Subscription count distribution | "Average user has X subscriptions" |
| Trending members | Most new subscribers this month |
| Retention rate | Members users stay subscribed to longest |
| Cross-group stats | % multi-group users, common combos |
| Hidden gems | High retention but lower total subs |
| Gateway member | Most common "first subscription" |

### Awards (Updated Daily)
- **Rising Star** - Fastest growing subscriber count this month
- **The Dedicated** - Longest average subscription streak
- **Hidden Gem** - Underrated members with high retention

### Update Frequency
- Daily aggregation via Supabase scheduled function

## Personal Analytics

### Local Summaries (In-App)
- Monthly/yearly message summary
- Breakdown by type (text, voice, photo, video)
- Per-member activity stats
- Personal subscription timeline

### Yearly Wrapped (Hybrid)

| Stat | Data Source |
|------|-------------|
| Your top member (longest subscribed) | Local |
| Total members subscribed this year | Local |
| Subscription anniversaries | Local |
| "You're in top X% of collectors" | Community |
| "You were early!" (subscribed before X users) | Community |
| Your group loyalty breakdown | Local |
| Compared to average user | Community |

### Shareable Cards
- Group-themed colors (Hinatazaka blue, Nogizaka purple, Sakurazaka white/red)
- Generated as PNG in-app
- Includes hashtag for social sharing (#HakoDesk2026)
- Detailed visual design TBD

## Database Schema (Supabase)

```sql
-- Anonymous users (linked by server logic)
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMP DEFAULT NOW()
);

-- Hardware IDs and credential hashes for linking
CREATE TABLE user_identifiers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  identifier_type TEXT NOT NULL,  -- 'hardware' | 'credential_hina' | 'credential_nogi' | 'credential_saku'
  identifier_hash TEXT UNIQUE NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Subscription snapshots
CREATE TABLE subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  member_id TEXT NOT NULL,        -- e.g., "hinata_001"
  group_name TEXT NOT NULL,       -- 'hinatazaka' | 'nogizaka' | 'sakurazaka'
  subscribed_at DATE NOT NULL,
  unsubscribed_at DATE,           -- NULL if still active
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Track uploads for diagnostics
CREATE TABLE uploads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  app_version TEXT,
  uploaded_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for linking queries
CREATE INDEX idx_identifiers_hash ON user_identifiers(identifier_hash);
CREATE INDEX idx_subscriptions_user ON subscriptions(user_id);
CREATE INDEX idx_subscriptions_member ON subscriptions(member_id, group_name);
```

## Public Website

Single website for:
1. **App introduction** - What is HakoDesk, features
2. **Download page** - Links to GitHub releases
3. **Stats dashboard** - Community rankings and trends (`/stats`)

Hosted on Vercel/Netlify (free tier), queries Supabase directly.

## Implementation Phases

### Phase 1: Backend Infrastructure
- [ ] Set up Supabase project
- [ ] Create database schema
- [ ] Implement upload endpoint with linking logic
- [ ] Add basic aggregation queries/views

### Phase 2: Desktop App Integration
- [ ] Add opt-in consent dialog (first launch + upgrade reminder)
- [ ] Implement anonymous ID generation (hardware hash + credential hashes)
- [ ] Add background upload service (daily, after sync)
- [ ] Add settings toggle for analytics participation

### Phase 3: Public Website
- [ ] Create project website (intro + download page)
- [ ] Add `/stats` page with community dashboard
- [ ] Display rankings, trends, awards
- [ ] Daily refresh from Supabase

### Phase 4: Personal Analytics
- [ ] Local monthly/yearly summaries in-app
- [ ] Message breakdown by type

### Phase 5: Yearly Wrapped
- [ ] Wrapped generation logic (local + community comparison)
- [ ] Shareable card generator (group-themed PNG)
- [ ] Social sharing integration

## Cost Estimate (Supabase)

| Resource | Free Limit | Expected Usage |
|----------|-----------|----------------|
| Database | 500 MB | ~10-50 MB |
| API requests | 500K/month | ~1K-10K |
| Edge Functions | 500K invocations | Same as API |
| Bandwidth | 5 GB | Minimal |

**Verdict:** Free tier sufficient for 1000+ users. Pro tier (~$25/mo) only needed at 10K+ users.

## Privacy Considerations

1. **One-way hashes** - Cannot reverse to get credentials
2. **No IP logging** - Supabase configured to skip
3. **Minimal data** - Only subscription metadata, no content
4. **User control** - Opt-in, can disable anytime
5. **Transparency** - Users can see their anonymous ID
6. **Clear messaging** - Explain exactly what's collected and why

## Development Setup

### Supabase CLI Commands

```bash
# Install Supabase CLI
npm install -g supabase

# Login (requires auth token from dashboard)
supabase login

# Initialize project (creates supabase/ directory)
supabase init

# Link to remote project
supabase link --project-ref <project-id>

# Push database migrations
supabase db push

# Deploy Edge Functions
supabase functions deploy upload-stats

# Local development
supabase start    # Start local Supabase stack
supabase stop     # Stop local stack
```

### Project Structure (to be created)

```
supabase/
├── migrations/
│   └── 001_initial_schema.sql    # Database schema
├── functions/
│   └── upload-stats/
│       └── index.ts              # Upload endpoint with linking logic
└── config.toml                   # Supabase config
```

### Environment Variables Needed

```
SUPABASE_URL=https://<project>.supabase.co
SUPABASE_ANON_KEY=<anon-key>      # For client-side uploads
```

### Feature Branch

When ready to implement, create branch:
```bash
git checkout -b feature/anonymous-analytics
```

-- AlgoRank database schema, migration 0001.
--
-- Design principles:
--   * Every row that came from an external source carries (source, external_id)
--     and the complete raw API payload (raw JSONB), so the database can always
--     be re-normalized without re-ingesting from the network.
--   * Internal surrogate BIGINT keys everywhere; external ids are never PKs.
--   * The same tables hold start.gg, parry.gg, and (later) liquipedia /
--     challonge / manual data, discriminated by `source`.
--   * Bracket structure is preserved losslessly: per-slot prerequisite edges
--     (start.gg model) AND per-set forward pointers (parry.gg model).
--   * Player identity is layered: immutable per-source player_account rows,
--     with a soft, reversible mapping onto canonical person rows.

CREATE TABLE IF NOT EXISTS schema_migrations (
    version     INTEGER PRIMARY KEY,
    applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Reference data
-- ---------------------------------------------------------------------------

CREATE TABLE videogame (
    id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    source            TEXT NOT NULL CHECK (source IN ('startgg','parry','liquipedia','challonge','manual')),
    external_id       TEXT NOT NULL,
    name              TEXT,
    display_name      TEXT,
    slug              TEXT,
    raw               JSONB,
    extra             JSONB NOT NULL DEFAULT '{}'::jsonb,
    first_seen_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_ingested_at  TIMESTAMPTZ,
    UNIQUE (source, external_id)
);

CREATE TABLE game_character (
    id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    source            TEXT NOT NULL,
    external_id       TEXT NOT NULL,
    videogame_id      BIGINT REFERENCES videogame(id),
    name              TEXT,
    slug              TEXT,
    raw               JSONB,
    extra             JSONB NOT NULL DEFAULT '{}'::jsonb,
    first_seen_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_ingested_at  TIMESTAMPTZ,
    UNIQUE (source, external_id)
);

CREATE TABLE stage (
    id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    source            TEXT NOT NULL,
    external_id       TEXT NOT NULL,
    videogame_id      BIGINT REFERENCES videogame(id),
    name              TEXT,
    slug              TEXT,
    raw               JSONB,
    extra             JSONB NOT NULL DEFAULT '{}'::jsonb,
    first_seen_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_ingested_at  TIMESTAMPTZ,
    UNIQUE (source, external_id)
);

-- ---------------------------------------------------------------------------
-- Tournaments and events
-- ---------------------------------------------------------------------------

CREATE TABLE tournament (
    id                    BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    source                TEXT NOT NULL,
    external_id           TEXT NOT NULL,
    slug                  TEXT,
    short_slug            TEXT,
    name                  TEXT,
    short_name            TEXT,
    start_at              TIMESTAMPTZ,
    end_at                TIMESTAMPTZ,
    timezone              TEXT,
    created_at_src        TIMESTAMPTZ,
    updated_at_src        TIMESTAMPTZ,
    state                 TEXT,
    is_online             BOOLEAN,
    has_offline_events    BOOLEAN,
    has_online_events     BOOLEAN,
    num_attendees         INTEGER,
    venue_name            TEXT,
    venue_address         TEXT,
    city                  TEXT,
    addr_state            TEXT,
    country_code          TEXT,
    postal_code           TEXT,
    lat                   DOUBLE PRECISION,
    lng                   DOUBLE PRECISION,
    maps_place_id         TEXT,
    currency              TEXT,
    registration_open_at  TIMESTAMPTZ,
    registration_close_at TIMESTAMPTZ,
    hashtag               TEXT,
    primary_contact       TEXT,
    rules                 TEXT,
    url                   TEXT,
    owner_external_id     TEXT,
    owner_info            JSONB,
    images                JSONB,
    -- ingestion bookkeeping
    ingest_status         TEXT NOT NULL DEFAULT 'pending'
                          CHECK (ingest_status IN ('pending','in_progress','complete','error','skipped')),
    ingest_error          TEXT,
    ingest_attempts       INTEGER NOT NULL DEFAULT 0,
    raw                   JSONB,
    extra                 JSONB NOT NULL DEFAULT '{}'::jsonb,
    first_seen_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_ingested_at      TIMESTAMPTZ,
    UNIQUE (source, external_id)
);
CREATE INDEX tournament_start_at_idx ON tournament (start_at);
CREATE INDEX tournament_pending_idx ON tournament (source) WHERE ingest_status IN ('pending','error');
CREATE INDEX tournament_slug_idx ON tournament (slug);

CREATE TABLE stream (
    id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    source            TEXT NOT NULL,
    external_id       TEXT NOT NULL,
    tournament_id     BIGINT REFERENCES tournament(id) ON DELETE CASCADE,
    name              TEXT,
    platform          TEXT,
    channel           TEXT,
    display_name      TEXT,
    capacity          INTEGER,
    enabled           BOOLEAN,
    raw               JSONB,
    first_seen_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_ingested_at  TIMESTAMPTZ,
    UNIQUE (source, external_id)
);
CREATE INDEX stream_tournament_idx ON stream (tournament_id);

CREATE TABLE event (
    id                    BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    source                TEXT NOT NULL,
    external_id           TEXT NOT NULL,
    tournament_id         BIGINT NOT NULL REFERENCES tournament(id) ON DELETE CASCADE,
    name                  TEXT,
    slug                  TEXT,
    state                 TEXT,
    event_type            INTEGER,            -- start.gg: 1=singles, 5=teams, ...
    is_teams              BOOLEAN,
    team_min_players      INTEGER,
    team_max_players      INTEGER,
    videogame_id          BIGINT REFERENCES videogame(id),
    start_at              TIMESTAMPTZ,
    created_at_src        TIMESTAMPTZ,
    updated_at_src        TIMESTAMPTZ,
    registration_open_at  TIMESTAMPTZ,
    registration_close_at TIMESTAMPTZ,
    check_in_buffer       INTEGER,
    check_in_duration     INTEGER,
    check_in_enabled      BOOLEAN,
    is_online             BOOLEAN,
    num_entrants          INTEGER,
    entrant_cap           INTEGER,
    competition_tier      INTEGER,
    prizing_info          JSONB,
    description           TEXT,
    price                 INTEGER,
    -- ingestion bookkeeping
    ingest_status         TEXT NOT NULL DEFAULT 'pending'
                          CHECK (ingest_status IN ('pending','in_progress','complete','error','skipped')),
    ingest_error          TEXT,
    ingest_attempts       INTEGER NOT NULL DEFAULT 0,
    is_final              BOOLEAN NOT NULL DEFAULT FALSE,  -- no further changes expected
    raw                   JSONB,
    extra                 JSONB NOT NULL DEFAULT '{}'::jsonb,
    first_seen_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_ingested_at      TIMESTAMPTZ,
    UNIQUE (source, external_id)
);
CREATE INDEX event_tournament_idx ON event (tournament_id);
CREATE INDEX event_start_at_idx ON event (start_at);
CREATE INDEX event_due_idx ON event (source, ingest_status) WHERE ingest_status IN ('pending','error');
CREATE INDEX event_not_final_idx ON event (source, last_ingested_at) WHERE NOT is_final;

CREATE TABLE phase (
    id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    source            TEXT NOT NULL,
    external_id       TEXT NOT NULL,
    event_id          BIGINT NOT NULL REFERENCES event(id) ON DELETE CASCADE,
    name              TEXT,
    ordinal           INTEGER,
    bracket_type      TEXT,
    num_seeds         INTEGER,
    group_count       INTEGER,
    state             TEXT,
    is_default_entry  BOOLEAN,
    slug              TEXT,
    raw               JSONB,
    extra             JSONB NOT NULL DEFAULT '{}'::jsonb,
    first_seen_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_ingested_at  TIMESTAMPTZ,
    UNIQUE (source, external_id)
);
CREATE INDEX phase_event_idx ON phase (event_id);

-- start.gg "phase group" (pool) == parry.gg "bracket"
CREATE TABLE phase_group (
    id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    source              TEXT NOT NULL,
    external_id         TEXT NOT NULL,
    phase_id            BIGINT NOT NULL REFERENCES phase(id) ON DELETE CASCADE,
    display_identifier  TEXT,
    name                TEXT,
    slug                TEXT,
    bracket_type        TEXT,
    state               TEXT,
    bracket_index       INTEGER,
    first_round_time    TIMESTAMPTZ,
    tiebreak_order      JSONB,
    rounds_config       JSONB,      -- per-round best-of / labels / winners-side
    seed_map            JSONB,
    checksum            TEXT,
    wave_identifier     TEXT,
    wave_start_at       TIMESTAMPTZ,
    wave_end_at         TIMESTAMPTZ,
    raw                 JSONB,
    extra               JSONB NOT NULL DEFAULT '{}'::jsonb,
    first_seen_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_ingested_at    TIMESTAMPTZ,
    UNIQUE (source, external_id)
);
CREATE INDEX phase_group_phase_idx ON phase_group (phase_id);

-- ---------------------------------------------------------------------------
-- People
-- ---------------------------------------------------------------------------

-- Canonical real-world person. Rows are created lazily (by tooling or by the
-- future admin UI); merging two persons NEVER deletes anything: it points one
-- at the other via merged_into_person_id and writes an identity_event row, so
-- every merge can be undone.
CREATE TABLE person (
    id                      BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    display_name            TEXT,
    notes                   TEXT,
    birthday                DATE,
    country_code            TEXT,
    merged_into_person_id   BIGINT REFERENCES person(id),
    created_by              TEXT NOT NULL DEFAULT 'system',
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX person_merged_into_idx ON person (merged_into_person_id) WHERE merged_into_person_id IS NOT NULL;

-- Resolve a person id through any chain of soft merges.
CREATE OR REPLACE FUNCTION person_root(p BIGINT) RETURNS BIGINT
LANGUAGE sql STABLE AS $$
    WITH RECURSIVE chain(id, target, depth) AS (
        SELECT id, merged_into_person_id, 0 FROM person WHERE id = p
        UNION ALL
        SELECT pe.id, pe.merged_into_person_id, chain.depth + 1
        FROM person pe JOIN chain ON pe.id = chain.target
        WHERE chain.depth < 50
    )
    SELECT id FROM chain WHERE target IS NULL LIMIT 1;
$$;

-- One row per player identity per source (a start.gg Player, a parry.gg User,
-- a Liquipedia player page, a manually entered player, ...). Never merged or
-- mutated destructively; person_id is the soft link to the canonical person.
CREATE TABLE player_account (
    id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    source            TEXT NOT NULL,
    external_id       TEXT NOT NULL,
    person_id         BIGINT REFERENCES person(id),
    gamer_tag         TEXT,
    prefix            TEXT,
    user_external_id  TEXT,        -- start.gg User id behind the Player, when known
    user_slug         TEXT,
    discriminator     TEXT,
    real_name         TEXT,
    first_name        TEXT,
    last_name         TEXT,
    bio               TEXT,
    birthday          TEXT,        -- as reported by source, free-form
    pronouns          TEXT,
    city              TEXT,
    state             TEXT,
    country           TEXT,
    avatar_url        TEXT,
    images            JSONB,
    connections       JSONB,       -- twitter/twitch/discord/startgg-link/...
    sponsor           TEXT,
    is_anonymous      BOOLEAN,
    raw               JSONB,
    extra             JSONB NOT NULL DEFAULT '{}'::jsonb,
    first_seen_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_ingested_at  TIMESTAMPTZ,
    UNIQUE (source, external_id)
);
CREATE INDEX player_account_tag_idx ON player_account (lower(gamer_tag));
CREATE INDEX player_account_person_idx ON player_account (person_id);

-- Append-only audit log of all identity operations (assign/unassign accounts,
-- merge/unmerge persons, automatic link hints from cross-source connections).
CREATE TABLE identity_event (
    id                 BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    kind               TEXT NOT NULL CHECK (kind IN ('assign','unassign','merge','unmerge','link_hint','note')),
    player_account_id  BIGINT REFERENCES player_account(id),
    person_from_id     BIGINT REFERENCES person(id),
    person_to_id       BIGINT REFERENCES person(id),
    reason             TEXT,
    actor              TEXT NOT NULL DEFAULT 'system',
    payload            JSONB,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Tournament-level registration of a player (start.gg Participant /
-- parry.gg TournamentAttendee).
CREATE TABLE participant (
    id                 BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    source             TEXT NOT NULL,
    external_id        TEXT NOT NULL,
    tournament_id      BIGINT NOT NULL REFERENCES tournament(id) ON DELETE CASCADE,
    player_account_id  BIGINT REFERENCES player_account(id),
    gamer_tag          TEXT,
    prefix             TEXT,
    verified           BOOLEAN,
    checked_in         BOOLEAN,
    connected_accounts JSONB,
    contact_info       JSONB,
    raw                JSONB,
    first_seen_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_ingested_at   TIMESTAMPTZ,
    UNIQUE (source, external_id)
);
CREATE INDEX participant_tournament_idx ON participant (tournament_id);
CREATE INDEX participant_player_idx ON participant (player_account_id);

-- ---------------------------------------------------------------------------
-- Entrants, seeds, progressions
-- ---------------------------------------------------------------------------

CREATE TABLE entrant (
    id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    source            TEXT NOT NULL,
    external_id       TEXT NOT NULL,
    event_id          BIGINT NOT NULL REFERENCES event(id) ON DELETE CASCADE,
    name              TEXT,
    initial_seed_num  INTEGER,
    is_disqualified   BOOLEAN,
    skill             INTEGER,
    final_placement   INTEGER,
    raw               JSONB,
    extra             JSONB NOT NULL DEFAULT '{}'::jsonb,
    first_seen_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_ingested_at  TIMESTAMPTZ,
    UNIQUE (source, external_id)
);
CREATE INDEX entrant_event_idx ON entrant (event_id);

CREATE TABLE entrant_player (
    entrant_id         BIGINT NOT NULL REFERENCES entrant(id) ON DELETE CASCADE,
    player_account_id  BIGINT NOT NULL REFERENCES player_account(id),
    participant_id     BIGINT REFERENCES participant(id),
    PRIMARY KEY (entrant_id, player_account_id)
);
CREATE INDEX entrant_player_player_idx ON entrant_player (player_account_id);

CREATE TABLE seed (
    id                 BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    source             TEXT NOT NULL,
    external_id        TEXT NOT NULL,
    phase_id           BIGINT REFERENCES phase(id) ON DELETE CASCADE,
    phase_group_id     BIGINT REFERENCES phase_group(id) ON DELETE CASCADE,
    entrant_id         BIGINT REFERENCES entrant(id),
    seed_num           INTEGER,
    group_seed_num     INTEGER,
    is_bye             BOOLEAN,
    placeholder_name   TEXT,
    placement          INTEGER,
    progression        JSONB,    -- origin of a progressed seed (phase/group/placement)
    raw                JSONB,
    first_seen_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_ingested_at   TIMESTAMPTZ,
    UNIQUE (source, external_id)
);
CREATE INDEX seed_phase_idx ON seed (phase_id);
CREATE INDEX seed_phase_group_idx ON seed (phase_group_id);
CREATE INDEX seed_entrant_idx ON seed (entrant_id);

-- parry.gg first-class progressions (and a place to model start.gg
-- phase-to-phase progression rules if ever needed beyond seed.progression).
CREATE TABLE progression (
    id                       BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    source                   TEXT NOT NULL,
    external_id              TEXT NOT NULL,
    event_id                 BIGINT REFERENCES event(id) ON DELETE CASCADE,
    origin_phase_group_id    BIGINT REFERENCES phase_group(id),
    target_phase_id          BIGINT REFERENCES phase(id),
    target_phase_group_id    BIGINT REFERENCES phase_group(id),
    origin_set_external_id   TEXT,
    seed_external_id         TEXT,
    origin_placement         INTEGER,
    origin_seed              INTEGER,
    match_winner             BOOLEAN,
    winners_side             BOOLEAN,
    raw                      JSONB,
    first_seen_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_ingested_at         TIMESTAMPTZ,
    UNIQUE (source, external_id)
);
CREATE INDEX progression_event_idx ON progression (event_id);

-- ---------------------------------------------------------------------------
-- Sets and games
-- ---------------------------------------------------------------------------

CREATE TABLE sets (
    id                          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    source                      TEXT NOT NULL,
    external_id                 TEXT NOT NULL,
    event_id                    BIGINT NOT NULL REFERENCES event(id) ON DELETE CASCADE,
    phase_group_id              BIGINT REFERENCES phase_group(id),
    identifier                  TEXT,
    round                       INTEGER,     -- negative = losers side (start.gg)
    full_round_text             TEXT,
    winners_side                BOOLEAN,
    is_grand_finals             BOOLEAN,
    state                       TEXT,
    started_at                  TIMESTAMPTZ,
    completed_at                TIMESTAMPTZ,
    created_at_src              TIMESTAMPTZ,
    updated_at_src              TIMESTAMPTZ,
    winner_entrant_id           BIGINT REFERENCES entrant(id),
    total_games                 INTEGER,
    set_games_type              INTEGER,     -- start.gg: 1=best-of, 2=play-all
    display_score               TEXT,
    w_placement                 INTEGER,     -- placement earned by winning this set
    l_placement                 INTEGER,
    vod_url                     TEXT,
    station_number              INTEGER,
    stream_id                   BIGINT REFERENCES stream(id),
    stream_info                 JSONB,
    -- bracket DAG, both directions, as external set ids within same source
    prev_set_external_id_1     TEXT,
    prev_set_external_id_2     TEXT,
    winners_next_set_external_id TEXT,
    losers_next_set_external_id  TEXT,
    raw                         JSONB,
    extra                       JSONB NOT NULL DEFAULT '{}'::jsonb,
    first_seen_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_ingested_at            TIMESTAMPTZ,
    UNIQUE (source, external_id)
);
CREATE INDEX sets_event_idx ON sets (event_id);
CREATE INDEX sets_phase_group_idx ON sets (phase_group_id);
CREATE INDEX sets_winner_idx ON sets (winner_entrant_id);
CREATE INDEX sets_completed_at_idx ON sets (completed_at);

-- One row per side of a set. Slot prerequisites encode the bracket DAG the
-- start.gg way: prereq_type in ('set','seed','bye',...), prereq_external_id
-- points to the feeding set/seed within the same source.
CREATE TABLE set_slot (
    id                   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    set_id               BIGINT NOT NULL REFERENCES sets(id) ON DELETE CASCADE,
    slot_index           INTEGER,
    entrant_id           BIGINT REFERENCES entrant(id),
    seed_external_id     TEXT,
    seed_num             INTEGER,
    prereq_type          TEXT,
    prereq_external_id   TEXT,
    prereq_placement     INTEGER,
    placement            INTEGER,
    score                DOUBLE PRECISION,   -- start.gg: -1 means DQ
    is_dq                BOOLEAN,
    is_bye               BOOLEAN,
    slot_state           TEXT,
    raw                  JSONB,
    UNIQUE (set_id, slot_index)
);
CREATE INDEX set_slot_entrant_idx ON set_slot (entrant_id);

CREATE TABLE game (
    id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    source              TEXT NOT NULL,
    external_id         TEXT,
    set_id              BIGINT NOT NULL REFERENCES sets(id) ON DELETE CASCADE,
    order_num           INTEGER,
    state               TEXT,
    winner_entrant_id   BIGINT REFERENCES entrant(id),
    -- per-game score; for platform fighters start.gg documents this as
    -- "stocks remaining"
    entrant1_score      DOUBLE PRECISION,
    entrant2_score      DOUBLE PRECISION,
    stage_id            BIGINT REFERENCES stage(id),
    stage_name          TEXT,
    started_at          TIMESTAMPTZ,
    ended_at            TIMESTAMPTZ,
    raw                 JSONB,
    UNIQUE (set_id, order_num)
);
CREATE INDEX game_set_idx ON game (set_id);

-- Per-slot game results (parry.gg exposes these directly; start.gg per-game
-- entrant scores land on game.entrant1_score/entrant2_score instead).
CREATE TABLE game_slot (
    id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    game_id      BIGINT NOT NULL REFERENCES game(id) ON DELETE CASCADE,
    slot_index   INTEGER,
    entrant_id   BIGINT REFERENCES entrant(id),
    score        DOUBLE PRECISION,
    placement    INTEGER,
    slot_state   TEXT,
    raw          JSONB,
    UNIQUE (game_id, slot_index)
);

-- Character (and other) selections within a game.
CREATE TABLE game_selection (
    id                       BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    game_id                  BIGINT NOT NULL REFERENCES game(id) ON DELETE CASCADE,
    slot_index               INTEGER,
    entrant_id               BIGINT REFERENCES entrant(id),
    player_account_id        BIGINT REFERENCES player_account(id),
    participant_external_id  TEXT,
    selection_type           TEXT,           -- e.g. CHARACTER
    character_id             BIGINT REFERENCES game_character(id),
    value_external_id        TEXT,
    value_name               TEXT,
    order_num                INTEGER,
    raw                      JSONB
);
CREATE INDEX game_selection_game_idx ON game_selection (game_id);

-- ---------------------------------------------------------------------------
-- Standings
-- ---------------------------------------------------------------------------

CREATE TABLE standing (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    source          TEXT NOT NULL,
    external_id     TEXT,
    event_id        BIGINT NOT NULL REFERENCES event(id) ON DELETE CASCADE,
    entrant_id      BIGINT REFERENCES entrant(id),
    container_type  TEXT NOT NULL DEFAULT 'event',   -- event | phase | phase_group
    phase_id        BIGINT REFERENCES phase(id),
    phase_group_id  BIGINT REFERENCES phase_group(id),
    placement       INTEGER,
    is_final        BOOLEAN,
    wins            INTEGER,
    losses          INTEGER,
    seed_num        INTEGER,
    stats           JSONB,
    raw             JSONB,
    last_ingested_at TIMESTAMPTZ
);
-- Expression index so ON CONFLICT works although phase_group_id is nullable.
CREATE UNIQUE INDEX standing_unique_idx
    ON standing (event_id, container_type, entrant_id, COALESCE(phase_group_id, 0));
CREATE INDEX standing_event_idx ON standing (event_id);

-- ---------------------------------------------------------------------------
-- Ingestion bookkeeping
-- ---------------------------------------------------------------------------

CREATE TABLE sync_run (
    id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    source       TEXT NOT NULL,
    kind         TEXT NOT NULL,                 -- backfill | incremental | verify
    started_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at  TIMESTAMPTZ,
    status       TEXT NOT NULL DEFAULT 'running'
                 CHECK (status IN ('running','success','paused','error')),
    stats        JSONB NOT NULL DEFAULT '{}'::jsonb,
    error        TEXT
);

-- Resumable, adaptively split discovery windows over tournament start dates.
CREATE TABLE discovery_window (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    source        TEXT NOT NULL,
    window_start  TIMESTAMPTZ NOT NULL,
    window_end    TIMESTAMPTZ NOT NULL,
    status        TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','in_progress','done','split','error')),
    total_found   INTEGER,
    error         TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (source, window_start, window_end)
);
CREATE INDEX discovery_window_pending_idx ON discovery_window (source, window_start)
    WHERE status IN ('pending','in_progress','error');

-- Small key/value store for cursors and watermarks.
CREATE TABLE kv_state (
    key        TEXT PRIMARY KEY,
    value      JSONB,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Snapshots of the remote API schema (start.gg introspection results, parry
-- SDK versions) for auditability of what was available at ingest time.
CREATE TABLE schema_snapshot (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    source      TEXT NOT NULL,
    captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    label       TEXT,
    payload     JSONB
);

-- Fields/arguments the live API rejected and we dropped from queries.
-- If anything ever appears here, we know exactly what to look at.
CREATE TABLE api_field_fallback (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    source        TEXT NOT NULL,
    query_name    TEXT NOT NULL,
    kind          TEXT NOT NULL,    -- field | argument | variable
    name          TEXT NOT NULL,
    error_message TEXT,
    first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (source, query_name, kind, name)
);

INSERT INTO schema_migrations (version) VALUES (1);

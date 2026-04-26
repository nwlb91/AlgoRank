-- CreateTable
CREATE TABLE "Videogame" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "source" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "externalKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "displayName" TEXT,
    "slug" TEXT,
    "rawJson" TEXT,
    "firstSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Character" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "source" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "externalKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "imageUrl" TEXT,
    "rawJson" TEXT,
    "firstSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Stage" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "source" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "externalKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "imageUrl" TEXT,
    "rawJson" TEXT,
    "firstSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "User" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "source" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "externalKey" TEXT NOT NULL,
    "slug" TEXT,
    "discriminator" TEXT,
    "name" TEXT,
    "bio" TEXT,
    "location" TEXT,
    "genderPronoun" TEXT,
    "rawJson" TEXT,
    "firstSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Player" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "source" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "externalKey" TEXT NOT NULL,
    "gamerTag" TEXT,
    "prefix" TEXT,
    "userId" INTEGER,
    "rawJson" TEXT,
    "firstSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Player_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Tournament" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "source" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "externalKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT,
    "shortSlug" TEXT,
    "startAt" DATETIME,
    "endAt" DATETIME,
    "registrationClosesAt" DATETIME,
    "timezone" TEXT,
    "city" TEXT,
    "addrState" TEXT,
    "countryCode" TEXT,
    "postalCode" TEXT,
    "lat" REAL,
    "lng" REAL,
    "venueName" TEXT,
    "venueAddress" TEXT,
    "hashtag" TEXT,
    "currency" TEXT,
    "isOnline" BOOLEAN,
    "hasOfflineEvents" BOOLEAN,
    "hasOnlineEvents" BOOLEAN,
    "numAttendees" INTEGER,
    "ownerSourceId" TEXT,
    "primaryContact" TEXT,
    "primaryContactType" TEXT,
    "mapsPlaceId" TEXT,
    "rules" TEXT,
    "url" TEXT,
    "rawJson" TEXT,
    "firstSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Event" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "source" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "externalKey" TEXT NOT NULL,
    "tournamentId" INTEGER NOT NULL,
    "videogameId" INTEGER,
    "name" TEXT NOT NULL,
    "slug" TEXT,
    "type" INTEGER,
    "startAt" DATETIME,
    "state" INTEGER,
    "numEntrants" INTEGER,
    "teamRosterSize" INTEGER,
    "isOnline" BOOLEAN,
    "prizingInfo" TEXT,
    "rulesetId" INTEGER,
    "useEventSeeds" BOOLEAN,
    "ownerSourceId" TEXT,
    "rawJson" TEXT,
    "firstSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Event_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Event_videogameId_fkey" FOREIGN KEY ("videogameId") REFERENCES "Videogame" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Phase" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "source" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "externalKey" TEXT NOT NULL,
    "eventId" INTEGER NOT NULL,
    "name" TEXT,
    "phaseOrder" INTEGER,
    "numSeeds" INTEGER,
    "bracketType" TEXT,
    "groupCount" INTEGER,
    "isExhibition" BOOLEAN,
    "state" INTEGER,
    "rawJson" TEXT,
    "firstSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Phase_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PhaseGroup" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "source" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "externalKey" TEXT NOT NULL,
    "phaseId" INTEGER NOT NULL,
    "displayIdentifier" TEXT,
    "bracketType" TEXT,
    "firstRoundTime" DATETIME,
    "state" INTEGER,
    "waveSourceId" TEXT,
    "numRounds" INTEGER,
    "rawJson" TEXT,
    "firstSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PhaseGroup_phaseId_fkey" FOREIGN KEY ("phaseId") REFERENCES "Phase" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Entrant" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "source" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "externalKey" TEXT NOT NULL,
    "eventId" INTEGER NOT NULL,
    "name" TEXT,
    "isDisqualified" BOOLEAN,
    "initialSeedNum" INTEGER,
    "finalPlacement" INTEGER,
    "rawJson" TEXT,
    "firstSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Entrant_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Participant" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "source" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "externalKey" TEXT NOT NULL,
    "entrantId" INTEGER NOT NULL,
    "playerId" INTEGER,
    "gamerTag" TEXT,
    "prefix" TEXT,
    "rawJson" TEXT,
    "firstSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Participant_entrantId_fkey" FOREIGN KEY ("entrantId") REFERENCES "Entrant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Participant_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Set" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "source" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "externalKey" TEXT NOT NULL,
    "eventId" INTEGER NOT NULL,
    "phaseGroupId" INTEGER,
    "identifier" TEXT,
    "displayScore" TEXT,
    "fullRoundText" TEXT,
    "round" INTEGER,
    "startedAt" DATETIME,
    "completedAt" DATETIME,
    "state" INTEGER,
    "totalGames" INTEGER,
    "winnerEntrantId" INTEGER,
    "loserEntrantId" INTEGER,
    "isGF" BOOLEAN,
    "lPlacement" INTEGER,
    "wPlacement" INTEGER,
    "hasPlaceholder" BOOLEAN,
    "hasErrors" BOOLEAN,
    "station" TEXT,
    "streamSourceId" TEXT,
    "vodUrl" TEXT,
    "setGamesType" INTEGER,
    "rawJson" TEXT,
    "firstSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Set_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Set_phaseGroupId_fkey" FOREIGN KEY ("phaseGroupId") REFERENCES "PhaseGroup" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SetSlot" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "source" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "externalKey" TEXT NOT NULL,
    "setId" INTEGER NOT NULL,
    "slotIndex" INTEGER NOT NULL,
    "entrantId" INTEGER,
    "seedNum" INTEGER,
    "prereqType" TEXT,
    "prereqSourceSetId" TEXT,
    "prereqPlacement" INTEGER,
    "rawJson" TEXT,
    "firstSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SetSlot_setId_fkey" FOREIGN KEY ("setId") REFERENCES "Set" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SetSlot_entrantId_fkey" FOREIGN KEY ("entrantId") REFERENCES "Entrant" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Game" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "source" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "externalKey" TEXT NOT NULL,
    "setId" INTEGER NOT NULL,
    "orderNum" INTEGER NOT NULL,
    "winnerEntrantId" INTEGER,
    "state" INTEGER,
    "stageId" INTEGER,
    "entrant1Score" INTEGER,
    "entrant2Score" INTEGER,
    "rawJson" TEXT,
    "firstSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Game_setId_fkey" FOREIGN KEY ("setId") REFERENCES "Set" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Game_winnerEntrantId_fkey" FOREIGN KEY ("winnerEntrantId") REFERENCES "Entrant" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Game_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "Stage" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "GameSelection" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "source" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "externalKey" TEXT NOT NULL,
    "gameId" INTEGER NOT NULL,
    "entrantId" INTEGER,
    "participantId" INTEGER,
    "characterId" INTEGER,
    "selectionType" TEXT,
    "selectionValue" INTEGER,
    "orderNum" INTEGER,
    "rawJson" TEXT,
    "firstSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "GameSelection_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "GameSelection_entrantId_fkey" FOREIGN KEY ("entrantId") REFERENCES "Entrant" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "GameSelection_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "Participant" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "GameSelection_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Standing" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "source" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "externalKey" TEXT NOT NULL,
    "eventId" INTEGER,
    "phaseGroupId" INTEGER,
    "entrantId" INTEGER,
    "placement" INTEGER,
    "isFinal" BOOLEAN,
    "totalPoints" REAL,
    "metadata" TEXT,
    "rawJson" TEXT,
    "firstSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Standing_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Standing_phaseGroupId_fkey" FOREIGN KEY ("phaseGroupId") REFERENCES "PhaseGroup" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Standing_entrantId_fkey" FOREIGN KEY ("entrantId") REFERENCES "Entrant" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "IngestionRun" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "source" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "paramsJson" TEXT NOT NULL,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'running',
    "errorMessage" TEXT
);

-- CreateTable
CREATE TABLE "IngestionCheckpoint" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "runId" INTEGER NOT NULL,
    "scopeKey" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "page" INTEGER NOT NULL DEFAULT 0,
    "done" BOOLEAN NOT NULL DEFAULT false,
    "metaJson" TEXT,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "IngestionCheckpoint_runId_fkey" FOREIGN KEY ("runId") REFERENCES "IngestionRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Videogame_externalKey_key" ON "Videogame"("externalKey");

-- CreateIndex
CREATE INDEX "Videogame_slug_idx" ON "Videogame"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Videogame_source_sourceId_key" ON "Videogame"("source", "sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "Character_externalKey_key" ON "Character"("externalKey");

-- CreateIndex
CREATE UNIQUE INDEX "Character_source_sourceId_key" ON "Character"("source", "sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "Stage_externalKey_key" ON "Stage"("externalKey");

-- CreateIndex
CREATE UNIQUE INDEX "Stage_source_sourceId_key" ON "Stage"("source", "sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "User_externalKey_key" ON "User"("externalKey");

-- CreateIndex
CREATE INDEX "User_slug_idx" ON "User"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "User_source_sourceId_key" ON "User"("source", "sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "Player_externalKey_key" ON "Player"("externalKey");

-- CreateIndex
CREATE INDEX "Player_gamerTag_idx" ON "Player"("gamerTag");

-- CreateIndex
CREATE INDEX "Player_userId_idx" ON "Player"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Player_source_sourceId_key" ON "Player"("source", "sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "Tournament_externalKey_key" ON "Tournament"("externalKey");

-- CreateIndex
CREATE INDEX "Tournament_slug_idx" ON "Tournament"("slug");

-- CreateIndex
CREATE INDEX "Tournament_startAt_idx" ON "Tournament"("startAt");

-- CreateIndex
CREATE UNIQUE INDEX "Tournament_source_sourceId_key" ON "Tournament"("source", "sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "Event_externalKey_key" ON "Event"("externalKey");

-- CreateIndex
CREATE INDEX "Event_tournamentId_idx" ON "Event"("tournamentId");

-- CreateIndex
CREATE INDEX "Event_videogameId_idx" ON "Event"("videogameId");

-- CreateIndex
CREATE INDEX "Event_slug_idx" ON "Event"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Event_source_sourceId_key" ON "Event"("source", "sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "Phase_externalKey_key" ON "Phase"("externalKey");

-- CreateIndex
CREATE INDEX "Phase_eventId_idx" ON "Phase"("eventId");

-- CreateIndex
CREATE UNIQUE INDEX "Phase_source_sourceId_key" ON "Phase"("source", "sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "PhaseGroup_externalKey_key" ON "PhaseGroup"("externalKey");

-- CreateIndex
CREATE INDEX "PhaseGroup_phaseId_idx" ON "PhaseGroup"("phaseId");

-- CreateIndex
CREATE UNIQUE INDEX "PhaseGroup_source_sourceId_key" ON "PhaseGroup"("source", "sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "Entrant_externalKey_key" ON "Entrant"("externalKey");

-- CreateIndex
CREATE INDEX "Entrant_eventId_idx" ON "Entrant"("eventId");

-- CreateIndex
CREATE INDEX "Entrant_name_idx" ON "Entrant"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Entrant_source_sourceId_key" ON "Entrant"("source", "sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "Participant_externalKey_key" ON "Participant"("externalKey");

-- CreateIndex
CREATE INDEX "Participant_entrantId_idx" ON "Participant"("entrantId");

-- CreateIndex
CREATE INDEX "Participant_playerId_idx" ON "Participant"("playerId");

-- CreateIndex
CREATE INDEX "Participant_gamerTag_idx" ON "Participant"("gamerTag");

-- CreateIndex
CREATE UNIQUE INDEX "Participant_source_sourceId_key" ON "Participant"("source", "sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "Set_externalKey_key" ON "Set"("externalKey");

-- CreateIndex
CREATE INDEX "Set_eventId_idx" ON "Set"("eventId");

-- CreateIndex
CREATE INDEX "Set_phaseGroupId_idx" ON "Set"("phaseGroupId");

-- CreateIndex
CREATE INDEX "Set_completedAt_idx" ON "Set"("completedAt");

-- CreateIndex
CREATE INDEX "Set_winnerEntrantId_idx" ON "Set"("winnerEntrantId");

-- CreateIndex
CREATE INDEX "Set_loserEntrantId_idx" ON "Set"("loserEntrantId");

-- CreateIndex
CREATE UNIQUE INDEX "Set_source_sourceId_key" ON "Set"("source", "sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "SetSlot_externalKey_key" ON "SetSlot"("externalKey");

-- CreateIndex
CREATE INDEX "SetSlot_setId_idx" ON "SetSlot"("setId");

-- CreateIndex
CREATE INDEX "SetSlot_entrantId_idx" ON "SetSlot"("entrantId");

-- CreateIndex
CREATE INDEX "SetSlot_prereqSourceSetId_idx" ON "SetSlot"("prereqSourceSetId");

-- CreateIndex
CREATE UNIQUE INDEX "SetSlot_source_sourceId_key" ON "SetSlot"("source", "sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "SetSlot_setId_slotIndex_key" ON "SetSlot"("setId", "slotIndex");

-- CreateIndex
CREATE UNIQUE INDEX "Game_externalKey_key" ON "Game"("externalKey");

-- CreateIndex
CREATE INDEX "Game_setId_idx" ON "Game"("setId");

-- CreateIndex
CREATE INDEX "Game_stageId_idx" ON "Game"("stageId");

-- CreateIndex
CREATE INDEX "Game_winnerEntrantId_idx" ON "Game"("winnerEntrantId");

-- CreateIndex
CREATE UNIQUE INDEX "Game_source_sourceId_key" ON "Game"("source", "sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "Game_setId_orderNum_key" ON "Game"("setId", "orderNum");

-- CreateIndex
CREATE UNIQUE INDEX "GameSelection_externalKey_key" ON "GameSelection"("externalKey");

-- CreateIndex
CREATE INDEX "GameSelection_gameId_idx" ON "GameSelection"("gameId");

-- CreateIndex
CREATE INDEX "GameSelection_entrantId_idx" ON "GameSelection"("entrantId");

-- CreateIndex
CREATE INDEX "GameSelection_participantId_idx" ON "GameSelection"("participantId");

-- CreateIndex
CREATE INDEX "GameSelection_characterId_idx" ON "GameSelection"("characterId");

-- CreateIndex
CREATE UNIQUE INDEX "GameSelection_source_sourceId_key" ON "GameSelection"("source", "sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "Standing_externalKey_key" ON "Standing"("externalKey");

-- CreateIndex
CREATE INDEX "Standing_eventId_placement_idx" ON "Standing"("eventId", "placement");

-- CreateIndex
CREATE INDEX "Standing_phaseGroupId_placement_idx" ON "Standing"("phaseGroupId", "placement");

-- CreateIndex
CREATE INDEX "Standing_entrantId_idx" ON "Standing"("entrantId");

-- CreateIndex
CREATE UNIQUE INDEX "Standing_source_sourceId_key" ON "Standing"("source", "sourceId");

-- CreateIndex
CREATE INDEX "IngestionRun_source_mode_idx" ON "IngestionRun"("source", "mode");

-- CreateIndex
CREATE INDEX "IngestionRun_startedAt_idx" ON "IngestionRun"("startedAt");

-- CreateIndex
CREATE INDEX "IngestionCheckpoint_runId_idx" ON "IngestionCheckpoint"("runId");

-- CreateIndex
CREATE UNIQUE INDEX "IngestionCheckpoint_runId_scopeKey_stage_key" ON "IngestionCheckpoint"("runId", "scopeKey", "stage");

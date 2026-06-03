-- CreateTable
CREATE TABLE "RankingPeriod" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "startAt" DATETIME NOT NULL,
    "endAt" DATETIME NOT NULL,
    "videogameId" INTEGER,
    "eventType" INTEGER,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "RankingPeriodTournament" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "periodId" INTEGER NOT NULL,
    "tournamentId" INTEGER NOT NULL,
    "included" BOOLEAN NOT NULL,
    "reason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RankingPeriodTournament_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "RankingPeriod" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RankingPeriodTournament_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "EventNameRule" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "normalizedName" TEXT NOT NULL,
    "eligible" BOOLEAN NOT NULL,
    "reason" TEXT,
    "createdInPeriodId" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "EventNameRule_createdInPeriodId_fkey" FOREIGN KEY ("createdInPeriodId") REFERENCES "RankingPeriod" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "EventEligibilityOverride" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "eventId" INTEGER NOT NULL,
    "eligible" BOOLEAN NOT NULL,
    "reason" TEXT NOT NULL,
    "createdInPeriodId" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "EventEligibilityOverride_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "EventEligibilityOverride_createdInPeriodId_fkey" FOREIGN KEY ("createdInPeriodId") REFERENCES "RankingPeriod" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SetOverride" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "setId" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "correctedWinnerEntrantId" INTEGER,
    "correctedDisplayScore" TEXT,
    "createdInPeriodId" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SetOverride_setId_fkey" FOREIGN KEY ("setId") REFERENCES "Set" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SetOverride_correctedWinnerEntrantId_fkey" FOREIGN KEY ("correctedWinnerEntrantId") REFERENCES "Entrant" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "SetOverride_createdInPeriodId_fkey" FOREIGN KEY ("createdInPeriodId") REFERENCES "RankingPeriod" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "RankingPeriod_name_key" ON "RankingPeriod"("name");

-- CreateIndex
CREATE INDEX "RankingPeriod_startAt_endAt_idx" ON "RankingPeriod"("startAt", "endAt");

-- CreateIndex
CREATE INDEX "RankingPeriodTournament_periodId_idx" ON "RankingPeriodTournament"("periodId");

-- CreateIndex
CREATE INDEX "RankingPeriodTournament_tournamentId_idx" ON "RankingPeriodTournament"("tournamentId");

-- CreateIndex
CREATE UNIQUE INDEX "RankingPeriodTournament_periodId_tournamentId_key" ON "RankingPeriodTournament"("periodId", "tournamentId");

-- CreateIndex
CREATE UNIQUE INDEX "EventNameRule_normalizedName_key" ON "EventNameRule"("normalizedName");

-- CreateIndex
CREATE INDEX "EventNameRule_eligible_idx" ON "EventNameRule"("eligible");

-- CreateIndex
CREATE UNIQUE INDEX "EventEligibilityOverride_eventId_key" ON "EventEligibilityOverride"("eventId");

-- CreateIndex
CREATE UNIQUE INDEX "SetOverride_setId_key" ON "SetOverride"("setId");

-- CreateIndex
CREATE INDEX "SetOverride_kind_idx" ON "SetOverride"("kind");

-- CreateIndex
CREATE INDEX "Event_name_idx" ON "Event"("name");

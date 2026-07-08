-- CreateEnum
CREATE TYPE "AppointmentStatus" AS ENUM ('SCHEDULED', 'CONFIRMED', 'CANCELLED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "ConfirmationChannel" AS ENUM ('EMAIL', 'PORTAL');

-- AlterTable
ALTER TABLE "Patient" ADD COLUMN     "email" TEXT,
ADD COLUMN     "emailOptedIn" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "portalEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "portalLastSeenAt" TIMESTAMP(3),
ADD COLUMN     "preferredName" TEXT;

-- DropTable
DROP TABLE "patient_documents";

-- CreateTable
CREATE TABLE "Appointment" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "clinicianName" TEXT,
    "clinicName" TEXT NOT NULL DEFAULT 'SES Clinic',
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "status" "AppointmentStatus" NOT NULL DEFAULT 'SCHEDULED',
    "confirmedAt" TIMESTAMP(3),
    "confirmedVia" "ConfirmationChannel",
    "reminderSentAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Appointment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MagicLinkToken" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "purpose" TEXT NOT NULL DEFAULT 'login',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MagicLinkToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PortalSession" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userAgent" TEXT,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "PortalSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthAuditLog" (
    "id" TEXT NOT NULL,
    "patientId" TEXT,
    "email" TEXT,
    "event" TEXT NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PortalAccessLog" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PortalAccessLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PushSubscription" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConditionContent" (
    "id" TEXT NOT NULL,
    "conditionKey" TEXT NOT NULL,
    "icdPrefixes" TEXT NOT NULL,
    "matchTerms" TEXT NOT NULL,
    "plainName" TEXT NOT NULL,
    "plainDescription" TEXT NOT NULL,
    "tips" JSONB NOT NULL,
    "mythBusters" JSONB NOT NULL,

    CONSTRAINT "ConditionContent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PatientCheckInEmail" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "dataSnapshot" JSONB NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PatientCheckInEmail_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Appointment_patientId_scheduledAt_idx" ON "Appointment"("patientId", "scheduledAt");

-- CreateIndex
CREATE UNIQUE INDEX "MagicLinkToken_tokenHash_key" ON "MagicLinkToken"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "PortalSession_tokenHash_key" ON "PortalSession"("tokenHash");

-- CreateIndex
CREATE INDEX "PortalSession_patientId_idx" ON "PortalSession"("patientId");

-- CreateIndex
CREATE INDEX "AuthAuditLog_patientId_createdAt_idx" ON "AuthAuditLog"("patientId", "createdAt");

-- CreateIndex
CREATE INDEX "PortalAccessLog_patientId_createdAt_idx" ON "PortalAccessLog"("patientId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");

-- CreateIndex
CREATE INDEX "PushSubscription_patientId_idx" ON "PushSubscription"("patientId");

-- CreateIndex
CREATE UNIQUE INDEX "ConditionContent_conditionKey_key" ON "ConditionContent"("conditionKey");

-- CreateIndex
CREATE INDEX "PatientCheckInEmail_patientId_sentAt_idx" ON "PatientCheckInEmail"("patientId", "sentAt");

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MagicLinkToken" ADD CONSTRAINT "MagicLinkToken_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortalSession" ADD CONSTRAINT "PortalSession_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSubscription_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientCheckInEmail" ADD CONSTRAINT "PatientCheckInEmail_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


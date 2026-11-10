-- CreateTable
CREATE TABLE "TokenRevocation" (
    "subject" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TokenRevocation_pkey" PRIMARY KEY ("subject")
);

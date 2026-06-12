-- Convert Proposal.endTime from String (ISO text) to DateTime (timestamptz)
ALTER TABLE "Proposal" ALTER COLUMN "endTime" TYPE TIMESTAMP(3) USING "endTime"::timestamptz;

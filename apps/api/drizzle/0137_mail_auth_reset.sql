-- A mail's `pass` once came from its Authentication-Results header, which a sender can write
-- where the provider adds none. Since 0136's time it comes only from a signature checked here or
-- the provider's own header; what was kept before is believed no longer.
UPDATE "mail_messages" SET "auth" = 'none' WHERE "auth" = 'pass';

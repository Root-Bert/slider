-- A conversation's „Dateien“ also lists Cloud files and folders a message points to (dragged
-- into the chat): `attachment_id` is then the node's id, no upload – so no key to `attachments`
-- any more (a message's files go with it all the same); one node may be on several messages,
-- so a file is one per message.
ALTER TABLE "sender_files" DROP CONSTRAINT "sender_files_attachment_id_attachments_id_fk";--> statement-breakpoint
ALTER TABLE "sender_files" DROP CONSTRAINT "sender_files_pkey";--> statement-breakpoint
ALTER TABLE "sender_files" ADD CONSTRAINT "sender_files_message_id_attachment_id_pk" PRIMARY KEY("message_id","attachment_id");

# Chat message previews in CRM notifications

New internal chat messages now persist a bell notification and use existing Web Push. The title names the sender and group where applicable. Text, shared-document label and attachment filenames are included in a preview up to 500 characters, with an ellipsis for longer messages; opening the link shows the full chat. Attachment URLs remain private and are not included in notification data.

Only active internal members of the matching conversation/message can receive or read a preview. The sender is excluded. Manager status does not grant access to somebody else's private conversation. Source authorization also checks the message has not been recalled; leaving/removal from a group or recalling a message hides existing bell previews. Already delivered browser push content cannot be remotely withdrawn by this feature.

One notification per message/recipient uses the existing deduplication key. Background work remains under waitUntil and group delivery reuses the existing bounded recipient dispatcher. No migration, historical backfill or production messages are required.

Tests cover decrypted push text matching the bell preview, attachment/reference labels, sender/outsider/supplier exclusion, recall/read denial, group departure, long-message truncation and retaining complete text in the chat. Existing chat, notifications, recipient-scope, SePay notification and architecture tests are rerun.

---
status: accepted
---

# The gateway keeps its state in SQLite on the data volume

Conversations, the usage ledger and device settings are stored in one SQLite database on the gateway's data volume, which on TrueNAS is a folder on the storage pool, using Node's built-in `node:sqlite`. We considered loose JSON files (what sessions use today), which have no queries, so listing, searching and totalling would mean reading everything, and need hand-written write queues; and `better-sqlite3`, which is the more mature binding but needs a native build in the image and on every machine. `node:sqlite` has no native build and is enough for one gateway process, at the cost of being marked experimental (it prints a warning and its interface could change; the gateway pins its Node version in the image).

Conversations stay append-only sequences of numbered events with ids a client can mint, so a local-first client that syncs events could be added later without changing the storage. Existing JSON sessions are imported once.

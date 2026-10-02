#!/bin/sh
set -eu

# Migrations and seeding run here rather than inside the server, so a schema
# failure stops the container with the migration's own error instead of a
# confusing stream of query failures once it is already listening.

echo "tapedeck: applying migrations"
npm run --silent db:migrate

# Seeds only when the trades table is empty. The reviewer will run
# `docker compose up` more than once and a double-seeded blotter reads as a bug.
echo "tapedeck: seeding if empty"
npm run --silent db:seed

echo "tapedeck: starting the api"
# exec node directly rather than `npm run start`, so Fastify is PID 1 and
# receives SIGTERM itself. Through npm the signal reaches a wrapper and
# `docker compose down` becomes a ten second kill instead of a clean shutdown.
exec node --import tsx backend/src/server.ts

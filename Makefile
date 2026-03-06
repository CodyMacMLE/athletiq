ROOT := $(shell pwd)

.PHONY: dev dev-backend dev-web dev-mobile docker-up docker-down docker-build dev-seed

# Start all three services in separate Terminal windows
dev:
	@osascript \
		-e 'tell application "Terminal"' \
		-e '  do script "cd $(ROOT)/Backend && npm run dev"' \
		-e '  do script "cd $(ROOT)/Frontend/Web && npm run dev"' \
		-e '  do script "cd $(ROOT)/Frontend/Mobile && npx expo start"' \
		-e 'end tell'
	@echo "Opening Backend (port 4000), Web (port 3000), and Mobile (Expo) in Terminal."

dev-backend:
	cd Backend && npm run dev

dev-web:
	cd Frontend/Web && npm run dev

dev-mobile:
	cd Frontend/Mobile && npx expo start

# ── Docker dev environment ───────────────────────────────────────────────────

docker-up:
	docker compose -f docker-compose.dev.yml up

docker-build:
	docker compose -f docker-compose.dev.yml up --build

docker-down:
	docker compose -f docker-compose.dev.yml down

# Seed local Docker postgres from production RDS.
# Requires pg_dump: brew install libpq && brew link --force libpq
dev-seed:
	@bash $(ROOT)/scripts/seed-from-prod.sh

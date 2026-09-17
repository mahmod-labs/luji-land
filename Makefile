.PHONY: up down test

# --wait blocks until every healthcheck passes (or fails), so `make up`
# returns only once the plane is actually ready.
up:
	docker compose up -d --wait

down:
	docker compose down

# Each service's checks run in its own built image — the same artifact that
# ships, no host toolchain, no mocked infra. (Testcontainers suites land with
# the slices that need them.)
test:
	docker compose build directory
	docker compose run --rm --no-deps directory node dist/config.spec.js
	cd services/care-records && uv run pytest tests/

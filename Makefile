.PHONY: up down

# --wait blocks until every healthcheck passes (or fails), so `make up`
# returns only once the plane is actually ready.
up:
	docker compose up -d --wait

down:
	docker compose down

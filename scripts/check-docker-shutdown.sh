#!/usr/bin/env bash
# Checks how the running Compose `app` service shuts down with a stream open, which only the
# production server can show. Used by CI's docker job; leaves the app stopped.
set -euo pipefail

export COMPOSE_PROFILES=app
base="http://localhost:${APP_PORT:-3000}"
output=$(mktemp)
trap 'rm -f "$output"' EXIT

# Longer than the app's own deadline, so a 137 means the app did not exit by itself.
STOP_TIMEOUT_SECONDS=30

ready_count() {
  grep -c '^event: ready' "$output" || true
}

wait_for_first_ready() {
  for _ in $(seq 100); do
    [ "$(ready_count)" -ge 1 ] && return 0
    sleep 0.1
  done
  echo "The stream never became ready" >&2
  return 1
}

# Stops the app and fails unless it exited by itself within the given time.
stop_and_check() {
  local name=$1 max_ms=$2 container started elapsed_ms exit_code
  container=$(docker compose ps --all --quiet app)
  started=$(date +%s%N)
  docker compose stop --timeout "$STOP_TIMEOUT_SECONDS" app 2>/dev/null
  elapsed_ms=$((($(date +%s%N) - started) / 1000000))
  exit_code=$(docker inspect --format '{{.State.ExitCode}}' "$container")
  echo "$name: stopped in $elapsed_ms ms, exit $exit_code, $(ready_count) stream(s) ready"
  [ "$exit_code" = 143 ] || { echo "Expected exit 143" >&2; return 1; }
  [ "$elapsed_ms" -lt "$max_ms" ] || { echo "Expected under $max_ms ms" >&2; return 1; }
}

room=$(curl --fail --silent --show-error "$base/api/rooms" \
  --header 'content-type: application/json' --data '{"lat":44.43,"lng":26.1}' | jq --raw-output .id)
stream="$base/api/rooms/$room/stream"

# curl closes its connection when the stream ends, so only closing the streams can make this quick;
# the app's 2 s deadline would be too late.
curl --fail --silent --no-buffer "$stream" > "$output" &
wait_for_first_ready
stop_and_check "Stream that does not reconnect" 1500

docker compose start app 2>/dev/null
for _ in $(seq 30); do
  curl --fail --silent --output /dev/null "$base/health" && break
  sleep 1
done

# A browser reconnects, on the connection it already has. Here only the deadline can end it.
: > "$output"
curl --fail --silent --no-buffer "$stream" --next --fail --silent --no-buffer "$stream" > "$output" || true &
wait_for_first_ready
stop_and_check "Stream that reconnects on its connection" 5000
[ "$(ready_count)" = 2 ] || { echo "Expected the stream to reopen during shutdown" >&2; exit 1; }

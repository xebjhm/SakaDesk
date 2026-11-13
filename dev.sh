#!/bin/bash
# SakaDesk Development Server Script
# Usage: ./dev.sh [start|stop|restart|status]

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_PORT=8000
FRONTEND_PORT=5173
BACKEND_LOG="/tmp/sakadesk-backend.log"
FRONTEND_LOG="/tmp/sakadesk-frontend.log"

# One API token per launch (security audit 2026-11-13). 'start' and 'restart'
# draw a fresh token every time (ensure_api_token) and overwrite the git-ignored
# .dev-api-token (mode 600), so an old URL in the browser history stops working.
# An exported SAKADESK_API_TOKEN is used instead, unchanged (manual override).
# The browser gets the token only through the app URL's #t= fragment, which this
# script prints to the terminal (never to a log file). The rule matches the
# page's (frontend/src/core/api/launchAuth.ts): 16-128 of A-Z a-z 0-9 _ -.
TOKEN_FILE="$SCRIPT_DIR/.dev-api-token"
token_is_valid() {
    [[ "$1" =~ ^[A-Za-z0-9_-]{16,128}$ ]]
}
ensure_api_token() {
    if [ -n "${SAKADESK_API_TOKEN:-}" ]; then
        if ! token_is_valid "$SAKADESK_API_TOKEN"; then
            echo "ERROR: SAKADESK_API_TOKEN must be 16-128 characters of A-Z, a-z, 0-9, _ or -." >&2
            echo "       Unset it to use the generated .dev-api-token instead." >&2
            return 1
        fi
    else
        local token=""
        rm -f "$TOKEN_FILE"
        if ! (umask 077 && uv run python -c "import secrets; print(secrets.token_urlsafe(32))" > "$TOKEN_FILE"); then
            rm -f "$TOKEN_FILE"
            echo "ERROR: could not generate the dev API token (.dev-api-token)." >&2
            return 1
        fi
        token="$(tr -d '[:space:]' < "$TOKEN_FILE")"
        if ! token_is_valid "$token"; then
            rm -f "$TOKEN_FILE"
            echo "ERROR: the generated dev API token (.dev-api-token) is invalid." >&2
            return 1
        fi
        SAKADESK_API_TOKEN="$token"
    fi
    export SAKADESK_API_TOKEN
}

# The dev app URL. It carries the token: print it to the terminal only.
app_url() {
    echo "http://127.0.0.1:$FRONTEND_PORT/#t=$SAKADESK_API_TOKEN"
}

# Cross-platform port helpers (lsof works on macOS and Linux; fuser is Linux-only)
kill_port() {
    local pids
    pids=$(lsof -ti "tcp:$1" 2>/dev/null)
    [ -n "$pids" ] && echo "$pids" | xargs kill 2>/dev/null || true
}

port_in_use() {
    lsof -ti "tcp:$1" >/dev/null 2>&1
}

# Needs SAKADESK_API_TOKEN from ensure_api_token (called once per start/restart).
start_backend() {
    if [ -z "${SAKADESK_API_TOKEN:-}" ]; then
        echo "ERROR: no API token prepared for the backend." >&2
        return 1
    fi
    echo "Starting backend on port $BACKEND_PORT..."
    cd "$SCRIPT_DIR"
    # Keep-alive must match KEEP_ALIVE_TIMEOUT_S in desktop.py (outlast the
    # browser's 300 s idle sockets so the server never closes a reused one).
    nohup uv run uvicorn backend.main:app --port $BACKEND_PORT --reload \
        --timeout-keep-alive 600 > "$BACKEND_LOG" 2>&1 &
    echo $! > /tmp/sakadesk-backend.pid
    sleep 2
    if curl -s "http://127.0.0.1:$BACKEND_PORT/health" > /dev/null 2>&1; then
        echo "Backend started successfully"
    else
        echo "Backend starting... (check $BACKEND_LOG for details)"
    fi
}

start_frontend() {
    echo "Starting frontend on port $FRONTEND_PORT..."
    cd "$SCRIPT_DIR/frontend"
    # Vite binds 127.0.0.1 (vite.config.ts) and never reads the token.
    nohup npm run dev -- --port $FRONTEND_PORT --strictPort > "$FRONTEND_LOG" 2>&1 &
    echo $! > /tmp/sakadesk-frontend.pid
    sleep 3
    if curl -s "http://127.0.0.1:$FRONTEND_PORT/" > /dev/null 2>&1; then
        echo "Frontend started on http://127.0.0.1:$FRONTEND_PORT"
    else
        echo "Frontend starting... (check $FRONTEND_LOG for details)"
    fi
}

# Terminal only (not redirected): the URL carries this run's API token.
show_app_url() {
    echo "Open SakaDesk: $(app_url)"
    echo "(The backend has a new token: reopen the app tab with this URL; an old tab gets 401 on changes.)"
}

stop_backend() {
    echo "Stopping backend..."
    kill_port $BACKEND_PORT
    [ -f /tmp/sakadesk-backend.pid ] && kill $(cat /tmp/sakadesk-backend.pid) 2>/dev/null
    rm -f /tmp/sakadesk-backend.pid
    echo "Backend stopped"
}

stop_frontend() {
    echo "Stopping frontend..."
    kill_port $FRONTEND_PORT
    [ -f /tmp/sakadesk-frontend.pid ] && kill $(cat /tmp/sakadesk-frontend.pid) 2>/dev/null
    rm -f /tmp/sakadesk-frontend.pid
    echo "Frontend stopped"
}

status() {
    echo "=== SakaDesk Dev Server Status ==="
    if port_in_use $BACKEND_PORT; then
        echo "Backend:  RUNNING on port $BACKEND_PORT"
    else
        echo "Backend:  STOPPED"
    fi
    if port_in_use $FRONTEND_PORT; then
        echo "Frontend: RUNNING on port $FRONTEND_PORT"
    else
        echo "Frontend: STOPPED"
    fi
    echo ""
    echo "Logs:"
    echo "  Backend:  $BACKEND_LOG"
    echo "  Frontend: $FRONTEND_LOG"
}

case "${1:-start}" in
    start|restart)
        # Draw this launch's token (or validate the exported one) before
        # stopping anything that is running; the backend restarts with it.
        ensure_api_token || exit 1
        stop_backend
        stop_frontend
        sleep 1
        start_backend || exit 1
        start_frontend || exit 1
        echo ""
        if [ "$1" = "restart" ]; then
            echo "=== Dev servers restarted ==="
        else
            echo "=== Dev servers started ==="
        fi
        echo "Frontend: http://127.0.0.1:$FRONTEND_PORT"
        echo "Backend:  http://127.0.0.1:$BACKEND_PORT"
        show_app_url
        ;;
    stop)
        stop_backend
        stop_frontend
        ;;
    status)
        status
        ;;
    *)
        echo "Usage: $0 {start|stop|restart|status}"
        exit 1
        ;;
esac

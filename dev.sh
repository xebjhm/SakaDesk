#!/bin/bash
# SakaDesk Development Server Script
# Usage: ./dev.sh [start|stop|restart|status]

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_PORT=8000
FRONTEND_PORT=5173
BACKEND_LOG="/tmp/sakadesk-backend.log"
FRONTEND_LOG="/tmp/sakadesk-frontend.log"

# One per-launch API token shared by the backend and the Vite proxy
# (security audit 2026-11-13). Kept in a git-ignored file so restarting only
# one side keeps them in sync.
TOKEN_FILE="$SCRIPT_DIR/.dev-api-token"
ensure_api_token() {
    if [ -z "${SAKADESK_API_TOKEN:-}" ]; then
        if [ ! -s "$TOKEN_FILE" ]; then
            (umask 077 && uv run python -c "import secrets; print(secrets.token_urlsafe(32))" > "$TOKEN_FILE")
        fi
        SAKADESK_API_TOKEN="$(tr -d '[:space:]' < "$TOKEN_FILE")"
    fi
    export SAKADESK_API_TOKEN
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

start_backend() {
    ensure_api_token
    echo "Starting backend on port $BACKEND_PORT..."
    cd "$SCRIPT_DIR"
    # Keep-alive must match KEEP_ALIVE_TIMEOUT_S in desktop.py (outlast the
    # browser's 300 s idle sockets so the server never closes a reused one).
    nohup uv run uvicorn backend.main:app --port $BACKEND_PORT --reload \
        --timeout-keep-alive 600 > "$BACKEND_LOG" 2>&1 &
    echo $! > /tmp/sakadesk-backend.pid
    sleep 2
    if curl -s "http://localhost:$BACKEND_PORT/health" > /dev/null 2>&1; then
        echo "Backend started successfully"
    else
        echo "Backend starting... (check $BACKEND_LOG for details)"
    fi
}

start_frontend() {
    ensure_api_token
    echo "Starting frontend on port $FRONTEND_PORT..."
    cd "$SCRIPT_DIR/frontend"
    nohup npm run dev -- --port $FRONTEND_PORT --strictPort > "$FRONTEND_LOG" 2>&1 &
    echo $! > /tmp/sakadesk-frontend.pid
    sleep 3
    echo "Frontend started on http://localhost:$FRONTEND_PORT"
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
    start)
        stop_backend
        stop_frontend
        sleep 1
        start_backend
        start_frontend
        echo ""
        echo "=== Dev servers started ==="
        echo "Frontend: http://localhost:$FRONTEND_PORT"
        echo "Backend:  http://localhost:$BACKEND_PORT"
        ;;
    stop)
        stop_backend
        stop_frontend
        ;;
    restart)
        stop_backend
        stop_frontend
        sleep 1
        start_backend
        start_frontend
        echo ""
        echo "=== Dev servers restarted ==="
        echo "Frontend: http://localhost:$FRONTEND_PORT"
        echo "Backend:  http://localhost:$BACKEND_PORT"
        ;;
    status)
        status
        ;;
    *)
        echo "Usage: $0 {start|stop|restart|status}"
        exit 1
        ;;
esac

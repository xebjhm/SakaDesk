#!/bin/bash
# ZakaDesk Development Server Script
# Usage: ./dev.sh [start|stop|restart|status]

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_PORT=8000
FRONTEND_PORT=5173
BACKEND_LOG="/tmp/zakadesk-backend.log"
FRONTEND_LOG="/tmp/zakadesk-frontend.log"

start_backend() {
    echo "Starting backend on port $BACKEND_PORT..."
    cd "$SCRIPT_DIR"
    nohup uv run uvicorn backend.main:app --port $BACKEND_PORT --reload > "$BACKEND_LOG" 2>&1 &
    echo $! > /tmp/zakadesk-backend.pid
    sleep 2
    if curl -s "http://localhost:$BACKEND_PORT/api/health" > /dev/null 2>&1; then
        echo "Backend started successfully"
    else
        echo "Backend starting... (check $BACKEND_LOG for details)"
    fi
}

start_frontend() {
    echo "Starting frontend on port $FRONTEND_PORT..."
    cd "$SCRIPT_DIR/frontend"
    nohup npm run dev -- --port $FRONTEND_PORT --strictPort > "$FRONTEND_LOG" 2>&1 &
    echo $! > /tmp/zakadesk-frontend.pid
    sleep 3
    echo "Frontend started on http://localhost:$FRONTEND_PORT"
}

stop_backend() {
    echo "Stopping backend..."
    fuser -k $BACKEND_PORT/tcp 2>/dev/null || true
    [ -f /tmp/zakadesk-backend.pid ] && kill $(cat /tmp/zakadesk-backend.pid) 2>/dev/null
    rm -f /tmp/zakadesk-backend.pid
    echo "Backend stopped"
}

stop_frontend() {
    echo "Stopping frontend..."
    fuser -k $FRONTEND_PORT/tcp 2>/dev/null || true
    [ -f /tmp/zakadesk-frontend.pid ] && kill $(cat /tmp/zakadesk-frontend.pid) 2>/dev/null
    rm -f /tmp/zakadesk-frontend.pid
    echo "Frontend stopped"
}

status() {
    echo "=== ZakaDesk Dev Server Status ==="
    if fuser $BACKEND_PORT/tcp 2>/dev/null | grep -q .; then
        echo "Backend:  RUNNING on port $BACKEND_PORT"
    else
        echo "Backend:  STOPPED"
    fi
    if fuser $FRONTEND_PORT/tcp 2>/dev/null | grep -q .; then
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

"""ApiNoStoreMiddleware: no-store on API JSON only, everything else untouched."""

from fastapi import FastAPI
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.testclient import TestClient

from backend.api_no_store import ApiNoStoreMiddleware
from backend.main import app as real_app


def _build_app(tmp_path) -> FastAPI:
    image = tmp_path / "a.png"
    image.write_bytes(b"\x89PNG-bytes")
    app = FastAPI()
    app.add_middleware(ApiNoStoreMiddleware)

    @app.get("/api/json")
    async def json_route():
        return {"ok": True}

    @app.get("/api/json-cached")
    async def json_cached():
        return JSONResponse({"ok": True}, headers={"Cache-Control": "max-age=60"})

    @app.get("/api/json-etag")
    async def json_etag():
        return JSONResponse({"ok": True}, headers={"cache-control": "no-cache"})

    @app.get("/api/avatar")
    async def avatar():
        return FileResponse(
            image,
            media_type="image/png",
            headers={"Cache-Control": "public, max-age=604800"},
        )

    @app.get("/api/media-uncached")
    async def media_uncached():
        return FileResponse(image, media_type="image/png")

    @app.get("/api/stream")
    async def stream():
        async def chunks():
            yield b"abc"
            yield b"def"

        return StreamingResponse(
            chunks(),
            media_type="video/mp4",
            headers={"Cache-Control": "private, max-age=3600"},
        )

    @app.get("/other.json")
    async def other():
        return {"ok": True}

    return app


def test_api_json_gets_no_store(tmp_path):
    res = TestClient(_build_app(tmp_path)).get("/api/json")
    assert res.headers["cache-control"] == "no-store"
    assert res.json() == {"ok": True}


def test_existing_cache_control_is_preserved(tmp_path):
    client = TestClient(_build_app(tmp_path))
    assert client.get("/api/json-cached").headers["cache-control"] == "max-age=60"
    assert client.get("/api/json-etag").headers["cache-control"] == "no-cache"


def test_non_api_path_is_untouched(tmp_path):
    res = TestClient(_build_app(tmp_path)).get("/other.json")
    assert "cache-control" not in res.headers


def test_avatar_keeps_its_cache_header(tmp_path):
    res = TestClient(_build_app(tmp_path)).get("/api/avatar")
    assert res.headers["cache-control"] == "public, max-age=604800"
    assert res.content == b"\x89PNG-bytes"


def test_non_json_without_cache_control_is_not_given_one(tmp_path):
    res = TestClient(_build_app(tmp_path)).get("/api/media-uncached")
    assert "cache-control" not in res.headers


def test_streaming_response_keeps_header_and_body(tmp_path):
    res = TestClient(_build_app(tmp_path)).get("/api/stream")
    assert res.headers["cache-control"] == "private, max-age=3600"
    assert res.content == b"abcdef"


def test_real_app_api_json_is_no_store():
    res = TestClient(real_app).get("/api/version")
    assert res.headers["cache-control"] == "no-store"

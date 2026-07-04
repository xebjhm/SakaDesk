def test_runtime_status_endpoint(client):
    resp = client.get("/api/ai/runtime/status")
    assert resp.status_code == 200
    body = resp.json()
    assert set(body) >= {"state", "host", "bytesDone", "bytesTotal", "reason"}
    assert body["state"] in ("idle", "downloading", "verifying", "extracting", "done", "error", "cancelled")

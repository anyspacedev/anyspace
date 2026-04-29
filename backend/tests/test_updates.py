def test_update_check_returns_204(client):
    r = client.get("/updates/linux/x86_64/0.0.1")
    assert r.status_code == 204
    assert r.text == ""


def test_update_check_handles_macos(client):
    r = client.get("/updates/darwin/aarch64/0.1.0")
    assert r.status_code == 204

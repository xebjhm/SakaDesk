"""Extended tests for blogs API endpoints beyond basic coverage."""

from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

from fastapi.testclient import TestClient

from backend.main import app

client = TestClient(app)


class TestGetRecentPosts:
    """Tests for GET /api/blogs/recent."""

    def test_recent_missing_service(self):
        """Missing service returns 422."""
        response = client.get("/api/blogs/recent")
        assert response.status_code == 422

    def test_recent_invalid_service(self):
        """Invalid service returns 400."""
        response = client.get("/api/blogs/recent?service=invalid_service")
        assert response.status_code == 400

    @patch("backend.api.blogs.blog_service")
    def test_recent_success(self, mock_svc):
        """Returns recent posts."""
        mock_svc.get_recent_posts = AsyncMock(return_value=[
            {
                "id": "post1",
                "title": "Test Blog",
                "published_at": "2025-01-01T00:00:00Z",
                "url": "https://example.com/blog/1",
                "thumbnail": None,
                "member_id": "100",
                "member_name": "Test Member",
            }
        ])
        response = client.get("/api/blogs/recent?service=hinatazaka46&limit=10")
        assert response.status_code == 200
        data = response.json()
        assert data["service"] == "hinatazaka46"
        assert len(data["posts"]) == 1
        assert data["posts"][0]["id"] == "post1"

    @patch("backend.api.blogs.blog_service")
    def test_recent_with_member_ids(self, mock_svc):
        """Filters by comma-separated member IDs."""
        mock_svc.get_recent_posts = AsyncMock(return_value=[])
        response = client.get("/api/blogs/recent?service=hinatazaka46&member_ids=1,2,3")
        assert response.status_code == 200
        call_args = mock_svc.get_recent_posts.call_args
        assert call_args[0][2] == ["1", "2", "3"]  # member_id_list

    @patch("backend.api.blogs.blog_service")
    def test_recent_internal_error(self, mock_svc):
        """Returns 500 on internal error."""
        mock_svc.get_recent_posts = AsyncMock(side_effect=RuntimeError("db error"))
        response = client.get("/api/blogs/recent?service=hinatazaka46")
        assert response.status_code == 500


class TestGetBlogMembers:
    """Tests for GET /api/blogs/members."""

    @patch("backend.api.blogs.blog_service")
    def test_blog_members_success(self, mock_svc):
        """Returns member list."""
        mock_svc.get_blog_members = AsyncMock(return_value={
            "100": "Member A",
            "101": "Member B",
        })
        response = client.get("/api/blogs/members?service=hinatazaka46")
        assert response.status_code == 200
        data = response.json()
        assert data["service"] == "hinatazaka46"
        assert len(data["members"]) == 2

    @patch("backend.api.blogs.blog_service")
    def test_blog_members_error(self, mock_svc):
        """Returns 500 on error."""
        mock_svc.get_blog_members = AsyncMock(side_effect=RuntimeError("fail"))
        response = client.get("/api/blogs/members?service=hinatazaka46")
        assert response.status_code == 500


class TestGetMembersWithThumbnails:
    """Tests for GET /api/blogs/members-with-thumbnails."""

    def test_members_thumbnails_missing_service(self):
        """Missing service returns 422."""
        response = client.get("/api/blogs/members-with-thumbnails")
        assert response.status_code == 422

    def test_members_thumbnails_invalid_service(self):
        """Invalid service returns 400."""
        response = client.get("/api/blogs/members-with-thumbnails?service=bad_svc")
        assert response.status_code == 400

    @patch("backend.api.blogs.blog_service")
    def test_members_thumbnails_success(self, mock_svc):
        """Returns members with thumbnail paths."""
        mock_svc.get_members_with_thumbnails = AsyncMock(return_value=[
            {"id": "100", "name": "Member A", "thumbnail": "/path/to/thumb.jpg"},
        ])
        response = client.get("/api/blogs/members-with-thumbnails?service=hinatazaka46")
        assert response.status_code == 200
        data = response.json()
        assert len(data["members"]) == 1
        assert data["members"][0]["thumbnail"] == "/path/to/thumb.jpg"

    @patch("backend.api.blogs.blog_service")
    def test_members_thumbnails_error(self, mock_svc):
        """Returns 500 on error."""
        mock_svc.get_members_with_thumbnails = AsyncMock(side_effect=RuntimeError("fail"))
        response = client.get("/api/blogs/members-with-thumbnails?service=hinatazaka46")
        assert response.status_code == 500


class TestGetMemberThumbnail:
    """Tests for GET /api/blogs/member-thumbnail/{service}/{member_id}."""

    def test_thumbnail_invalid_service(self):
        """Invalid service returns 400."""
        response = client.get("/api/blogs/member-thumbnail/invalid_service/100")
        assert response.status_code == 400

    @patch("backend.api.blogs.blog_service")
    def test_thumbnail_not_found(self, mock_svc):
        """Returns 404 when thumbnail does not exist."""
        mock_svc.get_member_thumbnail_path = MagicMock(return_value=None)
        response = client.get("/api/blogs/member-thumbnail/hinatazaka46/100")
        assert response.status_code == 404

    @patch("backend.api.blogs.blog_service")
    def test_thumbnail_success(self, mock_svc, tmp_path):
        """Serves thumbnail file."""
        thumb = tmp_path / "thumb.jpg"
        thumb.write_bytes(b"\xff\xd8\xff\xe0")  # JPEG header
        mock_svc.get_member_thumbnail_path = MagicMock(return_value=thumb)
        response = client.get("/api/blogs/member-thumbnail/hinatazaka46/100")
        assert response.status_code == 200
        assert "image/jpeg" in response.headers.get("content-type", "")

    @patch("backend.api.blogs.blog_service")
    def test_thumbnail_png(self, mock_svc, tmp_path):
        """Serves PNG thumbnail with correct media type."""
        thumb = tmp_path / "thumb.png"
        thumb.write_bytes(b"\x89PNG")
        mock_svc.get_member_thumbnail_path = MagicMock(return_value=thumb)
        response = client.get("/api/blogs/member-thumbnail/hinatazaka46/100")
        assert response.status_code == 200
        assert "image/png" in response.headers.get("content-type", "")


class TestGetBlogList:
    """Tests for GET /api/blogs/list."""

    def test_blog_list_missing_params(self):
        """Missing parameters returns 422."""
        response = client.get("/api/blogs/list")
        assert response.status_code == 422

    @patch("backend.api.blogs.blog_service")
    def test_blog_list_success(self, mock_svc):
        """Returns blog list for a member."""
        mock_svc.get_blog_list = AsyncMock(return_value={
            "member_id": "100",
            "member_name": "Test",
            "blogs": [
                {"id": "b1", "title": "Blog 1", "published_at": "2025-01-01", "url": "u1", "cached": True},
            ],
        })
        response = client.get("/api/blogs/list?service=hinatazaka46&member_id=100")
        assert response.status_code == 200
        data = response.json()
        assert len(data["blogs"]) == 1

    @patch("backend.api.blogs.blog_service")
    def test_blog_list_error(self, mock_svc):
        """Returns 500 on error."""
        mock_svc.get_blog_list = AsyncMock(side_effect=RuntimeError("fail"))
        response = client.get("/api/blogs/list?service=hinatazaka46&member_id=100")
        assert response.status_code == 500


class TestGetBlogContent:
    """Tests for GET /api/blogs/content."""

    def test_blog_content_missing_params(self):
        """Missing parameters returns 422."""
        response = client.get("/api/blogs/content")
        assert response.status_code == 422

    @patch("backend.api.blogs.blog_service")
    def test_blog_content_success(self, mock_svc):
        """Returns blog content."""
        mock_svc.get_blog_content = AsyncMock(return_value={
            "meta": {
                "id": "b1",
                "member_name": "Member",
                "title": "Title",
                "published_at": "2025-01-01",
                "url": "https://example.com",
            },
            "content": {"html": "<p>Hello</p>"},
            "images": [],
        })
        response = client.get("/api/blogs/content?service=hinatazaka46&blog_id=b1")
        assert response.status_code == 200
        data = response.json()
        assert data["content"]["html"] == "<p>Hello</p>"

    @patch("backend.api.blogs.blog_service")
    def test_blog_content_not_found(self, mock_svc):
        """Returns 404 when blog is not found."""
        mock_svc.get_blog_content = AsyncMock(side_effect=ValueError("Blog not found"))
        response = client.get("/api/blogs/content?service=hinatazaka46&blog_id=missing")
        assert response.status_code == 404

    @patch("backend.api.blogs.blog_service")
    def test_blog_content_invalid_service(self, mock_svc):
        """Returns 400 for invalid service in content lookup."""
        mock_svc.get_blog_content = AsyncMock(
            side_effect=ValueError("Invalid service: bad_svc")
        )
        response = client.get("/api/blogs/content?service=hinatazaka46&blog_id=b1")
        assert response.status_code == 400


class TestCacheStats:
    """Tests for GET /api/blogs/cache-stats."""

    def test_cache_stats_missing_service(self):
        """Missing service returns 422."""
        response = client.get("/api/blogs/cache-stats")
        assert response.status_code == 422

    def test_cache_stats_invalid_service(self):
        """Invalid service returns 400."""
        response = client.get("/api/blogs/cache-stats?service=invalid_service")
        assert response.status_code == 400

    @patch("backend.api.blogs.blog_service")
    def test_cache_stats_success(self, mock_svc):
        """Returns cache statistics."""
        mock_svc.get_cache_stats = AsyncMock(return_value={
            "total_blogs": 100,
            "cached_blogs": 50,
            "removed_count": 5,
        })
        response = client.get("/api/blogs/cache-stats?service=hinatazaka46")
        assert response.status_code == 200
        data = response.json()
        assert data["total_blogs"] == 100


class TestBlogBackup:
    """Tests for blog backup endpoints."""

    @patch("backend.api.blogs.get_blog_backup_manager")
    def test_backup_status(self, mock_mgr):
        """Returns running backup services."""
        manager = MagicMock()
        manager.running_services.return_value = ["hinatazaka46"]
        mock_mgr.return_value = manager
        response = client.get("/api/blogs/backup/status")
        assert response.status_code == 200
        data = response.json()
        assert data["running"]["hinatazaka46"] is True

    @patch("backend.api.blogs.get_blog_backup_manager")
    def test_backup_start_success(self, mock_mgr):
        """Starts backup for specified services."""
        manager = MagicMock()
        mock_mgr.return_value = manager
        response = client.post("/api/blogs/backup/start?services=hinatazaka46&services=sakurazaka46")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "started"
        manager.start.assert_called_once_with(["hinatazaka46", "sakurazaka46"])

    def test_backup_start_invalid_service(self):
        """Returns 400 for invalid service."""
        response = client.post("/api/blogs/backup/start?services=invalid_service")
        assert response.status_code == 400

    @patch("backend.api.blogs.get_blog_backup_manager")
    def test_backup_stop_specific(self, mock_mgr):
        """Stops backup for specified services."""
        manager = MagicMock()
        mock_mgr.return_value = manager
        response = client.post("/api/blogs/backup/stop?services=hinatazaka46")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "stopped"

    @patch("backend.api.blogs.get_blog_backup_manager")
    def test_backup_stop_all(self, mock_mgr):
        """Stops all backups when no services specified."""
        manager = MagicMock()
        mock_mgr.return_value = manager
        response = client.post("/api/blogs/backup/stop")
        assert response.status_code == 200
        data = response.json()
        assert "all" in data["services"]


class TestSyncBlogMetadata:
    """Tests for POST /api/blogs/sync."""

    def test_sync_missing_service(self):
        """Missing service returns 422."""
        response = client.post("/api/blogs/sync")
        assert response.status_code == 422

    def test_sync_invalid_service(self):
        """Invalid service returns 400."""
        response = client.post("/api/blogs/sync?service=bad_svc")
        assert response.status_code == 400

    @patch("backend.api.blogs.blog_service")
    def test_sync_success(self, mock_svc):
        """Returns sync stats on success."""
        mock_svc.sync_blog_metadata = AsyncMock(return_value={
            "members": {
                "100": {"name": "A", "blogs": [{"id": "1"}, {"id": "2"}]},
                "101": {"name": "B", "blogs": [{"id": "3"}]},
            },
            "last_sync": "2025-01-01T00:00:00Z",
        })
        response = client.post("/api/blogs/sync?service=hinatazaka46")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "ok"
        assert data["total_members"] == 2
        assert data["total_blogs"] == 3

    @patch("backend.api.blogs.blog_service")
    def test_sync_error(self, mock_svc):
        """Returns 500 on error."""
        mock_svc.sync_blog_metadata = AsyncMock(side_effect=RuntimeError("network err"))
        response = client.post("/api/blogs/sync?service=hinatazaka46")
        assert response.status_code == 500


class TestProxyBlogImage:
    """Tests for GET /api/blogs/proxy-image."""

    def test_proxy_image_missing_url(self):
        """Missing URL returns 422."""
        response = client.get("/api/blogs/proxy-image")
        assert response.status_code == 422

    def test_proxy_image_forbidden_domain(self):
        """Disallowed domain returns 403."""
        response = client.get("/api/blogs/proxy-image?url=https://evil.com/img.jpg")
        assert response.status_code == 403

    @patch("httpx.AsyncClient")
    def test_proxy_image_allowed_domain(self, mock_httpx_cls):
        """Allowed domain proxies the image."""
        mock_response = MagicMock()
        mock_response.content = b"\xff\xd8\xff\xe0"
        mock_response.headers = {"content-type": "image/jpeg"}
        mock_response.raise_for_status = MagicMock()

        mock_client_inst = AsyncMock()
        mock_client_inst.get = AsyncMock(return_value=mock_response)
        mock_client_inst.__aenter__ = AsyncMock(return_value=mock_client_inst)
        mock_client_inst.__aexit__ = AsyncMock(return_value=None)
        mock_httpx_cls.return_value = mock_client_inst

        response = client.get(
            "/api/blogs/proxy-image?url=https://cdn.hinatazaka46.com/img.jpg"
        )
        assert response.status_code == 200


class TestServeBlogImage:
    """Tests for GET /api/blogs/image."""

    def test_image_missing_params(self):
        """Missing parameters returns 422."""
        response = client.get("/api/blogs/image")
        assert response.status_code == 422

    def test_image_invalid_service(self):
        """Invalid service returns 400."""
        response = client.get("/api/blogs/image?service=bad&blog_id=1&filename=img_1.jpg")
        assert response.status_code == 400

    def test_image_invalid_filename(self):
        """Invalid filename pattern returns 400."""
        response = client.get(
            "/api/blogs/image?service=hinatazaka46&blog_id=1&filename=../../etc/passwd"
        )
        assert response.status_code == 400

    @patch("backend.api.blogs.blog_service")
    def test_image_blog_not_found(self, mock_svc):
        """Returns 404 when blog not in index."""
        mock_svc.load_blog_index = AsyncMock(return_value={"members": {}})
        response = client.get(
            "/api/blogs/image?service=hinatazaka46&blog_id=missing&filename=img_1.jpg"
        )
        assert response.status_code == 404

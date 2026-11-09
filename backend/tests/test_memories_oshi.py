from unittest.mock import AsyncMock, patch

import pytest

from backend.services.memories import oshi


@pytest.mark.asyncio
async def test_resolves_blog_ids_to_normalized_names():
    with (
        patch.object(
            oshi,
            "load_config",
            AsyncMock(return_value={"oshi_members": {"hinatazaka46": ["12", "99"]}}),
        ),
        patch.object(
            oshi, "_blog_members", AsyncMock(return_value={"12": "金村 美玖"})
        ),
    ):
        assert await oshi.oshi_names("hinatazaka46") == {"金村美玖"}


@pytest.mark.asyncio
async def test_no_setting_is_empty():
    with patch.object(oshi, "load_config", AsyncMock(return_value={})):
        assert await oshi.oshi_names("hinatazaka46") == set()


@pytest.mark.asyncio
async def test_blog_members_failure_is_empty():
    with (
        patch.object(
            oshi, "load_config", AsyncMock(return_value={"oshi_members": {"s": ["1"]}})
        ),
        patch.object(oshi, "_blog_members", AsyncMock(return_value={})),
    ):
        assert await oshi.oshi_names("s") == set()


@pytest.mark.asyncio
async def test_blog_members_swallows_errors():
    class Boom:
        async def get_blog_members(self, service):
            raise RuntimeError("x")

    with patch.object(oshi, "BlogService", Boom):
        assert await oshi._blog_members("s") == {}

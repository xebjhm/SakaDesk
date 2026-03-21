"""Tests for adaptive_sync.py — pure functions for sync interval calculation."""

import random
from unittest.mock import patch


from backend.services.adaptive_sync import (
    JST_OFFSET,
    add_jitter,
    calculate_next_sync_interval,
    get_activity_multiplier,
    get_jst_hour,
    get_sync_interval_description,
    get_time_multiplier,
)


# ── JST_OFFSET constant ─────────────────────────────────────────────


def test_jst_offset_is_9_hours():
    assert JST_OFFSET.total_seconds() == 9 * 3600


# ── get_jst_hour ─────────────────────────────────────────────────────


class TestGetJstHour:
    """Tests for JST hour calculation."""

    def test_returns_int(self):
        result = get_jst_hour()
        assert isinstance(result, int)

    def test_in_valid_range(self):
        result = get_jst_hour()
        assert 0 <= result <= 23


# ── get_time_multiplier ─────────────────────────────────────────────


class TestGetTimeMultiplier:
    """Tests for time-of-day multiplier."""

    def test_peak_hours_20_21(self):
        for hour in [20, 21]:
            with patch(
                "backend.services.adaptive_sync.get_jst_hour", return_value=hour
            ):
                assert get_time_multiplier() == 0.5

    def test_peak_shoulder_19_22(self):
        for hour in [19, 22]:
            with patch(
                "backend.services.adaptive_sync.get_jst_hour", return_value=hour
            ):
                assert get_time_multiplier() == 0.55

    def test_evening_buildup_17_18(self):
        for hour in [17, 18]:
            with patch(
                "backend.services.adaptive_sync.get_jst_hour", return_value=hour
            ):
                assert get_time_multiplier() == 0.6

    def test_lunch_peak_12(self):
        with patch("backend.services.adaptive_sync.get_jst_hour", return_value=12):
            assert get_time_multiplier() == 0.6

    def test_daytime_active(self):
        for hour in [10, 11, 15, 16]:
            with patch(
                "backend.services.adaptive_sync.get_jst_hour", return_value=hour
            ):
                assert get_time_multiplier() <= 0.8

    def test_late_night_23(self):
        with patch("backend.services.adaptive_sync.get_jst_hour", return_value=23):
            assert get_time_multiplier() == 0.7

    def test_morning_ramp(self):
        with patch("backend.services.adaptive_sync.get_jst_hour", return_value=8):
            assert get_time_multiplier() == 1.0

    def test_early_morning_sparse(self):
        with patch("backend.services.adaptive_sync.get_jst_hour", return_value=7):
            assert get_time_multiplier() == 1.5

    def test_wind_down_0(self):
        with patch("backend.services.adaptive_sync.get_jst_hour", return_value=0):
            assert get_time_multiplier() == 2.0

    def test_dead_hours_1_to_6(self):
        for hour in [1, 2, 3, 4, 5, 6]:
            with patch(
                "backend.services.adaptive_sync.get_jst_hour", return_value=hour
            ):
                assert get_time_multiplier() == 3.0

    def test_returns_float(self):
        result = get_time_multiplier()
        assert isinstance(result, float)


# ── get_activity_multiplier ──────────────────────────────────────────


class TestGetActivityMultiplier:
    """Tests for the activity-based multiplier."""

    def test_none_returns_1(self):
        assert get_activity_multiplier(None) == 1.0

    def test_very_recent_under_1h(self):
        assert get_activity_multiplier(0.5) == 0.5

    def test_recent_1_to_3h(self):
        assert get_activity_multiplier(2.0) == 0.7

    def test_moderate_3_to_6h(self):
        assert get_activity_multiplier(4.0) == 0.9

    def test_normal_6_to_24h(self):
        assert get_activity_multiplier(12.0) == 1.0

    def test_inactive_24_to_72h(self):
        assert get_activity_multiplier(48.0) == 1.3

    def test_very_inactive_over_72h(self):
        assert get_activity_multiplier(100.0) == 1.5

    def test_boundary_exactly_1(self):
        assert get_activity_multiplier(1.0) == 0.7

    def test_boundary_exactly_3(self):
        assert get_activity_multiplier(3.0) == 0.9

    def test_boundary_exactly_6(self):
        assert get_activity_multiplier(6.0) == 1.0

    def test_boundary_exactly_24(self):
        assert get_activity_multiplier(24.0) == 1.3

    def test_boundary_exactly_72(self):
        assert get_activity_multiplier(72.0) == 1.5

    def test_zero_hours(self):
        assert get_activity_multiplier(0.0) == 0.5


# ── add_jitter ───────────────────────────────────────────────────────


class TestAddJitter:
    """Tests for the jitter function."""

    def test_returns_float(self):
        result = add_jitter(15.0)
        assert isinstance(result, float)

    def test_minimum_is_1(self):
        # Even with large negative jitter, minimum should be 1
        result = add_jitter(0.5, jitter_pct=0.99)
        assert result >= 1.0

    def test_stays_near_base(self):
        random.seed(42)
        results = [add_jitter(15.0) for _ in range(100)]
        avg = sum(results) / len(results)
        # Average should be near 15 (within +-20% tolerance)
        assert 12.0 <= avg <= 18.0

    def test_zero_jitter(self):
        result = add_jitter(10.0, jitter_pct=0.0)
        assert result == 10.0

    def test_custom_jitter_pct(self):
        random.seed(0)
        results = [add_jitter(100.0, jitter_pct=0.5) for _ in range(100)]
        # With 50% jitter, values should vary between 50 and 150
        assert min(results) < 100
        assert max(results) > 100

    def test_very_small_interval(self):
        result = add_jitter(1.0)
        assert result >= 1.0  # Minimum clamp


# ── calculate_next_sync_interval ─────────────────────────────────────


class TestCalculateNextSyncInterval:
    """Tests for the main interval calculation function."""

    def test_returns_float(self):
        result = calculate_next_sync_interval()
        assert isinstance(result, float)

    def test_no_randomization_returns_base(self):
        from backend.services.adaptive_sync import _ADAPTIVE_BASE_MINUTES

        result = calculate_next_sync_interval(enable_randomization=False)
        assert result == float(_ADAPTIVE_BASE_MINUTES)

    def test_clamped_minimum_5(self):
        # Very active member at peak time
        with patch(
            "backend.services.adaptive_sync.get_time_multiplier", return_value=0.5
        ):
            result = calculate_next_sync_interval(hours_since_last_post=0.1)
        assert result >= 5.0

    def test_clamped_maximum_60(self):
        # Inactive member at dead hours
        with patch(
            "backend.services.adaptive_sync.get_time_multiplier", return_value=3.0
        ):
            result = calculate_next_sync_interval(hours_since_last_post=200.0)
        assert result <= 60.0

    def test_with_activity_data(self):
        random.seed(42)
        with patch(
            "backend.services.adaptive_sync.get_time_multiplier", return_value=1.0
        ):
            result = calculate_next_sync_interval(hours_since_last_post=0.5)
        # 10 * 1.0 * 0.5 = 5.0 + jitter, clamped to [5, 60]
        assert 5.0 <= result <= 60.0

    def test_none_activity_data(self):
        random.seed(42)
        with patch(
            "backend.services.adaptive_sync.get_time_multiplier", return_value=1.0
        ):
            result = calculate_next_sync_interval(hours_since_last_post=None)
        # 10 * 1.0 * 1.0 = 10 + jitter
        assert 5.0 <= result <= 60.0


# ── get_sync_interval_description ────────────────────────────────────


class TestGetSyncIntervalDescription:
    """Tests for the human-readable interval descriptions."""

    def test_very_frequent(self):
        result = get_sync_interval_description(5.0)
        assert "Very frequent" in result

    def test_frequent(self):
        result = get_sync_interval_description(15.0)
        assert result == "Frequent"

    def test_normal(self):
        result = get_sync_interval_description(25.0)
        assert result == "Normal"

    def test_relaxed(self):
        result = get_sync_interval_description(40.0)
        assert result == "Relaxed"

    def test_infrequent(self):
        result = get_sync_interval_description(50.0)
        assert "Infrequent" in result

    def test_boundary_10(self):
        result = get_sync_interval_description(10.0)
        assert result == "Frequent"

    def test_boundary_20(self):
        result = get_sync_interval_description(20.0)
        assert result == "Normal"

    def test_boundary_30(self):
        result = get_sync_interval_description(30.0)
        assert result == "Relaxed"

    def test_boundary_45(self):
        result = get_sync_interval_description(45.0)
        assert "Infrequent" in result

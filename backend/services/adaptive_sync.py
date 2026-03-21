"""
Adaptive Sync Scheduler for SakaDesk.

Implements randomized sync intervals based on observed posting patterns.
Designed to avoid detection patterns while efficiently catching new messages.

Based on analysis of 13,132 messages from 21 active Hinatazaka46 members
over the past year (2025-03 to 2026-03):

Hourly distribution (JST):
  - Dead:       01:00-06:00  (<0.1% of messages)
  - Wake-up:    07:00-08:00  (4% combined)
  - Daytime:    09:00-14:00  (29%, with lunch peak at 12:00)
  - Afternoon:  15:00-18:00  (25%, building toward evening)
  - Peak:       19:00-22:00  (37%, with 20:00 at 13% alone)
  - Wind-down:  23:00-00:00  (6%)

Inter-message gap P90: 74 min overall, 43 min during peak, 97 min daytime.
Day-of-week distribution is flat (13-15% each), no adjustment needed.

All time calculations use JST (UTC+9) regardless of the user's timezone,
because the idols post on a Japan schedule.
"""

import random
import structlog
from datetime import datetime, timezone, timedelta
from typing import Optional

logger = structlog.get_logger(__name__)

# JST offset from UTC
JST_OFFSET = timedelta(hours=9)


def get_jst_hour() -> int:
    """Get current hour in JST (0-23)."""
    now_utc = datetime.now(timezone.utc)
    now_jst = now_utc + JST_OFFSET
    return now_jst.hour


# Time-of-day multipliers derived from actual posting data.
# Lower = more frequent syncs (high activity), higher = less frequent.
# Computed as: avg_hourly_messages / this_hour_messages, then smoothed
# and clamped to [0.5, 3.0].
_TIME_MULTIPLIERS = {
    0: 2.0,  # wind-down, very few posts
    1: 3.0,  # near-zero activity
    2: 3.0,  # dead
    3: 3.0,  # dead
    4: 3.0,  # dead
    5: 3.0,  # dead
    6: 3.0,  # dead
    7: 1.5,  # wake-up, sparse
    8: 1.0,  # morning ramp-up
    9: 0.9,  # daytime active
    10: 0.8,  # daytime active
    11: 0.7,  # approaching lunch peak
    12: 0.6,  # lunch peak
    13: 0.7,  # post-lunch
    14: 1.0,  # afternoon dip
    15: 0.7,  # afternoon active
    16: 0.7,  # afternoon active
    17: 0.6,  # evening build-up
    18: 0.6,  # evening build-up
    19: 0.55,  # peak starts
    20: 0.5,  # highest peak (13% of all messages)
    21: 0.5,  # peak
    22: 0.55,  # peak winding down
    23: 0.7,  # late night active
}


def get_time_multiplier() -> float:
    """
    Get sync frequency multiplier based on current time of day (JST).

    Returns a multiplier where:
    - Lower values = more frequent syncs (peak hours)
    - Higher values = less frequent syncs (off-hours)

    Uses JST regardless of user's timezone because the idols post
    on a Japan schedule.
    """
    return _TIME_MULTIPLIERS.get(get_jst_hour(), 1.0)


def get_activity_multiplier(hours_since_last_post: Optional[float]) -> float:
    """
    Get multiplier based on how recently a member posted.

    More recent activity = check more often

    Args:
        hours_since_last_post: Hours since member's last message, or None if unknown

    Returns:
        Multiplier (lower = more frequent)
    """
    if hours_since_last_post is None:
        return 1.0

    if hours_since_last_post < 1:
        # Very recent activity - check more often
        return 0.5

    if hours_since_last_post < 3:
        # Recent activity
        return 0.7

    if hours_since_last_post < 6:
        # Moderate activity
        return 0.9

    if hours_since_last_post < 24:
        # Normal
        return 1.0

    if hours_since_last_post < 72:
        # Inactive for a day or more
        return 1.3

    # Very inactive - check less often
    return 1.5


def add_jitter(interval_minutes: float, jitter_pct: float = 0.2) -> float:
    """
    Add random jitter to an interval.

    Args:
        interval_minutes: Base interval in minutes
        jitter_pct: Percentage of jitter (default 20%)

    Returns:
        Interval with jitter applied (in minutes)
    """
    jitter_range = interval_minutes * jitter_pct
    jitter = random.uniform(-jitter_range, jitter_range)
    return max(1, interval_minutes + jitter)  # Minimum 1 minute


_ADAPTIVE_BASE_MINUTES = 10
"""Fixed base interval for adaptive sync.

Hardcoded rather than derived from user settings.  The multipliers are
calibrated against this base to produce sensible intervals (5-60 min).
The user setting ``sync_interval_minutes`` is only used for fixed-interval
mode (when adaptive sync is disabled).
"""


def calculate_next_sync_interval(
    hours_since_last_post: Optional[float] = None,
    enable_randomization: bool = True,
) -> float:
    """
    Calculate the next sync interval with adaptive timing.

    Algorithm:
    1. Start with fixed base interval (10 minutes)
    2. Apply time-of-day multiplier (peak hours = more frequent)
    3. Apply activity multiplier (recent posts = more frequent)
    4. Add jitter (±20%) to avoid predictable patterns

    Resulting intervals:
      Peak (20:00 JST, recent post):  10 × 0.5 × 0.5 = ~5 min
      Daytime (10:00, normal):         10 × 0.8 × 1.0 = ~8 min
      Dead hours (03:00, inactive):    10 × 3.0 × 1.3 = ~39 min

    Args:
        hours_since_last_post: Hours since most recent member posted
        enable_randomization: Whether to apply adaptive timing

    Returns:
        Next sync interval in minutes
    """
    if not enable_randomization:
        return float(_ADAPTIVE_BASE_MINUTES)

    interval = float(_ADAPTIVE_BASE_MINUTES)

    # Apply time-of-day multiplier
    time_mult = get_time_multiplier()
    interval *= time_mult

    # Apply activity multiplier
    activity_mult = get_activity_multiplier(hours_since_last_post)
    interval *= activity_mult

    # Add jitter
    interval = add_jitter(interval)

    # Clamp to reasonable bounds
    # Minimum: 5 minutes (don't spam the server)
    # Maximum: 60 minutes (don't miss too much)
    interval = max(5, min(60, interval))

    logger.debug(
        "Calculated sync interval",
        interval_minutes=round(interval, 1),
        base=_ADAPTIVE_BASE_MINUTES,
        time_mult=time_mult,
        activity_mult=activity_mult,
    )

    return interval


def get_sync_interval_description(interval_minutes: float) -> str:
    """Get human-readable description of sync interval."""
    if interval_minutes < 10:
        return "Very frequent (peak activity)"
    if interval_minutes < 20:
        return "Frequent"
    if interval_minutes < 30:
        return "Normal"
    if interval_minutes < 45:
        return "Relaxed"
    return "Infrequent (low activity)"


# For testing - run with: uv run python -m backend.services.adaptive_sync
if __name__ == "__main__":
    import structlog

    # Configure structlog for console output during testing
    structlog.configure(
        processors=[
            structlog.dev.ConsoleRenderer(),
        ],
        wrapper_class=structlog.make_filtering_bound_logger(0),
        context_class=dict,
        logger_factory=structlog.PrintLoggerFactory(),
        cache_logger_on_first_use=False,
    )
    test_logger = structlog.get_logger("adaptive_sync_test")

    test_logger.info("Testing adaptive sync intervals")
    test_logger.info(
        "Current state", jst_hour=get_jst_hour(), time_multiplier=get_time_multiplier()
    )

    # Test various scenarios
    scenarios = [
        (None, "No activity data"),
        (0.5, "Posted 30 min ago"),
        (2.0, "Posted 2 hours ago"),
        (6.0, "Posted 6 hours ago"),
        (24.0, "Posted 24 hours ago"),
        (72.0, "Posted 3 days ago"),
    ]

    for hours, desc in scenarios:
        intervals = [calculate_next_sync_interval(hours) for _ in range(5)]
        avg = sum(intervals) / len(intervals)
        test_logger.info(
            desc, avg_minutes=f"{avg:.1f}", samples=[f"{i:.1f}" for i in intervals]
        )

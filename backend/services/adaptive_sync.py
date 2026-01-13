"""
Adaptive Sync Scheduler for HakoDesk.

Implements randomized sync intervals based on observed posting patterns.
Designed to avoid detection patterns while efficiently catching new messages.

Based on analysis of 19,873 messages from 24 members:
- Peak hours (JST): 19:00-23:00 (40% of messages)
- Low activity: 02:00-06:00 (almost zero)
- Most active members post every 1.5-3.5 hours
- Overall median interval: 4.7 hours
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


def get_time_multiplier() -> float:
    """
    Get sync frequency multiplier based on current time of day (JST).

    Returns a multiplier where:
    - Lower values = more frequent syncs (peak hours)
    - Higher values = less frequent syncs (off-hours)

    Based on observed posting patterns:
    - Peak: 19:00-23:00 (40% of messages) -> 0.6x
    - Active: 09:00-18:00 -> 0.8x
    - Quiet: 00:00-01:00 -> 1.2x
    - Dead: 02:00-06:00 -> 2.0x
    """
    hour = get_jst_hour()

    # Peak hours: 19:00-23:00
    if 19 <= hour <= 22:
        return 0.6

    # Late night active: 23:00
    if hour == 23:
        return 0.7

    # Early evening: 17:00-18:00
    if 17 <= hour <= 18:
        return 0.7

    # Daytime active: 09:00-16:00
    if 9 <= hour <= 16:
        return 0.8

    # Early morning start: 07:00-08:00
    if 7 <= hour <= 8:
        return 0.9

    # Late night wind-down: 00:00-01:00
    if hour in (0, 1):
        return 1.2

    # Dead hours: 02:00-06:00
    if 2 <= hour <= 6:
        return 2.0

    # Default
    return 1.0


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


def calculate_next_sync_interval(
    base_interval_minutes: float = 15.0,
    hours_since_last_post: Optional[float] = None,
    enable_randomization: bool = True,
) -> float:
    """
    Calculate the next sync interval with adaptive timing.

    Algorithm:
    1. Start with base interval (default 15 minutes)
    2. Apply time-of-day multiplier (peak hours = more frequent)
    3. Apply activity multiplier (recent posts = more frequent)
    4. Add jitter (±20%) to avoid predictable patterns

    Args:
        base_interval_minutes: Base sync interval in minutes
        hours_since_last_post: Hours since most recent member posted
        enable_randomization: Whether to apply adaptive timing

    Returns:
        Next sync interval in minutes
    """
    if not enable_randomization:
        return base_interval_minutes

    interval = base_interval_minutes

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
        f"Calculated sync interval: {interval:.1f}m "
        f"(base={base_interval_minutes}, time_mult={time_mult}, "
        f"activity_mult={activity_mult})"
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


# For testing
if __name__ == "__main__":
    print("Testing adaptive sync intervals...")
    print(f"Current JST hour: {get_jst_hour()}")
    print(f"Time multiplier: {get_time_multiplier()}")
    print()

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
        intervals = [calculate_next_sync_interval(15, hours) for _ in range(5)]
        avg = sum(intervals) / len(intervals)
        print(f"{desc}: avg={avg:.1f}m, samples={[f'{i:.1f}' for i in intervals]}")

"""Public keys that may sign SakaDesk updates.

Maps a key id (:func:`backend.services.release_signing.key_id`) to the raw
32-byte Ed25519 public key, base64-encoded. The private halves live only in
the ``release`` environment's Actions secrets and in the owner's offline
backup (CONTRIBUTING.md, "Release signing"). Keep at most two entries: the
current key and, while rotating, the next one.
"""

TRUSTED_RELEASE_KEYS: dict[str, str] = {
    "fce860001c1c746e": "PSX6UiYLFvxHR6xzdA6cB7Mm06jGKJyu7KMMeB9sNpc=",
}

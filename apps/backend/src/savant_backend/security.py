import base64
import hashlib
import hmac
import json
import secrets
import time
from collections import defaultdict, deque

from fastapi import Header, HTTPException

from savant_backend import config

AUTH_HEADER_NAME = "Authorization"
BOOTSTRAP_HEADER_NAME = config.AUTH_BOOTSTRAP_HEADER

RATE_LIMIT_STATE: dict[str, deque[float]] = defaultdict(deque)


def _b64url_encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode("utf-8").rstrip("=")


def _b64url_decode(raw: str) -> bytes:
    padding = "=" * (-len(raw) % 4)
    return base64.urlsafe_b64decode(f"{raw}{padding}".encode("utf-8"))


def normalize_owner_id(value: str | None) -> str:
    owner_id = (value or "").strip().lower()
    if not owner_id:
        raise HTTPException(status_code=401, detail="Unable to establish an authenticated user session")
    safe = "".join(char for char in owner_id if char.isalnum() or char in {"-", "_"})
    if not safe:
        raise HTTPException(status_code=400, detail="Invalid owner identifier")
    return safe[:120]


def generate_owner_id(client_hint: str | None = None) -> str:
    normalized_hint = normalize_owner_id(client_hint or "") if client_hint and client_hint.strip() else "anon"
    suffix = secrets.token_hex(8)
    return f"{normalized_hint}_{suffix}"


def _sign_payload(payload_b64: str) -> str:
    digest = hmac.new(config.AUTH_SECRET.encode("utf-8"), payload_b64.encode("utf-8"), hashlib.sha256).digest()
    return _b64url_encode(digest)


def create_access_token(owner_id: str) -> tuple[str, int]:
    issued_at = int(time.time())
    expires_at = issued_at + config.AUTH_TOKEN_TTL_SECONDS
    payload = {"sub": owner_id, "iat": issued_at, "exp": expires_at}
    payload_b64 = _b64url_encode(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
    signature = _sign_payload(payload_b64)
    return f"{payload_b64}.{signature}", expires_at


def decode_access_token(token: str) -> dict:
    try:
        payload_b64, signature = token.split(".", 1)
    except ValueError as exc:
        raise HTTPException(status_code=401, detail="Malformed access token") from exc

    expected = _sign_payload(payload_b64)
    if not hmac.compare_digest(expected, signature):
        raise HTTPException(status_code=401, detail="Invalid access token signature")

    try:
        payload = json.loads(_b64url_decode(payload_b64).decode("utf-8"))
    except (ValueError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=401, detail="Invalid access token payload") from exc

    owner_id = normalize_owner_id(str(payload.get("sub", "")))
    expires_at = int(payload.get("exp", 0))
    if expires_at <= int(time.time()):
        raise HTTPException(status_code=401, detail="Access token expired")
    return {"owner_id": owner_id, "expires_at": expires_at}


def parse_bearer_token(authorization: str | None) -> str:
    raw = (authorization or "").strip()
    if not raw:
        raise HTTPException(status_code=401, detail=f"{AUTH_HEADER_NAME} header is required")
    scheme, _, token = raw.partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        raise HTTPException(status_code=401, detail="Authorization must use Bearer token format")
    return token.strip()


def enforce_rate_limit(owner_id: str) -> None:
    window_now = time.monotonic()
    bucket = RATE_LIMIT_STATE[owner_id]
    while bucket and window_now - bucket[0] > config.RATE_LIMIT_WINDOW_SECONDS:
        bucket.popleft()
    if len(bucket) >= config.RATE_LIMIT_REQUESTS:
        raise HTTPException(status_code=429, detail="Rate limit exceeded for this authenticated session")
    bucket.append(window_now)


async def get_owner_id(authorization: str | None = Header(default=None, alias=AUTH_HEADER_NAME)) -> str:
    token = parse_bearer_token(authorization)
    payload = decode_access_token(token)
    owner_id = payload["owner_id"]
    enforce_rate_limit(owner_id)
    return owner_id


def owner_filter(owner_id: str, **kwargs: object) -> dict:
    return {"owner_id": owner_id, **kwargs}

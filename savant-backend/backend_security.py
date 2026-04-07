from fastapi import Header, HTTPException

OWNER_HEADER_NAME = "X-Savant-Owner"


def normalize_owner_id(value: str | None) -> str:
    owner_id = (value or "").strip()
    if not owner_id:
        raise HTTPException(status_code=401, detail=f"{OWNER_HEADER_NAME} header is required")
    if len(owner_id) > 120:
        raise HTTPException(status_code=400, detail=f"{OWNER_HEADER_NAME} header is too long")
    return owner_id


async def get_owner_id(x_savant_owner: str | None = Header(default=None, alias=OWNER_HEADER_NAME)) -> str:
    return normalize_owner_id(x_savant_owner)


def owner_filter(owner_id: str, **kwargs: object) -> dict:
    return {"owner_id": owner_id, **kwargs}

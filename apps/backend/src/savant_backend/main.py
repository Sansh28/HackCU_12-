import logging
import time
import uuid

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from savant_backend import config, security, store
from savant_backend.models import AuthSessionResponse
from savant_backend.routers.documents import router as documents_router
from savant_backend.routers.graph import router as graph_router
from savant_backend.routers.sessions import router as sessions_router
from savant_backend.services import backend_services as services

app = FastAPI(title="Savant API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=config.CORS_ALLOW_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def startup() -> None:
    await store.ensure_indexes()


@app.middleware("http")
async def add_request_context(request: Request, call_next):
    request_id = request.headers.get("X-Request-ID") or str(uuid.uuid4())
    services.bind_request_context(request_id, request.url.path, request.method)
    request_start = time.perf_counter()
    services.log_event(logging.INFO, "request_started")
    try:
        response = await call_next(request)
    except Exception as exc:
        services.log_event(logging.ERROR, "request_failed", duration_ms=round((time.perf_counter() - request_start) * 1000, 1), detail=str(exc))
        services.clear_request_context()
        raise

    response.headers["X-Request-ID"] = request_id
    services.log_event(
        logging.INFO,
        "request_completed",
        status_code=response.status_code,
        duration_ms=round((time.perf_counter() - request_start) * 1000, 1),
    )
    services.clear_request_context()
    return response


@app.get("/")
async def root():
    return {
        "message": "Savant API is running",
        "features": {
            "payment_gating": config.REQUIRE_SOLANA_PAYMENT,
            "price_sol": config.QUERY_PRICE_SOL,
        },
    }


@app.post("/auth/session", response_model=AuthSessionResponse)
async def create_auth_session(request: Request):
    client_hint = request.headers.get(security.BOOTSTRAP_HEADER_NAME)
    owner_id = security.generate_owner_id(client_hint)
    access_token, expires_at = security.create_access_token(owner_id)
    services.log_event(logging.INFO, "auth_session_issued", owner_id=owner_id, expires_at=expires_at)
    return AuthSessionResponse(access_token=access_token, owner_id=owner_id, expires_at=expires_at)


@app.get("/healthz")
async def healthz():
    return {
        "status": "ok",
        "service": config.SERVICE_NAME,
    }


@app.get("/readyz")
async def readyz():
    checks = {
        "database_configured": bool(config.MONGODB_URI and store.client),
        "gemini_configured": bool(config.GEMINI_API_KEY),
        "auth_secret_configured": bool(config.AUTH_SECRET),
        "payment_wallet_configured": (not config.REQUIRE_SOLANA_PAYMENT) or bool(config.MASTER_WALLET),
    }
    ready = all(checks.values())
    if ready:
        services.log_event(logging.INFO, "readiness_check_passed", **checks)
        return {
            "status": "ready",
            "service": config.SERVICE_NAME,
            "checks": checks,
        }

    services.log_event(logging.WARNING, "readiness_check_failed", **checks)
    return JSONResponse(
        status_code=503,
        content={
            "status": "not_ready",
            "service": config.SERVICE_NAME,
            "checks": checks,
        },
    )


app.include_router(graph_router)
app.include_router(sessions_router)
app.include_router(documents_router)

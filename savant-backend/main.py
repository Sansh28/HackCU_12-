from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

import backend_config as config
from backend_routers_documents import router as documents_router
from backend_routers_graph import router as graph_router
from backend_routers_sessions import router as sessions_router

app = FastAPI(title="Savant API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=config.CORS_ALLOW_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
async def root():
    return {
        "message": "Savant API is running",
        "features": {
            "payment_gating": config.REQUIRE_SOLANA_PAYMENT,
            "price_sol": config.QUERY_PRICE_SOL,
        },
    }


app.include_router(graph_router)
app.include_router(sessions_router)
app.include_router(documents_router)

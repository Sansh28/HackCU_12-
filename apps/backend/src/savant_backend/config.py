try:
    from dotenv import load_dotenv
except ImportError:  # pragma: no cover - optional in lean test environments
    def load_dotenv():
        return False

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

load_dotenv()


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=True,
        extra="ignore",
    )

    SERVICE_NAME: str = "savant-backend"
    LOG_LEVEL: str = "INFO"

    GEMINI_EMBED_URL: str = "https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent"
    GEMINI_MODEL: str = "gemini-2.5-flash"

    MONGODB_URI: str | None = None
    GEMINI_API_KEY: str | None = None
    ELEVENLABS_API_KEY: str | None = None
    ELEVENLABS_VOICE_ID: str = "pOvpV9R62HOnx42lX4gE"

    SOLANA_RPC_URL: str = "https://api.devnet.solana.com"
    MASTER_WALLET: str = ""
    QUERY_PRICE_SOL: float = 0.005
    PAYMENT_WINDOW_SECONDS: int = 900
    REQUIRE_SOLANA_PAYMENT: bool = False

    EMBED_MAX_RETRIES: int = 6
    EMBED_RETRY_BASE_SECONDS: float = 1.0
    EMBED_RETRY_MAX_SECONDS: float = 20.0
    EMBED_REQUEST_TIMEOUT_SECONDS: int = 30
    EMBED_MIN_INTERVAL_SECONDS: float = 0.75
    EMBED_ALLOW_LEXICAL_FALLBACK: bool = True

    GENERATE_MAX_RETRIES: int = 4
    GENERATE_RETRY_BASE_SECONDS: float = 1.5
    GENERATE_RETRY_MAX_SECONDS: float = 45.0
    ALLOW_GENERATE_LOCAL_FALLBACK: bool = True

    UPLOAD_CHUNK_SIZE: int = 1400
    UPLOAD_CHUNK_OVERLAP: int = 200
    UPLOAD_MAX_CHUNKS: int = 120

    AUTH_SECRET: str = "dev-savant-auth-secret-change-me"
    AUTH_TOKEN_TTL_SECONDS: int = 60 * 60 * 24 * 14
    AUTH_BOOTSTRAP_HEADER: str = "X-Savant-Client"
    RATE_LIMIT_REQUESTS: int = 240
    RATE_LIMIT_WINDOW_SECONDS: int = 60

    JOB_POLL_INTERVAL_MS: int = 1200
    JOB_RESULT_TTL_SECONDS: int = 60 * 60 * 24

    CORS_ALLOW_ORIGINS_RAW: str = Field(default="*", alias="CORS_ALLOW_ORIGINS")

    @field_validator("LOG_LEVEL")
    @classmethod
    def normalize_log_level(cls, value: str) -> str:
        return value.upper().strip()

    @field_validator("UPLOAD_CHUNK_SIZE")
    @classmethod
    def validate_chunk_size(cls, value: int) -> int:
        if value < 200:
            raise ValueError("UPLOAD_CHUNK_SIZE must be at least 200")
        return value

    @field_validator("UPLOAD_CHUNK_OVERLAP")
    @classmethod
    def validate_chunk_overlap(cls, value: int, info) -> int:
        chunk_size = info.data.get("UPLOAD_CHUNK_SIZE", 1400)
        if value < 0 or value >= chunk_size:
            raise ValueError("UPLOAD_CHUNK_OVERLAP must be between 0 and UPLOAD_CHUNK_SIZE - 1")
        return value

    @field_validator("RATE_LIMIT_REQUESTS")
    @classmethod
    def validate_rate_limit_requests(cls, value: int) -> int:
        if value < 10:
            raise ValueError("RATE_LIMIT_REQUESTS must be at least 10")
        return value

    @field_validator("AUTH_SECRET")
    @classmethod
    def validate_auth_secret(cls, value: str) -> str:
        value = value.strip()
        if len(value) < 16:
            raise ValueError("AUTH_SECRET must be at least 16 characters long")
        return value

    @property
    def GEMINI_GENERATE_URL(self) -> str:
        return f"https://generativelanguage.googleapis.com/v1beta/models/{self.GEMINI_MODEL}:generateContent"

    @property
    def QUERY_PRICE_LAMPORTS(self) -> int:
        return int(self.QUERY_PRICE_SOL * 1_000_000_000)

    @property
    def CORS_ALLOW_ORIGINS(self) -> list[str]:
        return [origin.strip() for origin in self.CORS_ALLOW_ORIGINS_RAW.split(",") if origin.strip()]

    @property
    def REQUIRED_RUNTIME_KEYS(self) -> dict[str, bool]:
        return {
            "mongodb_uri": bool(self.MONGODB_URI),
            "gemini_api_key": bool(self.GEMINI_API_KEY),
            "auth_secret": bool(self.AUTH_SECRET),
        }


settings = Settings()

SERVICE_NAME = settings.SERVICE_NAME
LOG_LEVEL = settings.LOG_LEVEL
GEMINI_EMBED_URL = settings.GEMINI_EMBED_URL
GEMINI_MODEL = settings.GEMINI_MODEL
GEMINI_GENERATE_URL = settings.GEMINI_GENERATE_URL
MONGODB_URI = settings.MONGODB_URI
GEMINI_API_KEY = settings.GEMINI_API_KEY
ELEVENLABS_API_KEY = settings.ELEVENLABS_API_KEY
VOICE_ID = settings.ELEVENLABS_VOICE_ID
SOLANA_RPC_URL = settings.SOLANA_RPC_URL
MASTER_WALLET = settings.MASTER_WALLET
QUERY_PRICE_SOL = settings.QUERY_PRICE_SOL
QUERY_PRICE_LAMPORTS = settings.QUERY_PRICE_LAMPORTS
PAYMENT_WINDOW_SECONDS = settings.PAYMENT_WINDOW_SECONDS
REQUIRE_SOLANA_PAYMENT = settings.REQUIRE_SOLANA_PAYMENT
EMBED_MAX_RETRIES = settings.EMBED_MAX_RETRIES
EMBED_RETRY_BASE_SECONDS = settings.EMBED_RETRY_BASE_SECONDS
EMBED_RETRY_MAX_SECONDS = settings.EMBED_RETRY_MAX_SECONDS
EMBED_REQUEST_TIMEOUT_SECONDS = settings.EMBED_REQUEST_TIMEOUT_SECONDS
EMBED_MIN_INTERVAL_SECONDS = settings.EMBED_MIN_INTERVAL_SECONDS
EMBED_ALLOW_LEXICAL_FALLBACK = settings.EMBED_ALLOW_LEXICAL_FALLBACK
GENERATE_MAX_RETRIES = settings.GENERATE_MAX_RETRIES
GENERATE_RETRY_BASE_SECONDS = settings.GENERATE_RETRY_BASE_SECONDS
GENERATE_RETRY_MAX_SECONDS = settings.GENERATE_RETRY_MAX_SECONDS
ALLOW_GENERATE_LOCAL_FALLBACK = settings.ALLOW_GENERATE_LOCAL_FALLBACK
UPLOAD_CHUNK_SIZE = settings.UPLOAD_CHUNK_SIZE
UPLOAD_CHUNK_OVERLAP = settings.UPLOAD_CHUNK_OVERLAP
UPLOAD_MAX_CHUNKS = settings.UPLOAD_MAX_CHUNKS
AUTH_SECRET = settings.AUTH_SECRET
AUTH_TOKEN_TTL_SECONDS = settings.AUTH_TOKEN_TTL_SECONDS
AUTH_BOOTSTRAP_HEADER = settings.AUTH_BOOTSTRAP_HEADER
RATE_LIMIT_REQUESTS = settings.RATE_LIMIT_REQUESTS
RATE_LIMIT_WINDOW_SECONDS = settings.RATE_LIMIT_WINDOW_SECONDS
JOB_POLL_INTERVAL_MS = settings.JOB_POLL_INTERVAL_MS
JOB_RESULT_TTL_SECONDS = settings.JOB_RESULT_TTL_SECONDS
CORS_ALLOW_ORIGINS = settings.CORS_ALLOW_ORIGINS

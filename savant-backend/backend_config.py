import os

try:
    from dotenv import load_dotenv
except ImportError:  # pragma: no cover - optional in lean test environments
    def load_dotenv():
        return False

load_dotenv()

GEMINI_EMBED_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent"
GEMINI_MODEL = "gemini-2.5-flash"
GEMINI_GENERATE_URL = f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent"

MONGODB_URI = os.getenv("MONGODB_URI")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
ELEVENLABS_API_KEY = os.getenv("ELEVENLABS_API_KEY")
VOICE_ID = os.getenv("ELEVENLABS_VOICE_ID", "pOvpV9R62HOnx42lX4gE")

SOLANA_RPC_URL = os.getenv("SOLANA_RPC_URL", "https://api.devnet.solana.com")
MASTER_WALLET = os.getenv("MASTER_WALLET", "")
QUERY_PRICE_SOL = float(os.getenv("QUERY_PRICE_SOL", "0.005"))
QUERY_PRICE_LAMPORTS = int(QUERY_PRICE_SOL * 1_000_000_000)
PAYMENT_WINDOW_SECONDS = int(os.getenv("PAYMENT_WINDOW_SECONDS", "900"))
REQUIRE_SOLANA_PAYMENT = os.getenv("REQUIRE_SOLANA_PAYMENT", "false").lower() in {"1", "true", "yes"}

EMBED_MAX_RETRIES = int(os.getenv("EMBED_MAX_RETRIES", "6"))
EMBED_RETRY_BASE_SECONDS = float(os.getenv("EMBED_RETRY_BASE_SECONDS", "1.0"))
EMBED_RETRY_MAX_SECONDS = float(os.getenv("EMBED_RETRY_MAX_SECONDS", "20.0"))
EMBED_REQUEST_TIMEOUT_SECONDS = int(os.getenv("EMBED_REQUEST_TIMEOUT_SECONDS", "30"))
EMBED_MIN_INTERVAL_SECONDS = float(os.getenv("EMBED_MIN_INTERVAL_SECONDS", "0.75"))
EMBED_ALLOW_LEXICAL_FALLBACK = os.getenv("EMBED_ALLOW_LEXICAL_FALLBACK", "true").lower() in {"1", "true", "yes"}

GENERATE_MAX_RETRIES = int(os.getenv("GENERATE_MAX_RETRIES", "4"))
GENERATE_RETRY_BASE_SECONDS = float(os.getenv("GENERATE_RETRY_BASE_SECONDS", "1.5"))
GENERATE_RETRY_MAX_SECONDS = float(os.getenv("GENERATE_RETRY_MAX_SECONDS", "45.0"))
ALLOW_GENERATE_LOCAL_FALLBACK = os.getenv("ALLOW_GENERATE_LOCAL_FALLBACK", "true").lower() in {"1", "true", "yes"}

UPLOAD_CHUNK_SIZE = int(os.getenv("UPLOAD_CHUNK_SIZE", "1400"))
UPLOAD_CHUNK_OVERLAP = int(os.getenv("UPLOAD_CHUNK_OVERLAP", "200"))
UPLOAD_MAX_CHUNKS = int(os.getenv("UPLOAD_MAX_CHUNKS", "120"))

CORS_ALLOW_ORIGINS = [
    origin.strip()
    for origin in os.getenv("CORS_ALLOW_ORIGINS", "*").split(",")
    if origin.strip()
]

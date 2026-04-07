from elevenlabs.client import ElevenLabs
from google import genai
from motor.motor_asyncio import AsyncIOMotorClient

import backend_config as config

client = AsyncIOMotorClient(config.MONGODB_URI) if config.MONGODB_URI else None
db = client.savant if client else None

documents_collection = db.documents if db else None
payments_collection = db.payments if db else None
sessions_collection = db.sessions if db else None
messages_collection = db.session_messages if db else None
graph_sessions_collection = db.graph_sessions if db else None
graph_messages_collection = db.graph_messages if db else None
chat_conversations_collection = db.chat_conversations if db else None

genai_client = genai.Client(api_key=config.GEMINI_API_KEY) if config.GEMINI_API_KEY else None
elevenlabs_client = ElevenLabs(api_key=config.ELEVENLABS_API_KEY) if config.ELEVENLABS_API_KEY else None

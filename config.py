import os
from dotenv import load_dotenv

load_dotenv()

class APIConfig:
    AUTH_HEADER = os.getenv("API_AUTH_HEADER", "Authorization")
    AUTH_SCHEME = os.getenv("API_AUTH_SCHEME", "Bearer")
    TOKEN = os.getenv("API_TOKEN", "")
    TIMEOUT = int(os.getenv("API_TIMEOUT_SECONDS", 10))
    RETRIES = int(os.getenv("API_RETRIES", 2))
    BASE_URL = os.getenv("API_BASE_URL", "https://api.polygon.io") # Defaulting to Polygon for now as placeholder
    
    @classmethod
    def get_headers(cls):
        if not cls.TOKEN:
            return {}
        return {
            cls.AUTH_HEADER: f"{cls.AUTH_SCHEME} {cls.TOKEN}".strip() if cls.AUTH_SCHEME else cls.TOKEN
        }

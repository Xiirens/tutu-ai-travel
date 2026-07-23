import os
from pathlib import Path

from dotenv import load_dotenv


PROJECT_DIR = Path(__file__).resolve().parents[2]

# Prefer an isolated project/.env, but keep the old root .env usable while the
# five reference files remain untouched.
for env_file in (PROJECT_DIR / ".env", PROJECT_DIR.parent / ".env"):
    if env_file.exists():
        load_dotenv(env_file, override=False)

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "").strip()
PROXY = os.getenv("PROXY", "").strip()
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-5.6-luna").strip()
OPENAI_API_URL = "https://api.openai.com/v1/responses"
TUTU_MCP_URL = os.getenv("TUTU_MCP_URL", "https://mcp.tutu.ru/mcp").strip()
APP_TIMEZONE = os.getenv("APP_TIMEZONE", "Europe/Moscow").strip()
UNSPLASH_ACCESS_KEY = os.getenv("UNSPLASH_ACCESS_KEY", "").strip()
PROXY_CHECK_URL = os.getenv(
    "PROXY_CHECK_URL", "https://api.ipify.org?format=json"
).strip()
REQUEST_TIMEOUT_SECONDS = float(os.getenv("REQUEST_TIMEOUT_SECONDS", "90"))


def require_network_settings(*, require_openai_key: bool = True) -> None:
    """Fail closed: network calls are forbidden when proxy config is absent."""
    missing: list[str] = []
    if not PROXY:
        missing.append("PROXY")
    if require_openai_key and not OPENAI_API_KEY:
        missing.append("OPENAI_API_KEY")
    if missing:
        raise RuntimeError(f"Missing required environment variables: {', '.join(missing)}")
    if require_openai_key and not OPENAI_API_KEY.isascii():
        raise RuntimeError("OPENAI_API_KEY must contain only ASCII characters")

from typing import Any

import httpx

from back.config.settings import (
    PROXY,
    PROXY_CHECK_URL,
    REQUEST_TIMEOUT_SECONDS,
    require_network_settings,
)


class ProxyVerificationError(RuntimeError):
    """Raised when the mandatory outbound proxy cannot be verified."""


def create_proxy_client() -> httpx.AsyncClient:
    """Create the only allowed outbound HTTP client for this prototype."""
    require_network_settings(require_openai_key=False)
    return httpx.AsyncClient(
        proxy=PROXY,
        timeout=httpx.Timeout(REQUEST_TIMEOUT_SECONDS),
        trust_env=False,
        follow_redirects=True,
    )


async def verify_proxy(client: httpx.AsyncClient) -> str:
    """Return the public IP observed through the configured proxy."""
    try:
        response = await client.get(PROXY_CHECK_URL)
        response.raise_for_status()
        payload: Any = response.json()
        ip = payload.get("ip") if isinstance(payload, dict) else None
        if not isinstance(ip, str) or not ip.strip():
            raise ValueError("proxy check response does not contain an IP")
        return ip.strip()
    except (httpx.HTTPError, ValueError) as exc:
        raise ProxyVerificationError(f"Proxy verification failed: {exc}") from exc

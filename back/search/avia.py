import asyncio
import json
from datetime import datetime, timedelta
from typing import Any
from urllib.parse import parse_qs, urlencode, urlparse, urlunparse

import httpx

from back.config.settings import TUTU_MCP_URL
from back.search.filters import (
    compact_avia_offer,
    weekend_outbound_offer,
    weekend_return_offer,
)


AVIA_CITY_ALIASES = {
    "москва": "MOW",
    "санкт-петербург": "LED",
    "санкт петербург": "LED",
    "питер": "LED",
}


def _avia_place(value: Any) -> str:
    text = str(value or "").strip()
    return AVIA_CITY_ALIASES.get(text.casefold(), text)


def _roundtrip_search_url(
    outbound_url: Any,
    return_url: Any,
) -> str | None:
    if not outbound_url:
        return None
    outbound = urlparse(str(outbound_url))
    outbound_query = parse_qs(outbound.query)
    return_query = parse_qs(urlparse(str(return_url or "")).query)
    outbound_route = (outbound_query.get("route[0]") or [None])[0]
    return_route = (return_query.get("route[0]") or [None])[0]
    if outbound_route:
        outbound_query["route[0]"] = [outbound_route]
    if return_route:
        outbound_query["route[1]"] = [return_route]
    query = urlencode(outbound_query, doseq=True)
    return urlunparse(outbound._replace(query=query))


async def _mcp_initialize(client: httpx.AsyncClient) -> dict[str, str]:
    headers = {
        "Accept": "application/json, text/event-stream",
        "Content-Type": "application/json",
    }
    response = await client.post(
        TUTU_MCP_URL,
        headers=headers,
        json={
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {
                "protocolVersion": "2025-03-26",
                "capabilities": {},
                "clientInfo": {"name": "tutu-ai-backend", "version": "1.0"},
            },
        },
    )
    response.raise_for_status()
    session_id = response.headers.get("mcp-session-id")
    if session_id:
        headers["mcp-session-id"] = session_id
    await client.post(
        TUTU_MCP_URL,
        headers=headers,
        json={"jsonrpc": "2.0", "method": "notifications/initialized"},
    )
    return headers


async def _call_search(
    client: httpx.AsyncClient,
    headers: dict[str, str],
    request_id: int,
    arguments: dict[str, Any],
) -> list[dict[str, Any]]:
    response = await client.post(
        TUTU_MCP_URL,
        headers=headers,
        json={
            "jsonrpc": "2.0",
            "id": request_id,
            "method": "tools/call",
            "params": {"name": "search_avia", "arguments": arguments},
        },
    )
    response.raise_for_status()
    result = response.json().get("result", {})
    for content in result.get("content", []):
        if content.get("type") != "text":
            continue
        raw_text = content.get("text") or ""
        try:
            payload = json.loads(raw_text)
        except json.JSONDecodeError as exc:
            raise RuntimeError(f"Tutu avia search failed: {raw_text[:500]}") from exc
        return list(payload.get("offers") or [])
    return []


async def search_filtered_avia(
    client: httpx.AsyncClient,
    trip: dict[str, Any],
) -> list[dict[str, Any]]:
    departure_date = datetime.fromisoformat(trip["departure_date"])
    return_date = datetime.fromisoformat(trip["return_date"])
    headers = await _mcp_initialize(client)
    common = {
        "origin": _avia_place(trip["origin"]),
        "destination": _avia_place(trip["destination"]),
        "adults": trip.get("adults") or 1,
        "children": trip.get("children") or 0,
        "page_size": 30,
        "sort": "departure_asc",
        "view": "compact",
    }
    if trip.get("budget"):
        common["price_max"] = trip["budget"]

    semaphore = asyncio.Semaphore(4)

    async def limited_search(
        request_id: int,
        arguments: dict[str, Any],
    ) -> list[dict[str, Any]]:
        async with semaphore:
            return await _call_search(
                client,
                headers,
                request_id,
                arguments,
            )

    requests: list[tuple[str, Any]] = []
    request_id = 10
    search_dates = (
        ("outbound", departure_date.date().isoformat(), range(1, 4)),
        (
            "outbound",
            (departure_date.date() + timedelta(days=1)).isoformat(),
            range(1, 2),
        ),
        ("return", return_date.date().isoformat(), range(1, 4)),
    )
    for direction, date_value, pages_to_scan in search_dates:
        for page in pages_to_scan:
            request_id += 1
            requests.append(
                (
                    direction,
                    limited_search(
                        request_id,
                        {
                            **common,
                            "origin": (
                                common["destination"]
                                if direction == "return"
                                else common["origin"]
                            ),
                            "destination": (
                                common["origin"]
                                if direction == "return"
                                else common["destination"]
                            ),
                            "departure_date": date_value,
                            "page": page,
                        },
                    ),
                )
            )
    page_results = await asyncio.gather(*(request for _, request in requests))
    outbound_offers: dict[str, dict[str, Any]] = {}
    return_offers: dict[str, dict[str, Any]] = {}
    for (direction, _), offers in zip(requests, page_results):
        target = outbound_offers if direction == "outbound" else return_offers
        for offer in offers:
            offer_id = str(offer.get("offer_id") or "")
            if not offer_id:
                continue
            if direction == "outbound" and weekend_outbound_offer(
                offer, departure_date
            ):
                target[offer_id] = offer
            elif direction == "return" and weekend_return_offer(
                offer, return_date
            ):
                target[offer_id] = offer

    cheapest_outbound = sorted(
        outbound_offers.values(),
        key=lambda item: float((item.get("price") or {}).get("amount") or 10**12),
    )[:5]
    cheapest_return = sorted(
        return_offers.values(),
        key=lambda item: float((item.get("price") or {}).get("amount") or 10**12),
    )[:5]
    combinations: list[dict[str, Any]] = []
    for outbound in cheapest_outbound:
        for returning in cheapest_return:
            outbound_price = float((outbound.get("price") or {}).get("amount") or 0)
            return_price = float((returning.get("price") or {}).get("amount") or 0)
            combinations.append(
                {
                    "offer_id": (
                        f"{outbound.get('offer_id')}|{returning.get('offer_id')}"
                    ),
                    "price": {
                        "amount": outbound_price + return_price,
                        "currency": "RUB",
                    },
                    "carriers": list(
                        dict.fromkeys(
                            (outbound.get("carriers") or [])
                            + (returning.get("carriers") or [])
                        )
                    ),
                    "legs": [
                        (outbound.get("legs") or [{}])[0],
                        (returning.get("legs") or [{}])[0],
                    ],
                    "search_results_url": _roundtrip_search_url(
                        outbound.get("search_results_url"),
                        returning.get("search_results_url"),
                    ),
                }
            )
    selected = sorted(
        combinations,
        key=lambda item: float((item.get("price") or {}).get("amount") or 10**12),
    )[:5]
    return [compact_avia_offer(offer) for offer in selected]

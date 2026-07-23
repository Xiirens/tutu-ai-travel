import asyncio
import json
from datetime import datetime, time, timedelta
from typing import Any
from urllib.parse import parse_qs, urlparse

import httpx

from back.config.settings import TUTU_MCP_URL
from back.search.avia import _mcp_initialize
from back.search.filters import parse_datetime


async def _search_page(
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
            "params": {"name": "search_bus", "arguments": arguments},
        },
    )
    response.raise_for_status()
    for content in response.json().get("result", {}).get("content", []):
        if content.get("type") != "text":
            continue
        payload = json.loads(content.get("text") or "{}")
        return list(payload.get("offers") or [])
    return []


def _ground_outbound(offer: dict[str, Any], friday: datetime) -> bool:
    departure = parse_datetime(offer.get("departure_at"))
    arrival = parse_datetime(offer.get("arrival_at"))
    if not departure or not arrival:
        return False
    saturday = friday.date() + timedelta(days=1)
    return (
        (
            departure.date() == friday.date()
            and departure.time() >= time(18, 0)
        )
        or (
            departure.date() == saturday
            and departure.time() <= time(10, 0)
        )
    ) and (
        arrival.date() == friday.date()
        or (
            arrival.date() == saturday
            and arrival.time() <= time(14, 0)
        )
    )


def _ground_return(offer: dict[str, Any], sunday: datetime) -> bool:
    departure = parse_datetime(offer.get("departure_at"))
    arrival = parse_datetime(offer.get("arrival_at"))
    if not departure or not arrival:
        return False
    monday = sunday.date() + timedelta(days=1)
    return (
        departure.date() == sunday.date()
        and departure.time() >= time(15, 0)
        and (
            arrival.date() == sunday.date()
            or (
                arrival.date() == monday
                and arrival.time() <= time(1, 30)
            )
        )
    )


def _compact_leg(offer: dict[str, Any]) -> dict[str, Any]:
    leg = (offer.get("legs") or [{}])[0]
    checkout_ref = offer.get("checkout_ref") or {}
    checkout_query = parse_qs(urlparse(str(offer.get("checkout_url") or "")).query)
    departure_id = (
        (checkout_query.get("departure_geo_city_id") or [None])[0]
        or checkout_ref.get("departure_geo_city_id")
    )
    arrival_id = (
        (checkout_query.get("arrival_geo_city_id") or [None])[0]
        or checkout_ref.get("arrival_geo_city_id")
    )
    return {
        "offer_id": offer.get("offer_id"),
        "carrier": ", ".join(offer.get("carriers") or []),
        "departure_at": offer.get("departure_at"),
        "arrival_at": offer.get("arrival_at"),
        "from": leg.get("from"),
        "to": leg.get("to"),
        "duration_min": offer.get("duration_min"),
        "price": (offer.get("price") or {}).get("amount"),
        "currency": (offer.get("price") or {}).get("currency", "RUB"),
        "search_results_url": offer.get("search_results_url"),
        "departure_id": departure_id,
        "arrival_id": arrival_id,
    }


async def search_filtered_bus(
    client: httpx.AsyncClient,
    trip: dict[str, Any],
) -> list[dict[str, Any]]:
    friday = datetime.fromisoformat(trip["departure_date"])
    sunday = datetime.fromisoformat(trip["return_date"])
    headers = await _mcp_initialize(client)
    common = {
        "adults": trip.get("adults") or 1,
        "children": trip.get("children") or 0,
        "page_size": 30,
        "sort": "departure_asc",
        "view": "compact",
    }
    if trip.get("budget"):
        common["price_max"] = trip["budget"]

    searches = [
        ("outbound", trip["origin"], trip["destination"], friday.date(), 1),
        ("outbound", trip["origin"], trip["destination"], friday.date(), 2),
        (
            "outbound",
            trip["origin"],
            trip["destination"],
            friday.date() + timedelta(days=1),
            1,
        ),
        ("return", trip["destination"], trip["origin"], sunday.date(), 1),
        ("return", trip["destination"], trip["origin"], sunday.date(), 2),
    ]
    tasks = [
        _search_page(
            client,
            headers,
            100 + index,
            {
                **common,
                "origin": origin,
                "destination": destination,
                "departure_date": day.isoformat(),
                "page": page,
            },
        )
        for index, (_, origin, destination, day, page) in enumerate(searches)
    ]
    pages = await asyncio.gather(*tasks)
    outbound: dict[str, dict[str, Any]] = {}
    returning: dict[str, dict[str, Any]] = {}
    for (direction, *_), offers in zip(searches, pages):
        for offer in offers:
            offer_id = str(offer.get("offer_id") or "")
            if not offer_id:
                continue
            if direction == "outbound" and _ground_outbound(offer, friday):
                outbound[offer_id] = offer
            elif direction == "return" and _ground_return(offer, sunday):
                returning[offer_id] = offer

    cheapest_outbound = sorted(
        outbound.values(),
        key=lambda offer: float((offer.get("price") or {}).get("amount") or 10**12),
    )[:3]
    cheapest_return = sorted(
        returning.values(),
        key=lambda offer: float((offer.get("price") or {}).get("amount") or 10**12),
    )[:3]
    combinations = [
        {
            "price": float((out.get("price") or {}).get("amount") or 0)
            + float((back.get("price") or {}).get("amount") or 0),
            "outbound": _compact_leg(out),
            "return": _compact_leg(back),
        }
        for out in cheapest_outbound
        for back in cheapest_return
    ]
    return sorted(combinations, key=lambda item: item["price"])[:5]

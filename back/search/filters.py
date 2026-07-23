from datetime import datetime, time, timedelta
from typing import Any


def parse_datetime(value: Any) -> datetime | None:
    try:
        return datetime.fromisoformat(str(value or ""))
    except ValueError:
        return None


def weekend_avia_offer(offer: dict[str, Any], friday: datetime, sunday: datetime) -> bool:
    legs = offer.get("legs") or []
    if len(legs) < 2:
        return False
    outbound = legs[0]
    returning = legs[-1]
    outbound_departure = parse_datetime(outbound.get("departure_at"))
    outbound_arrival = parse_datetime(outbound.get("arrival_at"))
    return_departure = parse_datetime(returning.get("departure_at"))
    return_arrival = parse_datetime(returning.get("arrival_at"))
    if not all((outbound_departure, outbound_arrival, return_departure, return_arrival)):
        return False

    friday_date = friday.date()
    saturday_date = friday_date + timedelta(days=1)
    sunday_date = sunday.date()
    monday_date = sunday_date + timedelta(days=1)
    outbound_ok = (
        outbound_departure.date() == friday_date
        and outbound_departure.time() >= time(18, 0)
    ) or (
        outbound_departure.date() == saturday_date
        and outbound_departure.time() <= time(7, 0)
    )
    arrival_ok = (
        outbound_arrival.date() == friday_date
        and outbound_arrival >= outbound_departure
    ) or (
        outbound_arrival.date() == saturday_date
        and outbound_arrival.time() <= time(10, 0)
    )
    return_ok = (
        return_departure.date() == sunday_date
        and return_departure.time() >= time(17, 0)
    )
    arrival_home_ok = (
        return_arrival.date() == sunday_date
        or (
            return_arrival.date() == monday_date
            and return_arrival.time() <= time(1, 30)
        )
    )
    return outbound_ok and arrival_ok and return_ok and arrival_home_ok


def weekend_outbound_offer(offer: dict[str, Any], friday: datetime) -> bool:
    legs = offer.get("legs") or []
    if not legs:
        return False
    departure = parse_datetime(legs[0].get("departure_at"))
    arrival = parse_datetime(legs[0].get("arrival_at"))
    if not departure or not arrival:
        return False
    friday_date = friday.date()
    saturday_date = friday_date + timedelta(days=1)
    departure_ok = (
        departure.date() == friday_date and departure.time() >= time(18, 0)
    ) or (
        departure.date() == saturday_date and departure.time() <= time(7, 0)
    )
    arrival_ok = (
        arrival.date() == friday_date and arrival >= departure
    ) or (
        arrival.date() == saturday_date and arrival.time() <= time(10, 0)
    )
    return departure_ok and arrival_ok


def weekend_return_offer(offer: dict[str, Any], sunday: datetime) -> bool:
    legs = offer.get("legs") or []
    if not legs:
        return False
    departure = parse_datetime(legs[0].get("departure_at"))
    arrival = parse_datetime(legs[0].get("arrival_at"))
    if not departure or not arrival:
        return False
    sunday_date = sunday.date()
    monday_date = sunday_date + timedelta(days=1)
    return (
        departure.date() == sunday_date
        and departure.time() >= time(17, 0)
        and (
            arrival.date() == sunday_date
            or (
                arrival.date() == monday_date
                and arrival.time() <= time(1, 30)
            )
        )
    )


def compact_avia_offer(offer: dict[str, Any]) -> dict[str, Any]:
    legs = offer.get("legs") or []
    outbound = legs[0] if legs else {}
    returning = legs[-1] if len(legs) > 1 else {}
    price = offer.get("price") or {}
    return {
        "offer_id": offer.get("offer_id"),
        "price": price.get("amount"),
        "currency": price.get("currency", "RUB"),
        "carriers": offer.get("carriers") or [],
        "outbound": {
            "departure_at": outbound.get("departure_at"),
            "arrival_at": outbound.get("arrival_at"),
            "from": outbound.get("from"),
            "to": outbound.get("to"),
            "duration_min": outbound.get("duration_min"),
        },
        "return": {
            "departure_at": returning.get("departure_at"),
            "arrival_at": returning.get("arrival_at"),
            "from": returning.get("from"),
            "to": returning.get("to"),
            "duration_min": returning.get("duration_min"),
        },
        "search_results_url": offer.get("search_results_url"),
    }

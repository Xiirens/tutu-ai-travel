from datetime import datetime, time, timedelta
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import FileResponse
from urllib.parse import urlparse
from fastapi.staticfiles import StaticFiles
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from back.core.gpt_client import GPTClientError, generate_reply
from back.core.proxy import ProxyVerificationError, create_proxy_client, verify_proxy
from back.config.settings import UNSPLASH_ACCESS_KEY
from back.search.avia import search_filtered_avia
from back.search.bus import search_filtered_bus


FRONT_DIR = Path(__file__).resolve().parent.parent / "front"

app = FastAPI(title="Tutu AI prototype")
app.mount("/static", StaticFiles(directory=FRONT_DIR), name="static")


class HistoryMessage(BaseModel):
    model_config = ConfigDict(extra="forbid")

    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=8000)


class TripPreferences(BaseModel):
    model_config = ConfigDict(extra="forbid")

    origin: str = Field(default="", max_length=120)
    destination: str = Field(default="", max_length=120)
    departure_date: str = Field(default="", max_length=10)
    return_date: str = Field(default="", max_length=10)
    adults: int = Field(default=1, ge=1, le=9)
    children: int = Field(default=0, ge=0, le=9)
    budget: int | None = Field(default=None, ge=0, le=10_000_000)
    transport_modes: list[Literal["plane", "train", "bus"]] = Field(default_factory=list)
    stage: Literal["collecting", "confirmation", "result"] = "collecting"


class ChatRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    message: str = Field(min_length=1, max_length=4000)
    history: list[HistoryMessage] = Field(default_factory=list, max_length=20)
    trip: TripPreferences = Field(default_factory=TripPreferences)


class ChatResponse(BaseModel):
    reply: str
    used_tutu_mcp: bool
    links: list[dict[str, Any]]
    follow_up_question: str | None
    trip_update: dict[str, Any]
    proxy_ip: str
    response_id: str
    stage: Literal["collecting", "confirmation", "result"]
    trip_result: dict[str, Any] | None
    quick_replies: list[str]


def _confirmed(message: str) -> bool:
    normalized = message.strip().lower().rstrip(".!?")
    return normalized in {
        "\u0434\u0430",
        "\u0434\u0430\u0432\u0430\u0439",
        "\u0432\u0441\u0451 \u0432\u0435\u0440\u043d\u043e",
        "\u0432\u0441\u0435 \u0432\u0435\u0440\u043d\u043e",
        "\u043f\u043e\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0430\u044e",
        "\u043f\u043e\u0434\u0442\u0432\u0435\u0440\u0434\u0438\u0442\u044c",
        "\u043f\u043e\u0434\u0442\u0432\u0435\u0440\u0434\u0438\u0442\u044c \u043f\u043e\u0438\u0441\u043a",
        "\u043d\u0430\u0447\u0438\u043d\u0430\u0439",
        "\u0438\u0449\u0438",
        "\u043d\u0430\u0447\u0430\u0442\u044c \u043f\u043e\u0438\u0441\u043a",
    }


def _trip_is_complete(answer: Any) -> bool:
    trip = answer.trip_update
    return all(
        (
            trip.origin,
            trip.destination,
            trip.departure_date,
            trip.return_date,
            trip.adults is not None,
            trip.children is not None,
            trip.budget is not None,
            bool(trip.transport_modes),
        )
    )


def _has_complete_transport_result(result: dict[str, Any] | None) -> bool:
    if not result:
        return False

    def meaningful(value: Any) -> bool:
        return str(value or "").strip() not in {"", "-", "—"}

    for key in ("outbound", "return_trip"):
        leg = result.get(key) or {}
        if not (
            meaningful(leg.get("from"))
            and meaningful(leg.get("to"))
            and meaningful(leg.get("departure"))
            and meaningful(leg.get("arrival"))
        ):
            return False
    return True


def _parse_result_datetime(value: Any) -> datetime | None:
    text = str(value or "").strip()
    if not text:
        return None
    try:
        return datetime.fromisoformat(text)
    except ValueError:
        return None


def _fits_weekend_window(
    trip: TripPreferences,
    result: dict[str, Any] | None,
) -> bool:
    try:
        friday = datetime.fromisoformat(trip.departure_date).date()
        sunday = datetime.fromisoformat(trip.return_date).date()
    except ValueError:
        return True
    if friday.weekday() != 4 or sunday.weekday() != 6 or not result:
        return True

    outbound = result.get("outbound") or {}
    returning = result.get("return_trip") or {}
    outbound_departure = _parse_result_datetime(outbound.get("departure"))
    outbound_arrival = _parse_result_datetime(outbound.get("arrival"))
    return_departure = _parse_result_datetime(returning.get("departure"))
    return_arrival = _parse_result_datetime(returning.get("arrival"))
    if not all(
        (outbound_departure, outbound_arrival, return_departure, return_arrival)
    ):
        return True

    saturday = friday + timedelta(days=1)
    monday = sunday + timedelta(days=1)
    ground_only = bool(trip.transport_modes) and set(
        trip.transport_modes
    ).issubset({"bus", "train"})
    saturday_departure_limit = time(10, 0) if ground_only else time(7, 0)
    saturday_arrival_limit = time(14, 0) if ground_only else time(10, 0)
    sunday_departure_limit = time(15, 0) if ground_only else time(17, 0)
    outbound_ok = (
        outbound_departure.date() == friday
        and outbound_departure.time() >= time(18, 0)
    ) or (
        outbound_departure.date() == saturday
        and outbound_departure.time() <= saturday_departure_limit
    )
    arrival_ok = (
        outbound_arrival.date() == friday
        and outbound_arrival >= outbound_departure
    ) or (
        outbound_arrival.date() == saturday
        and outbound_arrival.time() <= saturday_arrival_limit
    )
    return_ok = (
        return_departure.date() == sunday
        and return_departure.time() >= sunday_departure_limit
    )
    final_arrival_ok = (
        return_arrival.date() == sunday
        or (
            return_arrival.date() == monday
            and return_arrival.time() <= time(1, 30)
        )
    )
    return outbound_ok and arrival_ok and return_ok and final_arrival_ok


@app.get("/", include_in_schema=False)
async def index() -> FileResponse:
    return FileResponse(FRONT_DIR / "index.html")


@app.get("/api/proxy/check")
async def check_proxy() -> dict[str, str | bool]:
    try:
        async with create_proxy_client() as client:
            ip = await verify_proxy(client)
        return {"ok": True, "ip": ip}
    except (RuntimeError, ProxyVerificationError) as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


UNIVERSAL_TRAVEL_PHOTO = (
    "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee"
    "?auto=format&fit=crop&w=1600&q=82"
)


@app.get("/api/city-image", include_in_schema=False)
async def city_image(
    city: str = Query(min_length=1, max_length=120),
) -> dict[str, str | bool]:
    fallback = {
        "url": UNIVERSAL_TRAVEL_PHOTO,
        "is_fallback": True,
        "credit_name": "Unsplash",
        "credit_url": "https://unsplash.com/",
    }
    if not UNSPLASH_ACCESS_KEY:
        return fallback

    try:
        async with create_proxy_client() as client:
            await verify_proxy(client)
            response = await client.get(
                "https://api.unsplash.com/search/photos",
                params={
                    "query": f"{city} city travel",
                    "page": 1,
                    "per_page": 1,
                    "orientation": "landscape",
                    "content_filter": "high",
                },
                headers={
                    "Authorization": f"Client-ID {UNSPLASH_ACCESS_KEY}",
                    "Accept-Version": "v1",
                },
            )
            response.raise_for_status()
            photo = next(iter(response.json().get("results") or []), None)
            source = ((photo or {}).get("urls") or {}).get("regular")
            parsed = urlparse(source or "")
            if (
                parsed.scheme != "https"
                or parsed.hostname != "images.unsplash.com"
            ):
                return fallback
            user = (photo or {}).get("user") or {}
            user_links = user.get("links") or {}
            return {
                "url": source,
                "is_fallback": False,
                "credit_name": user.get("name") or "Unsplash",
                "credit_url": user_links.get("html") or "https://unsplash.com/",
            }
    except Exception:
        return fallback


@app.post("/api/chat", response_model=ChatResponse)
async def chat(request: ChatRequest) -> ChatResponse:
    message = request.message.strip()
    if not message:
        raise HTTPException(status_code=422, detail="Message cannot be empty")

    try:
        # The proxy check and OpenAI request deliberately share one client.
        async with create_proxy_client() as client:
            proxy_ip = await verify_proxy(client)
            use_mcp = request.trip.stage == "confirmation" and _confirmed(message)
            prefetched_avia = None
            prefetched_bus = None
            if use_mcp and request.trip.transport_modes == ["plane"]:
                prefetched_avia = await search_filtered_avia(
                    client, request.trip.model_dump()
                )
            elif use_mcp and request.trip.transport_modes == ["bus"]:
                prefetched_bus = await search_filtered_bus(
                    client, request.trip.model_dump()
                )
            answer, response_id = await generate_reply(
                client,
                message,
                history=[item.model_dump() for item in request.history],
                trip=request.trip.model_dump(),
                use_mcp=use_mcp,
                prefetched_avia=prefetched_avia,
                prefetched_bus=prefetched_bus,
            )
            valid_transport = _has_complete_transport_result(answer.trip_result)
            valid_weekend_time = _fits_weekend_window(
                request.trip, answer.trip_result
            )
            if use_mcp and valid_transport and valid_weekend_time:
                answer.stage = "result"
            elif use_mcp:
                has_avia_link = any(link.kind == "avia" for link in answer.links)
                retryable_time_window = valid_transport or has_avia_link
                answer.stage = (
                    "confirmation" if retryable_time_window else "collecting"
                )
                answer.trip_result = None
                if retryable_time_window:
                    answer.reply = (
                        "Не нашёл вариант в удобном окне: выезд вечером в пятницу "
                        "или ночью и возвращение вечером в воскресенье. "
                        "Можно посмотреть вечерние авиабилеты на Tutu."
                    )
                    answer.follow_up_question = (
                        "Повторить поиск в этом временном окне?"
                    )
                    for link in answer.links:
                        if link.kind == "avia":
                            link.title = "вечерние авиабилеты на Tutu"
                else:
                    answer.links = []
                    answer.trip_update.transport_modes = []
            elif not (request.trip.stage == "result" and answer.stage == "result") and _trip_is_complete(answer):
                answer.stage = "confirmation"
                combined_text = f"{answer.reply} {answer.follow_up_question or ''}"
                normalized_text = combined_text.lower()
                already_asks_confirmation = (
                    "\u043f\u043e\u0434\u0442\u0432\u0435\u0440\u0434" in normalized_text
                    and (
                        "\u043f\u043e\u0438\u0441\u043a" in normalized_text
                        or "\u043f\u0430\u0440\u0430\u043c\u0435\u0442\u0440" in normalized_text
                    )
                )
                if not already_asks_confirmation:
                    answer.follow_up_question = "Подтвердить поиск по обновлённым параметрам?"
    except ProxyVerificationError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except GPTClientError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    return ChatResponse(
        reply=answer.reply,
        used_tutu_mcp=answer.used_tutu_mcp,
        links=[
            {**link.model_dump(), "url": str(link.url)} for link in answer.links
        ],
        follow_up_question=answer.follow_up_question,
        trip_update=answer.trip_update.model_dump(),
        proxy_ip=proxy_ip,
        response_id=response_id,
        stage=answer.stage,
        trip_result=answer.trip_result,
        quick_replies=answer.quick_replies,
    )

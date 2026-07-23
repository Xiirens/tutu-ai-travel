import { checkProxy, sendChat } from "./api.js";
import { initTransportFilters } from "./filters.js";
import { READY_TRIPS } from "./ready-trips.js";

const form = document.querySelector("#chat-form");
const input = document.querySelector("#message-input");
const messages = document.querySelector("#messages");
const sendButton = document.querySelector("#send-button");
const proxyButton = document.querySelector("#proxy-check");
const newChatButton = document.querySelector("#new-chat");
const aiModal = document.querySelector("#ai-modal");
const closeAiButton = document.querySelector("#close-ai");
const openAiButtons = document.querySelectorAll("[data-open-ai]");
const promptButtons = document.querySelectorAll("[data-ai-prompt]");
const homeSearch = document.querySelector("#home-search");
const homeOrigin = document.querySelector("#home-origin");
const homeDestination = document.querySelector("#home-destination");
const homeDate = document.querySelector("#home-date");
const transportInputs = [...document.querySelectorAll(".transport-picker input")];
const resultPanel = document.querySelector("#trip-result");
const readyTripCards = document.querySelectorAll("[data-ready-trip]");
const dialogEyebrow = document.querySelector(".dialog-header .eyebrow");
const miniChat = document.querySelector("#mini-chat");
const miniChatToggle = document.querySelector("#mini-chat-toggle");
const miniChatClose = document.querySelector("#mini-close");
const miniChatExpand = document.querySelector("#mini-expand");
const miniChatForm = document.querySelector("#mini-chat-form");
const miniChatInput = document.querySelector("#mini-chat-input");
const miniChatMessages = document.querySelector("#mini-messages");
const miniSendButton = document.querySelector("#mini-send");
const miniPromptButtons = document.querySelectorAll("[data-mini-prompt]");
const quickReplies = document.querySelector("#quick-replies");
const miniQuickReplies = document.querySelector("#mini-quick-replies");
const tripInputs = {
  origin: document.querySelector("#trip-origin"),
  destination: document.querySelector("#trip-destination"),
  departure_date: document.querySelector("#trip-date"),
  return_date: document.querySelector("#trip-return-date"),
  adults: document.querySelector("#trip-adults"),
  children: document.querySelector("#trip-children"),
  budget: document.querySelector("#trip-budget"),
  stage: document.querySelector("#trip-stage"),
};

const HISTORY_KEY = "tutu-ai-history";
const TRIP_KEY = "tutu-ai-trip";
let history = loadJson(HISTORY_KEY, []);

function loadJson(key, fallback) {
  try {
    return JSON.parse(sessionStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
}

function saveHistory() {
  history = history.slice(-20);
  sessionStorage.setItem(HISTORY_KEY, JSON.stringify(history));
}

function getTrip() {
  return {
    origin: tripInputs.origin.value.trim(),
    destination: tripInputs.destination.value.trim(),
    departure_date: tripInputs.departure_date.value,
    return_date: tripInputs.return_date.value,
    adults: Number(tripInputs.adults.value) || 1,
    children: Number(tripInputs.children.value) || 0,
    budget: tripInputs.budget.value ? Number(tripInputs.budget.value) : null,
    transport_modes: transportInputs.filter((item) => item.checked).map((item) => item.value),
    stage: tripInputs.stage.value || "collecting",
  };
}

function saveTrip() {
  sessionStorage.setItem(TRIP_KEY, JSON.stringify(getTrip()));
}

function restoreTrip() {
  const trip = loadJson(TRIP_KEY, {});
  Object.entries(tripInputs).forEach(([key, element]) => {
    if (trip[key] !== undefined) element.value = trip[key];
    element.addEventListener("input", () => {
      if (key !== "stage" && tripInputs.stage.value !== "collecting") {
        tripInputs.stage.value = "collecting";
        resultPanel.hidden = true;
        document.querySelector(".dialog-layout").classList.remove("has-result");
      }
      saveTrip();
    });
  });
  transportInputs.forEach((element) => {
    element.checked = (trip.transport_modes || []).includes(element.value);
    element.addEventListener("change", () => {
      tripInputs.stage.value = "collecting";
      resultPanel.hidden = true;
      document.querySelector(".dialog-layout").classList.remove("has-result");
      saveTrip();
    });
  });
}

function applyTripUpdate(update) {
  if (!update || typeof update !== "object") return;
  Object.entries(tripInputs).forEach(([key, element]) => {
    const value = update[key];
    if (value !== null && value !== undefined && value !== "") {
      element.value = value;
    }
  });
  if (Array.isArray(update.transport_modes)) {
    transportInputs.forEach((item) => {
      item.checked = update.transport_modes.includes(item.value);
    });
  }
  saveTrip();
}

function parseLocalMoment(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})[T\s](\d{2}):(\d{2})/);
  if (!match) return null;
  return { year: match[1], month: Number(match[2]), day: Number(match[3]), time: `${match[4]}:${match[5]}` };
}

function formatTravelInterval(departure, arrival) {
  const start = parseLocalMoment(departure);
  const end = parseLocalMoment(arrival);
  if (!start || !end) return [departure, arrival].filter(Boolean).join(" — ") || "—";
  const months = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
  const startDate = `${start.day} ${months[start.month - 1]}`;
  const endDate = `${end.day} ${months[end.month - 1]}`;
  const sameDate = start.year === end.year && start.month === end.month && start.day === end.day;
  return sameDate
    ? `${startDate}, ${start.time}–${end.time}`
    : `${startDate}, ${start.time} — ${endDate}, ${end.time}`;
}

function cardText(text, className) {
  const element = document.createElement("div");
  element.className = className;
  element.textContent = text || "—";
  return element;
}

function humanDate(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return value;
  const months = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
  return `${Number(match[3])} ${months[Number(match[2]) - 1]}`;
}

function formatHotelDates(value) {
  return String(value || "").replace(/\d{4}-\d{2}-\d{2}/g, humanDate);
}

function simplifyEndpoint(value, city) {
  let text = String(value || "—").trim();
  if (!city) return text;
  const escaped = city.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  text = text.replace(new RegExp(`^${escaped}\\s*(?:—|-|,|:)\\s*`, "i"), "");
  return text || value;
}

function renderLeg(target, leg, reverse = false, priceText = null) {
  const origin = tripInputs.origin.value || "Откуда";
  const destination = tripInputs.destination.value || "Куда";
  const route = reverse ? `${destination} → ${origin}` : `${origin} → ${destination}`;
  const fromCity = reverse ? destination : origin;
  const toCity = reverse ? origin : destination;
  target.replaceChildren(
    cardText(route, "card-primary"),
    cardText(`${simplifyEndpoint(leg?.from, fromCity)} → ${simplifyEndpoint(leg?.to, toCity)}`, "card-secondary"),
    cardText(formatTravelInterval(leg?.departure, leg?.arrival), "card-time"),
    cardText([leg?.carrier, leg?.duration].filter(Boolean).join(" · "), "card-meta-line"),
    cardText(priceText || (leg?.price ? `${Number(leg.price).toLocaleString("ru-RU")} ₽` : "Цена уточняется"), "card-price"),
  );
}

function renderHotel(target, hotel) {
  const rawMeal = String(hotel?.meal || "").trim();
  const meal = !rawMeal || rawMeal.toLocaleLowerCase("ru-RU").includes("не указан")
    ? "Питание не указано"
    : rawMeal;
  const extras = [meal, hotel?.rating ? `рейтинг ${hotel.rating}/10` : null].filter(Boolean).join(" · ");
  target.replaceChildren(
    cardText(hotel?.name, "card-primary"),
    cardText(hotel?.location, "card-secondary"),
    cardText(formatHotelDates(hotel?.dates), "card-time"),
    cardText(extras, "card-meta-line"),
    cardText(hotel?.price ? `${Number(hotel.price).toLocaleString("ru-RU")} ₽` : "Цена уточняется", "card-price"),
  );
}

function bookingLabel(link, direction = "") {
  const value = `${link.title || ""} ${link.url || ""}`.toLocaleLowerCase("ru-RU");
  if (value.includes("hotel") || value.includes("отел")) return "Забронировать отель";
  if (value.includes("avia") || value.includes("самол") || value.includes("рейс")) return "Посмотреть авиабилеты";
  if (value.includes("train") || value.includes("поезд") || value.includes("ж/д")) {
    return `Посмотреть поезда${direction ? ` ${direction}` : ""}`;
  }
  if (value.includes("bus") || value.includes("автобус")) {
    return `Посмотреть автобусы${direction ? ` ${direction}` : ""}`;
  }
  return "Открыть на Tutu";
}

function datedTransportUrl(rawUrl, direction) {
  const safeUrl = safeTutuUrl(rawUrl);
  if (!safeUrl) return null;
  try {
    const url = new URL(safeUrl);
    const isBus = url.hostname === "bus.tutu.ru";
    const isRail = url.hostname.endsWith("tutu.ru") && url.pathname.includes("/poezda/");
    const isAvia = url.hostname === "avia.tutu.ru";
    if (isAvia) {
      url.searchParams.set(
        "ff-b-avia_departure_time_0",
        "evening_departure_time",
      );
      url.searchParams.set(
        "ff-b-avia_arrival_time_1",
        "evening_arrival_time",
      );
      return url.toString();
    }
    if (!isBus && !isRail) return safeUrl;
    const isoDate = direction === "обратно"
      ? tripInputs.return_date.value
      : tripInputs.departure_date.value;
    if (!isoDate) return safeUrl;
    const [year, month, day] = isoDate.split("-");
    url.searchParams.set("date", `${day}.${month}.${year}`);
    const travelers = Number(tripInputs.adults.value || 1) + Number(tripInputs.children.value || 0);
    url.searchParams.set("travelers", String(travelers));
    if (isBus) url.searchParams.set("amount", String(travelers));
    return url.toString();
  } catch {
    return safeUrl;
  }
}

function busScheduleUrl(link, direction) {
  const safeUrl = safeTutuUrl(link.url);
  if (!safeUrl || !link.departure_id || !link.arrival_id) {
    return datedTransportUrl(link.url, direction);
  }
  try {
    const source = new URL(safeUrl);
    const routeParts = source.pathname.split("/").filter(Boolean);
    const originSlug = routeParts.at(-2);
    const destinationSlug = routeParts.at(-1);
    if (!originSlug || !destinationSlug) return datedTransportUrl(safeUrl, direction);
    const target = new URL(
      `/raspisanie/gorod_${originSlug}/gorod_${destinationSlug}/`,
      "https://bus.tutu.ru",
    );
    const isoDate = direction === "обратно"
      ? tripInputs.return_date.value
      : tripInputs.departure_date.value;
    if (isoDate) {
      const [year, month, day] = isoDate.split("-");
      target.searchParams.set("date", `${day}.${month}.${year}`);
    }
    const travelers = Number(tripInputs.adults.value || 1) + Number(tripInputs.children.value || 0);
    target.searchParams.set("amount", String(travelers));
    target.searchParams.set("from", String(link.departure_id));
    target.searchParams.set("to", String(link.arrival_id));
    target.searchParams.set("travelers", String(travelers));
    return target.toString();
  } catch {
    return datedTransportUrl(safeUrl, direction);
  }
}

function alignResultCardRows() {
  const rowClasses = ["card-primary", "card-secondary", "card-time", "card-meta-line"];
  rowClasses.forEach((className) => {
    const elements = [...resultPanel.querySelectorAll(`.${className}`)];
    elements.forEach((element) => { element.style.minHeight = "0"; });
    const tallest = Math.max(0, ...elements.map((element) => element.getBoundingClientRect().height));
    elements.forEach((element) => { element.style.minHeight = `${Math.ceil(tallest)}px`; });
  });
}

function renderTripResult(result, links = []) {
  if (!result) return;
  const destination = tripInputs.destination.value.trim();
  const modeIcons = { plane: "✈", train: "▰", bus: "▣" };
  const selectedMode = transportInputs.find((item) => item.checked)?.value;
  const travelIcon = modeIcons[selectedMode] || "↔";
  resultPanel.querySelectorAll(".result-block .result-icon")[0].textContent = travelIcon;
  resultPanel.querySelectorAll(".result-block .result-icon")[2].textContent = travelIcon;
  const hero = resultPanel.querySelector(".result-hero");
  const photoCredit = document.querySelector("#result-photo-credit");
  hero.style.backgroundImage = "linear-gradient(135deg, #17106b, #7257f5)";
  photoCredit.hidden = true;
  if (result.hero_image) {
    hero.style.backgroundImage = `url("${result.hero_image}")`;
  }
  const normalizedDestination = destination.toLocaleLowerCase("ru-RU");
  const instantImage = normalizedDestination.includes("петербург")
    ? "https://images.unsplash.com/photo-1556610961-2fecc5927173?auto=format&fit=crop&w=1400&q=85"
    : null;
  if (!result.hero_image && instantImage) {
    hero.style.backgroundImage = `url("${instantImage}")`;
    photoCredit.textContent = "Фото: Unsplash";
    photoCredit.href = "https://unsplash.com/";
    photoCredit.hidden = false;
  } else if (!result.hero_image && destination) {
    fetch(`/api/city-image?city=${encodeURIComponent(destination)}`)
      .then((response) => {
        if (!response.ok) throw new Error("Photo lookup failed");
        return response.json();
      })
      .then((photo) => {
        if (!photo?.url) return;
        const cityPhoto = new Image();
        cityPhoto.addEventListener("load", () => {
          hero.style.backgroundImage = `url("${photo.url}")`;
          photoCredit.textContent = `Фото: ${photo.credit_name || "Unsplash"}`;
          photoCredit.href = photo.credit_url || "https://unsplash.com/";
          photoCredit.hidden = false;
        }, { once: true });
        cityPhoto.src = photo.url;
      })
      .catch(() => {
        hero.style.backgroundImage =
          'url("https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=1600&q=82")';
        photoCredit.textContent = "Фото: Unsplash";
        photoCredit.href = "https://unsplash.com/";
        photoCredit.hidden = false;
      });
  }
  document.querySelector("#result-title").textContent = result.title;
  document.querySelector("#result-description").textContent = result.description;
  const roundTripPrice = result.outbound?.price_scope === "round_trip"
    || (result.outbound?.price && !result.return_trip?.price);
  const approximateLegPrice = roundTripPrice && result.outbound?.price
    ? Math.round(Number(result.outbound.price) / 2)
    : null;
  const outboundPriceText = approximateLegPrice
    ? `≈ ${approximateLegPrice.toLocaleString("ru-RU")} ₽`
    : null;
  const returnPriceText = approximateLegPrice
    ? `≈ ${approximateLegPrice.toLocaleString("ru-RU")} ₽`
    : null;
  renderLeg(document.querySelector("#result-outbound"), result.outbound, false, outboundPriceText);
  renderHotel(document.querySelector("#result-hotel"), result.hotel);
  renderLeg(document.querySelector("#result-return"), result.return_trip, true, returnPriceText);
  const pricesForTotal = roundTripPrice
    ? [result.outbound?.price, result.hotel?.price]
    : [result.outbound?.price, result.hotel?.price, result.return_trip?.price];
  const calculatedTotal = pricesForTotal
    .filter((price) => Number.isFinite(Number(price)))
    .reduce((sum, price) => sum + Number(price), 0);
  const totalPrice = calculatedTotal || result.total_price;
  document.querySelector("#result-price").textContent = totalPrice
    ? `${Number(totalPrice).toLocaleString("ru-RU")} ₽`
    : "Уточняется";
  const activities = document.querySelector("#result-activities");
  activities.replaceChildren(...(result.activities || []).slice(0, 3).map((activity) => {
    const item = document.createElement("li");
    const title = document.createElement("a");
    const mapQuery = String(
      activity.map_query || `${activity.title || "Интересное место"}, ${destination}`,
    ).trim();
    title.href = `https://yandex.ru/maps/?text=${encodeURIComponent(mapQuery)}`;
    title.target = "_blank";
    title.rel = "noopener noreferrer";
    title.className = "activity-map-link";
    title.textContent = activity.title || "Идея";
    title.setAttribute("aria-label", `${title.textContent}: открыть на Яндекс Картах`);
    const description = document.createElement("span");
    description.textContent = activity.description || "Можно добавить в маршрут";
    item.append(title, description);
    return item;
  }));
  const actions = document.querySelector("#result-actions");
  const uniqueLinks = links.filter((link, index, all) =>
    safeTutuUrl(link.url) && all.findIndex((item) => safeTutuUrl(item.url) === safeTutuUrl(link.url)) === index
  );
  let transportLinkIndex = 0;
  actions.replaceChildren(...uniqueLinks.map((link) => {
    const value = `${link.title || ""} ${link.url || ""}`.toLocaleLowerCase("ru-RU");
    const isHotel = link.kind === "hotel" || value.includes("hotel") || value.includes("отел");
    let direction = "";
    if (!isHotel) {
      if (value.includes("обратно")) direction = "обратно";
      else if (value.includes("туда")) direction = "туда";
      else direction = transportLinkIndex === 0 ? "туда" : "обратно";
      transportLinkIndex += 1;
    }
    const anchor = document.createElement("a");
    anchor.href = isHotel
      ? (safeTutuUrl(link.url) || "#")
      : link.kind === "bus"
        ? (busScheduleUrl(link, direction) || "#")
        : (datedTransportUrl(link.url, direction) || "#");
    anchor.target = "_blank";
    anchor.rel = "noopener noreferrer";
    anchor.textContent = bookingLabel(link, direction);
    return anchor;
  }));
  resultPanel.hidden = false;
  document.querySelector(".dialog-layout").classList.add("has-result");
  window.requestAnimationFrame(() => window.requestAnimationFrame(alignResultCardRows));
}

function safeTutuUrl(rawUrl) {
  if (typeof rawUrl !== "string" || /%(?![0-9a-f]{2})/i.test(rawUrl)) {
    return null;
  }
  try {
    const parsed = new URL(rawUrl);
    const isHttp = parsed.protocol === "https:" || parsed.protocol === "http:";
    const isTutu =
      parsed.hostname === "tutu.ru" || parsed.hostname.endsWith(".tutu.ru");
    return isHttp && isTutu ? parsed.href : null;
  } catch {
    return null;
  }
}

function appendStructuredLinks(parent, text, links) {
  let remaining = text;
  const usableLinks = links
    .map((link) => ({
      title: link?.title,
      url: safeTutuUrl(link?.url),
    }))
    .filter((link) => typeof link.title === "string" && link.title.length && link.url);

  while (remaining) {
    const lower = remaining.toLocaleLowerCase();
    let match = null;
    for (const link of usableLinks) {
      const index = lower.indexOf(link.title.toLocaleLowerCase());
      if (index >= 0 && (!match || index < match.index)) {
        match = { index, link };
      }
    }

    if (!match) {
      parent.append(document.createTextNode(remaining));
      return;
    }

    if (match.index > 0) {
      parent.append(document.createTextNode(remaining.slice(0, match.index)));
    }
    const label = remaining.slice(
      match.index,
      match.index + match.link.title.length,
    );
    const anchor = document.createElement("a");
    anchor.href = match.link.url;
    anchor.target = "_blank";
    anchor.rel = "noopener noreferrer";
    anchor.textContent = label;
    parent.append(anchor);
    remaining = remaining.slice(match.index + match.link.title.length);
  }
}

function appendLinkedText(parent, text, links) {
  const markdownLink = /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/i;
  let remaining = text;

  while (remaining) {
    const match = remaining.match(markdownLink);
    if (!match || match.index === undefined) {
      appendStructuredLinks(parent, remaining, links);
      return;
    }

    appendStructuredLinks(parent, remaining.slice(0, match.index), links);
    const safeUrl = safeTutuUrl(match[2]);
    if (safeUrl) {
      const anchor = document.createElement("a");
      anchor.href = safeUrl;
      anchor.target = "_blank";
      anchor.rel = "noopener noreferrer";
      anchor.textContent = match[1];
      parent.append(anchor);
    } else {
      parent.append(document.createTextNode(match[1]));
    }
    remaining = remaining.slice(match.index + match[0].length);
  }
}

function renderRichText(parent, text, links) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  parts.forEach((part) => {
    const isBold = part.startsWith("**") && part.endsWith("**");
    const target = isBold ? document.createElement("strong") : parent;
    const content = isBold ? part.slice(2, -2) : part;
    appendLinkedText(target, content, links);
    if (isBold) parent.append(target);
  });
}

function appendFollowUp(article, followUp) {
  if (!followUp) return;
  const question = document.createElement("div");
  question.className = "follow-up";
  question.textContent = followUp;
  article.append(question);
}

function plainTextForTyping(text) {
  return text
    .replace(/\[([^\]\n]+)\]\(https?:\/\/[^\s)]+\)/gi, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1");
}

function animateAssistantMessage(text, links = [], followUp = null) {
  const article = document.createElement("article");
  article.className = "message assistant typing";
  article.title = "Нажмите, чтобы показать ответ целиком";

  const body = document.createElement("div");
  body.className = "message-bubble";
  article.append(body);
  messages.append(article);
  messages.scrollTop = messages.scrollHeight;

  const mainTypingText = plainTextForTyping(text);
  const completeTypingText = followUp
    ? `${mainTypingText}\n\n${followUp}`
    : mainTypingText;
  const chunkSize = Math.max(4, Math.ceil(completeTypingText.length / 180));
  let position = 0;
  let finished = false;
  let timerId = null;

  function finish() {
    if (finished) return;
    finished = true;
    if (timerId !== null) window.clearTimeout(timerId);
    article.classList.remove("typing");
    article.removeAttribute("title");
    body.replaceChildren();
    renderRichText(body, text, links);
    appendFollowUp(body, followUp);
    messages.scrollTop = messages.scrollHeight;
  }

  function tick() {
    position = Math.min(position + chunkSize, completeTypingText.length);
    body.textContent = completeTypingText.slice(0, position);
    messages.scrollTop = messages.scrollHeight;
    if (position >= completeTypingText.length) {
      finish();
      return;
    }
    timerId = window.setTimeout(tick, 14);
  }

  article.addEventListener("click", finish, { once: true });
  tick();
  return article;
}

function addMessage(text, role, links = [], followUp = null) {
  const article = document.createElement("article");
  article.className = `message ${role}`;

  const body = document.createElement("div");
  body.className = "message-bubble";
  renderRichText(body, text, links);
  article.append(body);

  appendFollowUp(body, followUp);

  messages.append(article);
  messages.scrollTop = messages.scrollHeight;
  return article;
}

function renderSavedHistory() {
  if (!Array.isArray(history) || !history.length) {
    renderQuickReplies();
    return;
  }
  messages.innerHTML = "";
  history.forEach((item) => {
    addMessage(item.content, item.role, item.links || []);
  });
  const lastAssistant = [...history].reverse().find((item) => item.role === "assistant");
  renderQuickReplies(lastAssistant?.quick_replies || []);
}

function renderQuickReplies(values = []) {
  const suggestions = [...new Set(
    values.filter((value) => typeof value === "string" && value.trim())
      .map((value) => value.trim()),
  )].slice(0, 3);
  const finalSuggestions = suggestions.length
    ? suggestions
    : ["Предложи варианты", "Эти выходные", "Заполнить параметры"];

  [quickReplies, miniQuickReplies].forEach((container) => {
    container.replaceChildren(...finalSuggestions.map((label) => {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.quickReply = label;
      button.textContent = label;
      return button;
    }));
  });
}

function submitQuickReply(value, fromMini = false) {
  if (!value || sendButton.disabled) return;
  if (fromMini) {
    miniChatInput.value = value;
    miniChatForm.requestSubmit();
  } else {
    input.value = value;
    form.requestSubmit();
  }
}

function syncMiniMessages() {
  if (!miniChatMessages) return;
  const sourceMessages = [...messages.querySelectorAll(".message")].slice(-8);
  miniChatMessages.replaceChildren();
  sourceMessages.forEach((source) => {
    const article = document.createElement("article");
    const role = source.classList.contains("user")
      ? "user"
      : source.classList.contains("error")
        ? "error"
        : "assistant";
    article.className = `mini-chat-message ${role}`;
    const bubble = document.createElement("div");
    bubble.textContent = source.textContent.trim();
    article.append(bubble);
    miniChatMessages.append(article);
  });
  miniChatMessages.scrollTop = miniChatMessages.scrollHeight;
}

function openMiniChat() {
  miniChat.hidden = false;
  miniChatToggle.setAttribute("aria-expanded", "true");
  syncMiniMessages();
  window.setTimeout(() => miniChatInput.focus(), 50);
}

function closeMiniChat() {
  miniChat.hidden = true;
  miniChatToggle.setAttribute("aria-expanded", "false");
}

proxyButton.addEventListener("click", async () => {
  proxyButton.disabled = true;
  proxyButton.textContent = "Проверяем…";
  try {
    const payload = await checkProxy();
    proxyButton.textContent = `Прокси: ${payload.ip}`;
    proxyButton.classList.add("ok");
  } catch (error) {
    proxyButton.textContent = "Прокси недоступен";
    proxyButton.classList.remove("ok");
    addMessage(error.message, "error");
  } finally {
    proxyButton.disabled = false;
  }
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const message = input.value.trim();
  if (!message) return;

  addMessage(message, "user");
  input.value = "";
  quickReplies.replaceChildren();
  miniQuickReplies.replaceChildren();
  sendButton.disabled = true;
  const pending = addMessage("Ищу ответ…", "assistant pending");

  try {
    const payload = await sendChat({
      message,
      history: history.map(({ role, content }) => ({ role, content })),
      trip: getTrip(),
    });
    pending.remove();
    applyTripUpdate(payload.trip_update);
    tripInputs.stage.value = payload.stage || "collecting";
    saveTrip();
    if (payload.trip_result) {
      renderTripResult(payload.trip_result, payload.links || []);
    } else if (payload.stage !== "result") {
      resultPanel.hidden = true;
      document.querySelector(".dialog-layout").classList.remove("has-result");
    }
    const canonicalMessageText = (value) =>
      String(value || "")
        .toLocaleLowerCase("ru-RU")
        .replace(/[^\p{L}\p{N}]+/gu, " ")
        .trim();
    const normalizedReply = canonicalMessageText(payload.reply);
    const normalizedQuestion = canonicalMessageText(
      payload.follow_up_question,
    );
    const questionAlreadyInReply =
      normalizedQuestion &&
      (normalizedReply.includes(normalizedQuestion) ||
        normalizedQuestion.includes(normalizedReply));
    const separateFollowUp =
      normalizedQuestion && !questionAlreadyInReply
        ? payload.follow_up_question
        : null;
    animateAssistantMessage(
      payload.reply,
      payload.links || [],
      separateFollowUp,
    );
    renderQuickReplies(payload.quick_replies || []);
    const assistantContext = separateFollowUp
      ? `${payload.reply}\n\n${separateFollowUp}`
      : payload.reply;
    history.push(
      { role: "user", content: message },
      {
        role: "assistant",
        content: assistantContext,
        links: payload.links || [],
        quick_replies: payload.quick_replies || [],
      },
    );
    saveHistory();
    proxyButton.textContent = `Прокси: ${payload.proxy_ip}`;
    proxyButton.classList.add("ok");
  } catch (error) {
    pending.remove();
    addMessage(error.message, "error");
  } finally {
    sendButton.disabled = false;
    input.focus();
  }
});

newChatButton.addEventListener("click", () => {
  history = [];
  sessionStorage.removeItem(HISTORY_KEY);
  messages.innerHTML = "";
  tripInputs.stage.value = "collecting";
  saveTrip();
  resultPanel.hidden = true;
  document.querySelector(".dialog-layout").classList.remove("has-result");
  addMessage("Привет! Опиши поездку — или скажи, что нравится, и я предложу варианты.", "assistant");
  renderQuickReplies();
  input.focus();
});

input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    form.requestSubmit();
  }
});

restoreTrip();
renderSavedHistory();
syncMiniMessages();

const miniMessagesObserver = new MutationObserver(() => {
  window.requestAnimationFrame(syncMiniMessages);
});
miniMessagesObserver.observe(messages, {
  childList: true,
  subtree: true,
  characterData: true,
});

const sendStateObserver = new MutationObserver(() => {
  miniSendButton.disabled = sendButton.disabled;
});
sendStateObserver.observe(sendButton, {
  attributes: true,
  attributeFilter: ["disabled"],
});

function openAi() {
  aiModal.classList.remove("ready-trip-mode");
  document.querySelector("#ai-title").textContent = "Джарвел";
  dialogEyebrow.textContent = "Ваш AI-путеводитель";
  aiModal.classList.add("is-open");
  aiModal.setAttribute("aria-hidden", "false");
  document.body.classList.add("modal-open");
  window.setTimeout(() => input.focus(), 80);
}

function openReadyTrip(key) {
  const trip = READY_TRIPS[key];
  if (!trip) return;
  tripInputs.origin.value = "Москва";
  tripInputs.destination.value = trip.destination;
  tripInputs.departure_date.value = trip.departure_date;
  tripInputs.return_date.value = trip.return_date;
  tripInputs.adults.value = "1";
  tripInputs.children.value = "0";
  transportInputs.forEach((item) => { item.checked = item.value === trip.transport; });
  aiModal.classList.add("ready-trip-mode", "is-open");
  aiModal.setAttribute("aria-hidden", "false");
  document.body.classList.add("modal-open");
  document.querySelector("#ai-title").textContent = "Готовая поездка";
  dialogEyebrow.textContent = "Подборка для вас";
  renderTripResult(trip, trip.links);
}

function closeAi() {
  aiModal.classList.remove("is-open");
  aiModal.setAttribute("aria-hidden", "true");
  document.body.classList.remove("modal-open");
}

function syncHomeSearchFromTrip() {
  if (!homeOrigin.value) homeOrigin.value = tripInputs.origin.value;
  if (!homeDestination.value) homeDestination.value = tripInputs.destination.value;
  if (!homeDate.value) homeDate.value = tripInputs.departure_date.value;
}

openAiButtons.forEach((button) => button.addEventListener("click", openAi));
miniChatToggle.addEventListener("click", () => {
  if (miniChat.hidden) openMiniChat();
  else closeMiniChat();
});
miniChatClose.addEventListener("click", closeMiniChat);
miniChatExpand.addEventListener("click", () => {
  closeMiniChat();
  openAi();
});
miniChatForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const message = miniChatInput.value.trim();
  if (!message || sendButton.disabled) return;
  input.value = message;
  miniChatInput.value = "";
  form.requestSubmit();
});
miniPromptButtons.forEach((button) => {
  button.addEventListener("click", () => {
    miniChatInput.value = button.dataset.miniPrompt || "";
    miniChatForm.requestSubmit();
  });
});
quickReplies.addEventListener("click", (event) => {
  const button = event.target.closest("[data-quick-reply], button");
  if (button) submitQuickReply(button.dataset.quickReply || button.textContent);
});
miniQuickReplies.addEventListener("click", (event) => {
  const button = event.target.closest("[data-quick-reply], button");
  if (button) {
    submitQuickReply(
      button.dataset.quickReply || button.dataset.miniPrompt || button.textContent,
      true,
    );
  }
});
readyTripCards.forEach((card) => {
  card.addEventListener("click", () => openReadyTrip(card.dataset.readyTrip));
  card.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openReadyTrip(card.dataset.readyTrip);
    }
  });
});
closeAiButton.addEventListener("click", closeAi);
aiModal.addEventListener("click", (event) => {
  if (event.target === aiModal) closeAi();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && aiModal.classList.contains("is-open")) closeAi();
});

promptButtons.forEach((button) => {
  button.addEventListener("click", () => {
    input.value = button.dataset.aiPrompt || "";
    openAi();
  });
});

homeSearch.addEventListener("submit", (event) => {
  event.preventDefault();
  const origin = homeOrigin.value.trim();
  const destination = homeDestination.value.trim();
  const date = homeDate.value;

  if (origin) tripInputs.origin.value = origin;
  if (destination) tripInputs.destination.value = destination;
  if (date) tripInputs.departure_date.value = date;
  saveTrip();

  const route = destination
    ? `из ${origin || "моего города"} в ${destination}`
    : `из ${origin || "моего города"}, направление пока не выбрано`;
  const datePart = date ? ` на ${date.split("-").reverse().join(".")}` : "";
  input.value = `Помоги подобрать поездку ${route}${datePart}`;
  openAi();
});

syncHomeSearchFromTrip();

resultPanel.addEventListener("click", (event) => {
  const button = event.target.closest("[data-result-prompt]");
  if (!button) return;
  input.value = button.dataset.resultPrompt;
  input.focus();
});

window.addEventListener("resize", () => {
  if (!resultPanel.hidden) alignResultCardRows();
});

initTransportFilters();

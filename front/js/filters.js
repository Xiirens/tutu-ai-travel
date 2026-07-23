export function initTransportFilters() {
  const filters = document.querySelectorAll("[data-transport-filter]");
  const cards = document.querySelectorAll("[data-transport]");

  filters.forEach((button) => {
    button.addEventListener("click", () => {
      const selected = button.dataset.transportFilter;
      filters.forEach((item) => item.classList.toggle("active", item === button));
      cards.forEach((card) => {
        const visible = selected === "all" || card.dataset.transport === selected;
        card.classList.toggle("is-hidden", !visible);
      });
    });
  });
}

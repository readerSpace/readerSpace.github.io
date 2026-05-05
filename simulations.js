const revealObserver = new IntersectionObserver(
    (entries) => {
        entries.forEach((entry) => {
            if (entry.isIntersecting) {
                entry.target.classList.add("is-visible");
                revealObserver.unobserve(entry.target);
            }
        });
    },
    {
        threshold: 0.18,
        rootMargin: "0px 0px -40px 0px"
    }
);

document.querySelectorAll(".reveal, .site-footer").forEach((element) => {
    if (!element.classList.contains("is-visible")) {
        revealObserver.observe(element);
    }
});

const filterButtons = document.querySelectorAll(".filter-chip");
const simulationCards = document.querySelectorAll(".simulation-card");

const applyFilter = (filterName) => {
    simulationCards.forEach((card) => {
        const groups = (card.dataset.groups || "").split(" ").filter(Boolean);
        const shouldShow = filterName === "all" || groups.includes(filterName);
        card.classList.toggle("is-hidden", !shouldShow);
    });

    filterButtons.forEach((button) => {
        button.classList.toggle("is-active", button.dataset.filter === filterName);
    });
};

filterButtons.forEach((button) => {
    button.addEventListener("click", () => {
        applyFilter(button.dataset.filter || "all");
    });
});

applyFilter("all");
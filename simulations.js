const filterButtons = document.querySelectorAll(".filter-chip");
const simulationCards = document.querySelectorAll(".simulation-card");
const previewCards = document.querySelectorAll(".featured-card, .simulation-card");
const catalogGrid = document.querySelector(".catalog-grid");
const featuredGrid = document.querySelector(".featured-grid");

const easyToHardFeaturedOrder = [
    "boids.html",
    "sand.html",
    "chladni.html",
    "double-pendulum.html"
];

const easyToHardCatalogOrder = [
    "friction.html",
    "sky.html",
    "rainbow.html",
    "function-shapes.html",
    "water-oil.html",
    "boiling-concentration.html",
    "ph.html",
    "plant-growth.html",
    "fossilization.html",
    "engine.html",
    "pet-bottle-bike.html",
    "sand.html",
    "wave.html",
    "chladni.html",
    "fire-smoke.html",
    "boids.html",
    "ants.html",
    "predator-prey.html",
    "flower-evolution.html",
    "life-game.html",
    "money-flow.html",
    "turing-machine.html",
    "nuclear-power.html",
    "earth-temperature.html",
    "lightning.html",
    "electric-magnetic.html",
    "magnetization.html",
    "antenna.html",
    "eddy-current.html",
    "lorentz-force.html",
    "laser.html",
    "gem-light.html",
    "chemical-reaction.html",
    "synapse.html",
    "force-chain.html",
    "lava-solidification.html",
    "snowflake.html",
    "reaction-diffusion.html",
    "ising-model.html",
    "spinning-top.html",
    "celestial.html",
    "solar-wind.html",
    "double-pendulum.html",
    "chaos.html",
    "lyapunov.html",
    "poincare.html",
    "complex-plane.html",
    "classical-quantum.html",
    "hydrogen-orbital.html",
    "stellar-fusion.html",
    "simulation.html",
    "statistics.html"
];

const sortCardsByEase = () => {
    if (!catalogGrid) {
        return;
    }

    const rankByHref = new Map(
        easyToHardCatalogOrder.map((href, index) => [href, index])
    );

    const cards = Array.from(catalogGrid.querySelectorAll(".simulation-card"));
    const cardsWithIndex = cards.map((card, index) => ({ card, index }));

    cardsWithIndex.sort((left, right) => {
        const leftHref = left.card.querySelector('a[href$=".html"]')?.getAttribute("href") || "";
        const rightHref = right.card.querySelector('a[href$=".html"]')?.getAttribute("href") || "";
        const leftRank = rankByHref.get(leftHref) ?? Number.MAX_SAFE_INTEGER;
        const rightRank = rankByHref.get(rightHref) ?? Number.MAX_SAFE_INTEGER;

        if (leftRank !== rightRank) {
            return leftRank - rightRank;
        }

        return left.index - right.index;
    });

    cardsWithIndex.forEach(({ card }) => {
        catalogGrid.append(card);
    });
};

const sortFeaturedCardsByEase = () => {
    if (!featuredGrid) {
        return;
    }

    const rankByHref = new Map(
        easyToHardFeaturedOrder.map((href, index) => [href, index])
    );

    const cards = Array.from(featuredGrid.querySelectorAll(".featured-card"));
    const cardsWithIndex = cards.map((card, index) => ({ card, index }));

    cardsWithIndex.sort((left, right) => {
        const leftHref = left.card.querySelector('a[href$=".html"]')?.getAttribute("href") || "";
        const rightHref = right.card.querySelector('a[href$=".html"]')?.getAttribute("href") || "";
        const leftRank = rankByHref.get(leftHref) ?? Number.MAX_SAFE_INTEGER;
        const rightRank = rankByHref.get(rightHref) ?? Number.MAX_SAFE_INTEGER;

        if (leftRank !== rightRank) {
            return leftRank - rightRank;
        }

        return left.index - right.index;
    });

    cardsWithIndex.forEach(({ card }) => {
        featuredGrid.append(card);
    });
};

const attachCardSnapshots = () => {
    previewCards.forEach((card) => {
        if (card.querySelector(".card-snapshot")) {
            return;
        }

        const link = card.querySelector('a[href$=".html"]');
        const title = card.querySelector("h3")?.textContent?.trim() || "シミュレーション";
        const href = link?.getAttribute("href");

        if (!href) {
            return;
        }

        const snapshotPath = `assets/simulation-previews/${href.replace(/\.html$/i, ".png")}`;
        const preview = document.createElement("div");
        preview.className = "card-snapshot";

        const image = document.createElement("img");
        image.src = snapshotPath;
        image.alt = `${title} のスナップショット`;
        image.loading = "lazy";
        image.decoding = "async";
        image.addEventListener("error", () => {
            preview.remove();
        });

        preview.append(image);
        card.insertBefore(preview, card.firstElementChild);
    });
};

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

sortFeaturedCardsByEase();
sortCardsByEase();
attachCardSnapshots();
applyFilter("all");
const filterButtons = document.querySelectorAll(".filter-chip");
const simulationCards = document.querySelectorAll(".simulation-card");
const previewCards = document.querySelectorAll(".featured-card, .simulation-card");

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

attachCardSnapshots();
applyFilter("all");
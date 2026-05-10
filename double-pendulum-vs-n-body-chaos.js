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

const sectionLinks = Array.from(document.querySelectorAll('.site-nav a[href^="#"]'));
const sectionTargets = sectionLinks
    .map((link) => document.querySelector(link.getAttribute("href")))
    .filter(Boolean);

const activateLinkForSection = (activeSection) => {
    sectionLinks.forEach((link) => {
        const href = link.getAttribute("href");
        link.classList.toggle("is-active", href === `#${activeSection.id}`);
    });
};

const navObserver = new IntersectionObserver(
    (entries) => {
        const visibleEntries = entries
            .filter((entry) => entry.isIntersecting)
            .sort((left, right) => right.intersectionRatio - left.intersectionRatio);

        if (visibleEntries.length > 0) {
            activateLinkForSection(visibleEntries[0].target);
        }
    },
    {
        threshold: [0.2, 0.35, 0.55],
        rootMargin: "-18% 0px -54% 0px"
    }
);

sectionTargets.forEach((section) => navObserver.observe(section));
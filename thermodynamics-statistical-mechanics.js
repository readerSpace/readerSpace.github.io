(() => {
    const targets = document.querySelectorAll('.reveal, .site-footer');
    if (!targets.length) return;

    if (!('IntersectionObserver' in window)) {
        targets.forEach((element) => element.classList.add('is-visible'));
        return;
    }

    const observer = new IntersectionObserver((entries) => {
        for (const entry of entries) {
            if (entry.isIntersecting) {
                entry.target.classList.add('is-visible');
                observer.unobserve(entry.target);
            }
        }
    }, { threshold: 0.16 });

    targets.forEach((element) => observer.observe(element));
})();
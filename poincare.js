const revealTargets = document.querySelectorAll(".reveal");

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

revealTargets.forEach((target) => {
    if (!target.classList.contains("is-visible")) {
        revealObserver.observe(target);
    }
});

const kSlider = document.querySelector("#kStrength");
const kValue = document.querySelector("#kValue");
const regimeLabel = document.querySelector("#regimeLabel");
const patternLabel = document.querySelector("#patternLabel");
const insightLabel = document.querySelector("#insightLabel");
const presetButtons = document.querySelectorAll(".preset-button");
const canvas = document.querySelector("#poincareCanvas");

const TAU = Math.PI * 2;

const wrapAngle = (value) => {
    const wrapped = value % TAU;
    return wrapped < 0 ? wrapped + TAU : wrapped;
};

const standardMapStep = (theta, momentum, strength) => {
    const nextMomentum = wrapAngle(momentum + strength * Math.sin(theta));
    const nextTheta = wrapAngle(theta + nextMomentum);

    return { theta: nextTheta, momentum: nextMomentum };
};

const buildSeeds = () => {
    const seeds = [];
    const columns = 9;
    const rows = 7;

    for (let row = 0; row < rows; row += 1) {
        for (let column = 0; column < columns; column += 1) {
            const theta = wrapAngle(TAU * ((column + 0.45 + (row % 2) * 0.18) / columns));
            const momentum = wrapAngle(TAU * ((row + 0.55) / rows));

            seeds.push({ theta, momentum, group: row % 3 });
        }
    }

    return seeds;
};

const resizeCanvas = () => {
    if (!canvas) {
        return;
    }

    const context = canvas.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();

    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
};

const buildPointCloud = (strength) => {
    const colors = ["rgba(22, 82, 106, 0.76)", "rgba(231, 164, 75, 0.72)", "rgba(29, 112, 138, 0.68)"];
    const groups = colors.map((color) => ({ color, points: [] }));
    const seeds = buildSeeds();

    seeds.forEach((seed) => {
        let theta = seed.theta;
        let momentum = seed.momentum;

        for (let iteration = 0; iteration < 180; iteration += 1) {
            const next = standardMapStep(theta, momentum, strength);

            theta = next.theta;
            momentum = next.momentum;

            if (iteration >= 12) {
                groups[seed.group].points.push({ theta, momentum });
            }
        }
    });

    return groups;
};

const drawPointCloud = (strength) => {
    if (!canvas) {
        return;
    }

    const context = canvas.getContext("2d");
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const padding = { top: 20, right: 22, bottom: 38, left: 46 };
    const plotSize = Math.min(width - padding.left - padding.right, height - padding.top - padding.bottom);
    const originX = padding.left + (width - padding.left - padding.right - plotSize) / 2;
    const originY = padding.top + (height - padding.top - padding.bottom - plotSize) / 2;
    const groups = buildPointCloud(strength);

    context.clearRect(0, 0, width, height);
    context.fillStyle = "#fdf9f2";
    context.fillRect(0, 0, width, height);

    context.strokeStyle = "rgba(16, 37, 45, 0.08)";
    context.lineWidth = 1;

    for (let index = 0; index <= 4; index += 1) {
        const offset = (plotSize / 4) * index;

        context.beginPath();
        context.moveTo(originX, originY + offset);
        context.lineTo(originX + plotSize, originY + offset);
        context.stroke();

        context.beginPath();
        context.moveTo(originX + offset, originY);
        context.lineTo(originX + offset, originY + plotSize);
        context.stroke();
    }

    context.strokeStyle = "#10252d";
    context.lineWidth = 1.2;
    context.strokeRect(originX, originY, plotSize, plotSize);

    groups.forEach((group) => {
        context.fillStyle = group.color;

        group.points.forEach((point) => {
            const x = originX + plotSize * (point.theta / TAU);
            const y = originY + plotSize * (1 - point.momentum / TAU);

            context.fillRect(x, y, 1.8, 1.8);
        });
    });

    context.fillStyle = "#5a7179";
    context.font = "12px IBM Plex Sans JP";
    context.fillText("p", 14, originY + 10);
    context.fillText("θ", originX + plotSize - 4, originY + plotSize + 28);

    const tickLabels = ["0", "π", "2π"];
    const tickPositions = [0, 0.5, 1];

    tickPositions.forEach((position, index) => {
        const label = tickLabels[index];
        const x = originX + plotSize * position;
        const y = originY + plotSize * (1 - position);

        context.fillText(label, x - 8, originY + plotSize + 18);
        context.fillText(label, originX - 26, y + 4);
    });
};

const describeStrength = (strength) => {
    if (strength < 0.8) {
        return {
            regime: "ほぼ規則",
            pattern: "点は滑らかな曲線に沿う",
            insight: "トーラスがまだ壊れにくい"
        };
    }

    if (strength < 1.6) {
        return {
            regime: "島と海が共存",
            pattern: "曲線と散乱点が混ざる",
            insight: "共鳴が重なり始める"
        };
    }

    return {
        regime: "広いカオス",
        pattern: "点が広く散らばる",
        insight: "規則構造が大きく壊れる"
    };
};

const updatePresetState = (strength) => {
    presetButtons.forEach((button) => {
        const isMatch = Number(button.dataset.k).toFixed(1) === strength.toFixed(1);
        button.classList.toggle("is-active", isMatch);
    });
};

const updateDemo = () => {
    if (!kSlider) {
        return;
    }

    const strength = Number(kSlider.value) / 10;
    const description = describeStrength(strength);

    kValue.textContent = strength.toFixed(1);
    regimeLabel.textContent = description.regime;
    patternLabel.textContent = description.pattern;
    insightLabel.textContent = description.insight;
    updatePresetState(strength);
    drawPointCloud(strength);
};

if (canvas) {
    resizeCanvas();
    updateDemo();

    window.addEventListener("resize", () => {
        resizeCanvas();
        updateDemo();
    });
}

kSlider?.addEventListener("input", updateDemo);

presetButtons.forEach((button) => {
    button.addEventListener("click", () => {
        if (!kSlider) {
            return;
        }

        kSlider.value = String(Math.round(Number(button.dataset.k) * 10));
        updateDemo();
    });
});
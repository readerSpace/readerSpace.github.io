const revealTargets = document.querySelectorAll(".reveal");
const footer = document.querySelector(".site-footer");

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

if (footer) {
    revealObserver.observe(footer);
}

const deltaSlider = document.querySelector("#deltaPower");
const parameterSlider = document.querySelector("#parameterA");
const deltaValue = document.querySelector("#deltaValue");
const parameterValue = document.querySelector("#parameterValue");
const initialPair = document.querySelector("#initialPair");
const divergenceStep = document.querySelector("#divergenceStep");
const finalDifference = document.querySelector("#finalDifference");
const canvas = document.querySelector("#chaosCanvas");

const x0 = 0.321;
const steps = 40;

const logisticNext = (value, parameter) => parameter * value * (1 - value);

const buildSequence = (start, parameter, count) => {
    const values = [start];
    let current = start;

    for (let index = 0; index < count; index += 1) {
        current = logisticNext(current, parameter);
        values.push(current);
    }

    return values;
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

const drawChart = (seriesA, seriesB) => {
    if (!canvas) {
        return;
    }

    const context = canvas.getContext("2d");
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const padding = { top: 18, right: 18, bottom: 36, left: 44 };
    const chartWidth = width - padding.left - padding.right;
    const chartHeight = height - padding.top - padding.bottom;

    context.clearRect(0, 0, width, height);
    context.fillStyle = "#fcfaf5";
    context.fillRect(0, 0, width, height);

    context.strokeStyle = "rgba(16, 35, 41, 0.08)";
    context.lineWidth = 1;

    for (let row = 0; row <= 4; row += 1) {
        const y = padding.top + (chartHeight / 4) * row;
        context.beginPath();
        context.moveTo(padding.left, y);
        context.lineTo(width - padding.right, y);
        context.stroke();
    }

    for (let column = 0; column <= 8; column += 1) {
        const x = padding.left + (chartWidth / 8) * column;
        context.beginPath();
        context.moveTo(x, padding.top);
        context.lineTo(x, height - padding.bottom);
        context.stroke();
    }

    context.strokeStyle = "#102329";
    context.lineWidth = 1.2;
    context.beginPath();
    context.moveTo(padding.left, padding.top);
    context.lineTo(padding.left, height - padding.bottom);
    context.lineTo(width - padding.right, height - padding.bottom);
    context.stroke();

    const plotSeries = (values, color) => {
        context.strokeStyle = color;
        context.lineWidth = 3;
        context.beginPath();

        values.forEach((value, index) => {
            const x = padding.left + (chartWidth * index) / steps;
            const y = padding.top + chartHeight * (1 - value);

            if (index === 0) {
                context.moveTo(x, y);
            } else {
                context.lineTo(x, y);
            }
        });

        context.stroke();
    };

    plotSeries(seriesA, "#0e6f74");
    plotSeries(seriesB, "#f0b665");

    context.fillStyle = "#58717a";
    context.font = "12px IBM Plex Sans JP";
    context.fillText("x", 12, padding.top + 8);
    context.fillText("n", width - padding.right - 4, height - 10);

    for (let row = 0; row <= 4; row += 1) {
        const value = (1 - row / 4).toFixed(2);
        const y = padding.top + (chartHeight / 4) * row + 4;
        context.fillText(value, 8, y);
    }

    for (let column = 0; column <= 8; column += 1) {
        const value = Math.round((steps / 8) * column);
        const x = padding.left + (chartWidth / 8) * column - 6;
        context.fillText(String(value), x, height - 14);
    }
};

const updateDemo = () => {
    if (!deltaSlider || !parameterSlider) {
        return;
    }

    const delta = 10 ** (-Number(deltaSlider.value));
    const parameter = Number(parameterSlider.value) / 10;
    const sequenceA = buildSequence(x0, parameter, steps);
    const sequenceB = buildSequence(x0 + delta, parameter, steps);
    const stepIndex = sequenceA.findIndex((value, index) => Math.abs(value - sequenceB[index]) >= 0.1);
    const finalDelta = Math.abs(sequenceA[steps] - sequenceB[steps]);

    deltaValue.textContent = `10^-${deltaSlider.value}`;
    parameterValue.textContent = parameter.toFixed(1);
    initialPair.textContent = `${x0.toFixed(6)} / ${(x0 + delta).toFixed(6)}`;
    divergenceStep.textContent = stepIndex === -1 ? "まだ近い" : `n = ${stepIndex}`;
    finalDifference.textContent = finalDelta.toFixed(3);

    drawChart(sequenceA, sequenceB);
};

if (canvas) {
    resizeCanvas();
    updateDemo();
    window.addEventListener("resize", () => {
        resizeCanvas();
        updateDemo();
    });
}

deltaSlider?.addEventListener("input", updateDemo);
parameterSlider?.addEventListener("input", updateDemo);
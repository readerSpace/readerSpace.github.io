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

const setMultilineContent = (element, lines) => {
    if (!element) {
        return;
    }

    element.innerHTML = "";

    lines.forEach((line) => {
        const span = document.createElement("span");
        span.innerHTML = line;
        element.appendChild(span);
    });
};

const prepareCanvas = (canvas, context) => {
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    const nextWidth = Math.max(1, Math.round(width * dpr));
    const nextHeight = Math.max(1, Math.round(height * dpr));

    if (canvas.width !== nextWidth || canvas.height !== nextHeight) {
        canvas.width = nextWidth;
        canvas.height = nextHeight;
    }

    context.setTransform(dpr, 0, 0, dpr, 0, 0);

    return { width, height };
};

const measurementStrengthInput = document.querySelector("#measurementStrength");
const measurementStrengthValue = document.querySelector("#measurementStrengthValue");
const visibilityValue = document.querySelector("#visibilityValue");
const regimeValue = document.querySelector("#regimeValue");
const slitFormula = document.querySelector("#slitFormula");
const slitNote = document.querySelector("#slitNote");
const slitCanvas = document.querySelector("#slitCanvas");
const slitContext = slitCanvas?.getContext("2d");

const describeSlitMode = (strength) => {
    if (strength < 0.2) {
        return {
            regime: "ほぼ波",
            formula: ["P = |ψA + ψB|<sup>2</sup>", "干渉項がはっきり残る"],
            note: "観測の影響が弱いので、A を通る波と B を通る波が重なり、スクリーン上では縞模様がはっきり見えます。"
        };
    }

    if (strength < 0.55) {
        return {
            regime: "干渉が残る",
            formula: ["P = |ψA + ψB|<sup>2</sup>", "経路情報が少しだけ入り始める"],
            note: "どちらを通ったかの手がかりが少し入ると、干渉縞のコントラストは下がりますが、波らしさはまだ残ります。"
        };
    }

    if (strength < 0.85) {
        return {
            regime: "干渉が弱まる",
            formula: ["P = |ψA + ψB|<sup>2</sup>", "干渉項がかなり小さくなる"],
            note: "観測で経路情報をかなり得ると、波同士がそろって重なれなくなり、縞模様はぼやけていきます。"
        };
    }

    return {
        regime: "ほぼ粒",
        formula: ["P ≈ |ψA|<sup>2</sup> + |ψB|<sup>2</sup>", "どちらの経路かの情報が強い"],
        note: "どちらのスリットを通ったかが強く分かると、波の重ね合わせよりも経路の区別が優勢になり、干渉縞はほぼ消えます。"
    };
};

const drawSlitDemo = () => {
    if (!measurementStrengthInput || !measurementStrengthValue || !visibilityValue || !regimeValue || !slitFormula || !slitNote || !slitCanvas || !slitContext) {
        return;
    }

    const strength = Number(measurementStrengthInput.value) / 100;
    const visibility = 1 - strength;
    const scene = describeSlitMode(strength);
    const { width, height } = prepareCanvas(slitCanvas, slitContext);
    const context = slitContext;
    const sourceX = width * 0.12;
    const barrierX = width * 0.42;
    const screenX = width * 0.84;
    const centerY = height * 0.5;
    const slitGap = height * 0.18;
    const slitA = centerY - slitGap * 0.5;
    const slitB = centerY + slitGap * 0.5;
    const slitHalf = 18;
    const screenTop = 34;
    const screenBottom = height - 34;

    measurementStrengthValue.textContent = `${Math.round(strength * 100)}%`;
    visibilityValue.textContent = `${Math.round(visibility * 100)}%`;
    regimeValue.textContent = scene.regime;
    setMultilineContent(slitFormula, scene.formula);
    slitNote.textContent = scene.note;

    const background = context.createLinearGradient(0, 0, width, height);
    background.addColorStop(0, "rgba(4, 11, 20, 1)");
    background.addColorStop(1, "rgba(10, 24, 41, 1)");
    context.clearRect(0, 0, width, height);
    context.fillStyle = background;
    context.fillRect(0, 0, width, height);

    const glow = context.createRadialGradient(sourceX, centerY, 10, sourceX, centerY, 160);
    glow.addColorStop(0, "rgba(104, 239, 255, 0.18)");
    glow.addColorStop(1, "rgba(104, 239, 255, 0)");
    context.fillStyle = glow;
    context.fillRect(0, 0, width, height);

    context.save();
    context.setLineDash([6, 9]);
    context.strokeStyle = "rgba(255, 255, 255, 0.16)";
    context.lineWidth = 1.5;
    context.beginPath();
    context.moveTo(sourceX + 16, centerY);
    context.lineTo(barrierX - 20, centerY);
    context.stroke();
    context.restore();

    context.fillStyle = "rgba(104, 239, 255, 0.95)";
    context.beginPath();
    context.arc(sourceX, centerY, 8, 0, Math.PI * 2);
    context.fill();

    context.lineWidth = 10;
    context.strokeStyle = "rgba(228, 239, 252, 0.78)";
    context.beginPath();
    context.moveTo(barrierX, 26);
    context.lineTo(barrierX, slitA - slitHalf);
    context.moveTo(barrierX, slitA + slitHalf);
    context.lineTo(barrierX, slitB - slitHalf);
    context.moveTo(barrierX, slitB + slitHalf);
    context.lineTo(barrierX, height - 26);
    context.stroke();

    context.save();
    for (const slitY of [slitA, slitB]) {
        for (let radius = 44; radius < screenX - barrierX + 76; radius += 28) {
            context.strokeStyle = `rgba(104, 239, 255, ${0.02 + visibility * 0.08})`;
            context.lineWidth = 1.4;
            context.beginPath();
            context.arc(barrierX, slitY, radius, -0.52, 0.52);
            context.stroke();
        }
    }
    context.restore();

    const sensorRadius = 9 + strength * 8;
    context.fillStyle = `rgba(255, 190, 107, ${0.12 + strength * 0.34})`;
    context.strokeStyle = `rgba(255, 190, 107, ${0.22 + strength * 0.5})`;
    context.lineWidth = 2;

    [slitA, slitB].forEach((slitY) => {
        context.beginPath();
        context.arc(barrierX - 22, slitY, sensorRadius, 0, Math.PI * 2);
        context.fill();
        context.stroke();
    });

    context.fillStyle = "rgba(232, 241, 252, 0.22)";
    context.fillRect(screenX, screenTop, 24, screenBottom - screenTop);

    for (let y = screenTop; y <= screenBottom; y += 2) {
        const normalized = (y - centerY) / ((screenBottom - screenTop) * 0.5);
        const envelope = Math.exp(-(normalized ** 2) * 1.8);
        const interference = 0.08 + envelope * (0.18 + 0.82 * (0.5 + 0.5 * Math.cos(normalized * 28)));
        const lumpA = Math.exp(-(((normalized - 0.3) ** 2) * 16));
        const lumpB = Math.exp(-(((normalized + 0.3) ** 2) * 16));
        const particle = 0.1 + envelope * (0.28 + 0.34 * (lumpA + lumpB));
        const intensity = particle * (1 - visibility) + interference * visibility;
        const alpha = Math.min(1, 0.08 + intensity * 0.9);
        const red = Math.round(160 + intensity * 80);
        const green = Math.round(180 + intensity * 52);
        const blue = Math.round(96 + intensity * 76);

        context.fillStyle = `rgba(${red}, ${green}, ${blue}, ${alpha})`;
        context.fillRect(screenX + 2, y, 20, 2);
    }

    context.fillStyle = "rgba(235, 246, 255, 0.82)";
    context.font = "600 12px IBM Plex Sans JP, sans-serif";
    context.fillText("source", sourceX - 18, centerY - 16);
    context.fillText("slits", barrierX - 12, 18);
    context.fillText("screen", screenX - 6, 18);
};

if (measurementStrengthInput) {
    measurementStrengthInput.addEventListener("input", drawSlitDemo);
    window.addEventListener("resize", drawSlitDemo);
    drawSlitDemo();
}

const stageButtons = Array.from(document.querySelectorAll(".stage-button"));
const circuitFormula = document.querySelector("#circuitFormula");
const circuitNote = document.querySelector("#circuitNote");
const measurementOutcome = document.querySelector("#measurementOutcome");
const entanglementValue = document.querySelector("#entanglementValue");
const basisIds = ["00", "01", "10", "11"];
const basisFills = Object.fromEntries(
    basisIds.map((basis) => [basis, document.querySelector(`#basis${basis}`)])
);
const basisValues = Object.fromEntries(
    basisIds.map((basis) => [basis, document.querySelector(`#basis${basis}Value`)])
);
const basisRows = Object.fromEntries(
    basisIds.map((basis) => [basis, document.querySelector(`.basis-row[data-basis="${basis}"]`)])
);

const svgGateH = document.querySelector("#svgGateH");
const svgCnot = document.querySelector("#svgCnot");
const svgMeasureTop = document.querySelector("#svgMeasureTop");
const svgMeasureBottom = document.querySelector("#svgMeasureBottom");

const circuitStages = [
    {
        formula: ["|ψ⟩ = |00⟩", "2 つの量子ビットは |0⟩ から始まる"],
        note: "まだ重ね合わせも相関もありません。ここからゲートで状態ベクトルを回していきます。",
        distribution: [1, 0, 0, 0],
        outcome: "00 が 100%",
        entanglement: "なし",
        active: {
            h: false,
            cnot: false,
            measure: false
        }
    },
    {
        formula: ["|ψ⟩ = (|00⟩ + |10⟩) / √2", "q0 に H をかけて重ね合わせを作る"],
        note: "1 つ目の量子ビットだけが 0 と 1 の両方の振幅を持ちます。測定すると 00 と 10 が半々で出ます。",
        distribution: [0.5, 0, 0.5, 0],
        outcome: "00 / 10 が半々",
        entanglement: "まだなし",
        active: {
            h: true,
            cnot: false,
            measure: false
        }
    },
    {
        formula: ["|ψ⟩ = (|00⟩ + |11⟩) / √2", "CNOT でベル状態を作る"],
        note: "q0 が 1 の枝だけ q1 を反転させると、2 つの量子ビットは切り離せない 1 つの状態になります。",
        distribution: [0.5, 0, 0, 0.5],
        outcome: "00 / 11 が半々",
        entanglement: "強い相関あり",
        active: {
            h: true,
            cnot: true,
            measure: false
        }
    },
    {
        formula: ["測定 -> 00 か 11 のどちらか", "確率はそれぞれ 50%"],
        note: "測定した瞬間、重ね合わせは 1 つの結果に読み出されます。ただし 2 つのビットの相関は、測定前のもつれに由来しています。",
        distribution: [0.5, 0, 0, 0.5],
        outcome: "1 回ごとは 00 か 11",
        entanglement: "測定前に相関を持つ",
        active: {
            h: true,
            cnot: true,
            measure: true
        }
    }
];

const updateCircuitStage = (stageIndex) => {
    const stage = circuitStages[stageIndex];

    if (!stage || !circuitFormula || !circuitNote || !measurementOutcome || !entanglementValue) {
        return;
    }

    setMultilineContent(circuitFormula, stage.formula);
    circuitNote.textContent = stage.note;
    measurementOutcome.textContent = stage.outcome;
    entanglementValue.textContent = stage.entanglement;

    stageButtons.forEach((button) => {
        const isActive = Number(button.dataset.stage) === stageIndex;
        button.classList.toggle("is-active", isActive);
        button.setAttribute("aria-pressed", String(isActive));
    });

    basisIds.forEach((basis, index) => {
        const probability = stage.distribution[index];
        const fill = basisFills[basis];
        const value = basisValues[basis];
        const row = basisRows[basis];

        if (fill) {
            fill.style.width = `${probability * 100}%`;
            fill.style.opacity = probability > 0 ? "1" : "0.18";
        }

        if (value) {
            value.textContent = `${Math.round(probability * 100)}%`;
        }

        if (row) {
            row.classList.toggle("is-on", probability > 0.001);
        }
    });

    svgGateH?.classList.toggle("is-active", stage.active.h);
    svgCnot?.classList.toggle("is-active", stage.active.cnot);
    svgMeasureTop?.classList.toggle("is-active", stage.active.measure);
    svgMeasureBottom?.classList.toggle("is-active", stage.active.measure);
};

if (stageButtons.length > 0) {
    stageButtons.forEach((button) => {
        button.addEventListener("click", () => {
            updateCircuitStage(Number(button.dataset.stage));
        });
    });

    updateCircuitStage(0);
}
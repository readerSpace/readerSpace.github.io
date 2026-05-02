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

const trueValueInput = document.querySelector("#trueValue");
const trueValueValue = document.querySelector("#trueValueValue");
const noiseLevelInput = document.querySelector("#noiseLevel");
const noiseLevelValue = document.querySelector("#noiseLevelValue");
const sampleCountInput = document.querySelector("#sampleCount");
const sampleCountValue = document.querySelector("#sampleCountValue");
const resampleButton = document.querySelector("#resampleButton");
const meanValue = document.querySelector("#meanValue");
const stdValue = document.querySelector("#stdValue");
const rangeValue = document.querySelector("#rangeValue");
const withinOneSigmaValue = document.querySelector("#withinOneSigmaValue");
const demoNote = document.querySelector("#demoNote");
const sampleList = document.querySelector("#sampleList");
const measurementCanvas = document.querySelector("#measurementCanvas");
const measurementContext = measurementCanvas?.getContext("2d");

const lengthAInput = document.querySelector("#lengthA");
const sigmaAInput = document.querySelector("#sigmaA");
const lengthBInput = document.querySelector("#lengthB");
const sigmaBInput = document.querySelector("#sigmaB");
const lengthAValue = document.querySelector("#lengthAValue");
const sigmaAValue = document.querySelector("#sigmaAValue");
const lengthBValue = document.querySelector("#lengthBValue");
const sigmaBValue = document.querySelector("#sigmaBValue");
const areaValue = document.querySelector("#areaValue");
const sigmaAreaValue = document.querySelector("#sigmaAreaValue");
const relativeErrorValue = document.querySelector("#relativeErrorValue");
const propagationFormula = document.querySelector("#propagationFormula");
const contribABar = document.querySelector("#contribABar");
const contribBBar = document.querySelector("#contribBBar");
const contribAValue = document.querySelector("#contribAValue");
const contribBValue = document.querySelector("#contribBValue");
const propagationNote = document.querySelector("#propagationNote");

const round = (value, digits = 2) => Number(value.toFixed(digits));

const gaussianRandom = () => {
    let u = 0;
    let v = 0;

    while (u === 0) {
        u = Math.random();
    }

    while (v === 0) {
        v = Math.random();
    }

    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};

const sampleMean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;

const sampleStd = (values, mean) => Math.sqrt(
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length
);

const buildMeasurements = (trueValue, sigma, count) => Array.from(
    { length: count },
    () => trueValue + gaussianRandom() * sigma
);

const updateMeasurementLabels = () => {
    if (!trueValueInput || !noiseLevelInput || !sampleCountInput) {
        return null;
    }

    const trueValue = Number(trueValueInput.value) / 100;
    const sigma = Number(noiseLevelInput.value) / 100;
    const sampleCount = Number(sampleCountInput.value);

    if (trueValueValue) {
        trueValueValue.textContent = `${trueValue.toFixed(2)} cm`;
    }

    if (noiseLevelValue) {
        noiseLevelValue.textContent = `${sigma.toFixed(2)} cm`;
    }

    if (sampleCountValue) {
        sampleCountValue.textContent = `${sampleCount} 回`;
    }

    return {
        trueValue,
        sigma,
        sampleCount
    };
};

const drawMeasurementChart = (measurements, trueValue, mean, sigma) => {
    if (!measurementCanvas || !measurementContext || measurements.length === 0) {
        return;
    }

    const context = measurementContext;
    const width = measurementCanvas.width;
    const height = measurementCanvas.height;
    const padding = { top: 26, right: 22, bottom: 58, left: 46 };
    const minMeasurement = Math.min(...measurements, trueValue - sigma * 4);
    const maxMeasurement = Math.max(...measurements, trueValue + sigma * 4);
    const xMin = minMeasurement - 0.04;
    const xMax = maxMeasurement + 0.04;
    const bins = Math.min(14, Math.max(7, Math.round(Math.sqrt(measurements.length) * 2.3)));
    const binWidth = (xMax - xMin) / bins;
    const counts = Array.from({ length: bins }, () => 0);
    const baseLineY = height - padding.bottom;

    measurements.forEach((value) => {
        const index = Math.min(bins - 1, Math.max(0, Math.floor((value - xMin) / binWidth)));
        counts[index] += 1;
    });

    const maxCount = Math.max(...counts, 1);
    const plotWidth = width - padding.left - padding.right;
    const plotHeight = height - padding.top - padding.bottom - 28;

    context.clearRect(0, 0, width, height);

    const background = context.createLinearGradient(0, 0, 0, height);
    background.addColorStop(0, "rgba(10, 15, 22, 0.98)");
    background.addColorStop(1, "rgba(24, 38, 50, 0.98)");
    context.fillStyle = background;
    context.fillRect(0, 0, width, height);

    for (let step = 0; step <= 4; step += 1) {
        const y = padding.top + (plotHeight / 4) * step;
        context.strokeStyle = "rgba(255, 255, 255, 0.08)";
        context.lineWidth = 1;
        context.beginPath();
        context.moveTo(padding.left, y);
        context.lineTo(width - padding.right, y);
        context.stroke();
    }

    counts.forEach((count, index) => {
        const ratio = count / maxCount;
        const barHeight = ratio * plotHeight;
        const x = padding.left + (index / bins) * plotWidth + 2;
        const y = baseLineY - barHeight;
        const barWidthPx = plotWidth / bins - 4;
        const barGradient = context.createLinearGradient(0, y, 0, baseLineY);
        barGradient.addColorStop(0, "rgba(242, 188, 108, 0.96)");
        barGradient.addColorStop(1, "rgba(207, 143, 50, 0.35)");
        context.fillStyle = barGradient;
        context.fillRect(x, y, barWidthPx, barHeight);
    });

    const valueToX = (value) => padding.left + ((value - xMin) / (xMax - xMin)) * plotWidth;

    const drawMarker = (value, color, label, labelOffset) => {
        const x = valueToX(value);
        context.strokeStyle = color;
        context.lineWidth = 2;
        context.beginPath();
        context.moveTo(x, padding.top);
        context.lineTo(x, baseLineY + 12);
        context.stroke();
        context.fillStyle = color;
        context.font = "12px IBM Plex Sans JP, sans-serif";
        context.fillText(label, x + labelOffset, padding.top + 14);
    };

    drawMarker(trueValue, "#8ee8d1", "本当の値", 8);
    drawMarker(mean, "#f2bc6c", "平均", -32);

    measurements.forEach((value, index) => {
        const x = valueToX(value);
        const jitter = ((index % 5) - 2) * 5;
        context.fillStyle = "rgba(126, 242, 255, 0.9)";
        context.beginPath();
        context.arc(x, baseLineY + 24 + jitter * 0.25, 3, 0, Math.PI * 2);
        context.fill();
    });

    context.fillStyle = "rgba(255, 255, 255, 0.82)";
    context.font = "12px IBM Plex Sans JP, sans-serif";
    context.fillText(`${xMin.toFixed(2)} cm`, padding.left, height - 14);
    context.fillText(`${xMax.toFixed(2)} cm`, width - padding.right - 56, height - 14);
};

const describeMeasurementState = ({ trueValue, sigma, sampleCount, mean, std }) => {
    const meanGap = Math.abs(mean - trueValue);
    const meanScale = std / Math.sqrt(sampleCount);

    if (sampleCount <= 6) {
        return "回数が少ないので、平均も標準偏差も偶然にかなり左右されます。まずは測定回数を増やしてみてください。";
    }

    if (sigma >= 0.15) {
        return "ばらつきが大きいので、平均は読めても 1 回ごとの値はかなり揺れています。環境や測定器の精度を疑う場面です。";
    }

    if (meanGap <= meanScale * 1.2) {
        return "今回の平均は本当の値にかなり近く、回数を増やした効果が出ています。平均との差ではなく、分布全体で判断する感覚が重要です。";
    }

    return "平均は本当の値に近づこうとしていますが、まだ偶然の揺れが残っています。回数を増やすと中心の位置がさらに安定していきます。";
};

const renderSampleList = (measurements) => {
    if (!sampleList) {
        return;
    }

    sampleList.innerHTML = "";

    measurements.forEach((value) => {
        const chip = document.createElement("span");
        chip.className = "sample-chip";
        chip.textContent = `${value.toFixed(2)} cm`;
        sampleList.appendChild(chip);
    });
};

const regenerateMeasurements = () => {
    const settings = updateMeasurementLabels();

    if (!settings) {
        return;
    }

    const measurements = buildMeasurements(settings.trueValue, settings.sigma, settings.sampleCount);
    const mean = sampleMean(measurements);
    const std = sampleStd(measurements, mean);
    const min = Math.min(...measurements);
    const max = Math.max(...measurements);
    const withinOneSigma = measurements.filter((value) => Math.abs(value - mean) <= std).length;
    const withinOneSigmaRatio = (withinOneSigma / measurements.length) * 100;

    if (meanValue) {
        meanValue.textContent = `${mean.toFixed(2)} cm`;
    }

    if (stdValue) {
        stdValue.textContent = `${std.toFixed(2)} cm`;
    }

    if (rangeValue) {
        rangeValue.textContent = `${(max - min).toFixed(2)} cm`;
    }

    if (withinOneSigmaValue) {
        withinOneSigmaValue.textContent = `${Math.round(withinOneSigmaRatio)}%`;
    }

    if (demoNote) {
        demoNote.textContent = describeMeasurementState({
            ...settings,
            mean,
            std
        });
    }

    renderSampleList(measurements);
    drawMeasurementChart(measurements, settings.trueValue, mean, settings.sigma);
};

const describePropagationState = ({ a, sigmaA, b, sigmaB, shareA, shareB, relativeError }) => {
    if (relativeError > 4) {
        return "相対誤差がかなり大きいので、結果より先に測定精度そのものを改善したい状態です。長さの読み取りや器具の分解能を見直す価値があります。";
    }

    if (Math.abs(shareA - shareB) < 8) {
        return "a 側と b 側がほぼ同じくらい面積の誤差に効いています。どちらか片方だけ改善しても、全体は半分しかよくなりません。";
    }

    if (shareA > shareB) {
        return `いまは a 側の誤差が支配的です。a の誤差 ${sigmaA.toFixed(2)} cm を下げる方が、b を改善するより効率よく全体を小さくできます。`;
    }

    return `いまは b 側の誤差が支配的です。b の誤差 ${sigmaB.toFixed(2)} cm が大きいので、こちらを改善すると面積の誤差が目に見えて下がります。`;
};

const updatePropagationDemo = () => {
    if (!lengthAInput || !sigmaAInput || !lengthBInput || !sigmaBInput) {
        return;
    }

    const a = Number(lengthAInput.value) / 10;
    const sigmaA = Number(sigmaAInput.value) / 100;
    const b = Number(lengthBInput.value) / 10;
    const sigmaB = Number(sigmaBInput.value) / 100;
    const area = a * b;
    const varianceFromA = (b * sigmaA) ** 2;
    const varianceFromB = (a * sigmaB) ** 2;
    const sigmaArea = Math.sqrt(varianceFromA + varianceFromB);
    const relativeError = (sigmaArea / area) * 100;
    const totalVariance = varianceFromA + varianceFromB;
    const shareA = totalVariance > 0 ? (varianceFromA / totalVariance) * 100 : 0;
    const shareB = totalVariance > 0 ? (varianceFromB / totalVariance) * 100 : 0;

    if (lengthAValue) {
        lengthAValue.textContent = `${a.toFixed(1)} cm`;
    }

    if (sigmaAValue) {
        sigmaAValue.textContent = `${sigmaA.toFixed(2)} cm`;
    }

    if (lengthBValue) {
        lengthBValue.textContent = `${b.toFixed(1)} cm`;
    }

    if (sigmaBValue) {
        sigmaBValue.textContent = `${sigmaB.toFixed(2)} cm`;
    }

    if (areaValue) {
        areaValue.textContent = `${area.toFixed(2)} cm²`;
    }

    if (sigmaAreaValue) {
        sigmaAreaValue.textContent = `${sigmaArea.toFixed(2)} cm²`;
    }

    if (relativeErrorValue) {
        relativeErrorValue.textContent = `${relativeError.toFixed(1)}%`;
    }

    if (propagationFormula) {
        propagationFormula.innerHTML = `
            <span>σ<sub>S</sub> = √[(${b.toFixed(1)} × ${sigmaA.toFixed(2)})<sup>2</sup> + (${a.toFixed(1)} × ${sigmaB.toFixed(2)})<sup>2</sup>]</span>
            <span>σ<sub>S</sub> = ${sigmaArea.toFixed(2)} cm²</span>
        `;
    }

    if (contribABar) {
        contribABar.style.width = `${round(shareA, 1)}%`;
    }

    if (contribBBar) {
        contribBBar.style.width = `${round(shareB, 1)}%`;
    }

    if (contribAValue) {
        contribAValue.textContent = `${Math.round(shareA)}%`;
    }

    if (contribBValue) {
        contribBValue.textContent = `${Math.round(shareB)}%`;
    }

    if (propagationNote) {
        propagationNote.textContent = describePropagationState({
            a,
            sigmaA,
            b,
            sigmaB,
            shareA,
            shareB,
            relativeError
        });
    }
};

[trueValueInput, noiseLevelInput, sampleCountInput].forEach((input) => {
    input?.addEventListener("input", regenerateMeasurements);
});

resampleButton?.addEventListener("click", regenerateMeasurements);

[lengthAInput, sigmaAInput, lengthBInput, sigmaBInput].forEach((input) => {
    input?.addEventListener("input", updatePropagationDemo);
});

regenerateMeasurements();
updatePropagationDemo();
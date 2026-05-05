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

const canvas = document.querySelector("#moneyFlowCanvas");
const simulationShell = document.querySelector("#playgroundShell");
const context = canvas?.getContext("2d");

if (!canvas || !simulationShell || !context) {
    throw new Error("Money flow simulation failed to initialize.");
}

const consumeRateSlider = document.querySelector("#consumeRate");
const wageRateSlider = document.querySelector("#wageRate");
const taxRateSlider = document.querySelector("#taxRate");
const govSpendSlider = document.querySelector("#govSpend");
const loanRateSlider = document.querySelector("#loanRate");
const interestRateSlider = document.querySelector("#interestRate");

const toggleRunningButton = document.querySelector("#toggleRunning");
const boomPresetButton = document.querySelector("#boomPreset");
const recessionPresetButton = document.querySelector("#recessionPreset");
const stimulusPresetButton = document.querySelector("#stimulusPreset");
const resetButton = document.querySelector("#resetSim");

const consumeText = document.querySelector("#consumeText");
const wageText = document.querySelector("#wageText");
const taxText = document.querySelector("#taxText");
const govText = document.querySelector("#govText");
const loanText = document.querySelector("#loanText");
const interestText = document.querySelector("#interestText");

const gdpStat = document.querySelector("#gdpStat");
const profitStat = document.querySelector("#profitStat");
const savingStat = document.querySelector("#savingStat");
const budgetStat = document.querySelector("#budgetStat");
const debtStat = document.querySelector("#debtStat");
const stateStat = document.querySelector("#stateStat");

const quickGdp = document.querySelector("#quickGdp");
const quickHousehold = document.querySelector("#quickHousehold");
const quickDebt = document.querySelector("#quickDebt");
const quickState = document.querySelector("#quickState");
const panelStatus = document.querySelector("#panelStatus");
const controlPanel = document.querySelector(".panel");
const floatingHint = document.querySelector(".floating-hint");

const sectorMeta = {
    household: { name: "家計", color: "#22c55e" },
    firm: { name: "企業", color: "#f97316" },
    bank: { name: "銀行", color: "#6366f1" },
    gov: { name: "政府", color: "#0ea5e9" }
};

const connectionMeta = [
    { from: "household", to: "firm", label: "消費", color: "#22c55e", dx: 0, dy: -92 },
    { from: "firm", to: "household", label: "賃金", color: "#f97316", dx: 0, dy: -140 },
    { from: "household", to: "gov", label: "税", color: "#0284c7", dx: -86, dy: 0 },
    { from: "gov", to: "household", label: "給付", color: "#0ea5e9", dx: 84, dy: 0 },
    { from: "firm", to: "gov", label: "法人税", color: "#0284c7", dx: -146, dy: -8 },
    { from: "gov", to: "firm", label: "公共事業", color: "#0ea5e9", dx: -18, dy: 104 },
    { from: "bank", to: "firm", label: "融資", color: "#6366f1", dx: 82, dy: 0 },
    { from: "firm", to: "bank", label: "利払い", color: "#7c3aed", dx: -82, dy: 0 }
];

let width = 0;
let height = 0;
let widthDpr = 1;
let running = true;
let tick = 0;
let lastTime = 0;
let stepAccumulator = 0;
let statusTimeout = 0;

let sectors;
let firmDebt;
let gdp;
let lastProfit;
let lastTax;
let lastWage;
let lastConsumption;
let lastGov;
let lastLoan;
let lastInterest;
let flows;
let history;

const defaultStatus = "家計の消費、企業の賃金、政府の支出、銀行の融資が、景気と債務のバランスを一緒に動かします。";

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function drawRoundedRectPath(x, y, boxWidth, boxHeight, radius) {
    const limitedRadius = Math.min(radius, boxWidth / 2, boxHeight / 2);
    context.beginPath();
    context.moveTo(x + limitedRadius, y);
    context.lineTo(x + boxWidth - limitedRadius, y);
    context.quadraticCurveTo(x + boxWidth, y, x + boxWidth, y + limitedRadius);
    context.lineTo(x + boxWidth, y + boxHeight - limitedRadius);
    context.quadraticCurveTo(x + boxWidth, y + boxHeight, x + boxWidth - limitedRadius, y + boxHeight);
    context.lineTo(x + limitedRadius, y + boxHeight);
    context.quadraticCurveTo(x, y + boxHeight, x, y + boxHeight - limitedRadius);
    context.lineTo(x, y + limitedRadius);
    context.quadraticCurveTo(x, y, x + limitedRadius, y);
    context.closePath();
}

function setStatus(message, reset = false) {
    if (!panelStatus) {
        return;
    }

    panelStatus.textContent = message;
    window.clearTimeout(statusTimeout);

    if (reset) {
        statusTimeout = window.setTimeout(() => {
            panelStatus.textContent = defaultStatus;
        }, 3400);
    }
}

function resetState() {
    sectors = {
        household: { money: 260 },
        firm: { money: 260 },
        bank: { money: 300 },
        gov: { money: 260 }
    };
    firmDebt = 100;
    gdp = 100;
    lastProfit = 0;
    lastTax = 0;
    lastWage = 0;
    lastConsumption = 0;
    lastGov = 0;
    lastLoan = 0;
    lastInterest = 0;
    flows = [];
    history = [];
    tick = 0;
    stepAccumulator = 0;
}

function getLayout() {
    const compact = width <= 900;
    const narrow = width <= 560;
    const sceneLeft = compact ? 28 : Math.min(370, width * 0.31);
    const sceneRight = width - 28;
    const sceneWidth = sceneRight - sceneLeft;
    const radius = narrow ? 48 : compact ? 56 : 66;
    const positions = {
        household: { x: sceneLeft + sceneWidth * 0.2, y: height * 0.28 },
        firm: { x: sceneLeft + sceneWidth * 0.76, y: height * 0.28 },
        gov: { x: sceneLeft + sceneWidth * 0.2, y: height * 0.62 },
        bank: { x: sceneLeft + sceneWidth * 0.76, y: height * 0.62 }
    };

    const historyWidth = narrow ? width - 32 : compact ? 236 : 256;
    const historyHeight = narrow ? 92 : 104;
    const historyBox = {
        x: narrow ? 16 : width - historyWidth - 18,
        y: 16,
        w: historyWidth,
        h: historyHeight
    };

    const gauges = [];

    if (compact) {
        const gaugeGap = narrow ? 12 : 14;
        const gaugeHeight = narrow ? 74 : 76;
        const gaugeY = height - (gaugeHeight * 2 + gaugeGap + (narrow ? 20 : 28));
        const gaugePaddingX = narrow ? 16 : 24;
        const gaugeWidth = (width - gaugePaddingX * 2 - gaugeGap) / 2;

        for (let index = 0; index < 4; index += 1) {
            const column = index % 2;
            const row = Math.floor(index / 2);
            gauges.push({
                x: gaugePaddingX + column * (gaugeWidth + gaugeGap),
                y: gaugeY + row * (gaugeHeight + gaugeGap),
                w: gaugeWidth,
                h: gaugeHeight
            });
        }
    } else {
        const gaugeGap = 10;
        const gaugeHeight = 58;
        const gaugeGroupWidth = Math.min(300, Math.max(248, width * 0.26));
        const gaugeWidth = (gaugeGroupWidth - gaugeGap) / 2;
        const gaugeX = clamp(positions.bank.x - gaugeGroupWidth / 2, 20, width - gaugeGroupWidth - 20);
        const gaugeY = positions.bank.y + radius;

        for (let index = 0; index < 4; index += 1) {
            const column = index % 2;
            const row = Math.floor(index / 2);
            gauges.push({
                x: gaugeX + column * (gaugeWidth + gaugeGap),
                y: gaugeY + row * (gaugeHeight + gaugeGap),
                w: gaugeWidth,
                h: gaugeHeight
            });
        }
    }

    return {
        compact,
        narrow,
        radius,
        positions,
        historyBox,
        gauges
    };
}

function currentStateLabel() {
    if (gdp > 165 && firmDebt < 420) {
        return "好景気";
    }

    if (gdp < 75) {
        return "不景気";
    }

    if (firmDebt > 420) {
        return "債務過多";
    }

    if (sectors.household.money < 60) {
        return "消費低迷";
    }

    return "通常";
}

function updateToggleButton() {
    if (!toggleRunningButton) {
        return;
    }

    toggleRunningButton.textContent = running ? "一時停止" : "再生";
}

function toggleRunning() {
    running = !running;
    setStatus(running ? "シミュレーションを再開しました。" : "シミュレーションを停止しました。現在の資金配分をその場で確認できます。", true);
    updateToggleButton();
    updateUi();
    draw();
}

function resetSimulation() {
    consumeRateSlider.value = 60;
    wageRateSlider.value = 45;
    taxRateSlider.value = 18;
    govSpendSlider.value = 35;
    loanRateSlider.value = 25;
    interestRateSlider.value = 3;
    running = true;
    resetState();
    setStatus(defaultStatus);
    updateToggleButton();
    updateUi();
    draw();
}

function boomPreset() {
    consumeRateSlider.value = 78;
    wageRateSlider.value = 50;
    taxRateSlider.value = 15;
    govSpendSlider.value = 35;
    loanRateSlider.value = 55;
    interestRateSlider.value = 2;
    setStatus("好景気寄りにしました。消費と融資が強く、循環が勢いを持ちやすい設定です。", true);
    updateUi();
    draw();
}

function recessionPreset() {
    consumeRateSlider.value = 30;
    wageRateSlider.value = 35;
    taxRateSlider.value = 20;
    govSpendSlider.value = 20;
    loanRateSlider.value = 8;
    interestRateSlider.value = 8;
    setStatus("不景気寄りにしました。消費と融資が弱く、利払いが重くなりやすい設定です。", true);
    updateUi();
    draw();
}

function stimulusPreset() {
    consumeRateSlider.value = 55;
    wageRateSlider.value = 48;
    taxRateSlider.value = 12;
    govSpendSlider.value = 85;
    loanRateSlider.value = 35;
    interestRateSlider.value = 3;
    setStatus("財政出動にしました。政府支出を大きくして循環を押し戻す設定です。", true);
    updateUi();
    draw();
}

function createFlow(fromKey, toKey, amount, label, color) {
    const countCap = width <= 560 ? 12 : 24;
    const count = Math.min(countCap, Math.max(2, Math.floor(amount / 5)));

    for (let index = 0; index < count; index += 1) {
        flows.push({
            fromKey,
            toKey,
            t: Math.random() * 0.18,
            speed: 0.008 + Math.random() * 0.008,
            label,
            color,
            radius: 4 + Math.random() * 3
        });
    }

    const cap = width <= 560 ? 220 : 420;

    if (flows.length > cap) {
        flows.splice(0, flows.length - cap);
    }
}

function transfer(fromKey, toKey, amount, label, color) {
    const from = sectors[fromKey];
    const to = sectors[toKey];
    const safeAmount = Math.max(0, Math.min(amount, from.money));

    if (safeAmount <= 0.01) {
        return 0;
    }

    from.money -= safeAmount;
    to.money += safeAmount;
    createFlow(fromKey, toKey, safeAmount, label, color);
    return safeAmount;
}

function economicStep() {
    const consumeRate = Number(consumeRateSlider.value) / 100;
    const wageRate = Number(wageRateSlider.value) / 100;
    const taxRate = Number(taxRateSlider.value) / 100;
    const govSpend = Number(govSpendSlider.value);
    const loanRate = Number(loanRateSlider.value);
    const interestRate = Number(interestRateSlider.value) / 100;

    const consumptionBase = sectors.household.money * consumeRate * 0.055;
    const confidence = clamp(gdp / 120, 0.45, 1.45);
    lastConsumption = transfer("household", "firm", consumptionBase * confidence, "消費", "#22c55e");

    const plannedGov = Math.min(sectors.gov.money, govSpend * 0.12);
    const govToHousehold = transfer("gov", "household", plannedGov * 0.55, "給付・公共雇用", "#0ea5e9");
    const govToFirm = transfer("gov", "firm", plannedGov * 0.45, "公共事業", "#0ea5e9");
    lastGov = govToHousehold + govToFirm;

    const wagePayment = (lastConsumption + govToFirm + 8) * wageRate;
    lastWage = transfer("firm", "household", wagePayment, "賃金", "#f97316");

    const householdTax = transfer("household", "gov", lastWage * taxRate, "所得税", "#0284c7");
    const firmProfitBeforeTax = Math.max(0, lastConsumption + govToFirm - lastWage);
    const firmTax = transfer("firm", "gov", firmProfitBeforeTax * taxRate, "法人税", "#0284c7");
    lastTax = householdTax + firmTax;

    const loanDemand = loanRate * 0.09 * clamp(1.2 - interestRate * 3, 0.2, 1.2);
    lastLoan = transfer("bank", "firm", loanDemand, "融資", "#6366f1");
    firmDebt += lastLoan;

    lastInterest = transfer("firm", "bank", firmDebt * interestRate * 0.008, "利払い", "#7c3aed");

    lastProfit = lastConsumption + govToFirm + lastLoan * 0.25 - lastWage - firmTax - lastInterest;
    firmDebt = Math.max(0, firmDebt - Math.max(0, lastProfit) * 0.004);

    let targetGdp =
        lastConsumption * 10.5 +
        lastGov * 8 +
        lastLoan * 5 +
        lastWage * 2.4 -
        lastInterest * 60 -
        Math.max(0, firmDebt - 140) * 0.16;

    if (sectors.household.money < 40) {
        targetGdp -= 14;
    }

    if (sectors.firm.money < 40) {
        targetGdp -= 18;
    }

    if (sectors.gov.money < 30) {
        targetGdp -= 10;
    }

    targetGdp = clamp(targetGdp, 10, 300);
    gdp = clamp(gdp + (targetGdp - gdp) * 0.18, 10, 300);

    if (sectors.gov.money < 20) {
        transfer("bank", "gov", Math.min(10, sectors.bank.money), "国債購入", "#64748b");
    }

    if (sectors.bank.money < 30) {
        loanRateSlider.value = Math.max(0, Number(loanRateSlider.value) - 1);
    }

    tick += 1;

    if (tick % 3 === 0) {
        history.push({
            gdp,
            household: sectors.household.money,
            firm: sectors.firm.money,
            gov: sectors.gov.money,
            bank: sectors.bank.money,
            debt: firmDebt
        });

        if (history.length > 130) {
            history.shift();
        }
    }
}

function getConnectionConfig(fromKey, toKey) {
    return connectionMeta.find((item) => item.from === fromKey && item.to === toKey);
}

function pointOnCurve(start, control, end, t) {
    return {
        x: (1 - t) * (1 - t) * start.x + 2 * (1 - t) * t * control.x + t * t * end.x,
        y: (1 - t) * (1 - t) * start.y + 2 * (1 - t) * t * control.y + t * t * end.y
    };
}

function connectionControlPoint(layout, config) {
    const start = layout.positions[config.from];
    const end = layout.positions[config.to];
    const scale = layout.narrow ? 0.72 : layout.compact ? 0.84 : 1;

    return {
        x: (start.x + end.x) / 2 + config.dx * scale,
        y: (start.y + end.y) / 2 + config.dy * scale
    };
}

function updateFlows(timeScale) {
    for (const flow of flows) {
        flow.t += flow.speed * timeScale;
    }

    flows = flows.filter((flow) => flow.t < 1.02);
}

function drawBackground() {
    const gradient = context.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, "#f8fafc");
    gradient.addColorStop(0.55, "#eef4ff");
    gradient.addColorStop(1, "#f8fafc");
    context.fillStyle = gradient;
    context.fillRect(0, 0, width, height);

    context.strokeStyle = "rgba(148, 163, 184, 0.16)";
    context.lineWidth = 1;

    for (let x = 22; x < width; x += 48) {
        context.beginPath();
        context.moveTo(x, 0);
        context.lineTo(x, height);
        context.stroke();
    }
}

function drawConnectionLines(layout) {
    context.lineWidth = 2;
    context.font = `${layout.narrow ? 10 : 11}px IBM Plex Sans JP`;

    for (const config of connectionMeta) {
        const start = layout.positions[config.from];
        const end = layout.positions[config.to];
        const control = connectionControlPoint(layout, config);

        context.strokeStyle = "rgba(100, 116, 139, 0.25)";
        context.beginPath();
        context.moveTo(start.x, start.y);
        context.quadraticCurveTo(control.x, control.y, end.x, end.y);
        context.stroke();

        if (!layout.narrow) {
            const labelPoint = pointOnCurve(start, control, end, 0.5);
            context.fillStyle = "rgba(255, 255, 255, 0.78)";
            drawRoundedRectPath(labelPoint.x - 24, labelPoint.y - 14, 48, 18, 9);
            context.fill();
            context.fillStyle = "#64748b";
            context.textAlign = "center";
            context.fillText(config.label, labelPoint.x, labelPoint.y - 1);
            context.textAlign = "start";
        }
    }
}

function drawSector(layout, key) {
    const sector = sectors[key];
    const meta = sectorMeta[key];
    const position = layout.positions[key];
    const radius = layout.radius;

    context.fillStyle = "rgba(255, 255, 255, 0.92)";
    context.beginPath();
    context.arc(position.x, position.y, radius + 8, 0, Math.PI * 2);
    context.fill();

    context.fillStyle = meta.color;
    context.beginPath();
    context.arc(position.x, position.y, radius, 0, Math.PI * 2);
    context.fill();

    context.strokeStyle = "rgba(15, 23, 42, 0.24)";
    context.lineWidth = 3;
    context.stroke();

    context.fillStyle = "white";
    context.textAlign = "center";
    context.font = `700 ${layout.narrow ? 16 : 20}px IBM Plex Sans JP`;
    context.fillText(meta.name, position.x, position.y - 8);
    context.font = `700 ${layout.narrow ? 15 : 18}px IBM Plex Sans JP`;
    context.fillText(`¥${sector.money.toFixed(0)}`, position.x, position.y + 20);
    context.textAlign = "start";
}

function drawSectors(layout) {
    drawConnectionLines(layout);
    drawSector(layout, "household");
    drawSector(layout, "firm");
    drawSector(layout, "gov");
    drawSector(layout, "bank");
}

function drawFlows(layout) {
    for (const flow of flows) {
        const config = getConnectionConfig(flow.fromKey, flow.toKey);

        if (!config) {
            continue;
        }

        const start = layout.positions[flow.fromKey];
        const end = layout.positions[flow.toKey];
        const control = connectionControlPoint(layout, config);
        const point = pointOnCurve(start, control, end, flow.t);

        context.fillStyle = flow.color;
        context.beginPath();
        context.arc(point.x, point.y, flow.radius, 0, Math.PI * 2);
        context.fill();
    }
}

function drawGauge(box, label, value, min, max, color) {
    const ratio = clamp((value - min) / Math.max(1, max - min), 0, 1);
    const compactGauge = box.w < 190 || box.h < 68;
    const insetX = compactGauge ? 10 : 12;
    const labelY = box.y + (compactGauge ? 18 : 22);
    const barY = box.y + (compactGauge ? 28 : 38);
    const barHeight = compactGauge ? 10 : 12;
    const valueY = box.y + box.h - (compactGauge ? 9 : 12);

    context.fillStyle = "rgba(255, 255, 255, 0.82)";
    drawRoundedRectPath(box.x, box.y, box.w, box.h, compactGauge ? 12 : 14);
    context.fill();
    context.strokeStyle = "rgba(203, 213, 225, 0.9)";
    context.lineWidth = 1.2;
    context.stroke();

    context.fillStyle = "#111827";
    context.font = `${compactGauge ? 10 : width <= 560 ? 11 : 12}px IBM Plex Sans JP`;
    context.fillText(label, box.x + insetX, labelY);

    context.fillStyle = "#e5e7eb";
    context.fillRect(box.x + insetX, barY, box.w - insetX * 2, barHeight);
    context.fillStyle = color;
    context.fillRect(box.x + insetX, barY, (box.w - insetX * 2) * ratio, barHeight);

    context.fillStyle = "#111827";
    context.font = `${compactGauge ? 12 : width <= 560 ? 12 : 13}px IBM Plex Sans JP`;
    context.fillText(value.toFixed(0), box.x + insetX, valueY);
}

function drawIndicators(layout) {
    drawGauge(layout.gauges[0], "景気指数", gdp, 0, 300, "#16a34a");
    drawGauge(layout.gauges[1], "企業債務", firmDebt, 0, 600, "#dc2626");
    drawGauge(layout.gauges[2], "家計貯蓄", sectors.household.money, 0, 600, "#22c55e");
    drawGauge(layout.gauges[3], "財政", sectors.gov.money, 0, 600, "#0ea5e9");
}

function drawHistoryGraph(layout) {
    const box = layout.historyBox;
    context.fillStyle = "rgba(255, 255, 255, 0.82)";
    drawRoundedRectPath(box.x, box.y, box.w, box.h, 16);
    context.fill();
    context.strokeStyle = "rgba(203, 213, 225, 0.9)";
    context.lineWidth = 1.2;
    context.stroke();

    context.fillStyle = "#111827";
    context.font = `${layout.narrow ? 12 : 13}px IBM Plex Sans JP`;
    context.fillText("景気指数の履歴", box.x + 12, box.y + 22);

    if (history.length < 2) {
        context.fillStyle = "#64748b";
        context.font = `${layout.narrow ? 10 : 11}px IBM Plex Sans JP`;
        context.fillText("数秒待つと推移が描かれます。", box.x + 12, box.y + 48);
        return;
    }

    const graph = {
        x: box.x + 10,
        y: box.y + 30,
        w: box.w - 20,
        h: box.h - 40
    };

    context.strokeStyle = "rgba(148, 163, 184, 0.36)";
    context.beginPath();
    context.moveTo(graph.x, graph.y + graph.h);
    context.lineTo(graph.x + graph.w, graph.y + graph.h);
    context.stroke();

    context.strokeStyle = "#16a34a";
    context.lineWidth = 2;
    context.beginPath();

    history.forEach((point, index) => {
        const px = graph.x + index / Math.max(1, history.length - 1) * graph.w;
        const py = graph.y + graph.h - clamp(point.gdp / 300, 0, 1) * (graph.h - 6);

        if (index === 0) {
            context.moveTo(px, py);
        } else {
            context.lineTo(px, py);
        }
    });

    context.stroke();
}

function draw() {
    const layout = getLayout();
    context.clearRect(0, 0, width, height);
    drawBackground();
    drawHistoryGraph(layout);
    drawSectors(layout);
    drawFlows(layout);
    drawIndicators(layout);
}

function updateUi() {
    const state = currentStateLabel();

    consumeText.textContent = `${consumeRateSlider.value} %`;
    wageText.textContent = `${wageRateSlider.value} %`;
    taxText.textContent = `${taxRateSlider.value} %`;
    govText.textContent = govSpendSlider.value;
    loanText.textContent = loanRateSlider.value;
    interestText.textContent = `${interestRateSlider.value} %`;

    gdpStat.textContent = gdp.toFixed(0);
    profitStat.textContent = lastProfit.toFixed(1);
    savingStat.textContent = sectors.household.money.toFixed(0);
    budgetStat.textContent = sectors.gov.money.toFixed(0);
    debtStat.textContent = firmDebt.toFixed(0);
    stateStat.textContent = state;

    quickGdp.textContent = gdp.toFixed(0);
    quickHousehold.textContent = sectors.household.money.toFixed(0);
    quickDebt.textContent = firmDebt.toFixed(0);
    quickState.textContent = state;

    updateToggleButton();
}

function resizeCanvas() {
    const nextWidth = Math.max(320, Math.floor(canvas.clientWidth || simulationShell.clientWidth || 320));
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
    const compact = window.matchMedia("(max-width: 900px)").matches;

    width = nextWidth;

    if (compact) {
        height = Math.max(560, Math.min(760, Math.floor(Math.min(width * 1.22, viewportHeight * 0.74))));
    } else {
        height = Math.max(760, Math.min(920, Math.floor(width * 0.7)));

        const overlayHeights = [height];

        for (const element of [controlPanel, floatingHint]) {
            if (!element) {
                continue;
            }

            const styles = window.getComputedStyle(element);

            if (styles.position !== "absolute") {
                continue;
            }

            overlayHeights.push(element.offsetTop + element.scrollHeight + 20);
        }

        height = Math.max(...overlayHeights);
    }

    widthDpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(width * widthDpr);
    canvas.height = Math.floor(height * widthDpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    context.setTransform(widthDpr, 0, 0, widthDpr, 0, 0);
}

function loop(timestamp) {
    if (!lastTime) {
        lastTime = timestamp;
    }

    const delta = Math.min(32, timestamp - lastTime);
    lastTime = timestamp;
    const timeScale = delta / 16.6667;

    if (running) {
        stepAccumulator += timeScale;

        if (stepAccumulator >= 4.8) {
            economicStep();
            stepAccumulator = 0;
        }

        updateFlows(timeScale);
    }

    updateUi();
    draw();
    window.requestAnimationFrame(loop);
}

toggleRunningButton?.addEventListener("click", toggleRunning);
boomPresetButton?.addEventListener("click", boomPreset);
recessionPresetButton?.addEventListener("click", recessionPreset);
stimulusPresetButton?.addEventListener("click", stimulusPreset);
resetButton?.addEventListener("click", resetSimulation);

[consumeRateSlider, wageRateSlider, taxRateSlider, govSpendSlider, loanRateSlider, interestRateSlider].forEach((slider) => {
    slider?.addEventListener("input", () => {
        updateUi();
        draw();
    });
});

window.addEventListener("resize", () => {
    resizeCanvas();
    draw();
});

resizeCanvas();
resetState();
setStatus(defaultStatus);
updateUi();
draw();
window.requestAnimationFrame(loop);
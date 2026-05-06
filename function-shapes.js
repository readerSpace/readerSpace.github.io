const graphRange = {
    xMin: -10,
    xMax: 10,
    yMin: -10,
    yMax: 10
};

const functionOrder = [
    "quadratic",
    "linear",
    "cubic",
    "sine",
    "exponential",
    "logarithm",
    "gaussian"
];

const functionDefinitions = {
    quadratic: {
        label: "2次関数",
        color: "#1f6feb",
        formula(params) {
            return `y = ${formatValue(params.a)}(x ${formatShiftValue(params.h)})^2 ${formatSignedValue(params.k)}`;
        },
        params: {
            a: { label: "a 開き方", min: -3, max: 3, step: 0.1, value: 1 },
            h: { label: "h 左右移動", min: -6, max: 6, step: 0.1, value: 0 },
            k: { label: "k 上下移動", min: -8, max: 8, step: 0.1, value: 0 }
        },
        evaluate(x, params) {
            return params.a * ((x - params.h) ** 2) + params.k;
        },
        domain(params) {
            return "すべての x";
        },
        hint: "a が正なら上に開き、負なら下に開きます。|a| が大きいほど細くなり、h と k で頂点が動きます。"
    },
    linear: {
        label: "1次関数",
        color: "#e58a19",
        formula(params) {
            return `y = ${formatValue(params.a)}x ${formatSignedValue(params.b)}`;
        },
        params: {
            a: { label: "a 傾き", min: -5, max: 5, step: 0.1, value: 1 },
            b: { label: "b 切片", min: -8, max: 8, step: 0.1, value: 0 }
        },
        evaluate(x, params) {
            return (params.a * x) + params.b;
        },
        domain(params) {
            return "すべての x";
        },
        hint: "a は傾きです。正なら右上がり、負なら右下がり。b は y 軸との交点を表します。"
    },
    cubic: {
        label: "3次関数",
        color: "#de5f77",
        formula(params) {
            return `y = ${formatValue(params.a)}(x ${formatShiftValue(params.h)})^3 ${formatSignedValue(params.k)}`;
        },
        params: {
            a: { label: "a 曲がり方", min: -1, max: 1, step: 0.05, value: 0.1 },
            h: { label: "h 左右移動", min: -6, max: 6, step: 0.1, value: 0 },
            k: { label: "k 上下移動", min: -8, max: 8, step: 0.1, value: 0 }
        },
        evaluate(x, params) {
            return params.a * ((x - params.h) ** 3) + params.k;
        },
        domain(params) {
            return "すべての x";
        },
        hint: "3次関数は S 字の形になります。a の符号を変えると、S 字の向きが反転します。"
    },
    sine: {
        label: "三角関数 sin",
        color: "#21a784",
        formula(params) {
            return `y = ${formatValue(params.A)} sin(${formatValue(params.B)}(x ${formatShiftValue(params.C)})) ${formatSignedValue(params.D)}`;
        },
        params: {
            A: { label: "A 振幅", min: 0, max: 6, step: 0.1, value: 2 },
            B: { label: "B 周波数", min: 0.1, max: 5, step: 0.1, value: 1 },
            C: { label: "C 横移動", min: -6, max: 6, step: 0.1, value: 0 },
            D: { label: "D 上下移動", min: -6, max: 6, step: 0.1, value: 0 }
        },
        evaluate(x, params) {
            return (params.A * Math.sin(params.B * (x - params.C))) + params.D;
        },
        domain(params) {
            return "すべての x";
        },
        hint: "A は波の高さ、B は波の細かさ、C は横方向のずれ、D は上下移動を表します。"
    },
    exponential: {
        label: "指数関数",
        color: "#8d5cf6",
        formula(params) {
            return `y = ${formatValue(params.A)} e^(${formatValue(params.B)}x) ${formatSignedValue(params.D)}`;
        },
        params: {
            A: { label: "A 大きさ", min: -5, max: 5, step: 0.1, value: 1 },
            B: { label: "B 増加率", min: -1, max: 1, step: 0.05, value: 0.3 },
            D: { label: "D 上下移動", min: -8, max: 8, step: 0.1, value: 0 }
        },
        evaluate(x, params) {
            return (params.A * Math.exp(params.B * x)) + params.D;
        },
        domain(params) {
            return "すべての x";
        },
        hint: "B が正なら右に行くほど急激に増え、負なら減衰します。増え方そのものが変わる関数です。"
    },
    logarithm: {
        label: "対数関数",
        color: "#b55718",
        formula(params) {
            return `y = ${formatValue(params.A)} ln(x ${formatShiftValue(params.h)}) ${formatSignedValue(params.k)}`;
        },
        params: {
            A: { label: "A 縦の伸び", min: -5, max: 5, step: 0.1, value: 2 },
            h: { label: "h 左右移動", min: -8, max: 8, step: 0.1, value: -5 },
            k: { label: "k 上下移動", min: -8, max: 8, step: 0.1, value: 0 }
        },
        evaluate(x, params) {
            if ((x - params.h) <= 0) {
                return Number.NaN;
            }

            return (params.A * Math.log(x - params.h)) + params.k;
        },
        domain(params) {
            return `x > ${formatValue(params.h)}`;
        },
        hint: "ln の中身が正のときだけ定義されます。最初は急に増え、その後はゆっくり増える形です。"
    },
    gaussian: {
        label: "ガウス関数",
        color: "#cf4b91",
        formula(params) {
            return `y = ${formatValue(params.A)} exp(-((x - ${formatValue(params.mu)})^2) / (2×${formatValue(params.sigma)}^2)) ${formatSignedValue(params.D)}`;
        },
        params: {
            A: { label: "A 高さ", min: -8, max: 8, step: 0.1, value: 5 },
            mu: { label: "μ 中心", min: -6, max: 6, step: 0.1, value: 0 },
            sigma: { label: "σ 広がり", min: 0.3, max: 5, step: 0.1, value: 1.5 },
            D: { label: "D 上下移動", min: -6, max: 6, step: 0.1, value: 0 }
        },
        evaluate(x, params) {
            return (params.A * Math.exp(-(((x - params.mu) ** 2) / (2 * params.sigma * params.sigma)))) + params.D;
        },
        domain(params) {
            return "すべての x";
        },
        hint: "μ は山の中心、σ は山の広がりです。σ が大きいほど幅広く、なだらかな山になります。"
    }
};

const dom = {
    tabs: document.querySelector("#tabs"),
    controls: document.querySelector("#controls"),
    formula: document.querySelector("#formula"),
    hint: document.querySelector("#hint"),
    graph: document.querySelector("#graph"),
    functionNameHeading: document.querySelector("#functionNameHeading"),
    nameStat: document.querySelector("#nameStat"),
    originStat: document.querySelector("#originStat"),
    domainStat: document.querySelector("#domainStat"),
    mouseStat: document.querySelector("#mouseStat")
};

const ctx = dom.graph.getContext("2d");

const state = {
    currentKey: "quadratic",
    params: {},
    hoverWorld: null,
    viewport: {
        width: 820,
        height: 560,
        dpr: 1
    }
};

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

functionOrder.forEach((key) => {
    resetParams(key);
});

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function resetParams(key) {
    state.params[key] = {};

    Object.entries(functionDefinitions[key].params).forEach(([paramName, config]) => {
        state.params[key][paramName] = config.value;
    });
}

function getCurrentDefinition() {
    return functionDefinitions[state.currentKey];
}

function getCurrentParams() {
    return state.params[state.currentKey];
}

function formatValue(value, digits = 2) {
    if (Math.abs(value) < 1e-10) {
        return "0";
    }

    const fixed = value.toFixed(digits);

    return fixed.replace(/\.0+$|(?<=\.[0-9]*?)0+$/g, "");
}

function formatSignedValue(value, digits = 2) {
    const absoluteValue = formatValue(Math.abs(value), digits);

    return value >= 0 ? `+ ${absoluteValue}` : `- ${absoluteValue}`;
}

function formatShiftValue(value, digits = 2) {
    const absoluteValue = formatValue(Math.abs(value), digits);

    if (Math.abs(value) < 1e-10) {
        return "- 0";
    }

    return value >= 0 ? `- ${absoluteValue}` : `+ ${absoluteValue}`;
}

function worldToScreen(x, y) {
    return {
        sx: ((x - graphRange.xMin) / (graphRange.xMax - graphRange.xMin)) * state.viewport.width,
        sy: state.viewport.height - (((y - graphRange.yMin) / (graphRange.yMax - graphRange.yMin)) * state.viewport.height)
    };
}

function screenToWorld(sx, sy) {
    return {
        x: graphRange.xMin + ((sx / state.viewport.width) * (graphRange.xMax - graphRange.xMin)),
        y: graphRange.yMin + (((state.viewport.height - sy) / state.viewport.height) * (graphRange.yMax - graphRange.yMin))
    };
}

function resizeCanvas() {
    const bounds = dom.graph.getBoundingClientRect();
    const cssWidth = Math.max(320, Math.round(bounds.width || dom.graph.parentElement.clientWidth || 820));
    const cssHeight = window.innerWidth <= 780
        ? Math.round(clamp(cssWidth * 0.72, 340, 440))
        : 560;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    dom.graph.style.height = `${cssHeight}px`;
    dom.graph.width = Math.round(cssWidth * dpr);
    dom.graph.height = Math.round(cssHeight * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    state.viewport = {
        width: cssWidth,
        height: cssHeight,
        dpr
    };
}

function drawGrid() {
    ctx.clearRect(0, 0, state.viewport.width, state.viewport.height);

    const background = ctx.createLinearGradient(0, 0, 0, state.viewport.height);
    background.addColorStop(0, "#ffffff");
    background.addColorStop(1, "#f8fbff");
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, state.viewport.width, state.viewport.height);

    ctx.lineWidth = 1;
    ctx.font = "12px IBM Plex Sans JP";
    ctx.fillStyle = "#708093";

    for (let x = graphRange.xMin; x <= graphRange.xMax; x += 1) {
        const point = worldToScreen(x, 0);

        ctx.strokeStyle = x === 0 ? "#17314d" : "#e1e8f0";
        ctx.lineWidth = x === 0 ? 2.2 : 1;
        ctx.beginPath();
        ctx.moveTo(point.sx, 0);
        ctx.lineTo(point.sx, state.viewport.height);
        ctx.stroke();

        if (x !== 0) {
            ctx.fillText(String(x), point.sx + 3, worldToScreen(0, 0).sy + 14);
        }
    }

    for (let y = graphRange.yMin; y <= graphRange.yMax; y += 1) {
        const point = worldToScreen(0, y);

        ctx.strokeStyle = y === 0 ? "#17314d" : "#e1e8f0";
        ctx.lineWidth = y === 0 ? 2.2 : 1;
        ctx.beginPath();
        ctx.moveTo(0, point.sy);
        ctx.lineTo(state.viewport.width, point.sy);
        ctx.stroke();

        if (y !== 0) {
            ctx.fillText(String(y), worldToScreen(0, 0).sx + 6, point.sy - 4);
        }
    }
}

function drawFunctionCurve() {
    const definition = getCurrentDefinition();
    const params = getCurrentParams();

    ctx.strokeStyle = definition.color;
    ctx.lineWidth = 3.5;
    ctx.shadowColor = `${definition.color}44`;
    ctx.shadowBlur = 14;
    ctx.shadowOffsetY = 2;

    let started = false;
    let previousScreenY = 0;
    ctx.beginPath();

    for (let step = 0; step <= 1800; step += 1) {
        const x = graphRange.xMin + (((graphRange.xMax - graphRange.xMin) * step) / 1800);
        const y = definition.evaluate(x, params);

        if (!Number.isFinite(y) || Math.abs(y) > 400) {
            started = false;
            continue;
        }

        const screenPoint = worldToScreen(x, y);

        if (!started || Math.abs(screenPoint.sy - previousScreenY) > state.viewport.height * 1.25) {
            ctx.moveTo(screenPoint.sx, screenPoint.sy);
            started = true;
        } else {
            ctx.lineTo(screenPoint.sx, screenPoint.sy);
        }

        previousScreenY = screenPoint.sy;
    }

    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
}

function drawHoverMarker() {
    if (!state.hoverWorld) {
        return;
    }

    const definition = getCurrentDefinition();
    const params = getCurrentParams();
    const y = definition.evaluate(state.hoverWorld.x, params);

    if (!Number.isFinite(y)) {
        return;
    }

    const point = worldToScreen(state.hoverWorld.x, y);

    ctx.save();
    ctx.strokeStyle = "rgba(31, 92, 190, 0.26)";
    ctx.setLineDash([5, 7]);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(point.sx, 0);
    ctx.lineTo(point.sx, state.viewport.height);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, point.sy);
    ctx.lineTo(state.viewport.width, point.sy);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = definition.color;
    ctx.beginPath();
    ctx.arc(point.sx, point.sy, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
}

function updateTextPanels() {
    const definition = getCurrentDefinition();
    const params = getCurrentParams();
    const originValue = definition.evaluate(0, params);

    dom.formula.textContent = definition.formula(params);
    dom.hint.textContent = definition.hint;
    dom.functionNameHeading.textContent = definition.label;
    dom.nameStat.textContent = definition.label;
    dom.originStat.textContent = Number.isFinite(originValue) ? `y = ${formatValue(originValue)}` : "未定義";
    dom.domainStat.textContent = definition.domain(params);
}

function draw() {
    drawGrid();
    drawFunctionCurve();
    drawHoverMarker();
    updateTextPanels();
}

function renderTabs() {
    dom.tabs.innerHTML = "";

    functionOrder.forEach((key) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = `tab-button ${key === state.currentKey ? "is-active" : ""}`.trim();
        button.textContent = functionDefinitions[key].label;
        button.addEventListener("click", () => {
            state.currentKey = key;
            state.hoverWorld = null;
            dom.mouseStat.textContent = "---";
            renderTabs();
            renderControls();
            draw();
        });
        dom.tabs.appendChild(button);
    });
}

function renderControls() {
    const definition = getCurrentDefinition();
    const params = getCurrentParams();

    dom.controls.innerHTML = "";

    Object.entries(definition.params).forEach(([paramName, config]) => {
        const group = document.createElement("div");
        const row = document.createElement("div");
        const label = document.createElement("span");
        const value = document.createElement("span");
        const input = document.createElement("input");

        group.className = "control-group";
        row.className = "control-row";
        label.textContent = config.label;
        value.className = "control-value";
        value.textContent = formatValue(params[paramName]);

        input.type = "range";
        input.min = String(config.min);
        input.max = String(config.max);
        input.step = String(config.step);
        input.value = String(params[paramName]);
        input.addEventListener("input", () => {
            params[paramName] = Number(input.value);
            value.textContent = formatValue(params[paramName]);
            draw();
        });

        row.append(label, value);
        group.append(row, input);
        dom.controls.appendChild(group);
    });

    const resetButton = document.createElement("button");
    resetButton.type = "button";
    resetButton.className = "reset-button";
    resetButton.textContent = "この関数のパラメータをリセット";
    resetButton.addEventListener("click", () => {
        resetParams(state.currentKey);
        renderControls();
        draw();
    });
    dom.controls.appendChild(resetButton);
}

dom.graph.addEventListener("mousemove", (event) => {
    const rect = dom.graph.getBoundingClientRect();
    const screenX = ((event.clientX - rect.left) / rect.width) * state.viewport.width;
    const screenY = ((event.clientY - rect.top) / rect.height) * state.viewport.height;
    const worldPoint = screenToWorld(screenX, screenY);
    const y = getCurrentDefinition().evaluate(worldPoint.x, getCurrentParams());

    state.hoverWorld = worldPoint;
    dom.mouseStat.textContent = `x = ${formatValue(worldPoint.x)}, y = ${Number.isFinite(y) ? formatValue(y) : "未定義"}`;
    draw();
});

dom.graph.addEventListener("mouseleave", () => {
    state.hoverWorld = null;
    dom.mouseStat.textContent = "---";
    draw();
});

window.addEventListener("resize", () => {
    resizeCanvas();
    draw();
});

resizeCanvas();
renderTabs();
renderControls();
draw();
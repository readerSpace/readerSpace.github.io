const DEFAULTS = {
    functionKey: "square",
    domainScale: 2.5,
    rangeScale: 5,
    gridCount: 17
};

const dom = {
    functionSelect: document.querySelector("#functionSelect"),
    domainScale: document.querySelector("#domainScale"),
    rangeScale: document.querySelector("#rangeScale"),
    gridCount: document.querySelector("#gridCount"),
    domainScaleText: document.querySelector("#domainScaleText"),
    rangeScaleText: document.querySelector("#rangeScaleText"),
    gridText: document.querySelector("#gridText"),
    animateBtn: document.querySelector("#animateBtn"),
    resetBtn: document.querySelector("#resetBtn"),
    formula: document.querySelector("#formula"),
    effectTitle: document.querySelector("#effectTitle"),
    effectText: document.querySelector("#effectText"),
    functionStat: document.querySelector("#functionStat"),
    sampleStat: document.querySelector("#sampleStat"),
    behaviorStat: document.querySelector("#behaviorStat"),
    branchStat: document.querySelector("#branchStat"),
    mouseInfo: document.querySelector("#mouseInfo"),
    domainChip: document.querySelector("#domainChip"),
    rangeChip: document.querySelector("#rangeChip"),
    zCanvas: document.querySelector("#zCanvas"),
    wCanvas: document.querySelector("#wCanvas")
};

const contexts = {
    z: dom.zCanvas.getContext("2d"),
    w: dom.wCanvas.getContext("2d")
};

const state = {
    currentKey: DEFAULTS.functionKey,
    domainScale: DEFAULTS.domainScale,
    rangeScale: DEFAULTS.rangeScale,
    gridCount: DEFAULTS.gridCount,
    animationMix: 1,
    animationId: null,
    animationTimeoutId: null,
    hoverInput: null,
    viewports: {
        z: { width: 560, height: 560, dpr: 1 },
        w: { width: 560, height: 560, dpr: 1 }
    }
};

const functionDefinitions = {
    identity: {
        label: "恒等写像 f(z) = z",
        shortLabel: "恒等写像",
        formula: "w = z",
        effectTitle: "変形しない基準",
        effectText: "入力平面と出力平面が同じになります。ほかの関数で何が変わったかを見るための基準です。",
        behavior: "格子の形をそのまま保つ",
        note: "特異点なし",
        transform(z) {
            return complex(z.re, z.im);
        }
    },
    square: {
        label: "2乗 f(z) = z^2",
        shortLabel: "2乗 z^2",
        formula: "w = z<sup>2</sup>",
        effectTitle: "角度を 2 倍、距離を 2 乗",
        effectText: "原点の近くが強く圧縮され、放射線の角度は 2 倍に広がります。格子線が大きく曲がる典型例です。",
        behavior: "角度 2 倍 / 原点付近が圧縮",
        note: "特異点なし",
        transform(z) {
            return multiply(z, z);
        }
    },
    cube: {
        label: "3乗 f(z) = z^3",
        shortLabel: "3乗 z^3",
        formula: "w = z<sup>3</sup>",
        effectTitle: "角度を 3 倍、距離を 3 乗",
        effectText: "z^2 よりさらに強く回転と圧縮が効きます。原点を中心に、格子の折れ曲がりがより急になります。",
        behavior: "角度 3 倍 / 原点近傍でさらに強く圧縮",
        note: "特異点なし",
        transform(z) {
            return powerInt(z, 3);
        }
    },
    inverse: {
        label: "逆数 f(z) = 1 / z",
        shortLabel: "逆数 1 / z",
        formula: "w = 1 / z",
        effectTitle: "近い点を遠くへ、遠い点を原点近くへ",
        effectText: "原点の近くほど大きく飛ばされ、外側の点は内側に引き戻されます。円と直線の入れ替わりも見やすい関数です。",
        behavior: "内外を反転しながら回転する",
        note: "z = 0 が特異点で未定義",
        transform(z) {
            return divide(complex(1, 0), z);
        }
    },
    exp: {
        label: "指数関数 f(z) = e^z",
        shortLabel: "指数 e^z",
        formula: "w = e<sup>z</sup> = e<sup>x</sup>(cos y + i sin y)",
        effectTitle: "縞を回転つきの放射状パターンへ変える",
        effectText: "実部方向の平行移動が拡大率になり、虚部方向の平行移動が回転角になります。格子が巻きつくように広がります。",
        behavior: "縦横の平行線が拡大と回転へ変換される",
        note: "特異点なし / 周期 2πi を持つ",
        transform(z) {
            return expComplex(z);
        }
    },
    sin: {
        label: "正弦関数 f(z) = sin z",
        shortLabel: "正弦 sin z",
        formula: "w = sin z",
        effectTitle: "周期と双曲的な広がりを同時に持つ",
        effectText: "実軸方向には周期的に繰り返し、虚軸方向には双曲線関数のように急速に広がります。波と指数の性質が混ざった形です。",
        behavior: "周期的な折り返しと急激な広がりが共存",
        note: "特異点なし",
        transform(z) {
            return sinComplex(z);
        }
    },
    log: {
        label: "対数関数 f(z) = log z",
        shortLabel: "対数 log z",
        formula: "w = log z = log|z| + i arg(z)",
        effectTitle: "半径と角度を、実部と虚部へほどく",
        effectText: "同心円がほぼ横線へ、放射線がほぼ縦線へ変わります。ここでは主値を使い、負の実軸に枝切りを置いています。",
        behavior: "積を和に変える / 円筒を帯にほどく",
        note: "z = 0 で未定義 / 負の実軸に枝切り",
        transform(z) {
            return logComplex(z);
        }
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

function complex(re, im) {
    return { re, im };
}

function add(a, b) {
    return complex(a.re + b.re, a.im + b.im);
}

function subtract(a, b) {
    return complex(a.re - b.re, a.im - b.im);
}

function multiply(a, b) {
    return complex((a.re * b.re) - (a.im * b.im), (a.re * b.im) + (a.im * b.re));
}

function divide(a, b) {
    const denominator = (b.re * b.re) + (b.im * b.im);

    if (denominator < 1e-10) {
        return complex(Number.NaN, Number.NaN);
    }

    return complex(
        ((a.re * b.re) + (a.im * b.im)) / denominator,
        ((a.im * b.re) - (a.re * b.im)) / denominator
    );
}

function powerInt(z, exponent) {
    let result = complex(1, 0);

    for (let index = 0; index < exponent; index += 1) {
        result = multiply(result, z);
    }

    return result;
}

function expComplex(z) {
    const scale = Math.exp(z.re);

    return complex(scale * Math.cos(z.im), scale * Math.sin(z.im));
}

function sinComplex(z) {
    return complex(
        Math.sin(z.re) * Math.cosh(z.im),
        Math.cos(z.re) * Math.sinh(z.im)
    );
}

function logComplex(z) {
    const radius = Math.hypot(z.re, z.im);

    if (radius < 1e-10) {
        return complex(Number.NaN, Number.NaN);
    }

    return complex(Math.log(radius), Math.atan2(z.im, z.re));
}

function lerpComplex(from, to, mix) {
    return complex(
        from.re + ((to.re - from.re) * mix),
        from.im + ((to.im - from.im) * mix)
    );
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function getCurrentDefinition() {
    return functionDefinitions[state.currentKey];
}

function transformCurrent(z) {
    return getCurrentDefinition().transform(z);
}

function mapForDisplay(z) {
    return lerpComplex(z, transformCurrent(z), state.animationMix);
}

function formatNumber(value, digits = 2) {
    if (!Number.isFinite(value)) {
        return "未定義";
    }

    const epsilon = 0.5 / (10 ** digits);
    const rounded = Math.abs(value) < epsilon ? 0 : value;

    return rounded.toFixed(digits).replace(/(?:\.0+|(\.\d*?[1-9]))0+$/, "$1");
}

function formatComplexValue(z, digits = 2) {
    if (!isFiniteComplex(z)) {
        return "未定義";
    }

    const real = formatNumber(z.re, digits);
    const imaginary = formatNumber(Math.abs(z.im), digits);
    const sign = z.im >= 0 ? "+" : "-";

    return `${real} ${sign} ${imaginary}i`;
}

function isFiniteComplex(z) {
    return Number.isFinite(z.re) && Number.isFinite(z.im) && Math.abs(z.re) < 1e6 && Math.abs(z.im) < 1e6;
}

function isDisplayableComplex(z, scale) {
    return isFiniteComplex(z) && Math.abs(z.re) <= scale * 10 && Math.abs(z.im) <= scale * 10;
}

function worldToScreen(viewport, z, scale) {
    return {
        x: ((z.re / scale) + 1) * 0.5 * viewport.width,
        y: (1 - ((z.im / scale) + 1) * 0.5) * viewport.height
    };
}

function screenToWorld(viewport, x, y, scale) {
    return complex(
        ((x / viewport.width) * 2 - 1) * scale,
        (1 - ((y / viewport.height) * 2)) * scale
    );
}

function niceStep(scale) {
    if (scale <= 1.5) {
        return 0.5;
    }

    if (scale <= 3) {
        return 1;
    }

    if (scale <= 6) {
        return 2;
    }

    return 5;
}

function resizeCanvas(key, canvas) {
    const shell = canvas.parentElement;
    const bounds = shell.getBoundingClientRect();
    const cssSize = Math.max(300, Math.round(bounds.width || shell.clientWidth || 560));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    canvas.style.height = `${cssSize}px`;
    canvas.width = Math.round(cssSize * dpr);
    canvas.height = Math.round(cssSize * dpr);
    contexts[key].setTransform(dpr, 0, 0, dpr, 0, 0);

    state.viewports[key] = {
        width: cssSize,
        height: cssSize,
        dpr
    };
}

function resizeCanvases() {
    resizeCanvas("z", dom.zCanvas);
    resizeCanvas("w", dom.wCanvas);
}

function drawPlaneBackground(key, scale) {
    const ctx = contexts[key];
    const viewport = state.viewports[key];
    const axisColor = key === "z" ? "#17314d" : "#163652";
    const gridColor = key === "z" ? "#e2ebf2" : "#dde7ee";
    const labelColor = key === "z" ? "#5f7286" : "#617588";
    const background = ctx.createLinearGradient(0, 0, 0, viewport.height);
    background.addColorStop(0, "#ffffff");
    background.addColorStop(1, key === "z" ? "#f7fbff" : "#fcf7ef");

    ctx.clearRect(0, 0, viewport.width, viewport.height);
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, viewport.width, viewport.height);
    ctx.lineWidth = 1;
    ctx.font = "12px IBM Plex Sans JP";
    ctx.fillStyle = labelColor;

    const step = niceStep(scale);

    for (let value = Math.ceil(-scale / step) * step; value <= scale + 1e-9; value += step) {
        const normalizedValue = Number(formatNumber(value, 2));
        const vertical = worldToScreen(viewport, complex(normalizedValue, 0), scale);
        const horizontal = worldToScreen(viewport, complex(0, normalizedValue), scale);

        ctx.strokeStyle = Math.abs(normalizedValue) < 1e-9 ? axisColor : gridColor;
        ctx.lineWidth = Math.abs(normalizedValue) < 1e-9 ? 2.2 : 1;

        ctx.beginPath();
        ctx.moveTo(vertical.x, 0);
        ctx.lineTo(vertical.x, viewport.height);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(0, horizontal.y);
        ctx.lineTo(viewport.width, horizontal.y);
        ctx.stroke();

        if (Math.abs(normalizedValue) >= 1e-9) {
            ctx.fillText(String(normalizedValue), vertical.x + 4, worldToScreen(viewport, complex(0, 0), scale).y + 15);
            ctx.fillText(String(normalizedValue), worldToScreen(viewport, complex(0, 0), scale).x + 6, horizontal.y - 4);
        }
    }

    const origin = worldToScreen(viewport, complex(0, 0), scale);
    ctx.fillStyle = axisColor;
    ctx.fillText("Re", viewport.width - 24, origin.y - 8);
    ctx.fillText("Im", origin.x + 8, 16);
}

function generateGridLines(scale, count) {
    const lines = [];
    const samples = 240;

    for (let index = 0; index < count; index += 1) {
        const fixedValue = -scale + ((2 * scale * index) / (count - 1));
        const realDirection = [];
        const imaginaryDirection = [];

        for (let sampleIndex = 0; sampleIndex <= samples; sampleIndex += 1) {
            const varyingValue = -scale + ((2 * scale * sampleIndex) / samples);
            realDirection.push(complex(varyingValue, fixedValue));
            imaginaryDirection.push(complex(fixedValue, varyingValue));
        }

        lines.push({ points: realDirection, color: "rgba(37, 99, 235, 0.78)" });
        lines.push({ points: imaginaryDirection, color: "rgba(234, 88, 12, 0.72)" });
    }

    return lines;
}

function drawMappedLine(key, points, color, mapped) {
    const ctx = contexts[key];
    const viewport = state.viewports[key];
    const displayScale = key === "z" ? state.domainScale : state.rangeScale;
    let started = false;
    let previous = null;

    ctx.strokeStyle = color;
    ctx.lineWidth = 1.7;
    ctx.beginPath();

    for (const point of points) {
        const rendered = mapped ? mapForDisplay(point) : point;

        if (!isDisplayableComplex(rendered, displayScale)) {
            if (started) {
                ctx.stroke();
            }
            ctx.beginPath();
            started = false;
            previous = null;
            continue;
        }

        const screenPoint = worldToScreen(viewport, rendered, displayScale);

        if (!started) {
            ctx.moveTo(screenPoint.x, screenPoint.y);
            started = true;
        } else {
            const jump = Math.hypot(screenPoint.x - previous.x, screenPoint.y - previous.y);

            if (jump > viewport.width * 0.26) {
                ctx.stroke();
                ctx.beginPath();
                ctx.moveTo(screenPoint.x, screenPoint.y);
            } else {
                ctx.lineTo(screenPoint.x, screenPoint.y);
            }
        }

        previous = screenPoint;
    }

    if (started) {
        ctx.stroke();
    }
}

function drawSpecialPoints(key, mapped) {
    const ctx = contexts[key];
    const viewport = state.viewports[key];
    const displayScale = key === "z" ? state.domainScale : state.rangeScale;
    const points = [
        { z: complex(1, 0), label: "1" },
        { z: complex(0, 1), label: "i" },
        { z: complex(-1, 0), label: "-1" },
        { z: complex(0, -1), label: "-i" }
    ];

    ctx.font = "700 13px IBM Plex Sans JP";
    ctx.textAlign = "center";

    points.forEach((item) => {
        const rendered = mapped ? mapForDisplay(item.z) : item.z;

        if (!isDisplayableComplex(rendered, displayScale)) {
            return;
        }

        const point = worldToScreen(viewport, rendered, displayScale);
        ctx.fillStyle = key === "z" ? "#12314d" : "#6a3b15";
        ctx.beginPath();
        ctx.arc(point.x, point.y, 4.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillText(item.label, point.x, point.y - 10);
    });
}

function drawHoverMarkers() {
    if (!state.hoverInput) {
        return;
    }

    drawMarker("z", state.hoverInput, state.domainScale, "rgba(23, 49, 77, 0.28)", "#174c87");
    drawMarker("w", mapForDisplay(state.hoverInput), state.rangeScale, "rgba(106, 59, 21, 0.24)", "#b66c18");
}

function drawMarker(key, point, scale, lineColor, dotColor) {
    if (!isDisplayableComplex(point, scale)) {
        return;
    }

    const ctx = contexts[key];
    const viewport = state.viewports[key];
    const screenPoint = worldToScreen(viewport, point, scale);

    ctx.save();
    ctx.strokeStyle = lineColor;
    ctx.setLineDash([5, 7]);
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(screenPoint.x, 0);
    ctx.lineTo(screenPoint.x, viewport.height);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, screenPoint.y);
    ctx.lineTo(viewport.width, screenPoint.y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = dotColor;
    ctx.beginPath();
    ctx.arc(screenPoint.x, screenPoint.y, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
}

function updateControlText() {
    dom.domainScaleText.textContent = `±${formatNumber(state.domainScale, 1)}`;
    dom.rangeScaleText.textContent = `±${formatNumber(state.rangeScale, 1)}`;
    dom.gridText.textContent = `${state.gridCount} 本`;
    dom.domainChip.textContent = `Re, Im = ±${formatNumber(state.domainScale, 1)}`;
    dom.rangeChip.textContent = `Re, Im = ±${formatNumber(state.rangeScale, 1)}`;
}

function updateInfoPanels() {
    const definition = getCurrentDefinition();
    const sample = definition.transform(complex(1, 1));

    dom.formula.innerHTML = definition.formula;
    dom.effectTitle.textContent = definition.effectTitle;
    dom.effectText.textContent = definition.effectText;
    dom.functionStat.textContent = definition.shortLabel;
    dom.sampleStat.textContent = formatComplexValue(sample);
    dom.behaviorStat.textContent = definition.behavior;
    dom.branchStat.textContent = definition.note;
}

function drawAll() {
    updateControlText();
    updateInfoPanels();
    drawPlaneBackground("z", state.domainScale);
    drawPlaneBackground("w", state.rangeScale);

    const lines = generateGridLines(state.domainScale, state.gridCount);

    lines.forEach((line) => {
        drawMappedLine("z", line.points, line.color, false);
        drawMappedLine("w", line.points, line.color, true);
    });

    drawSpecialPoints("z", false);
    drawSpecialPoints("w", true);
    drawHoverMarkers();
}

function cancelActiveAnimation() {
    if (state.animationId !== null) {
        cancelAnimationFrame(state.animationId);
        state.animationId = null;
    }

    if (state.animationTimeoutId !== null) {
        clearTimeout(state.animationTimeoutId);
        state.animationTimeoutId = null;
    }

    state.animationMix = 1;
    dom.animateBtn.disabled = false;
    dom.animateBtn.textContent = "変形アニメーション";
}

function playAnimation() {
    cancelActiveAnimation();
    state.animationMix = 0;
    dom.animateBtn.disabled = true;
    dom.animateBtn.textContent = "変形中...";

    const start = performance.now();
    const duration = 1300;

    state.animationTimeoutId = window.setTimeout(() => {
        state.animationId = null;
        state.animationTimeoutId = null;
        state.animationMix = 1;
        dom.animateBtn.disabled = false;
        dom.animateBtn.textContent = "変形アニメーション";
        drawAll();
    }, duration + 250);

    const tick = (now) => {
        const progress = Math.min(1, (now - start) / duration);
        state.animationMix = 1 - Math.pow(1 - progress, 3);
        drawAll();

        if (progress < 1) {
            state.animationId = requestAnimationFrame(tick);
        } else {
            state.animationId = null;
            if (state.animationTimeoutId !== null) {
                clearTimeout(state.animationTimeoutId);
                state.animationTimeoutId = null;
            }
            state.animationMix = 1;
            dom.animateBtn.disabled = false;
            dom.animateBtn.textContent = "変形アニメーション";
            drawAll();
        }
    };

    state.animationId = requestAnimationFrame(tick);
}

function populateFunctionSelect() {
    Object.entries(functionDefinitions).forEach(([key, definition]) => {
        const option = document.createElement("option");
        option.value = key;
        option.textContent = definition.label;
        dom.functionSelect.appendChild(option);
    });

    dom.functionSelect.value = state.currentKey;
}

function updateMouseInfo(z) {
    const mapped = transformCurrent(z);

    if (!isFiniteComplex(mapped)) {
        dom.mouseInfo.textContent = `z = ${formatComplexValue(z)} → 未定義`;
        return;
    }

    dom.mouseInfo.textContent = `z = ${formatComplexValue(z)} → w = ${formatComplexValue(mapped)}`;
}

function resetAll() {
    cancelActiveAnimation();
    state.currentKey = DEFAULTS.functionKey;
    state.domainScale = DEFAULTS.domainScale;
    state.rangeScale = DEFAULTS.rangeScale;
    state.gridCount = DEFAULTS.gridCount;
    state.hoverInput = null;

    dom.functionSelect.value = state.currentKey;
    dom.domainScale.value = String(state.domainScale);
    dom.rangeScale.value = String(state.rangeScale);
    dom.gridCount.value = String(state.gridCount);
    dom.mouseInfo.textContent = "マウス: ---";
    drawAll();
}

dom.functionSelect.addEventListener("change", () => {
    cancelActiveAnimation();
    state.currentKey = dom.functionSelect.value;
    drawAll();
});

dom.domainScale.addEventListener("input", () => {
    cancelActiveAnimation();
    state.domainScale = Number(dom.domainScale.value);
    drawAll();
});

dom.rangeScale.addEventListener("input", () => {
    cancelActiveAnimation();
    state.rangeScale = Number(dom.rangeScale.value);
    drawAll();
});

dom.gridCount.addEventListener("input", () => {
    cancelActiveAnimation();
    state.gridCount = Number(dom.gridCount.value);
    drawAll();
});

dom.animateBtn.addEventListener("click", playAnimation);
dom.resetBtn.addEventListener("click", resetAll);

dom.zCanvas.addEventListener("mousemove", (event) => {
    const rect = dom.zCanvas.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * state.viewports.z.width;
    const y = ((event.clientY - rect.top) / rect.height) * state.viewports.z.height;

    state.hoverInput = screenToWorld(state.viewports.z, x, y, state.domainScale);
    updateMouseInfo(state.hoverInput);
    drawAll();
});

dom.zCanvas.addEventListener("mouseleave", () => {
    state.hoverInput = null;
    dom.mouseInfo.textContent = "マウス: ---";
    drawAll();
});

window.addEventListener("resize", () => {
    resizeCanvases();
    drawAll();
});

populateFunctionSelect();
resizeCanvases();
drawAll();
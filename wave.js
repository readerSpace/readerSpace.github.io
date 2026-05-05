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

const canvas = document.querySelector("#waveCanvas");
const context = canvas?.getContext("2d", { alpha: false });
const bufferCanvas = document.createElement("canvas");
const bufferContext = bufferCanvas.getContext("2d", { alpha: false });
const simulationShell = document.querySelector(".simulation-shell");
const simulationPanel = document.querySelector("#simulationPanel");

const playPauseButton = document.querySelector("#playPause");
const togglePanelButton = document.querySelector("#togglePanel");
const showPanelButton = document.querySelector("#showPanel");
const clearButton = document.querySelector("#clear");
const twoSourcesButton = document.querySelector("#twoSources");
const doubleSlitButton = document.querySelector("#doubleSlit");
const rainButton = document.querySelector("#rain");
const waveSpeedSlider = document.querySelector("#waveSpeed");
const dampingSlider = document.querySelector("#damping");
const amplitudeSlider = document.querySelector("#amplitude");
const frequencySlider = document.querySelector("#frequency");
const speedValue = document.querySelector("#speedValue");
const dampingValue = document.querySelector("#dampingValue");
const ampValue = document.querySelector("#ampValue");
const freqValue = document.querySelector("#freqValue");
const sourceCountSpan = document.querySelector("#sourceCount");
const resolutionSpan = document.querySelector("#resolution");
const panelStatus = document.querySelector("#panelStatus");
const toolValue = document.querySelector("#toolValue");
const toolPanelValue = document.querySelector("#toolPanelValue");
const modeValue = document.querySelector("#modeValue");
const runningValue = document.querySelector("#runningValue");
const toolButtons = document.querySelectorAll("[data-tool]");

const toolLabels = {
    drop: "波紋",
    source: "波源追加",
    wall: "壁",
    erase: "消す",
    stir: "かき混ぜる"
};

let displayWidth = 0;
let displayHeight = 0;
let simulationWidth = 0;
let simulationHeight = 0;
let renderScale = 4;
let current = new Float32Array(0);
let previous = new Float32Array(0);
let next = new Float32Array(0);
let walls = new Uint8Array(0);
let imageData;
let sources = [];
let running = true;
let rainMode = false;
let tool = "drop";
let drawing = false;
let time = 0;
let statusTimeout = 0;
let animationTimeout = 0;
let panelHidden = false;

const defaultStatus = "クリックで波紋、波源追加で連続波、壁で反射っぽい境界を置けます。2つの波源か二重スリットから始めると変化が見やすいです。";

const indexOf = (x, y) => y * simulationWidth + x;

const inside = (x, y) => x >= 1 && x < simulationWidth - 1 && y >= 1 && y < simulationHeight - 1;

const setStatus = (message, persist = false) => {
    if (!panelStatus) {
        return;
    }

    panelStatus.textContent = message;

    if (statusTimeout) {
        window.clearTimeout(statusTimeout);
        statusTimeout = 0;
    }

    if (!persist) {
        statusTimeout = window.setTimeout(() => {
            panelStatus.textContent = defaultStatus;
        }, 2600);
    }
};

const setPanelVisibility = (hidden) => {
    panelHidden = hidden;
    simulationShell?.classList.toggle("is-panel-hidden", hidden);
    simulationPanel?.setAttribute("aria-hidden", hidden ? "true" : "false");
    togglePanelButton?.setAttribute("aria-expanded", hidden ? "false" : "true");
    showPanelButton?.setAttribute("aria-expanded", hidden ? "false" : "true");
};

const updateReadouts = () => {
    speedValue.textContent = Number(waveSpeedSlider?.value ?? 0).toFixed(2);
    dampingValue.textContent = Number(dampingSlider?.value ?? 0).toFixed(3);
    ampValue.textContent = String(amplitudeSlider?.value ?? 0);
    freqValue.textContent = Number(frequencySlider?.value ?? 0).toFixed(2);
    sourceCountSpan.textContent = String(sources.length);
    resolutionSpan.textContent = simulationWidth && simulationHeight ? `${simulationWidth}×${simulationHeight}` : "-";
    toolValue.textContent = toolLabels[tool];
    toolPanelValue.textContent = toolLabels[tool];
    modeValue.textContent = rainMode ? "雨モード" : "静かな水面";
    runningValue.textContent = running ? "再生中" : "停止中";
};

const resetFieldsOnly = () => {
    current.fill(0);
    previous.fill(0);
    next.fill(0);
    time = 0;
};

const resetWorld = ({ announce = false } = {}) => {
    const cellCount = simulationWidth * simulationHeight;
    current = new Float32Array(cellCount);
    previous = new Float32Array(cellCount);
    next = new Float32Array(cellCount);
    walls = new Uint8Array(cellCount);
    sources = [];
    rainMode = false;
    time = 0;
    rainButton?.classList.remove("active");
    updateReadouts();

    if (announce) {
        setStatus("水面をリセットしました。まずは 2 つの波源から始めると干渉縞が見えやすいです。", false);
    }
};

const disturb = (centerX, centerY, radius, amount) => {
    const radiusFloor = Math.max(1, Math.floor(radius));

    for (let offsetY = -radiusFloor; offsetY <= radiusFloor; offsetY += 1) {
        for (let offsetX = -radiusFloor; offsetX <= radiusFloor; offsetX += 1) {
            const x = centerX + offsetX;
            const y = centerY + offsetY;

            if (!inside(x, y)) {
                continue;
            }

            const index = indexOf(x, y);
            if (walls[index]) {
                continue;
            }

            const distance = Math.hypot(offsetX, offsetY);
            if (distance > radiusFloor) {
                continue;
            }

            const falloff = Math.cos((distance / radiusFloor) * Math.PI * 0.5);
            current[index] += amount * falloff;
        }
    }
};

const paintWall = (centerX, centerY, radius, value) => {
    for (let offsetY = -radius; offsetY <= radius; offsetY += 1) {
        for (let offsetX = -radius; offsetX <= radius; offsetX += 1) {
            const x = centerX + offsetX;
            const y = centerY + offsetY;

            if (!inside(x, y) || Math.hypot(offsetX, offsetY) > radius) {
                continue;
            }

            const index = indexOf(x, y);
            walls[index] = value;
            current[index] = 0;
            previous[index] = 0;
            next[index] = 0;
        }
    }
};

const addSource = (x, y, phase = 0) => {
    if (!inside(x, y)) {
        return;
    }

    const tooClose = sources.some((source) => Math.hypot(source.x - x, source.y - y) < 4);
    if (tooClose) {
        return;
    }

    sources.push({ x, y, phase });
    updateReadouts();
};

const applyTwoSources = (announce = true) => {
    resetFieldsOnly();
    walls.fill(0);
    sources = [
        { x: Math.floor(simulationWidth * 0.36), y: Math.floor(simulationHeight * 0.48), phase: 0 },
        { x: Math.floor(simulationWidth * 0.64), y: Math.floor(simulationHeight * 0.48), phase: 0 }
    ];
    updateReadouts();

    if (announce) {
        setStatus("2 つの波源を置きました。明るい筋と暗い筋が交互に並ぶ干渉縞を見てみてください。", false);
    }
};

const applyDoubleSlit = (announce = true) => {
    resetFieldsOnly();
    walls.fill(0);
    sources = [{ x: Math.floor(simulationWidth * 0.22), y: Math.floor(simulationHeight * 0.5), phase: 0 }];

    const wallX = Math.floor(simulationWidth * 0.42);
    const slit1 = Math.floor(simulationHeight * 0.42);
    const slit2 = Math.floor(simulationHeight * 0.58);
    const slitHalf = Math.max(2, Math.floor(simulationHeight * 0.035));

    for (let y = Math.floor(simulationHeight * 0.15); y < Math.floor(simulationHeight * 0.85); y += 1) {
        const inSlit1 = Math.abs(y - slit1) < slitHalf;
        const inSlit2 = Math.abs(y - slit2) < slitHalf;

        if (inSlit1 || inSlit2) {
            continue;
        }

        for (let x = wallX - 2; x <= wallX + 2; x += 1) {
            walls[indexOf(x, y)] = 1;
        }
    }

    updateReadouts();

    if (announce) {
        setStatus("二重スリットを作りました。すき間を抜けた後ろ側で、波が再び広がりながら干渉縞を作ります。", false);
    }
};

const setTool = (nextTool) => {
    tool = nextTool;
    toolButtons.forEach((button) => {
        button.classList.toggle("active", button.dataset.tool === nextTool);
    });
    updateReadouts();

    const messages = {
        drop: "クリックした場所から波紋を出します。まずは 1 回だけ打って、輪がどう広がるかを見てみましょう。",
        source: "連続して波を出す波源を置けます。2 つ以上置くと干渉縞が見えます。",
        wall: "動けない点として壁を描きます。波が反射っぽく折り返す様子が見えます。",
        erase: "壁や近くの波源を消します。詰まりすぎたら部分的に消して整えられます。",
        stir: "水面をかき混ぜるように小さな揺らぎを入れます。整った縞が乱れる様子も見られます。"
    };

    setStatus(messages[nextTool], false);
};

const pointerPosition = (event) => {
    const rect = canvas.getBoundingClientRect();
    return {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top
    };
};

const pointerToSimulation = (event) => {
    const pointer = pointerPosition(event);

    return {
        x: Math.floor((pointer.x / Math.max(displayWidth, 1)) * simulationWidth),
        y: Math.floor((pointer.y / Math.max(displayHeight, 1)) * simulationHeight)
    };
};

const applyCanvasTool = (event) => {
    const position = pointerToSimulation(event);

    if (!inside(position.x, position.y)) {
        return;
    }

    if (tool === "drop") {
        disturb(position.x, position.y, 8, Number(amplitudeSlider.value));
    } else if (tool === "source") {
        addSource(position.x, position.y, 0);
    } else if (tool === "wall") {
        paintWall(position.x, position.y, 5, 1);
    } else if (tool === "erase") {
        paintWall(position.x, position.y, 7, 0);
        sources = sources.filter((source) => Math.hypot(source.x - position.x, source.y - position.y) > 7);
        updateReadouts();
    } else if (tool === "stir") {
        disturb(position.x, position.y, 6, 55);
    }
};

const stepWave = () => {
    const waveSpeed = Number(waveSpeedSlider.value);
    const damping = Number(dampingSlider.value);

    for (let y = 1; y < simulationHeight - 1; y += 1) {
        for (let x = 1; x < simulationWidth - 1; x += 1) {
            const index = indexOf(x, y);
            if (walls[index]) {
                next[index] = 0;
                continue;
            }

            const center = current[index];
            const left = walls[indexOf(x - 1, y)] ? center : current[indexOf(x - 1, y)];
            const right = walls[indexOf(x + 1, y)] ? center : current[indexOf(x + 1, y)];
            const top = walls[indexOf(x, y - 1)] ? center : current[indexOf(x, y - 1)];
            const bottom = walls[indexOf(x, y + 1)] ? center : current[indexOf(x, y + 1)];
            const laplace = left + right + top + bottom - 4 * center;

            next[index] = (2 * center - previous[index] + waveSpeed * waveSpeed * laplace) * damping;
        }
    }

    const amplitude = Number(amplitudeSlider.value);
    const frequency = Number(frequencySlider.value);
    sources.forEach((source) => {
        disturb(source.x, source.y, 3, Math.sin(time * frequency + source.phase) * amplitude * 0.08);
    });

    if (rainMode && Math.random() < 0.16) {
        disturb(
            2 + Math.floor(Math.random() * Math.max(simulationWidth - 4, 1)),
            2 + Math.floor(Math.random() * Math.max(simulationHeight - 4, 1)),
            4,
            40 + Math.random() * 80
        );
    }

    const swap = previous;
    previous = current;
    current = next;
    next = swap;
    time += 1;
};

const drawSources = () => {
    if (!context || !simulationWidth || !simulationHeight) {
        return;
    }

    const scaleX = canvas.width / simulationWidth;
    const scaleY = canvas.height / simulationHeight;

    sources.forEach((source) => {
        const x = (source.x + 0.5) * scaleX;
        const y = (source.y + 0.5) * scaleY;
        const radius = Math.max(10, Math.min(scaleX, scaleY) * 2.6);

        context.save();
        context.beginPath();
        context.arc(x, y, radius, 0, Math.PI * 2);
        context.fillStyle = "#facc15";
        context.shadowColor = "#facc15";
        context.shadowBlur = radius * 1.5;
        context.fill();
        context.beginPath();
        context.arc(x, y, radius * (2 + Math.sin(time * 0.08 + source.phase) * 0.24), 0, Math.PI * 2);
        context.strokeStyle = "rgba(250, 204, 21, 0.42)";
        context.lineWidth = Math.max(2, radius * 0.16);
        context.stroke();
        context.restore();
    });
};

const render = () => {
    if (!context || !bufferContext || !imageData) {
        return;
    }

    const pixels = imageData.data;

    for (let y = 0; y < simulationHeight; y += 1) {
        for (let x = 0; x < simulationWidth; x += 1) {
            const index = indexOf(x, y);
            const pixel = index * 4;

            if (walls[index]) {
                pixels[pixel] = 192;
                pixels[pixel + 1] = 203;
                pixels[pixel + 2] = 214;
                pixels[pixel + 3] = 255;
                continue;
            }

            const height = Math.max(-80, Math.min(80, current[index]));
            const magnitude = Math.abs(height);

            if (height >= 0) {
                pixels[pixel] = Math.min(255, 22 + magnitude * 1.1);
                pixels[pixel + 1] = Math.min(255, 110 + height * 0.85);
                pixels[pixel + 2] = Math.min(255, 178 + magnitude * 0.68);
            } else {
                pixels[pixel] = 5;
                pixels[pixel + 1] = Math.max(0, 64 + height * 0.6);
                pixels[pixel + 2] = Math.max(0, 132 + height * 0.44);
            }

            pixels[pixel + 3] = 255;
        }
    }

    bufferContext.putImageData(imageData, 0, 0);
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.imageSmoothingEnabled = false;
    context.drawImage(bufferCanvas, 0, 0, canvas.width, canvas.height);
    drawSources();
    updateReadouts();
};

const animate = () => {
    if (running) {
        for (let step = 0; step < 3; step += 1) {
            stepWave();
        }
    }

    render();
    animationTimeout = window.setTimeout(animate, 16);
};

const resizeCanvas = () => {
    if (!canvas || !context || !bufferContext) {
        return;
    }

    displayWidth = Math.max(320, Math.floor(canvas.clientWidth || canvas.offsetWidth || 0));
    displayHeight = Math.max(240, Math.floor(canvas.clientHeight || canvas.offsetHeight || 0));

    const devicePixelRatio = window.devicePixelRatio || 1;
    canvas.width = Math.floor(displayWidth * devicePixelRatio);
    canvas.height = Math.floor(displayHeight * devicePixelRatio);

    renderScale = displayWidth < 620 ? 5 : 4;
    simulationWidth = Math.max(80, Math.floor(displayWidth / renderScale));
    simulationHeight = Math.max(60, Math.floor(displayHeight / renderScale));

    bufferCanvas.width = simulationWidth;
    bufferCanvas.height = simulationHeight;
    imageData = bufferContext.createImageData(simulationWidth, simulationHeight);
    resetWorld();
    render();
};

playPauseButton?.addEventListener("click", () => {
    running = !running;
    playPauseButton.textContent = running ? "一時停止" : "再生";
    playPauseButton.classList.toggle("green", running);
    updateReadouts();
});

togglePanelButton?.addEventListener("click", () => {
    setPanelVisibility(true);
});

showPanelButton?.addEventListener("click", () => {
    setPanelVisibility(false);
});

clearButton?.addEventListener("click", () => {
    resetWorld({ announce: true });
});

twoSourcesButton?.addEventListener("click", () => {
    applyTwoSources(true);
});

doubleSlitButton?.addEventListener("click", () => {
    applyDoubleSlit(true);
});

rainButton?.addEventListener("click", () => {
    rainMode = !rainMode;
    rainButton.classList.toggle("active", rainMode);
    updateReadouts();
    setStatus(rainMode ? "雨モードをオンにしました。ランダムな波紋が落ちて、模様がどこまで残るかを観察できます。" : "雨モードをオフにしました。整った干渉縞を見たいときはオフが見やすいです。", false);
});

[waveSpeedSlider, dampingSlider, amplitudeSlider, frequencySlider].forEach((slider) => {
    slider?.addEventListener("input", () => {
        updateReadouts();
    });
});

toolButtons.forEach((button) => {
    button.addEventListener("click", () => {
        setTool(button.dataset.tool);
    });
});

canvas?.addEventListener("pointerdown", (event) => {
    drawing = true;
    applyCanvasTool(event);
});

canvas?.addEventListener("pointermove", (event) => {
    if (!drawing) {
        return;
    }

    if (tool === "drop" || tool === "wall" || tool === "erase" || tool === "stir") {
        applyCanvasTool(event);
    }
});

window.addEventListener("pointerup", () => {
    drawing = false;
});

canvas?.addEventListener("pointerleave", () => {
    drawing = false;
});

window.addEventListener("resize", resizeCanvas);

if (canvas && context && bufferContext) {
    resizeCanvas();
    setPanelVisibility(false);
    setTool(tool);
    setStatus(defaultStatus, true);
    window.clearTimeout(animationTimeout);
    animate();
}
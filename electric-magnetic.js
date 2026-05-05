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

const canvas = document.querySelector("#fieldCanvas");
const context = canvas?.getContext("2d");

const electricModeButton = document.querySelector("#electricMode");
const magnetModeButton = document.querySelector("#magnetMode");
const addPositiveButton = document.querySelector("#addPositive");
const addNegativeButton = document.querySelector("#addNegative");
const sprinkleButton = document.querySelector("#sprinkle");
const clearParticlesButton = document.querySelector("#clearParticles");
const resetButton = document.querySelector("#reset");
const toggleLinesButton = document.querySelector("#toggleLines");
const strengthSlider = document.querySelector("#strength");
const particleSpeedSlider = document.querySelector("#particleSpeed");
const strengthValue = document.querySelector("#strengthValue");
const speedValue = document.querySelector("#speedValue");
const electricButtons = document.querySelector("#electricButtons");
const panelStatus = document.querySelector("#panelStatus");
const modeHint = document.querySelector("#modeHint");
const modeValue = document.querySelector("#modeValue");
const sourceCountValue = document.querySelector("#sourceCountValue");
const particleCountValue = document.querySelector("#particleCountValue");

const settings = {
    softening: 950,
    maxParticles: 900,
    lineStartCount: 22,
    vectorStep: 54,
    lineStep: 7,
    lineSteps: 220
};

let width = 0;
let height = 0;
let mode = "electric";
let sources = [];
let particles = [];
let dragging = null;
let showLines = true;
let statusTimeout = 0;

class Source {
    constructor(x, y, charge, pairId = null) {
        this.x = x;
        this.y = y;
        this.charge = charge;
        this.radius = 18;
        this.pairId = pairId;
    }
}

class Particle {
    constructor(x, y) {
        this.x = x;
        this.y = y;
        this.vx = (Math.random() - 0.5) * 0.8;
        this.vy = (Math.random() - 0.5) * 0.8;
        this.life = 1;
    }

    reset() {
        this.x = Math.random() * width;
        this.y = Math.random() * height;
        this.vx = (Math.random() - 0.5) * 0.8;
        this.vy = (Math.random() - 0.5) * 0.8;
        this.life = 1;
    }

    update() {
        const field = fieldAt(this.x, this.y);
        const speed = Number(particleSpeedSlider.value);

        this.vx += field.x * 0.09 * speed;
        this.vy += field.y * 0.09 * speed;

        const velocity = Math.hypot(this.vx, this.vy);
        const maxVelocity = 4.5 * speed;

        if (velocity > maxVelocity) {
            this.vx = (this.vx / velocity) * maxVelocity;
            this.vy = (this.vy / velocity) * maxVelocity;
        }

        this.x += this.vx;
        this.y += this.vy;
        this.vx *= 0.985;
        this.vy *= 0.985;
        this.life *= 0.999;

        if (
            this.x < -20 ||
            this.x > width + 20 ||
            this.y < -20 ||
            this.y > height + 20 ||
            this.life < 0.2
        ) {
            this.reset();
        }
    }

    draw() {
        context.beginPath();
        context.arc(this.x, this.y, 2.2, 0, Math.PI * 2);
        context.fillStyle = `rgba(134, 239, 172, ${0.25 + this.life * 0.55})`;
        context.fill();
    }
}

const clamp = (value, minimum, maximum) => Math.min(Math.max(value, minimum), maximum);

const setStatus = (message, persist = false) => {
    panelStatus.textContent = message;

    if (statusTimeout) {
        window.clearTimeout(statusTimeout);
        statusTimeout = 0;
    }

    if (!persist) {
        statusTimeout = window.setTimeout(() => {
            panelStatus.textContent = mode === "electric"
                ? "電場モードでは、力線は＋から出て−へ入ります。まずは赤と青の点を動かしてください。"
                : "磁石モードでは、棒磁石の外側の場を N から S へ向かう線として見ています。";
        }, 2600);
    }
};

const updateLabels = () => {
    strengthValue.textContent = Number(strengthSlider.value).toFixed(2);
    speedValue.textContent = Number(particleSpeedSlider.value).toFixed(2);
};

const updateDashboard = () => {
    modeValue.textContent = mode === "electric" ? "電場" : "磁場";
    sourceCountValue.textContent = String(sources.length);
    particleCountValue.textContent = String(particles.length);
};

const updateModeUI = () => {
    electricModeButton.classList.toggle("active", mode === "electric");
    magnetModeButton.classList.toggle("active", mode === "magnet");
    electricButtons.style.display = mode === "electric" ? "grid" : "none";
    toggleLinesButton.textContent = showLines ? "力線 ON" : "力線 OFF";
    toggleLinesButton.classList.toggle("active", showLines);
    modeHint.textContent = mode === "electric"
        ? "操作: 赤/青の点をドラッグ。電場モードでは＋/−電荷を追加でき、力線は＋から−へ入ります。"
        : "操作: N 極か S 極をドラッグすると棒磁石全体が動きます。外側の磁力線の回り込みに注目してください。";
};

const resizeCanvas = () => {
    const dpr = window.devicePixelRatio || 1;
    width = Math.max(canvas.clientWidth, 1);
    height = Math.max(canvas.clientHeight, 1);
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
};

const sprinkleParticles = (count = 220) => {
    for (let index = 0; index < count; index += 1) {
        if (particles.length >= settings.maxParticles) {
            particles.shift();
        }

        particles.push(new Particle(Math.random() * width, Math.random() * height));
    }

    updateDashboard();
};

const resetElectric = () => {
    mode = "electric";
    sources = [
        new Source(width * 0.38, height * 0.5, 1),
        new Source(width * 0.62, height * 0.5, -1)
    ];
    particles = [];
    sprinkleParticles(380);
    updateModeUI();
    updateDashboard();
    setStatus("電場モードに切り替えました。＋と−のあいだで力線がつながる形を見てください。", true);
};

const resetMagnet = () => {
    mode = "magnet";
    sources = [
        new Source(width * 0.42, height * 0.5, 1, "magnet-1"),
        new Source(width * 0.58, height * 0.5, -1, "magnet-1")
    ];
    particles = [];
    sprinkleParticles(420);
    updateModeUI();
    updateDashboard();
    setStatus("磁石モードに切り替えました。棒磁石の外側で磁力線がどう回り込むかを見てください。", true);
};

const addSource = (charge) => {
    sources.push(
        new Source(
            width * (0.25 + Math.random() * 0.5),
            height * (0.25 + Math.random() * 0.5),
            charge
        )
    );

    updateDashboard();
    setStatus(charge > 0 ? "＋電荷を追加しました。" : "−電荷を追加しました。", false);
};

const fieldAt = (x, y) => {
    const strength = Number(strengthSlider.value);
    let fx = 0;
    let fy = 0;

    sources.forEach((source) => {
        const dx = x - source.x;
        const dy = y - source.y;
        const r2 = dx * dx + dy * dy + settings.softening;
        const inverse = 1 / Math.pow(r2, 1.5);

        fx += source.charge * dx * inverse * 65000 * strength;
        fy += source.charge * dy * inverse * 65000 * strength;
    });

    return { x: fx, y: fy };
};

const nearNegativeSource = (x, y) => sources.some(
    (source) => source.charge < 0 && Math.hypot(x - source.x, y - source.y) < 24
);

const drawArrow = (x1, y1, x2, y2, color) => {
    const angle = Math.atan2(y2 - y1, x2 - x1);

    context.strokeStyle = color;
    context.fillStyle = color;
    context.beginPath();
    context.moveTo(x1, y1);
    context.lineTo(x2, y2);
    context.stroke();

    context.beginPath();
    context.moveTo(x2, y2);
    context.lineTo(x2 - Math.cos(angle - 0.55) * 5, y2 - Math.sin(angle - 0.55) * 5);
    context.lineTo(x2 - Math.cos(angle + 0.55) * 5, y2 - Math.sin(angle + 0.55) * 5);
    context.closePath();
    context.fill();
};

const drawBackground = () => {
    context.fillStyle = "rgba(2, 6, 23, 0.22)";
    context.fillRect(0, 0, width, height);
};

const drawVectorField = () => {
    const color = mode === "electric" ? "rgba(125, 211, 252, 0.28)" : "rgba(250, 204, 21, 0.24)";

    context.lineWidth = 1;

    for (let y = 34; y < height; y += settings.vectorStep) {
        for (let x = 34; x < width; x += settings.vectorStep) {
            const field = fieldAt(x, y);
            const magnitude = Math.hypot(field.x, field.y);

            if (magnitude < 0.02) {
                continue;
            }

            const length = Math.min(18, 5 + Math.log(1 + magnitude) * 5);
            const dx = (field.x / magnitude) * length;
            const dy = (field.y / magnitude) * length;
            drawArrow(x, y, x + dx, y + dy, color);
        }
    }
};

const drawFieldLines = () => {
    if (!showLines) {
        return;
    }

    const starts = [];

    sources.forEach((source) => {
        if (source.charge > 0) {
            for (let index = 0; index < settings.lineStartCount; index += 1) {
                const angle = (index / settings.lineStartCount) * Math.PI * 2;
                starts.push({
                    x: source.x + Math.cos(angle) * 24,
                    y: source.y + Math.sin(angle) * 24
                });
            }
        }
    });

    if (starts.length === 0) {
        for (let index = 0; index < 36; index += 1) {
            starts.push({ x: Math.random() * width, y: Math.random() * height });
        }
    }

    context.lineWidth = 1;
    context.strokeStyle = mode === "electric"
        ? "rgba(196, 181, 253, 0.32)"
        : "rgba(250, 204, 21, 0.34)";

    starts.forEach((start) => {
        let x = start.x;
        let y = start.y;

        context.beginPath();
        context.moveTo(x, y);

        for (let step = 0; step < settings.lineSteps; step += 1) {
            const field = fieldAt(x, y);
            const magnitude = Math.hypot(field.x, field.y);

            if (magnitude < 0.0001) {
                break;
            }

            x += (field.x / magnitude) * settings.lineStep;
            y += (field.y / magnitude) * settings.lineStep;
            context.lineTo(x, y);

            if (x < 0 || x > width || y < 0 || y > height || nearNegativeSource(x, y)) {
                break;
            }
        }

        context.stroke();
    });
};

const drawMagnetBody = () => {
    if (mode !== "magnet" || sources.length < 2) {
        return;
    }

    const north = sources[0];
    const south = sources[1];

    context.save();
    context.lineCap = "round";
    context.lineWidth = 26;
    context.strokeStyle = "rgba(148, 163, 184, 0.72)";
    context.beginPath();
    context.moveTo(north.x, north.y);
    context.lineTo(south.x, south.y);
    context.stroke();
    context.restore();
};

const drawSources = () => {
    drawMagnetBody();

    sources.forEach((source) => {
        context.save();
        context.beginPath();
        context.arc(source.x, source.y, source.radius, 0, Math.PI * 2);
        context.fillStyle = source.charge > 0 ? "rgba(251, 113, 133, 0.96)" : "rgba(96, 165, 250, 0.96)";
        context.shadowColor = source.charge > 0 ? "#fb7185" : "#60a5fa";
        context.shadowBlur = 18;
        context.fill();

        context.fillStyle = "white";
        context.font = "bold 18px system-ui";
        context.textAlign = "center";
        context.textBaseline = "middle";
        context.fillText(
            mode === "magnet" ? (source.charge > 0 ? "N" : "S") : (source.charge > 0 ? "+" : "−"),
            source.x,
            source.y + 1
        );
        context.restore();
    });
};

const animate = () => {
    drawBackground();
    drawVectorField();
    drawFieldLines();

    particles.forEach((particle) => {
        particle.update();
        particle.draw();
    });

    drawSources();
    updateDashboard();
    window.requestAnimationFrame(animate);
};

const pointerPosition = (event) => {
    const rect = canvas.getBoundingClientRect();

    return {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top
    };
};

const handlePointerDown = (event) => {
    const point = pointerPosition(event);
    dragging = null;

    for (let index = sources.length - 1; index >= 0; index -= 1) {
        const source = sources[index];

        if (Math.hypot(point.x - source.x, point.y - source.y) < source.radius + 10) {
            dragging = {
                pointerId: event.pointerId,
                source,
                offsetX: point.x - source.x,
                offsetY: point.y - source.y,
                lastX: point.x,
                lastY: point.y
            };
            canvas.setPointerCapture?.(event.pointerId);
            break;
        }
    }
};

const handlePointerMove = (event) => {
    if (!dragging || dragging.pointerId !== event.pointerId) {
        return;
    }

    const point = pointerPosition(event);

    if (mode === "magnet" && dragging.source.pairId) {
        const dx = point.x - dragging.lastX;
        const dy = point.y - dragging.lastY;

        sources.forEach((source) => {
            if (source.pairId === dragging.source.pairId) {
                source.x = clamp(source.x + dx, source.radius, width - source.radius);
                source.y = clamp(source.y + dy, source.radius, height - source.radius);
            }
        });

        dragging.lastX = point.x;
        dragging.lastY = point.y;
        return;
    }

    dragging.source.x = clamp(point.x - dragging.offsetX, dragging.source.radius, width - dragging.source.radius);
    dragging.source.y = clamp(point.y - dragging.offsetY, dragging.source.radius, height - dragging.source.radius);
};

const stopDragging = (event) => {
    if (!dragging) {
        return;
    }

    if (!event || dragging.pointerId === event.pointerId) {
        dragging = null;
    }
};

electricModeButton.addEventListener("click", resetElectric);
magnetModeButton.addEventListener("click", resetMagnet);
addPositiveButton.addEventListener("click", () => addSource(1));
addNegativeButton.addEventListener("click", () => addSource(-1));

sprinkleButton.addEventListener("click", () => {
    sprinkleParticles(260);
    setStatus("粒子を追加しました。流れの向きを追いやすくなります。", false);
});

clearParticlesButton.addEventListener("click", () => {
    particles = [];
    updateDashboard();
    setStatus("粒子をクリアしました。", false);
});

toggleLinesButton.addEventListener("click", () => {
    showLines = !showLines;
    updateModeUI();
    setStatus(showLines ? "力線を表示しました。" : "力線を非表示にしました。", false);
});

resetButton.addEventListener("click", () => {
    if (mode === "electric") {
        resetElectric();
    } else {
        resetMagnet();
    }
});

[strengthSlider, particleSpeedSlider].forEach((slider) => {
    slider.addEventListener("input", updateLabels);
});

canvas.addEventListener("pointerdown", handlePointerDown);
canvas.addEventListener("pointermove", handlePointerMove);
canvas.addEventListener("pointerup", stopDragging);
canvas.addEventListener("pointercancel", stopDragging);

window.addEventListener("resize", () => {
    resizeCanvas();

    if (mode === "electric") {
        resetElectric();
    } else {
        resetMagnet();
    }
});

if (canvas && context) {
    resizeCanvas();
    updateLabels();
    updateModeUI();
    resetElectric();
    animate();
}
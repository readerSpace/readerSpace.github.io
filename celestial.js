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

const canvas = document.querySelector("#spaceCanvas");
const simulationShell = document.querySelector("#playgroundShell");
const context = canvas?.getContext("2d");

if (!canvas || !simulationShell || !context) {
    throw new Error("Celestial simulation failed to initialize.");
}

const playPauseButton = document.querySelector("#playPause");
const clearButton = document.querySelector("#clear");
const stableOrbitButton = document.querySelector("#stableOrbit");
const solarSystemButton = document.querySelector("#solarSystem");
const starMassSlider = document.querySelector("#starMass");
const timeStepSlider = document.querySelector("#timeStep");
const throwPowerSlider = document.querySelector("#throwPower");
const trailLengthSlider = document.querySelector("#trailLength");
const massValue = document.querySelector("#massValue");
const timeValue = document.querySelector("#timeValue");
const throwValue = document.querySelector("#throwValue");
const trailValue = document.querySelector("#trailValue");
const planetCountSpan = document.querySelector("#planetCount");
const starCountSpan = document.querySelector("#starCount");
const modeNameSpan = document.querySelector("#modeName");
const panelStatus = document.querySelector("#panelStatus");
const hintText = document.querySelector("#hintText");
const toolButtons = Array.from(document.querySelectorAll("[data-tool]"));

const G = 0.12;
const softening = 80;

const toolNames = {
    throw: "惑星を投げる",
    star: "太陽を動かす",
    moon: "月つき惑星",
    blackhole: "重い星",
    erase: "消す",
    burst: "大量投入"
};

const toolHints = {
    throw: "操作: ドラッグした長さと方向が初速度になります。できるだけ横向きに投げると周回しやすくなります。",
    star: "操作: 太陽や追加した重い星をつかんで移動できます。重力中心をずらすと、回っている惑星の軌道が崩れます。",
    moon: "操作: 惑星と小さな月をセットで投げます。主星まわりの公転と相対運動が重なって見えます。",
    blackhole: "操作: ドラッグして重い星を追加します。2 つ目の重力源として置くと、軌道が一気に複雑になります。",
    erase: "操作: ドラッグした近くの惑星や追加した重い星を消します。中心の太陽は残したまま整理できます。",
    burst: "操作: クリックした周囲に多数の小天体を一気に入れます。散乱や崩壊の雰囲気を見るモードです。"
};

let width = 0;
let height = 0;
let planets = [];
let stars = [];
let starField = [];
let running = true;
let activeTool = "throw";
let dragging = false;
let dragStart = null;
let dragCurrent = null;
let grabbedStar = null;
let activePointerId = null;
let statusTimeout = 0;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

class Star {
    constructor(x, y, mass, radius, label = "太陽", color = "#facc15") {
        this.x = x;
        this.y = y;
        this.mass = mass;
        this.radius = radius;
        this.label = label;
        this.color = color;
    }

    draw() {
        context.save();
        context.beginPath();
        context.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
        context.fillStyle = this.color;
        context.shadowColor = this.color;
        context.shadowBlur = this.label === "重い星" ? 30 : 24;
        context.fill();

        context.beginPath();
        context.arc(this.x, this.y, this.radius * 2.1, 0, Math.PI * 2);
        context.strokeStyle = this.label === "重い星" ? "rgba(196, 181, 253, 0.18)" : "rgba(250, 204, 21, 0.16)";
        context.lineWidth = 2;
        context.stroke();

        context.fillStyle = "rgba(255, 255, 255, 0.92)";
        context.font = "bold 12px IBM Plex Sans JP";
        context.textAlign = "center";
        context.fillText(this.label, this.x, this.y + this.radius + 18);
        context.restore();
    }
}

class Planet {
    constructor(x, y, vx, vy, radius = 6, color = null, parent = null) {
        this.x = x;
        this.y = y;
        this.vx = vx;
        this.vy = vy;
        this.radius = radius;
        this.color = color || randomPlanetColor();
        this.trail = [];
        this.dead = false;
        this.parent = parent;
    }

    update(dt) {
        let ax = 0;
        let ay = 0;

        for (const star of stars) {
            const dx = star.x - this.x;
            const dy = star.y - this.y;
            const r2 = dx * dx + dy * dy + softening;
            const r = Math.sqrt(r2);
            const force = G * star.mass / r2;

            ax += force * dx / r;
            ay += force * dy / r;

            if (r < star.radius + this.radius * 0.7) {
                this.dead = true;
            }
        }

        for (const other of planets) {
            if (other === this || other.dead) {
                continue;
            }

            const dx = other.x - this.x;
            const dy = other.y - this.y;
            const r2 = dx * dx + dy * dy + 60;
            const r = Math.sqrt(r2);

            if (r < 120) {
                const force = 0.018 * other.radius * other.radius / r2;
                ax += force * dx / r;
                ay += force * dy / r;
            }
        }

        this.vx += ax * dt;
        this.vy += ay * dt;
        this.x += this.vx * dt;
        this.y += this.vy * dt;

        this.trail.push({ x: this.x, y: this.y });

        const maxTrail = Number(trailLengthSlider.value);

        if (this.trail.length > maxTrail) {
            this.trail.shift();
        }

        if (this.x < -500 || this.x > width + 500 || this.y < -500 || this.y > height + 500) {
            this.dead = true;
        }
    }

    drawTrail() {
        if (this.trail.length < 2) {
            return;
        }

        context.save();
        context.beginPath();
        context.moveTo(this.trail[0].x, this.trail[0].y);

        for (let i = 1; i < this.trail.length; i += 1) {
            context.lineTo(this.trail[i].x, this.trail[i].y);
        }

        context.strokeStyle = hexToRgba(this.color, 0.35);
        context.lineWidth = 1.5;
        context.stroke();
        context.restore();
    }

    draw() {
        context.save();
        context.beginPath();
        context.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
        context.fillStyle = this.color;
        context.shadowColor = this.color;
        context.shadowBlur = 12;
        context.fill();

        context.beginPath();
        context.moveTo(this.x, this.y);
        context.lineTo(this.x + this.vx * 9, this.y + this.vy * 9);
        context.strokeStyle = "rgba(255, 255, 255, 0.28)";
        context.lineWidth = 1;
        context.stroke();
        context.restore();
    }
}

function randomPlanetColor() {
    const colors = ["#60a5fa", "#34d399", "#f97316", "#c084fc", "#f472b6", "#22d3ee", "#a3e635"];
    return colors[Math.floor(Math.random() * colors.length)];
}

function hexToRgba(hex, alpha) {
    const normalized = hex.replace("#", "");
    const red = parseInt(normalized.substring(0, 2), 16);
    const green = parseInt(normalized.substring(2, 4), 16);
    const blue = parseInt(normalized.substring(4, 6), 16);
    return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function mainStar() {
    return stars[0];
}

function mainStarRadius(mass) {
    return 18 + Math.min(15, Math.sqrt(mass) / 7.5);
}

function resetPrimaryStar() {
    stars = [new Star(width * 0.5, height * 0.54, Number(starMassSlider.value), mainStarRadius(Number(starMassSlider.value)), "太陽", "#facc15")];
}

function makeStarField() {
    starField = [];

    for (let i = 0; i < 240; i += 1) {
        starField.push({
            x: Math.random() * width,
            y: Math.random() * height,
            r: Math.random() * 1.4 + 0.2,
            a: Math.random() * 0.7 + 0.15
        });
    }
}

function setStatus(message, resetToToolHint = false) {
    if (!panelStatus) {
        return;
    }

    panelStatus.textContent = message;
    window.clearTimeout(statusTimeout);

    if (resetToToolHint) {
        statusTimeout = window.setTimeout(() => {
            panelStatus.textContent = toolHints[activeTool];
        }, 2800);
    }
}

function updateToolUi() {
    toolButtons.forEach((button) => {
        button.classList.toggle("is-active", button.dataset.tool === activeTool);
    });

    if (modeNameSpan) {
        modeNameSpan.textContent = toolNames[activeTool];
    }

    if (hintText) {
        hintText.textContent = toolHints[activeTool];
    }
}

function updateLabels() {
    const sun = mainStar();

    if (sun) {
        sun.mass = Number(starMassSlider.value);
        sun.radius = mainStarRadius(sun.mass);
    }

    massValue.textContent = starMassSlider.value;
    timeValue.textContent = Number(timeStepSlider.value).toFixed(2);
    throwValue.textContent = Number(throwPowerSlider.value).toFixed(2);
    trailValue.textContent = trailLengthSlider.value;
    planetCountSpan.textContent = `${planets.length}`;
    starCountSpan.textContent = `${stars.length}`;

    updateToolUi();
}

function pointerPosition(event) {
    const rect = canvas.getBoundingClientRect();
    return {
        x: clamp(event.clientX - rect.left, 0, rect.width - 1),
        y: clamp(event.clientY - rect.top, 0, rect.height - 1)
    };
}

function addThrownPlanet(start, end) {
    const power = Number(throwPowerSlider.value);
    const vx = (end.x - start.x) * power;
    const vy = (end.y - start.y) * power;

    if (activeTool === "blackhole") {
        stars.push(new Star(start.x, start.y, 4200, 15, "重い星", "#c4b5fd"));
        return;
    }

    if (activeTool === "moon") {
        const planet = new Planet(start.x, start.y, vx, vy, 8, "#60a5fa");
        planets.push(planet);

        const moonDistance = 28;
        const moonSpeed = 1.65;
        planets.push(new Planet(start.x + moonDistance, start.y, vx, vy + moonSpeed, 3.5, "#e5e7eb", planet));
        return;
    }

    planets.push(new Planet(start.x, start.y, vx, vy, 5 + Math.random() * 3));
}

function addStableOrbit() {
    const sun = mainStar();

    if (!sun) {
        return;
    }

    const radius = Math.min(width, height) * (0.18 + Math.random() * 0.22);
    const angle = Math.random() * Math.PI * 2;
    const x = sun.x + Math.cos(angle) * radius;
    const y = sun.y + Math.sin(angle) * radius;
    const speed = Math.sqrt(G * sun.mass / radius);
    const vx = -Math.sin(angle) * speed;
    const vy = Math.cos(angle) * speed;

    planets.push(new Planet(x, y, vx, vy, 5 + Math.random() * 3));
}

function makeSolarSystem() {
    planets = [];
    resetPrimaryStar();

    const sun = mainStar();
    const distances = [90, 140, 200, 270, 350];
    const sizes = [4, 5, 6.5, 5, 9];
    const colors = ["#f97316", "#60a5fa", "#34d399", "#f472b6", "#c084fc"];

    for (let i = 0; i < distances.length; i += 1) {
        const radius = distances[i];
        const angle = Math.random() * Math.PI * 2;
        const speed = Math.sqrt(G * sun.mass / radius);
        planets.push(
            new Planet(
                sun.x + Math.cos(angle) * radius,
                sun.y + Math.sin(angle) * radius,
                -Math.sin(angle) * speed,
                Math.cos(angle) * speed,
                sizes[i],
                colors[i]
            )
        );
    }
}

function addBurst(center) {
    const sun = mainStar();

    if (!sun) {
        return;
    }

    for (let i = 0; i < 36; i += 1) {
        const angle = Math.random() * Math.PI * 2;
        const radius = 30 + Math.random() * 70;
        const x = center.x + Math.cos(angle) * radius;
        const y = center.y + Math.sin(angle) * radius;
        const dx = x - sun.x;
        const dy = y - sun.y;
        const distance = Math.max(40, Math.hypot(dx, dy));
        const orbital = Math.sqrt(G * sun.mass / distance);
        const sign = Math.random() < 0.5 ? 1 : -1;
        const vx = -dy / distance * orbital * sign + (Math.random() - 0.5) * 1.2;
        const vy = dx / distance * orbital * sign + (Math.random() - 0.5) * 1.2;

        planets.push(new Planet(x, y, vx, vy, 2.5 + Math.random() * 2.5));
    }
}

function eraseAt(point) {
    planets = planets.filter((planet) => Math.hypot(planet.x - point.x, planet.y - point.y) > 24);
    stars = stars.filter((star, index) => index === 0 || Math.hypot(star.x - point.x, star.y - point.y) > star.radius + 14);
}

function drawBackground() {
    context.fillStyle = "rgba(2, 6, 23, 0.38)";
    context.fillRect(0, 0, width, height);

    for (const star of starField) {
        context.beginPath();
        context.arc(star.x, star.y, star.r, 0, Math.PI * 2);
        context.fillStyle = `rgba(255, 255, 255, ${star.a})`;
        context.fill();
    }

    const sun = mainStar();

    if (sun) {
        const halo = context.createRadialGradient(sun.x, sun.y, sun.radius * 0.6, sun.x, sun.y, sun.radius * 6);
        halo.addColorStop(0, "rgba(250, 204, 21, 0.20)");
        halo.addColorStop(1, "rgba(250, 204, 21, 0)");
        context.fillStyle = halo;
        context.beginPath();
        context.arc(sun.x, sun.y, sun.radius * 6, 0, Math.PI * 2);
        context.fill();
    }
}

function drawDragPreview() {
    if (!dragging || !dragStart || !dragCurrent || ["star", "erase", "burst"].includes(activeTool)) {
        return;
    }

    context.save();
    context.beginPath();
    context.arc(dragStart.x, dragStart.y, activeTool === "blackhole" ? 12 : 7, 0, Math.PI * 2);
    context.fillStyle = activeTool === "blackhole" ? "#c4b5fd" : "#60a5fa";
    context.shadowColor = activeTool === "blackhole" ? "#e9d5ff" : "#60a5fa";
    context.shadowBlur = 16;
    context.fill();

    context.beginPath();
    context.moveTo(dragStart.x, dragStart.y);
    context.lineTo(dragCurrent.x, dragCurrent.y);
    context.strokeStyle = "rgba(255, 255, 255, 0.75)";
    context.lineWidth = 2;
    context.stroke();

    const angle = Math.atan2(dragCurrent.y - dragStart.y, dragCurrent.x - dragStart.x);
    context.beginPath();
    context.moveTo(dragCurrent.x, dragCurrent.y);
    context.lineTo(dragCurrent.x - Math.cos(angle - 0.5) * 12, dragCurrent.y - Math.sin(angle - 0.5) * 12);
    context.lineTo(dragCurrent.x - Math.cos(angle + 0.5) * 12, dragCurrent.y - Math.sin(angle + 0.5) * 12);
    context.closePath();
    context.fillStyle = "rgba(255, 255, 255, 0.75)";
    context.fill();
    context.restore();
}

function animate() {
    drawBackground();

    if (running) {
        const dt = Number(timeStepSlider.value);
        const subSteps = 2;

        for (let step = 0; step < subSteps; step += 1) {
            planets.forEach((planet) => planet.update(dt / subSteps));
            planets = planets.filter((planet) => !planet.dead);
        }
    }

    planets.forEach((planet) => planet.drawTrail());
    stars.forEach((star) => star.draw());
    planets.forEach((planet) => planet.draw());
    drawDragPreview();
    updateLabels();

    window.requestAnimationFrame(animate);
}

function resizeCanvas() {
    const rect = simulationShell.getBoundingClientRect();

    if (!rect.width || !rect.height) {
        return;
    }

    width = Math.max(320, Math.floor(rect.width));
    height = Math.max(420, Math.floor(rect.height));

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);

    if (!stars.length) {
        resetPrimaryStar();
    }

    makeStarField();
}

function stopDragging() {
    dragging = false;
    dragStart = null;
    dragCurrent = null;
    grabbedStar = null;

    if (activePointerId !== null && canvas.hasPointerCapture(activePointerId)) {
        canvas.releasePointerCapture(activePointerId);
    }

    activePointerId = null;
}

toolButtons.forEach((button) => {
    button.addEventListener("click", () => {
        activeTool = button.dataset.tool;
        updateToolUi();
        setStatus(toolHints[activeTool]);
    });
});

playPauseButton?.addEventListener("click", () => {
    running = !running;
    playPauseButton.textContent = running ? "一時停止" : "再生";
    playPauseButton.classList.toggle("is-paused", !running);
    setStatus(running ? "再生を再開しました。時間の速さを上げると周回も崩壊も速く観察できます。" : "一時停止中です。今の軌道の形と速度ベクトルを見比べてください。", true);
});

clearButton?.addEventListener("click", () => {
    planets = [];
    setStatus("惑星だけを消しました。追加した重い星は残るので、場を変えたまま投げ直せます。", true);
});

stableOrbitButton?.addEventListener("click", () => {
    addStableOrbit();
    setStatus("円軌道に近い初速度で 1 個追加しました。そこから自分の投げ方と比べてください。", true);
});

solarSystemButton?.addEventListener("click", () => {
    makeSolarSystem();
    setStatus("惑星セットを作りました。太陽質量や時間の速さを変えて、系全体の見え方を比べてください。", true);
});

[starMassSlider, timeStepSlider, throwPowerSlider, trailLengthSlider].forEach((element) => {
    element?.addEventListener("input", updateLabels);
});

canvas.addEventListener("pointerdown", (event) => {
    const point = pointerPosition(event);

    if (activeTool === "burst") {
        addBurst(point);
        setStatus("小天体を大量投入しました。軌道の束や散乱の雰囲気を見てください。", true);
        return;
    }

    dragging = true;
    activePointerId = event.pointerId;
    canvas.setPointerCapture(activePointerId);
    dragStart = point;
    dragCurrent = point;

    if (activeTool === "star") {
        grabbedStar = stars.find((star) => Math.hypot(star.x - point.x, star.y - point.y) < star.radius + 20) || null;
    } else if (activeTool === "erase") {
        eraseAt(point);
    }
});

canvas.addEventListener("pointermove", (event) => {
    if (!dragging) {
        return;
    }

    const point = pointerPosition(event);
    dragCurrent = point;

    if (activeTool === "star" && grabbedStar) {
        grabbedStar.x = point.x;
        grabbedStar.y = point.y;
    } else if (activeTool === "erase") {
        eraseAt(point);
    }
});

canvas.addEventListener("pointerup", () => {
    if (dragging && dragStart && dragCurrent && ["throw", "moon", "blackhole"].includes(activeTool)) {
        if (Math.hypot(dragCurrent.x - dragStart.x, dragCurrent.y - dragStart.y) > 8) {
            addThrownPlanet(dragStart, dragCurrent);
        }
    }

    stopDragging();
});

canvas.addEventListener("pointercancel", stopDragging);
window.addEventListener("pointerup", stopDragging);
window.addEventListener("resize", resizeCanvas);

updateToolUi();
resizeCanvas();
resetPrimaryStar();
makeSolarSystem();
setStatus(toolHints[activeTool]);
animate();
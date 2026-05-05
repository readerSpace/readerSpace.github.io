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

const canvas = document.querySelector("#boidsCanvas");
const context = canvas?.getContext("2d");

const cohesionSlider = document.querySelector("#cohesion");
const separationSlider = document.querySelector("#separation");
const alignmentSlider = document.querySelector("#alignment");
const predatorForceSlider = document.querySelector("#predatorForce");

const cohesionValue = document.querySelector("#cohesionValue");
const separationValue = document.querySelector("#separationValue");
const alignmentValue = document.querySelector("#alignmentValue");
const predatorValue = document.querySelector("#predatorValue");

const togglePredatorButton = document.querySelector("#togglePredator");
const toggleOddButton = document.querySelector("#toggleOdd");
const presetCalmButton = document.querySelector("#presetCalm");
const presetChaosButton = document.querySelector("#presetChaos");
const clearObstaclesButton = document.querySelector("#clearObstacles");
const saveShotButton = document.querySelector("#saveShot");
const resetButton = document.querySelector("#reset");

const panelStatus = document.querySelector("#panelStatus");
const obstacleCountValue = document.querySelector("#obstacleCountValue");
const moodValue = document.querySelector("#moodValue");
const boidCountValue = document.querySelector("#boidCountValue");

const settings = {
    boidCount: 96,
    perceptionRadius: 74,
    separationRadius: 30,
    maxSpeed: 3.1,
    maxForce: 0.066,
    obstacleAvoidanceForce: 2.2,
    predatorRadius: 160,
    obstacleRadius: 30,
    trailFade: 0.24
};

const presets = {
    calm: {
        cohesion: 0.62,
        separation: 1.20,
        alignment: 0.92,
        predatorForce: 2.20
    },
    default: {
        cohesion: 0.55,
        separation: 1.35,
        alignment: 0.85,
        predatorForce: 2.60
    },
    chaos: {
        cohesion: 0.18,
        separation: 2.85,
        alignment: 0.14,
        predatorForce: 4.40
    }
};

const predator = {
    x: 0,
    y: 0,
    vx: 2.2,
    vy: 1.5
};

let width = 0;
let height = 0;
let boids = [];
let obstacles = [];
let predatorEnabled = true;
let oddBoidEnabled = true;
let pointerDown = false;
let pointerMoved = false;
let activePointerId = null;
let statusTimeout = 0;

class Vector {
    constructor(x = 0, y = 0) {
        this.x = x;
        this.y = y;
    }

    add(vector) {
        this.x += vector.x;
        this.y += vector.y;
        return this;
    }

    sub(vector) {
        this.x -= vector.x;
        this.y -= vector.y;
        return this;
    }

    mult(value) {
        this.x *= value;
        this.y *= value;
        return this;
    }

    div(value) {
        if (value !== 0) {
            this.x /= value;
            this.y /= value;
        }

        return this;
    }

    mag() {
        return Math.hypot(this.x, this.y);
    }

    normalize() {
        const magnitude = this.mag();

        if (magnitude > 0) {
            this.div(magnitude);
        }

        return this;
    }

    limit(maximum) {
        const magnitude = this.mag();

        if (magnitude > maximum) {
            this.normalize().mult(maximum);
        }

        return this;
    }

    static sub(left, right) {
        return new Vector(left.x - right.x, left.y - right.y);
    }

    static random2D() {
        const angle = Math.random() * Math.PI * 2;
        return new Vector(Math.cos(angle), Math.sin(angle));
    }
}

class Boid {
    constructor(x, y, isOdd = false) {
        this.position = new Vector(x, y);
        this.velocity = Vector.random2D().mult(1.5 + Math.random() * 1.4);
        this.acceleration = new Vector();
        this.isOdd = isOdd;
        this.size = isOdd ? 8 : 6;
    }

    wrapAround() {
        if (this.position.x > width + 20) {
            this.position.x = -20;
        }

        if (this.position.x < -20) {
            this.position.x = width + 20;
        }

        if (this.position.y > height + 20) {
            this.position.y = -20;
        }

        if (this.position.y < -20) {
            this.position.y = height + 20;
        }
    }

    applyForce(force) {
        this.acceleration.add(force);
    }

    flock(flockmates) {
        const alignment = new Vector();
        const cohesion = new Vector();
        const separation = new Vector();
        let total = 0;
        let closeTotal = 0;

        const perception = this.isOdd ? settings.perceptionRadius * 1.9 : settings.perceptionRadius;
        const separationRadius = this.isOdd ? settings.separationRadius * 0.6 : settings.separationRadius;

        flockmates.forEach((other) => {
            if (other === this) {
                return;
            }

            const dx = this.position.x - other.position.x;
            const dy = this.position.y - other.position.y;
            const distance = Math.hypot(dx, dy);

            if (distance < perception) {
                alignment.add(other.velocity);
                cohesion.add(other.position);
                total += 1;
            }

            if (distance < separationRadius && distance > 0) {
                const diff = new Vector(dx, dy);
                diff.div(distance * distance);
                separation.add(diff);
                closeTotal += 1;
            }
        });

        if (total > 0) {
            alignment.div(total);
            alignment.normalize().mult(settings.maxSpeed);
            alignment.sub(this.velocity);
            alignment.limit(settings.maxForce);

            cohesion.div(total);
            cohesion.sub(this.position);
            cohesion.normalize().mult(settings.maxSpeed);
            cohesion.sub(this.velocity);
            cohesion.limit(settings.maxForce);
        }

        if (closeTotal > 0) {
            separation.div(closeTotal);
            separation.normalize().mult(settings.maxSpeed);
            separation.sub(this.velocity);
            separation.limit(settings.maxForce * 1.8);
        }

        if (this.isOdd && oddBoidEnabled) {
            alignment.mult(-0.9);
            cohesion.mult(-0.4);
            separation.mult(1.4);
        }

        alignment.mult(Number(alignmentSlider.value));
        cohesion.mult(Number(cohesionSlider.value));
        separation.mult(Number(separationSlider.value));

        this.applyForce(alignment);
        this.applyForce(cohesion);
        this.applyForce(separation);
    }

    avoidPredator() {
        if (!predatorEnabled) {
            return;
        }

        const away = Vector.sub(this.position, predator);
        const distance = away.mag();

        if (distance < settings.predatorRadius && distance > 0) {
            away.normalize().mult(settings.maxSpeed * 1.85);
            away.sub(this.velocity);
            away.limit(settings.maxForce * Number(predatorForceSlider.value));
            this.applyForce(away);
        }
    }

    avoidObstacles() {
        obstacles.forEach((obstacle) => {
            const away = Vector.sub(this.position, obstacle);
            const distance = away.mag();
            const avoidRadius = obstacle.r + 52;

            if (distance < avoidRadius && distance > 0) {
                away.normalize().mult(settings.maxSpeed * 1.45);
                away.sub(this.velocity);
                away.limit(settings.maxForce * settings.obstacleAvoidanceForce);
                this.applyForce(away);
            }
        });
    }

    update() {
        const maxSpeed = this.isOdd && oddBoidEnabled ? settings.maxSpeed * 1.38 : settings.maxSpeed;

        this.velocity.add(this.acceleration);
        this.velocity.limit(maxSpeed);
        this.position.add(this.velocity);
        this.acceleration.mult(0);
    }

    draw() {
        const angle = Math.atan2(this.velocity.y, this.velocity.x);

        context.save();
        context.translate(this.position.x, this.position.y);
        context.rotate(angle);

        context.beginPath();
        context.moveTo(this.size * 1.85, 0);
        context.lineTo(-this.size, this.size * 0.88);
        context.lineTo(-this.size * 0.4, 0);
        context.lineTo(-this.size, -this.size * 0.88);
        context.closePath();

        if (this.isOdd && oddBoidEnabled) {
            context.fillStyle = "#facc15";
            context.shadowColor = "rgba(250, 204, 21, 0.9)";
            context.shadowBlur = 16;
        } else {
            context.fillStyle = "rgba(147, 197, 253, 0.96)";
            context.shadowColor = "rgba(96, 165, 250, 0.84)";
            context.shadowBlur = 10;
        }

        context.fill();
        context.restore();
    }
}

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
            panelStatus.textContent = "まずは「崩壊モード」を押すと、群れがほどける瞬間が見えます。";
        }, 2600);
    }
};

const updateLabels = () => {
    cohesionValue.textContent = Number(cohesionSlider.value).toFixed(2);
    separationValue.textContent = Number(separationSlider.value).toFixed(2);
    alignmentValue.textContent = Number(alignmentSlider.value).toFixed(2);
    predatorValue.textContent = Number(predatorForceSlider.value).toFixed(2);
};

const describeMood = () => {
    const cohesion = Number(cohesionSlider.value);
    const separation = Number(separationSlider.value);
    const alignment = Number(alignmentSlider.value);
    const predatorForce = Number(predatorForceSlider.value);

    if (predatorEnabled && predatorForce > 3.5) {
        return "逃走中";
    }

    if (separation > 2.4 || alignment < 0.2) {
        return "崩壊気味";
    }

    if (oddBoidEnabled && separation > 1.7) {
        return "ざわつく";
    }

    if (cohesion > 0.45 && alignment > 0.75) {
        return "整列中";
    }

    return "ばらつき中";
};

const updateDashboard = () => {
    boidCountValue.textContent = String(settings.boidCount);
    obstacleCountValue.textContent = String(obstacles.length);
    moodValue.textContent = describeMood();
};

const updateToggleButtons = () => {
    togglePredatorButton.textContent = predatorEnabled ? "天敵 ON" : "天敵 OFF";
    togglePredatorButton.setAttribute("aria-pressed", String(predatorEnabled));
    toggleOddButton.textContent = oddBoidEnabled ? "変な 1 匹 ON" : "変な 1 匹 OFF";
    toggleOddButton.setAttribute("aria-pressed", String(oddBoidEnabled));
};

const applyPreset = (presetName) => {
    const preset = presets[presetName];

    cohesionSlider.value = String(preset.cohesion);
    separationSlider.value = String(preset.separation);
    alignmentSlider.value = String(preset.alignment);
    predatorForceSlider.value = String(preset.predatorForce);
    updateLabels();
    updateDashboard();

    if (presetName === "chaos") {
        setStatus("崩壊モードに切り替えました。離れる力が強く、向きがそろいにくい設定です。", true);
        return;
    }

    if (presetName === "calm") {
        setStatus("整列モードに切り替えました。群れがまとまりやすい設定です。", true);
        return;
    }

    setStatus("標準設定に戻しました。", true);
};

const resizeCanvas = () => {
    const dpr = window.devicePixelRatio || 1;
    width = Math.max(canvas.clientWidth, 1);
    height = Math.max(canvas.clientHeight, 1);
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    context.setTransform(dpr, 0, 0, dpr, 0, 0);

    if (predator.x === 0 && predator.y === 0) {
        predator.x = width * 0.55;
        predator.y = height * 0.48;
    }
};

const resetBoids = () => {
    boids = [];

    for (let index = 0; index < settings.boidCount; index += 1) {
        boids.push(new Boid(Math.random() * width, Math.random() * height, index === 0));
    }

    context.clearRect(0, 0, width, height);
    updateDashboard();
};

const drawBackgroundTrails = () => {
    context.fillStyle = `rgba(5, 9, 18, ${settings.trailFade})`;
    context.fillRect(0, 0, width, height);
};

const drawPredator = () => {
    if (!predatorEnabled) {
        return;
    }

    context.save();
    context.translate(predator.x, predator.y);

    context.beginPath();
    context.arc(0, 0, 18, 0, Math.PI * 2);
    context.fillStyle = "rgba(248, 113, 113, 0.96)";
    context.shadowColor = "rgba(248, 113, 113, 0.9)";
    context.shadowBlur = 20;
    context.fill();

    context.beginPath();
    context.arc(0, 0, settings.predatorRadius, 0, Math.PI * 2);
    context.strokeStyle = "rgba(248, 113, 113, 0.12)";
    context.lineWidth = 2;
    context.stroke();
    context.restore();
};

const updatePredator = () => {
    if (!predatorEnabled || pointerDown) {
        return;
    }

    predator.x += predator.vx;
    predator.y += predator.vy;

    if (predator.x < 30 || predator.x > width - 30) {
        predator.vx *= -1;
    }

    if (predator.y < 30 || predator.y > height - 30) {
        predator.vy *= -1;
    }
};

const drawObstacles = () => {
    obstacles.forEach((obstacle) => {
        context.save();

        context.beginPath();
        context.arc(obstacle.x, obstacle.y, obstacle.r, 0, Math.PI * 2);
        context.fillStyle = "rgba(148, 163, 184, 0.92)";
        context.shadowColor = "rgba(226, 232, 240, 0.62)";
        context.shadowBlur = 10;
        context.fill();

        context.beginPath();
        context.arc(obstacle.x, obstacle.y, obstacle.r + 52, 0, Math.PI * 2);
        context.strokeStyle = "rgba(203, 213, 225, 0.08)";
        context.lineWidth = 2;
        context.stroke();
        context.restore();
    });
};

const animate = () => {
    drawBackgroundTrails();
    updatePredator();
    drawObstacles();
    drawPredator();

    boids.forEach((boid) => {
        boid.wrapAround();
        boid.flock(boids);
        boid.avoidPredator();
        boid.avoidObstacles();
        boid.update();
        boid.draw();
    });

    updateDashboard();
    window.requestAnimationFrame(animate);
};

const getPointerPosition = (event) => {
    const rect = canvas.getBoundingClientRect();

    return {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top
    };
};

const handlePointerDown = (event) => {
    activePointerId = event.pointerId;
    pointerDown = true;
    pointerMoved = false;
    canvas.setPointerCapture?.(event.pointerId);

    const point = getPointerPosition(event);
    predator.x = point.x;
    predator.y = point.y;
};

const handlePointerMove = (event) => {
    if (!pointerDown || activePointerId !== event.pointerId) {
        return;
    }

    const point = getPointerPosition(event);

    if (Math.hypot(predator.x - point.x, predator.y - point.y) > 3) {
        pointerMoved = true;
    }

    predator.x = point.x;
    predator.y = point.y;
};

const finishPointerInteraction = (event) => {
    if (!pointerDown || activePointerId !== event.pointerId) {
        return;
    }

    const point = getPointerPosition(event);

    if (!pointerMoved) {
        obstacles.push({ x: point.x, y: point.y, r: settings.obstacleRadius });
        setStatus("障害物を追加しました。群れの流れが曲がる様子を見てください。", false);
    }

    pointerDown = false;
    activePointerId = null;
    updateDashboard();
};

const cancelPointerInteraction = () => {
    pointerDown = false;
    activePointerId = null;
};

const saveScreenshot = () => {
    const link = document.createElement("a");
    link.href = canvas.toDataURL("image/png");
    link.download = `boids-${Date.now()}.png`;
    link.click();
    setStatus("現在の状態を PNG として保存しました。", false);
};

togglePredatorButton.addEventListener("click", () => {
    predatorEnabled = !predatorEnabled;
    updateToggleButtons();
    updateDashboard();
    setStatus(predatorEnabled ? "天敵を有効にしました。赤い円の周囲で群れが裂けます。" : "天敵を無効にしました。群れの自律的なまとまりだけを見られます。", false);
});

toggleOddButton.addEventListener("click", () => {
    oddBoidEnabled = !oddBoidEnabled;
    updateToggleButtons();
    updateDashboard();
    setStatus(oddBoidEnabled ? "変な 1 匹を有効にしました。小さな異常が全体へどう広がるか見てください。" : "変な 1 匹を無効にしました。全員が同じルールで動きます。", false);
});

presetCalmButton.addEventListener("click", () => {
    applyPreset("calm");
});

presetChaosButton.addEventListener("click", () => {
    applyPreset("chaos");
});

clearObstaclesButton.addEventListener("click", () => {
    obstacles = [];
    updateDashboard();
    setStatus("障害物をすべて消しました。", false);
});

saveShotButton.addEventListener("click", saveScreenshot);

resetButton.addEventListener("click", () => {
    obstacles = [];
    applyPreset("default");
    resetBoids();
    predator.x = width * 0.55;
    predator.y = height * 0.48;
    setStatus("初期状態に戻しました。", false);
});

[cohesionSlider, separationSlider, alignmentSlider, predatorForceSlider].forEach((slider) => {
    slider.addEventListener("input", () => {
        updateLabels();
        updateDashboard();
    });
});

canvas.addEventListener("pointerdown", handlePointerDown);
canvas.addEventListener("pointermove", handlePointerMove);
canvas.addEventListener("pointerup", finishPointerInteraction);
canvas.addEventListener("pointercancel", cancelPointerInteraction);

window.addEventListener("resize", () => {
    resizeCanvas();
    resetBoids();
});

if (canvas && context) {
    resizeCanvas();
    applyPreset("default");
    updateLabels();
    updateToggleButtons();
    resetBoids();
    animate();
}
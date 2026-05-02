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

const physics = {
    g: 9.8,
    L1: 1,
    L2: 1,
    m1: 1,
    m2: 1
};

const normalizeAngle = (angle) => Math.atan2(Math.sin(angle), Math.cos(angle));

const derivatives = (state) => {
    const [theta1, omega1, theta2, omega2] = state;
    const { g, L1, L2, m1, m2 } = physics;
    const delta = theta2 - theta1;

    const den1 = (m1 + m2) * L1 - m2 * L1 * Math.cos(delta) * Math.cos(delta);
    const den2 = (L2 / L1) * den1;

    const domega1 = (
        m2 * L1 * omega1 * omega1 * Math.sin(delta) * Math.cos(delta)
        + m2 * g * Math.sin(theta2) * Math.cos(delta)
        + m2 * L2 * omega2 * omega2 * Math.sin(delta)
        - (m1 + m2) * g * Math.sin(theta1)
    ) / den1;

    const domega2 = (
        -m2 * L2 * omega2 * omega2 * Math.sin(delta) * Math.cos(delta)
        + (m1 + m2) * g * Math.sin(theta1) * Math.cos(delta)
        - (m1 + m2) * L1 * omega1 * omega1 * Math.sin(delta)
        - (m1 + m2) * g * Math.sin(theta2)
    ) / den2;

    return [omega1, domega1, omega2, domega2];
};

const rk4Step = (state, dt) => {
    const k1 = derivatives(state);
    const k2 = derivatives(state.map((value, index) => value + 0.5 * dt * k1[index]));
    const k3 = derivatives(state.map((value, index) => value + 0.5 * dt * k2[index]));
    const k4 = derivatives(state.map((value, index) => value + dt * k3[index]));

    return state.map((value, index) => (
        value + (dt / 6) * (k1[index] + 2 * k2[index] + 2 * k3[index] + k4[index])
    ));
};

const stateDistance = (left, right) => {
    let sum = 0;

    for (let index = 0; index < left.length; index += 1) {
        let delta = right[index] - left[index];

        if (index === 0 || index === 2) {
            delta = normalizeAngle(delta);
        }

        sum += delta * delta;
    }

    return Math.sqrt(sum);
};

const geometryForCanvas = (canvas) => ({
    width: canvas.width,
    height: canvas.height,
    originX: canvas.width / 2,
    originY: canvas.height * 0.24,
    scale: Math.min(canvas.width, canvas.height) * 0.27
});

const positionForState = (state, geometry) => {
    const [theta1, , theta2] = state;
    const x1 = geometry.originX + geometry.scale * physics.L1 * Math.sin(theta1);
    const y1 = geometry.originY + geometry.scale * physics.L1 * Math.cos(theta1);
    const x2 = x1 + geometry.scale * physics.L2 * Math.sin(theta2);
    const y2 = y1 + geometry.scale * physics.L2 * Math.cos(theta2);

    return { x1, y1, x2, y2 };
};

const drawPendulum = (context, geometry, state, color, opacity = 1) => {
    const { x1, y1, x2, y2 } = positionForState(state, geometry);

    context.save();
    context.globalAlpha = opacity;
    context.strokeStyle = color;
    context.lineWidth = 3;
    context.lineCap = "round";

    context.beginPath();
    context.moveTo(geometry.originX, geometry.originY);
    context.lineTo(x1, y1);
    context.lineTo(x2, y2);
    context.stroke();

    context.fillStyle = color;

    context.beginPath();
    context.arc(x1, y1, 10, 0, Math.PI * 2);
    context.fill();

    context.beginPath();
    context.arc(x2, y2, 12, 0, Math.PI * 2);
    context.fill();

    context.restore();
};

const drawPivot = (context, geometry) => {
    context.fillStyle = "#ffffff";
    context.beginPath();
    context.arc(geometry.originX, geometry.originY, 5, 0, Math.PI * 2);
    context.fill();
};

const drawTrail = (context, trail) => {
    if (trail.length < 2) {
        return;
    }

    context.strokeStyle = "rgba(120, 214, 255, 0.72)";
    context.lineWidth = 1.6;
    context.beginPath();

    trail.forEach((point, index) => {
        if (index === 0) {
            context.moveTo(point.x, point.y);
        } else {
            context.lineTo(point.x, point.y);
        }
    });

    context.stroke();
};

const drawCanvasBackdrop = (context, canvas) => {
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "rgba(9, 12, 22, 0.98)";
    context.fillRect(0, 0, canvas.width, canvas.height);

    context.strokeStyle = "rgba(255, 255, 255, 0.06)";
    context.lineWidth = 1;

    for (let x = 40; x < canvas.width; x += 40) {
        context.beginPath();
        context.moveTo(x, 0);
        context.lineTo(x, canvas.height);
        context.stroke();
    }

    for (let y = 40; y < canvas.height; y += 40) {
        context.beginPath();
        context.moveTo(0, y);
        context.lineTo(canvas.width, y);
        context.stroke();
    }
};

const mainCanvas = document.querySelector("#doublePendulumCanvas");
const mainContext = mainCanvas?.getContext("2d");
const initialOffsetInput = document.querySelector("#initialOffset");
const initialOffsetValue = document.querySelector("#initialOffsetValue");
const toggleMainButton = document.querySelector("#toggleMainButton");
const resetMainButton = document.querySelector("#resetMainButton");
const lambdaEstimateValue = document.querySelector("#lambdaEstimateValue");
const stretchValue = document.querySelector("#stretchValue");
const motionValue = document.querySelector("#motionValue");
const forecastValue = document.querySelector("#forecastValue");
const mainNote = document.querySelector("#mainNote");

const mainDelta0 = 1e-8;
const mainDt = 0.01;

let mainState = [];
let shadowState = [];
let mainTrail = [];
let mainTime = 0;
let lyapunovSum = 0;
let mainRunning = true;

const currentOffset = () => Number(initialOffsetInput?.value || 12) / 100;

const describeMainMotion = (state) => {
    const [, omega1, , omega2] = state;
    const maxOmega = Math.max(Math.abs(omega1), Math.abs(omega2));
    const maxAngle = Math.max(Math.abs(normalizeAngle(state[0])), Math.abs(normalizeAngle(state[2])));

    if (maxOmega < 1.4) {
        return "比較的おだやか";
    }

    if (maxOmega > 5.5 || maxAngle > Math.PI * 0.85) {
        return "回転や急変が混ざる";
    }

    return "複雑に揺れる";
};

const describeForecast = (lambda, time) => {
    if (time < 2) {
        return "計測中";
    }

    if (lambda <= 0.0001) {
        return "長め";
    }

    const horizon = Math.log(1e6) / lambda;

    if (!Number.isFinite(horizon)) {
        return "かなり長い";
    }

    return `約 ${horizon.toFixed(1)} s`;
};

const describeMainNote = (lambda, time) => {
    if (time < 2) {
        return "最初の数秒は推定が揺れます。時間がたつほど、差が広がる傾向が見えてきます。";
    }

    if (lambda > 0.8) {
        return "Lyapunov 指数がかなり正なので、近い初期条件でも短時間で別の運動へずれやすい状態です。";
    }

    if (lambda > 0.2) {
        return "差は着実に広がっています。法則はあるのに長期予測が難しいという、二重振り子らしい挙動です。";
    }

    return "今は比較的まとまって見えても、時間を延ばすと急に差が広がることがあります。";
};

const resetMainSimulation = () => {
    const offset = currentOffset();

    mainState = [Math.PI / 2, 0, Math.PI / 2 + offset, 0];
    shadowState = [mainState[0] + mainDelta0, mainState[1], mainState[2], mainState[3]];
    mainTrail = [];
    mainTime = 0;
    lyapunovSum = 0;

    if (initialOffsetValue) {
        initialOffsetValue.textContent = `${offset.toFixed(2)} rad / ${(offset * 180 / Math.PI).toFixed(1)}°`;
    }
};

const renormalizeShadow = () => {
    const distance = stateDistance(mainState, shadowState);

    if (!Number.isFinite(distance) || distance === 0) {
        return;
    }

    lyapunovSum += Math.log(distance / mainDelta0);

    for (let index = 0; index < mainState.length; index += 1) {
        let delta = shadowState[index] - mainState[index];

        if (index === 0 || index === 2) {
            delta = normalizeAngle(delta);
        }

        shadowState[index] = mainState[index] + delta * (mainDelta0 / distance);
    }

    shadowState[0] = normalizeAngle(shadowState[0]);
    shadowState[2] = normalizeAngle(shadowState[2]);
};

const updateMainReadout = () => {
    const lambda = mainTime > 0 ? lyapunovSum / mainTime : 0;
    const stretch = Math.exp(lambda);

    if (lambdaEstimateValue) {
        lambdaEstimateValue.textContent = lambda.toFixed(3);
    }

    if (stretchValue) {
        stretchValue.textContent = stretch.toFixed(2);
    }

    if (motionValue) {
        motionValue.textContent = describeMainMotion(mainState);
    }

    if (forecastValue) {
        forecastValue.textContent = describeForecast(lambda, mainTime);
    }

    if (mainNote) {
        mainNote.textContent = describeMainNote(lambda, mainTime);
    }
};

const updateMainSimulation = () => {
    if (!mainRunning || !mainCanvas || !mainContext) {
        return;
    }

    for (let step = 0; step < 5; step += 1) {
        mainState = rk4Step(mainState, mainDt);
        shadowState = rk4Step(shadowState, mainDt);

        mainState[0] = normalizeAngle(mainState[0]);
        mainState[2] = normalizeAngle(mainState[2]);
        shadowState[0] = normalizeAngle(shadowState[0]);
        shadowState[2] = normalizeAngle(shadowState[2]);

        renormalizeShadow();
        mainTime += mainDt;
    }

    const geometry = geometryForCanvas(mainCanvas);
    const position = positionForState(mainState, geometry);

    mainTrail.push({ x: position.x2, y: position.y2 });

    if (mainTrail.length > 1200) {
        mainTrail.shift();
    }

    updateMainReadout();
};

const drawMainSimulation = () => {
    if (!mainCanvas || !mainContext) {
        return;
    }

    const geometry = geometryForCanvas(mainCanvas);

    drawCanvasBackdrop(mainContext, mainCanvas);
    drawTrail(mainContext, mainTrail);
    drawPendulum(mainContext, geometry, shadowState, "#ff7171", 0.42);
    drawPendulum(mainContext, geometry, mainState, "#ffffff", 1);
    drawPivot(mainContext, geometry);
};

toggleMainButton?.addEventListener("click", () => {
    mainRunning = !mainRunning;
    toggleMainButton.textContent = mainRunning ? "一時停止" : "再開";
});

resetMainButton?.addEventListener("click", () => {
    resetMainSimulation();
    updateMainReadout();
    drawMainSimulation();
});

initialOffsetInput?.addEventListener("input", () => {
    resetMainSimulation();
    updateMainReadout();
    drawMainSimulation();
});

const poincareSimCanvas = document.querySelector("#poincareSimCanvas");
const poincareSimContext = poincareSimCanvas?.getContext("2d");
const poincareMapCanvas = document.querySelector("#poincareMapCanvas");
const poincareMapContext = poincareMapCanvas?.getContext("2d");
const resetMapButton = document.querySelector("#resetMapButton");
const pointCountValue = document.querySelector("#pointCountValue");
const mapSpreadValue = document.querySelector("#mapSpreadValue");
const mapInterpretationValue = document.querySelector("#mapInterpretationValue");

const poincareDt = 0.005;
let poincareState = [];
let poincarePoints = [];

const describePointCloud = (points) => {
    if (points.length < 40) {
        return "形成中";
    }

    const thetaValues = points.map((point) => point.theta1);
    const omegaValues = points.map((point) => point.omega1);
    const spread = (Math.max(...thetaValues) - Math.min(...thetaValues))
        * (Math.max(...omegaValues) - Math.min(...omegaValues));

    if (spread < 6) {
        return "曲線状にまとまる";
    }

    if (spread < 16) {
        return "帯状に広がる";
    }

    return "広く散っている";
};

const describeMapInterpretation = (label) => {
    if (label === "形成中") {
        return "点が増えるまで待機";
    }

    if (label === "曲線状にまとまる") {
        return "規則的な運動寄り";
    }

    if (label === "帯状に広がる") {
        return "準周期とカオスの中間";
    }

    return "カオス寄り";
};

const resetPoincareSimulation = () => {
    poincareState = [Math.PI / 2, 0, Math.PI / 2 + 0.3, 0];
    poincarePoints = [];
};

const updatePoincareReadout = () => {
    const spreadLabel = describePointCloud(poincarePoints);

    if (pointCountValue) {
        pointCountValue.textContent = `${poincarePoints.length}`;
    }

    if (mapSpreadValue) {
        mapSpreadValue.textContent = spreadLabel;
    }

    if (mapInterpretationValue) {
        mapInterpretationValue.textContent = describeMapInterpretation(spreadLabel);
    }
};

const recordPoincarePoint = (previousTheta2, nextTheta2, state) => {
    if (previousTheta2 < 0 && nextTheta2 >= 0 && state[3] > 0) {
        poincarePoints.push({
            theta1: normalizeAngle(state[0]),
            omega1: state[1]
        });

        if (poincarePoints.length > 8000) {
            poincarePoints.shift();
        }
    }
};

const updatePoincareSimulation = () => {
    if (!poincareSimCanvas || !poincareMapCanvas) {
        return;
    }

    for (let step = 0; step < 20; step += 1) {
        const oldTheta2 = normalizeAngle(poincareState[2]);

        poincareState = rk4Step(poincareState, poincareDt);
        poincareState[0] = normalizeAngle(poincareState[0]);
        poincareState[2] = normalizeAngle(poincareState[2]);

        const newTheta2 = normalizeAngle(poincareState[2]);
        recordPoincarePoint(oldTheta2, newTheta2, poincareState);
    }

    updatePoincareReadout();
};

const drawPoincareSimulation = () => {
    if (!poincareSimCanvas || !poincareSimContext) {
        return;
    }

    const geometry = geometryForCanvas(poincareSimCanvas);

    drawCanvasBackdrop(poincareSimContext, poincareSimCanvas);
    drawPendulum(poincareSimContext, geometry, poincareState, "#ffffff", 1);
    drawPivot(poincareSimContext, geometry);
};

const drawPoincareAxes = () => {
    if (!poincareMapCanvas || !poincareMapContext) {
        return;
    }

    const width = poincareMapCanvas.width;
    const height = poincareMapCanvas.height;

    poincareMapContext.strokeStyle = "rgba(255, 255, 255, 0.3)";
    poincareMapContext.lineWidth = 1;

    poincareMapContext.beginPath();
    poincareMapContext.moveTo(0, height / 2);
    poincareMapContext.lineTo(width, height / 2);
    poincareMapContext.moveTo(width / 2, 0);
    poincareMapContext.lineTo(width / 2, height);
    poincareMapContext.stroke();

    poincareMapContext.strokeStyle = "rgba(255, 255, 255, 0.12)";
    for (let index = -3; index <= 3; index += 1) {
        const x = width / 2 + (index / 3) * 170;

        poincareMapContext.beginPath();
        poincareMapContext.moveTo(x, 0);
        poincareMapContext.lineTo(x, height);
        poincareMapContext.stroke();
    }
};

const drawPoincareMap = () => {
    if (!poincareMapCanvas || !poincareMapContext) {
        return;
    }

    drawCanvasBackdrop(poincareMapContext, poincareMapCanvas);
    drawPoincareAxes();

    poincareMapContext.fillStyle = "#6ef1ff";

    poincarePoints.forEach((point) => {
        const x = poincareMapCanvas.width / 2 + (point.theta1 / Math.PI) * 170;
        const y = poincareMapCanvas.height / 2 - (point.omega1 / 8) * 170;

        if (x >= 0 && x < poincareMapCanvas.width && y >= 0 && y < poincareMapCanvas.height) {
            poincareMapContext.fillRect(x, y, 2, 2);
        }
    });

    poincareMapContext.fillStyle = "rgba(255, 255, 255, 0.84)";
    poincareMapContext.font = "14px IBM Plex Sans JP, sans-serif";
    poincareMapContext.fillText("θ₁", poincareMapCanvas.width - 22, poincareMapCanvas.height / 2 - 10);
    poincareMapContext.fillText("ω₁", poincareMapCanvas.width / 2 + 10, 20);
};

resetMapButton?.addEventListener("click", () => {
    resetPoincareSimulation();
    updatePoincareReadout();
    drawPoincareSimulation();
    drawPoincareMap();
});

const animate = () => {
    updateMainSimulation();
    drawMainSimulation();
    updatePoincareSimulation();
    drawPoincareSimulation();
    drawPoincareMap();
    requestAnimationFrame(animate);
};

resetMainSimulation();
updateMainReadout();
resetPoincareSimulation();
updatePoincareReadout();
drawMainSimulation();
drawPoincareSimulation();
drawPoincareMap();
animate();
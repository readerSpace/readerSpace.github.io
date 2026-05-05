const timeStepInput = document.querySelector("#timeStep");
const timeStepValue = document.querySelector("#timeStepValue");
const exactValue = document.querySelector("#exactValue");
const simValue = document.querySelector("#simValue");
const errorValue = document.querySelector("#errorValue");
const stepsValue = document.querySelector("#stepsValue");
const demoNote = document.querySelector("#demoNote");
const convergenceGrid = document.querySelector("#convergenceGrid");

const totalTime = 2;
const gravity = 9.8;

const exactFreeFall = (time) => 0.5 * gravity * time * time;

const simulateFreeFall = (dt) => {
    let position = 0;
    let velocity = 0;
    let time = 0;
    let steps = 0;

    while (time < totalTime - 1e-12) {
        const step = Math.min(dt, totalTime - time);

        position += velocity * step;
        velocity += gravity * step;
        time += step;
        steps += 1;
    }

    return {
        position,
        steps
    };
};

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const buildConvergenceRows = (currentDt) => {
    if (!convergenceGrid) {
        return;
    }

    const candidateSteps = [currentDt * 4, currentDt * 2, currentDt, currentDt / 2, currentDt / 4]
        .map((value) => clamp(Number(value.toFixed(3)), 0.01, 0.5));

    const stepList = [...new Set(candidateSteps)].sort((left, right) => right - left);
    const rows = stepList.map((dt) => {
        const simulation = simulateFreeFall(dt);
        const exact = exactFreeFall(totalTime);
        const error = Math.abs(simulation.position - exact);

        return {
            dt,
            error,
            steps: simulation.steps
        };
    });

    const maxError = Math.max(...rows.map((row) => row.error), 1e-9);

    convergenceGrid.innerHTML = "";

    rows.forEach((row) => {
        const item = document.createElement("div");
        const bar = document.createElement("div");
        const label = document.createElement("span");
        const detail = document.createElement("div");
        const errorText = document.createElement("strong");

        item.className = "convergence-item";

        if (Math.abs(row.dt - currentDt) < 0.0005) {
            item.classList.add("is-current");
        }

        label.textContent = `Δt = ${row.dt.toFixed(3)} s`;
        bar.className = "convergence-bar";
        bar.style.width = `${Math.max((row.error / maxError) * 100, 6)}%`;
        detail.textContent = `${row.steps} step`;
        errorText.textContent = `誤差 ${row.error.toFixed(3)} m`;

        item.append(label, bar, detail, errorText);
        convergenceGrid.appendChild(item);
    });
};

const describeAccuracy = (error, dt) => {
    if (error < 0.05) {
        return "かなり細かい刻みで、結果は理論値にかなり近づいています。ここから先は改善がゆるやかになります。";
    }

    if (dt >= 0.3) {
        return "かなり粗い刻みなので、落下の進み方を大づかみにしか追えていません。まずは時間刻みを細かくして収束を見る段階です。";
    }

    return "時間刻みを細かくするほど理論値に近づいています。大切なのは、刻みを変えても結果がほぼ変わらなくなるかを確認することです。";
};

const updateDemo = () => {
    if (!timeStepInput) {
        return;
    }

    const dt = Number(timeStepInput.value) / 100;
    const simulation = simulateFreeFall(dt);
    const exact = exactFreeFall(totalTime);
    const error = Math.abs(simulation.position - exact);

    timeStepValue.textContent = `${dt.toFixed(2)} s`;
    exactValue.textContent = `${exact.toFixed(2)} m`;
    simValue.textContent = `${simulation.position.toFixed(2)} m`;
    errorValue.textContent = `${error.toFixed(2)} m`;
    stepsValue.textContent = `${simulation.steps}`;
    demoNote.textContent = describeAccuracy(error, dt);

    buildConvergenceRows(dt);
};

timeStepInput?.addEventListener("input", updateDemo);

updateDemo();
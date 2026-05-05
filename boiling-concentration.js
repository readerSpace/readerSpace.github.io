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

const canvas = document.querySelector("#mixCanvas");
const simulationShell = document.querySelector("#playgroundShell");
const context = canvas?.getContext("2d");

if (!canvas || !simulationShell || !context) {
    throw new Error("Boiling concentration page failed to initialize.");
}

const addVolumeSlider = document.querySelector("#addVolume");
const concASlider = document.querySelector("#concA");
const heatPowerSlider = document.querySelector("#heatPower");
const addLiquidAButton = document.querySelector("#addLiquidA");
const heaterButton = document.querySelector("#toggleHeater");
const coolDownButton = document.querySelector("#coolDown");
const resetButton = document.querySelector("#resetSim");
const addVolumeText = document.querySelector("#addVolumeText");
const concAText = document.querySelector("#concAText");
const heatPowerText = document.querySelector("#heatPowerText");
const volumeStat = document.querySelector("#volumeStat");
const concStat = document.querySelector("#concStat");
const tempStat = document.querySelector("#tempStat");
const boilStat = document.querySelector("#boilStat");
const soluteStat = document.querySelector("#soluteStat");
const waterStat = document.querySelector("#waterStat");
const quickVolume = document.querySelector("#quickVolume");
const quickConc = document.querySelector("#quickConc");
const quickState = document.querySelector("#quickState");
const panelStatus = document.querySelector("#panelStatus");

let width = 0;
let height = 0;
let water = 0;
let solute = 0;
let temp = 25;
let heaterOn = false;
let bubbles = [];
let steam = [];
let droplets = [];
let statusTimeout = 0;

const maxVolume = 1000;

function totalVolume() {
    return water + solute;
}

function concentration() {
    if (totalVolume() <= 0) {
        return 0;
    }

    return 100 * solute / totalVolume();
}

function boilingPoint() {
    return 100 + 0.35 * concentration();
}

function currentStateLabel() {
    if (water <= 0 && solute > 0) {
        return "濃縮済み";
    }

    if (heaterOn && totalVolume() > 0 && temp >= boilingPoint()) {
        return "沸騰中";
    }

    if (heaterOn && totalVolume() > 0) {
        return "加熱中";
    }

    if (totalVolume() > 0) {
        return "待機中";
    }

    return "空";
}

function setStatus(message, reset = false) {
    if (!panelStatus) {
        return;
    }

    panelStatus.textContent = message;
    window.clearTimeout(statusTimeout);

    if (reset) {
        statusTimeout = window.setTimeout(() => {
            panelStatus.textContent = "液体を加えると全体濃度が決まり、加熱すると沸点を超えたあとに水だけが蒸発します。";
        }, 2800);
    }
}

function updateHeaterButton() {
    heaterButton.textContent = heaterOn ? "加熱停止" : "加熱開始";
    heaterButton.classList.toggle("is-on", heaterOn);
}

function updateUi() {
    addVolumeText.textContent = `${addVolumeSlider.value} mL`;
    concAText.textContent = `${concASlider.value} %`;
    heatPowerText.textContent = heatPowerSlider.value;

    volumeStat.textContent = `${totalVolume().toFixed(1)} mL`;
    concStat.textContent = `${concentration().toFixed(1)} %`;
    tempStat.textContent = `${temp.toFixed(1)} ℃`;
    boilStat.textContent = `${boilingPoint().toFixed(1)} ℃`;
    soluteStat.textContent = `${solute.toFixed(1)} g`;
    waterStat.textContent = `${water.toFixed(1)} g`;

    quickVolume.textContent = `${totalVolume().toFixed(1)} mL`;
    quickConc.textContent = `${concentration().toFixed(1)} %`;
    quickState.textContent = currentStateLabel();

    updateHeaterButton();
}

function getBeakerGeometry() {
    if (width <= 640) {
        const beakerWidth = Math.min(220, Math.max(190, width * 0.56));
        const beakerHeight = Math.min(230, Math.max(170, height * 0.48));
        const x = Math.max(34, Math.min(width * 0.18, width - beakerWidth - 88));
        const y = Math.max(118, height * 0.32);

        return {
            x,
            y,
            w: beakerWidth,
            h: beakerHeight
        };
    }

    const beakerWidth = width > 980 ? width * 0.34 : width * 0.42;
    const beakerHeight = height * 0.62;
    const x = width > 980 ? width * 0.42 : width * 0.28;
    const y = height * 0.17;

    return {
        x,
        y,
        w: Math.min(440, Math.max(280, beakerWidth)),
        h: Math.min(380, Math.max(250, beakerHeight))
    };
}

function addLiquid() {
    const requested = Number(addVolumeSlider.value);
    const available = Math.max(0, maxVolume - totalVolume());
    const added = Math.min(requested, available);

    if (added <= 0) {
        setStatus("容器がいっぱいです。少し蒸発させるか、リセットしてから追加してください。", true);
        return;
    }

    const concentrationValue = Number(concASlider.value);
    const addedSolute = added * concentrationValue / 100;
    const addedWater = added - addedSolute;

    water += addedWater;
    solute += addedSolute;

    const beaker = getBeakerGeometry();
    const dropCenterX = beaker.x + beaker.w * 0.53;
    const dropTopY = beaker.y - 28;

    for (let i = 0; i < 16; i += 1) {
        droplets.push({
            x: dropCenterX + Math.random() * 90 - 45,
            y: dropTopY + Math.random() * 40,
            vy: 2 + Math.random() * 2,
            r: 4 + Math.random() * 5,
            concentrationValue
        });
    }

    setStatus(`液体を ${added.toFixed(0)} mL 加えました。現在の濃度は ${concentration().toFixed(1)} % です。`, true);
}

function coolDown() {
    temp = Math.max(20, temp - 15);
    setStatus("温度を少し下げました。沸点との差が広がると泡と蒸気は弱まります。", true);
}

function resetSimulation() {
    water = 0;
    solute = 0;
    temp = 25;
    heaterOn = false;
    bubbles = [];
    steam = [];
    droplets = [];
    updateUi();
    setStatus("シミュレーションをリセットしました。液体を入れて最初から試せます。", true);
}

function toggleHeater() {
    heaterOn = !heaterOn;
    updateHeaterButton();
    setStatus(heaterOn ? "加熱を開始しました。沸点に近づくまでは温度が上がり、超えると水だけが蒸発します。" : "加熱を止めました。液体はゆっくり室温へ戻ります。", true);
}

function colorForConcentration(value) {
    const t = Math.min(1, value / 80);
    const r = Math.round(80 + 170 * t);
    const g = Math.round(170 - 70 * t);
    const b = Math.round(255 - 210 * t);
    return `rgb(${r}, ${g}, ${b})`;
}

function physicsStep() {
    const currentBoilingPoint = boilingPoint();
    const power = Number(heatPowerSlider.value);

    if (heaterOn && totalVolume() > 0) {
        if (temp < currentBoilingPoint) {
            temp += 0.025 * power;
        } else {
            temp += 0.002 * power;

            const evaporate = Math.min(water, 0.018 * power * (1 + (temp - currentBoilingPoint) * 0.08));
            water -= evaporate;

            if (Math.random() < 0.3 + power / 160) {
                const beaker = getBeakerGeometry();
                bubbles.push({
                    x: beaker.x + 60 + Math.random() * (beaker.w - 120),
                    y: beaker.y + beaker.h - 24 - Math.random() * 20,
                    r: 3 + Math.random() * 8,
                    vy: 1 + Math.random() * 2.2,
                    life: 1
                });
            }

            if (evaporate > 0 && Math.random() < 0.8) {
                const beaker = getBeakerGeometry();
                steam.push({
                    x: beaker.x + beaker.w * (0.36 + Math.random() * 0.28),
                    y: beaker.y + 20,
                    r: 8 + Math.random() * 12,
                    vy: 0.7 + Math.random() * 1.2,
                    alpha: 0.35
                });
            }
        }
    } else {
        temp += (25 - temp) * 0.006;
    }

    if (water <= 0 && solute > 0) {
        water = 0;
        temp = Math.min(temp, 180);
    }

    const beaker = getBeakerGeometry();

    bubbles = bubbles
        .map((bubble) => ({
            ...bubble,
            y: bubble.y - bubble.vy,
            r: bubble.r * 1.003,
            life: bubble.life - 0.01
        }))
        .filter((bubble) => bubble.life > 0 && bubble.y > beaker.y + 26);

    steam = steam
        .map((cloud) => ({
            ...cloud,
            y: cloud.y - cloud.vy,
            x: cloud.x + Math.sin(cloud.y * 0.05) * 0.8,
            r: cloud.r * 1.008,
            alpha: cloud.alpha - 0.003
        }))
        .filter((cloud) => cloud.alpha > 0 && cloud.y > 0);

    droplets = droplets
        .map((drop) => ({
            ...drop,
            y: drop.y + drop.vy,
            vy: drop.vy + 0.06
        }))
        .filter((drop) => drop.y < beaker.y + beaker.h - 10);
}

function drawBeaker(beaker) {
    context.lineWidth = 5;
    context.strokeStyle = "rgba(30, 41, 59, 0.72)";
    context.beginPath();
    context.moveTo(beaker.x, beaker.y);
    context.lineTo(beaker.x + 35, beaker.y + beaker.h);
    context.lineTo(beaker.x + beaker.w - 35, beaker.y + beaker.h);
    context.lineTo(beaker.x + beaker.w, beaker.y);
    context.stroke();

    context.lineWidth = 3;
    context.strokeStyle = "rgba(148, 163, 184, 0.72)";

    for (let i = 1; i <= 5; i += 1) {
        const y = beaker.y + beaker.h - i * beaker.h / 6;
        context.beginPath();
        context.moveTo(beaker.x + 28, y);
        context.lineTo(beaker.x + 54, y);
        context.stroke();
    }
}

function draw() {
    context.clearRect(0, 0, width, height);

    const beaker = getBeakerGeometry();
    const isCompactLayout = width <= 640;
    drawBeaker(beaker);

    const fillRatio = Math.min(1, totalVolume() / maxVolume);
    const liquidHeight = beaker.h * fillRatio;
    const liquidY = beaker.y + beaker.h - liquidHeight;
    const conc = concentration();

    if (totalVolume() > 0) {
        const gradient = context.createLinearGradient(0, liquidY, 0, beaker.y + beaker.h);
        gradient.addColorStop(0, colorForConcentration(conc));
        gradient.addColorStop(1, colorForConcentration(Math.min(80, conc + 12)));

        context.fillStyle = gradient;
        context.beginPath();
        context.moveTo(beaker.x + 35, beaker.y + beaker.h);
        context.lineTo(beaker.x + beaker.w - 35, beaker.y + beaker.h);
        context.lineTo(beaker.x + beaker.w - 35 + (liquidHeight / beaker.h) * 35, liquidY);
        context.quadraticCurveTo(
            beaker.x + beaker.w / 2,
            liquidY + Math.sin(Date.now() * 0.004) * 5,
            beaker.x + 35 - (liquidHeight / beaker.h) * 35,
            liquidY
        );
        context.closePath();
        context.fill();

        context.fillStyle = "rgba(255, 255, 255, 0.22)";
        context.beginPath();
        context.ellipse(beaker.x + beaker.w / 2, liquidY, Math.min(170, beaker.w * 0.4), 11, 0, 0, Math.PI * 2);
        context.fill();
    }

    bubbles.forEach((bubble) => {
        context.strokeStyle = `rgba(255, 255, 255, ${0.55 * bubble.life})`;
        context.lineWidth = 2;
        context.beginPath();
        context.arc(bubble.x, bubble.y, bubble.r, 0, Math.PI * 2);
        context.stroke();
    });

    steam.forEach((cloud) => {
        context.fillStyle = `rgba(148, 163, 184, ${cloud.alpha})`;
        context.beginPath();
        context.arc(cloud.x, cloud.y, cloud.r, 0, Math.PI * 2);
        context.fill();
    });

    droplets.forEach((drop) => {
        context.fillStyle = colorForConcentration(drop.concentrationValue);
        context.beginPath();
        context.arc(drop.x, drop.y, drop.r, 0, Math.PI * 2);
        context.fill();
    });

    const heaterX = beaker.x + 40;
    const heaterY = beaker.y + beaker.h + 20;
    const heaterWidth = beaker.w - 80;

    context.fillStyle = heaterOn ? "#ef4444" : "#94a3b8";
    context.fillRect(heaterX, heaterY, heaterWidth, 18);
    context.fillStyle = heaterOn ? "rgba(239, 68, 68, 0.26)" : "rgba(148, 163, 184, 0.2)";
    context.beginPath();
    context.ellipse(heaterX + heaterWidth / 2, heaterY - 3, heaterWidth * 0.56, 24, 0, 0, Math.PI * 2);
    context.fill();

    const thermometerX = beaker.x + beaker.w + 52;
    const thermometerY = beaker.y + 18;
    const thermometerHeight = beaker.h - 34;

    context.strokeStyle = "#334155";
    context.lineWidth = 4;
    context.strokeRect(thermometerX, thermometerY, 24, thermometerHeight);

    const tempRatio = Math.min(1, Math.max(0, (temp - 20) / 160));
    context.fillStyle = temp >= boilingPoint() ? "#dc2626" : "#f97316";
    context.fillRect(thermometerX + 4, thermometerY + thermometerHeight - tempRatio * thermometerHeight, 16, tempRatio * thermometerHeight);
    context.fillStyle = "#163047";
    context.font = '14px "IBM Plex Sans JP"';
    context.fillText("温度", thermometerX - 2, thermometerY - 12);
    context.fillText(`${temp.toFixed(1)}℃`, thermometerX - 18, thermometerY + thermometerHeight + 28);

    const statusX = width > 980 ? beaker.x - 10 : isCompactLayout ? 24 : 36;
    const statusY = isCompactLayout ? 34 : 42;
    const detailY = isCompactLayout ? 58 : 68;
    context.fillStyle = "#163047";
    context.font = `${isCompactLayout ? 15 : 16}px "IBM Plex Sans JP"`;
    context.fillText(
        temp >= boilingPoint() && totalVolume() > 0 ? "沸騰中: 水分が蒸発" : heaterOn ? "加熱中" : "待機中",
        statusX,
        statusY
    );
    context.fillText(`濃度が高いほど沸点が上がる: 現在 ${boilingPoint().toFixed(1)} ℃`, statusX, detailY);

    if (water <= 0 && solute > 0) {
        context.fillStyle = "#7c2d12";
        if (isCompactLayout) {
            const noticeY = Math.min(beaker.y - 18, detailY + 22);
            context.textAlign = "center";
            context.font = '13px "IBM Plex Sans JP"';
            context.fillText("水分がほぼ無くなりました", width / 2, noticeY);
            context.fillText("溶質だけが残っています", width / 2, noticeY + 18);
            context.textAlign = "left";
        } else {
            context.font = '18px "IBM Plex Sans JP"';
            context.fillText("水分がほぼ無くなり、溶質だけが残っています", beaker.x - 10, beaker.y - 18);
        }
    }
}

function resizeCanvas() {
    const rect = simulationShell.getBoundingClientRect();

    if (!rect.width) {
        return;
    }

    width = Math.max(320, Math.floor(rect.width));

    if (window.matchMedia("(max-width: 900px)").matches) {
        const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
        height = Math.max(360, Math.min(460, Math.floor(Math.min(width * 0.92, viewportHeight * 0.52))));
    } else {
        height = Math.max(420, Math.floor(rect.height || 840));
    }

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function loop() {
    physicsStep();
    updateUi();
    draw();
    window.requestAnimationFrame(loop);
}

addLiquidAButton?.addEventListener("click", addLiquid);
heaterButton?.addEventListener("click", toggleHeater);
coolDownButton?.addEventListener("click", coolDown);
resetButton?.addEventListener("click", resetSimulation);

[addVolumeSlider, concASlider, heatPowerSlider].forEach((slider) => {
    slider?.addEventListener("input", updateUi);
});

window.addEventListener("resize", resizeCanvas);

resizeCanvas();
updateUi();
loop();
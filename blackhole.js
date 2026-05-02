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

const massRange = document.querySelector("#massRange");
const positionRange = document.querySelector("#positionRange");

const massValue = document.querySelector("#massValue");
const positionValue = document.querySelector("#positionValue");
const horizonRadiusValue = document.querySelector("#horizonRadiusValue");
const regionValue = document.querySelector("#regionValue");
const escapeValue = document.querySelector("#escapeValue");
const futureValue = document.querySelector("#futureValue");
const timeRoleValue = document.querySelector("#timeRoleValue");
const tidalValue = document.querySelector("#tidalValue");
const demoNote = document.querySelector("#demoNote");

const canvas = document.querySelector("#blackholeCanvas");
const context = canvas?.getContext("2d");

const G = 6.6743e-11;
const C = 299792458;
const SOLAR_MASS = 1.98847e30;
const EARTH_G = 9.80665;
const BODY_LENGTH = 2;

const formatMassSolar = (massSolar) => {
    if (massSolar < 1000) {
        return `${Math.round(massSolar).toLocaleString("ja-JP")} M☉`;
    }

    if (massSolar < 10_000) {
        return `${Math.round(massSolar).toLocaleString("ja-JP")} M☉`;
    }

    if (massSolar < 100_000) {
        return `${(massSolar / 10_000).toFixed(2)}万 M☉`;
    }

    return `${(massSolar / 10_000).toFixed(1)}万 M☉`;
};

const formatDistance = (kilometers) => {
    if (kilometers < 1000) {
        return `${kilometers.toFixed(0)} km`;
    }

    if (kilometers < 10_000) {
        return `${Math.round(kilometers).toLocaleString("ja-JP")} km`;
    }

    if (kilometers < 100_000) {
        return `${(kilometers / 10_000).toFixed(2)}万 km`;
    }

    return `${(kilometers / 10_000).toFixed(1)}万 km`;
};

const describeRegion = (factor) => {
    if (factor > 1.1) {
        return "地平線の外側";
    }

    if (factor >= 0.95) {
        return "事象の地平線付近";
    }

    return "地平線の内側";
};

const describeEscape = (factor) => {
    if (factor > 1.1) {
        return "外向きの未来が残る";
    }

    if (factor >= 0.95) {
        return "光でもほぼ出られない";
    }

    return "外へ出る未来がない";
};

const describeFuture = (factor) => {
    if (factor > 1.1) {
        return "外にも横にも広がる";
    }

    if (factor >= 0.95) {
        return "地平線に沿って細くなる";
    }

    return "中心へ向かって収束する";
};

const describeTimeRole = (factor) => {
    if (factor > 1.1) {
        return "t が時間として優勢";
    }

    if (factor >= 0.95) {
        return "役割が切り替わる境界";
    }

    return "r が時間的に振る舞う";
};

const describeTidal = (gUnits, massSolar, factor) => {
    if (gUnits > 100000) {
        return "即座に引き裂かれやすい";
    }

    if (gUnits > 1000) {
        return "非常に強い";
    }

    if (gUnits > 30) {
        return "かなり強い";
    }

    if (factor <= 1.1 && massSolar > 1_000_000) {
        return "超大質量なら比較的穏やか";
    }

    if (gUnits > 1) {
        return "体感できる";
    }

    return "まだ穏やか";
};

const formatGUnits = (gUnits) => {
    if (gUnits < 0.1) {
        return "0.1 g 未満";
    }

    if (gUnits < 10) {
        return `${gUnits.toFixed(1)} g`;
    }

    return `${Math.round(gUnits).toLocaleString("ja-JP")} g`;
};

const describeDemo = (factor, massSolar, gUnits) => {
    if (factor < 0.95) {
        return "地平線の内側に入ったので、中心へ進むことがそのまま未来になります。ここでの『脱出』は、時間を逆行するのと同じ意味になり、不可能です。";
    }

    if (factor < 1.1) {
        return "いまは事象の地平線のすぐ近くです。未来方向の円錐が強く傾き、外へ向かう選択肢がほぼ失われます。";
    }

    if (massSolar > 1_000_000 && gUnits < 1) {
        return "超大質量ブラックホールでは、地平線そのものは意外に大きく、潮汐力は比較的穏やかです。危険なのはむしろ、もっと深く入ったあとです。";
    }

    return "まだ地平線の外側なので、外向きの未来も残っています。ここではブラックホールは『戻れない時空の領域』としてではなく、非常に強い重力源として見えています。";
};

const resizeCanvas = () => {
    if (!canvas || !context) {
        return;
    }

    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    const displayWidth = Math.min(canvas.parentElement?.clientWidth || 640, 640);
    const displayHeight = Math.round(displayWidth * 0.66);

    canvas.width = Math.round(displayWidth * ratio);
    canvas.height = Math.round(displayHeight * ratio);
    canvas.style.width = `${displayWidth}px`;
    canvas.style.height = `${displayHeight}px`;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
};

const drawArrow = (x1, y1, x2, y2, color, width = 2.2) => {
    if (!context) {
        return;
    }

    const angle = Math.atan2(y2 - y1, x2 - x1);

    context.strokeStyle = color;
    context.lineWidth = width;
    context.beginPath();
    context.moveTo(x1, y1);
    context.lineTo(x2, y2);
    context.stroke();

    context.fillStyle = color;
    context.beginPath();
    context.moveTo(x2, y2);
    context.lineTo(x2 - 10 * Math.cos(angle - Math.PI / 7), y2 - 10 * Math.sin(angle - Math.PI / 7));
    context.lineTo(x2 - 10 * Math.cos(angle + Math.PI / 7), y2 - 10 * Math.sin(angle + Math.PI / 7));
    context.closePath();
    context.fill();
};

const drawDemo = (factor, massSolar) => {
    if (!canvas || !context) {
        return;
    }

    const width = Number(canvas.style.width.replace("px", "")) || 640;
    const height = Number(canvas.style.height.replace("px", "")) || 420;
    const centerX = width * 0.38;
    const centerY = height * 0.52;
    const horizonRadius = Math.min(width, height) * 0.22;
    const scaledDistance = horizonRadius * (0.45 + factor * 0.6);
    const travelerX = centerX + scaledDistance;
    const travelerY = centerY;
    const gradient = context.createLinearGradient(0, 0, 0, height);

    gradient.addColorStop(0, "rgba(5, 9, 16, 0.98)");
    gradient.addColorStop(1, "rgba(18, 27, 39, 0.98)");
    context.clearRect(0, 0, width, height);
    context.fillStyle = gradient;
    context.fillRect(0, 0, width, height);

    for (let index = 0; index < 26; index += 1) {
        const x = (index * 97) % width;
        const y = (index * 53) % height;
        context.fillStyle = "rgba(255,255,255,0.24)";
        context.fillRect(x, y, 2, 2);
    }

    context.beginPath();
    context.arc(centerX, centerY, horizonRadius * 1.38, 0, Math.PI * 2);
    context.strokeStyle = "rgba(125, 179, 255, 0.12)";
    context.lineWidth = 1;
    context.setLineDash([8, 8]);
    context.stroke();
    context.setLineDash([]);

    const glow = context.createRadialGradient(centerX, centerY, horizonRadius * 0.4, centerX, centerY, horizonRadius * 1.3);
    glow.addColorStop(0, "rgba(255, 173, 94, 0.16)");
    glow.addColorStop(1, "rgba(255, 173, 94, 0)");
    context.fillStyle = glow;
    context.beginPath();
    context.arc(centerX, centerY, horizonRadius * 1.3, 0, Math.PI * 2);
    context.fill();

    context.beginPath();
    context.arc(centerX, centerY, horizonRadius, 0, Math.PI * 2);
    context.fillStyle = "rgba(7, 10, 15, 0.95)";
    context.fill();
    context.lineWidth = 8;
    context.strokeStyle = "rgba(241, 178, 106, 0.6)";
    context.stroke();

    context.fillStyle = "rgba(255,255,255,0.82)";
    context.font = "14px IBM Plex Sans JP, sans-serif";
    context.fillText("事象の地平線", centerX - 44, centerY - horizonRadius - 20);
    context.fillText("特異点", centerX - 20, centerY + 6);

    context.beginPath();
    context.arc(travelerX, travelerY, 8, 0, Math.PI * 2);
    context.fillStyle = factor < 1 ? "#f1b26a" : "#7db3ff";
    context.fill();
    context.fillStyle = "rgba(255,255,255,0.9)";
    context.fillText(`観測者 (${factor.toFixed(2)} r_s)`, travelerX - 48, travelerY - 20);

    if (factor > 1.1) {
        drawArrow(travelerX, travelerY, travelerX + 54, travelerY, "rgba(125, 179, 255, 0.9)");
        drawArrow(travelerX, travelerY, travelerX + 30, travelerY - 34, "rgba(125, 179, 255, 0.74)");
        drawArrow(travelerX, travelerY, travelerX + 30, travelerY + 34, "rgba(125, 179, 255, 0.74)");
        drawArrow(travelerX, travelerY, travelerX - 60, travelerY, "rgba(241, 178, 106, 0.72)");
    } else if (factor >= 0.95) {
        drawArrow(travelerX, travelerY, travelerX + 28, travelerY - 22, "rgba(125, 179, 255, 0.55)");
        drawArrow(travelerX, travelerY, travelerX - 58, travelerY, "rgba(241, 178, 106, 0.88)");
        drawArrow(travelerX, travelerY, travelerX - 40, travelerY + 18, "rgba(241, 178, 106, 0.78)");
    } else {
        drawArrow(travelerX, travelerY, centerX + 22, centerY - 22, "rgba(241, 178, 106, 0.92)");
        drawArrow(travelerX, travelerY, centerX + 16, centerY + 2, "rgba(241, 178, 106, 0.92)");
        drawArrow(travelerX, travelerY, centerX + 22, centerY + 24, "rgba(241, 178, 106, 0.92)");
        drawArrow(travelerX, travelerY, centerX + 42, centerY, "rgba(241, 178, 106, 0.72)");
    }

    context.fillStyle = "rgba(255,255,255,0.76)";
    context.font = "13px IBM Plex Sans JP, sans-serif";
    context.fillText(`質量: ${formatMassSolar(massSolar)}`, width * 0.62, 36);
    context.fillText("青い矢印: 外にも開く未来", width * 0.62, 62);
    context.fillText("橙の矢印: 中心へ向かう未来", width * 0.62, 84);
};

const updateDemo = () => {
    if (!massRange || !positionRange) {
        return;
    }

    const massSolar = 5 * 10 ** (Number(massRange.value) / 15);
    const factor = Number(positionRange.value) / 100;
    const rsMeters = (2 * G * massSolar * SOLAR_MASS) / (C ** 2);
    const rsKilometers = rsMeters / 1000;
    const radiusMeters = rsMeters * factor;
    const tidal = (2 * G * massSolar * SOLAR_MASS * BODY_LENGTH) / (radiusMeters ** 3);
    const gUnits = tidal / EARTH_G;

    if (massValue) {
        massValue.textContent = formatMassSolar(massSolar);
    }

    if (positionValue) {
        positionValue.innerHTML = `${factor.toFixed(2)} r<sub>s</sub>`;
    }

    if (horizonRadiusValue) {
        horizonRadiusValue.textContent = formatDistance(rsKilometers);
    }

    if (regionValue) {
        regionValue.textContent = describeRegion(factor);
    }

    if (escapeValue) {
        escapeValue.textContent = describeEscape(factor);
    }

    if (futureValue) {
        futureValue.textContent = describeFuture(factor);
    }

    if (timeRoleValue) {
        timeRoleValue.textContent = describeTimeRole(factor);
    }

    if (tidalValue) {
        tidalValue.textContent = `${describeTidal(gUnits, massSolar, factor)} (${formatGUnits(gUnits)})`;
    }

    if (demoNote) {
        demoNote.textContent = describeDemo(factor, massSolar, gUnits);
    }

    drawDemo(factor, massSolar);
};

const handleResize = () => {
    resizeCanvas();
    updateDemo();
};

[massRange, positionRange].forEach((element) => {
    element?.addEventListener("input", updateDemo);
});

window.addEventListener("resize", handleResize);

handleResize();
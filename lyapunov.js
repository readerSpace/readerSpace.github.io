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

const parameterRInput = document.querySelector("#parameterR");
const initialXInput = document.querySelector("#initialX");
const parameterRValue = document.querySelector("#parameterRValue");
const initialXValue = document.querySelector("#initialXValue");
const lambdaValue = document.querySelector("#lambdaValue");
const regimeValue = document.querySelector("#regimeValue");
const stretchValue = document.querySelector("#stretchValue");
const horizonValue = document.querySelector("#horizonValue");
const regimeNote = document.querySelector("#regimeNote");
const growthBars = document.querySelector("#growthBars");

const formatNumber = (value, digits = 3) => value.toFixed(digits);

const logisticLyapunov = (r, x0, iterations = 500, transient = 120) => {
    let x = x0;
    let sum = 0;
    let count = 0;

    for (let index = 0; index < iterations; index += 1) {
        x = r * x * (1 - x);

        if (index >= transient) {
            const derivative = Math.max(Math.abs(r * (1 - 2 * x)), 1e-12);

            sum += Math.log(derivative);
            count += 1;
        }
    }

    return count === 0 ? 0 : sum / count;
};

const describeRegime = (lambda, r) => {
    if (lambda > 0.02) {
        if (r > 3.9) {
            return {
                label: "強いカオス",
                note: "この領域では Lyapunov 指数が明確に正で、誤差は平均的に急速に広がります。"
            };
        }

        return {
            label: "カオス",
            note: "Lyapunov 指数が正なので、初期誤差は平均的に指数関数的に増えます。"
        };
    }

    if (lambda < -0.02) {
        return {
            label: "安定",
            note: "Lyapunov 指数が負なので、近い状態は再び近づきやすく、長期の予測も比較的保たれます。"
        };
    }

    return {
        label: "境界付近",
        note: "Lyapunov 指数が 0 に近く、規則と不規則の境目のようなふるまいです。"
    };
};

const buildGrowthBars = (lambda) => {
    if (!growthBars) {
        return;
    }

    growthBars.innerHTML = "";

    const initialError = 1e-6;
    const values = Array.from({ length: 8 }, (_, step) => initialError * Math.exp(lambda * step));
    const maxValue = Math.max(...values, 1e-6);

    values.forEach((value, step) => {
        const bar = document.createElement("div");
        const ratio = Math.max(value / maxValue, 0.08);

        bar.className = "growth-bar";
        bar.style.height = `${Math.round(ratio * 160)}px`;
        bar.title = `${step} step: ${value.toExponential(2)}`;
        growthBars.appendChild(bar);
    });
};

const updateDemo = () => {
    if (!parameterRInput || !initialXInput) {
        return;
    }

    const r = Number(parameterRInput.value) / 100;
    const x0 = Number(initialXInput.value) / 100;
    const lambda = logisticLyapunov(r, x0);
    const stretch = Math.exp(lambda);
    const regime = describeRegime(lambda, r);

    parameterRValue.textContent = r.toFixed(2);
    initialXValue.textContent = x0.toFixed(2);
    lambdaValue.textContent = formatNumber(lambda, 3);
    regimeValue.textContent = regime.label;
    stretchValue.textContent = `${stretch.toFixed(2)} 倍`;

    if (lambda > 0.0001) {
        const horizon = Math.log(1e6) / lambda;

        horizonValue.textContent = `約 ${Math.round(horizon)} ステップ`;
    } else if (lambda < -0.0001) {
        horizonValue.textContent = "広がらず縮む";
    } else {
        horizonValue.textContent = "かなり長い";
    }

    regimeNote.textContent = regime.note;
    buildGrowthBars(lambda);
};

[parameterRInput, initialXInput].forEach((input) => {
    input?.addEventListener("input", updateDemo);
});

updateDemo();
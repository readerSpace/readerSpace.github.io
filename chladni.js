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

const canvas = document.querySelector("#chladniCanvas");
const context = canvas?.getContext("2d");

const mMode = document.querySelector("#mMode");
const nMode = document.querySelector("#nMode");
const contrastRange = document.querySelector("#contrastRange");

const mModeValue = document.querySelector("#mModeValue");
const nModeValue = document.querySelector("#nModeValue");
const contrastValue = document.querySelector("#contrastValue");
const complexityValue = document.querySelector("#complexityValue");
const symmetryValue = document.querySelector("#symmetryValue");
const differenceValue = document.querySelector("#differenceValue");
const modeNoteValue = document.querySelector("#modeNoteValue");
const demoNote = document.querySelector("#demoNote");

const chladni = (x, y, m, n) => (
    Math.sin(m * Math.PI * x) * Math.sin(n * Math.PI * y)
    - Math.sin(n * Math.PI * x) * Math.sin(m * Math.PI * y)
);

const describeComplexity = (m, n) => {
    const score = m + n;

    if (score <= 6) {
        return "低め";
    }

    if (score <= 12) {
        return "中程度";
    }

    if (score <= 18) {
        return "高め";
    }

    return "かなり高い";
};

const describeSymmetry = (m, n) => {
    if (m === n) {
        return "非常に高い";
    }

    if ((m + n) % 2 === 0) {
        return "高め";
    }

    return "やや崩れる";
};

const describeModeNote = (m, n) => {
    const difference = Math.abs(m - n);

    if (difference === 0) {
        return "対称性の強いモード";
    }

    if (difference <= 2) {
        return "節線のバランスが見やすい";
    }

    if (difference <= 5) {
        return "節線が増えて模様が細かい";
    }

    return "かなり複雑な交差が出やすい";
};

const describeDemo = (m, n) => {
    const difference = Math.abs(m - n);

    if (difference === 0) {
        return "m と n が同じなので、対称性の強い節線が現れます。";
    }

    if (difference <= 2) {
        return "近いモード同士なので、比較的整った模様が見えます。";
    }

    return "m と n の差が大きいほど、節線が増えて模様が入り組んで見えやすくなります。";
};

const resizeCanvas = () => {
    if (!canvas) {
        return;
    }

    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    const displayWidth = Math.min(canvas.parentElement?.clientWidth || 560, 560);
    const displayHeight = displayWidth;

    canvas.width = Math.round(displayWidth * ratio);
    canvas.height = Math.round(displayHeight * ratio);
    canvas.style.width = `${displayWidth}px`;
    canvas.style.height = `${displayHeight}px`;

    context?.setTransform(ratio, 0, 0, ratio, 0, 0);
};

const draw = () => {
    if (!canvas || !context || !mMode || !nMode || !contrastRange) {
        return;
    }

    const width = Number(canvas.style.width.replace("px", "")) || 560;
    const height = Number(canvas.style.height.replace("px", "")) || 560;
    const m = Number(mMode.value);
    const n = Number(nMode.value);
    const contrast = Number(contrastRange.value);

    mModeValue.textContent = `${m}`;
    nModeValue.textContent = `${n}`;
    contrastValue.textContent = `${contrast}`;

    complexityValue.textContent = describeComplexity(m, n);
    symmetryValue.textContent = describeSymmetry(m, n);
    differenceValue.textContent = `${Math.abs(m - n)}`;
    modeNoteValue.textContent = describeModeNote(m, n);
    demoNote.textContent = describeDemo(m, n);

    const image = context.createImageData(width, height);
    const data = image.data;

    for (let py = 0; py < height; py += 1) {
        for (let px = 0; px < width; px += 1) {
            const x = (px / width) * 2 - 1;
            const y = (py / height) * 2 - 1;
            const value = chladni(x, y, m, n);
            const brightness = Math.exp(-Math.abs(value) * contrast) * 255;
            const index = (py * width + px) * 4;

            data[index] = brightness;
            data[index + 1] = brightness;
            data[index + 2] = brightness;
            data[index + 3] = 255;
        }
    }

    context.putImageData(image, 0, 0);
};

const update = () => {
    resizeCanvas();
    draw();
};

[mMode, nMode, contrastRange].forEach((element) => {
    element?.addEventListener("input", draw);
});

window.addEventListener("resize", update);

update();
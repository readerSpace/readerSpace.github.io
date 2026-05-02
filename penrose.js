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

const stages = [
    {
        title: "通常の時空図 (t, x)",
        keep: "光は t = ±x の 45 度",
        drop: "まだ無限遠は有限化していない",
        formula: "ds<sup>2</sup> = -dt<sup>2</sup> + dx<sup>2</sup>",
        description: "まずは特殊相対論のミンコフスキー時空から始めます。光は常に 45 度に進むので、因果関係の基準線がここで決まります。",
        caption: "原点から左右 45 度に伸びる線が光です。物体はその内側にしか動けません。"
    },
    {
        title: "光座標に変換する",
        keep: "u と v がそのまま光線を表す",
        drop: "t と x の見慣れた役割分担",
        formula: "u = t - x, v = t + x",
        description: "左向きと右向きの光を、それぞれ u と v の一定値として表します。これで光が座標の基準そのものになります。",
        caption: "u = const と v = const の格子は、光の進み方を直接反映した座標の見え方です。"
    },
    {
        title: "無限遠を有限に押し込める",
        keep: "因果構造",
        drop: "距離と時間の絶対的な大きさ",
        formula: "U = arctan(u), V = arctan(v)",
        description: "arctan を使うと、u と v が無限大に飛んでも U と V は ±π/2 に収まります。こうして無限遠が図の端に現れます。",
        caption: "無限遠を端に押し込めても、光が 45 度であるというルールは保たれます。"
    },
    {
        title: "ダイヤ形のペンローズ図",
        keep: "光 45 度と境界の意味",
        drop: "普通の地図としての距離感",
        formula: "T = (U + V) / 2, X = (V - U) / 2",
        description: "(T, X) に戻すと、時空全体が有限のダイヤに収まります。i+, i-, I+, I- を一枚の図で読めるのがペンローズ図です。",
        caption: "ここで初めて、未来無限や光的無限の意味を図の端として読み取れるようになります。"
    },
    {
        title: "ブラックホールに応用する",
        keep: "地平線、特異点、未来の向き",
        drop: "内外で同じ時間感覚という直感",
        formula: "外部領域 + 事象の地平線 + 特異点",
        description: "ブラックホールでは、地平線が 45 度の境界として現れ、内部では未来方向が特異点へ流れ込むようになります。",
        caption: "これが『未来が特異点に向く』を図として言い直したものです。"
    }
];

const stageButtons = [...document.querySelectorAll(".stage-tab")];
const stageScenes = [...document.querySelectorAll(".stage-scene")];
const stageTitleValue = document.querySelector("#stageTitleValue");
const stageKeepValue = document.querySelector("#stageKeepValue");
const stageDropValue = document.querySelector("#stageDropValue");
const stageFormula = document.querySelector("#stageFormula");
const stageDescription = document.querySelector("#stageDescription");
const stageCaption = document.querySelector("#stageCaption");

const updateStage = (index) => {
    const stage = stages[index];

    if (!stage) {
        return;
    }

    stageButtons.forEach((button, buttonIndex) => {
        const isActive = buttonIndex === index;
        button.classList.toggle("is-active", isActive);
        button.setAttribute("aria-pressed", String(isActive));
    });

    stageScenes.forEach((scene, sceneIndex) => {
        scene.classList.toggle("is-active", sceneIndex === index);
    });

    if (stageTitleValue) {
        stageTitleValue.textContent = stage.title;
    }

    if (stageKeepValue) {
        stageKeepValue.textContent = stage.keep;
    }

    if (stageDropValue) {
        stageDropValue.textContent = stage.drop;
    }

    if (stageFormula) {
        stageFormula.innerHTML = stage.formula;
    }

    if (stageDescription) {
        stageDescription.textContent = stage.description;
    }

    if (stageCaption) {
        stageCaption.textContent = stage.caption;
    }
};

stageButtons.forEach((button) => {
    button.addEventListener("click", () => {
        updateStage(Number(button.dataset.stage));
    });
});

updateStage(0);
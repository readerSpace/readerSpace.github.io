const templateButtons = document.querySelectorAll("#copyTemplate, #copyTemplateBottom");
const copyStatus = document.querySelector("#copyStatus");

const inquiryTemplate = [
    "SSH課題研究サポートについて相談したいです。",
    "",
    "【研究テーマまたは候補】",
    "",
    "【現在の進捗】",
    "",
    "【困っている点】",
    "",
    "【数式・プログラムの状況】",
    "",
    "【希望するサポート内容】",
    ""
].join("\n");

const setStatus = (message, isSuccess = false) => {
    if (!copyStatus) {
        return;
    }

    copyStatus.textContent = message;
    copyStatus.classList.toggle("is-success", isSuccess);
};

const fallbackCopy = () => {
    const helper = document.createElement("textarea");

    helper.value = inquiryTemplate;
    helper.setAttribute("readonly", "");
    helper.style.position = "absolute";
    helper.style.left = "-9999px";

    document.body.appendChild(helper);
    helper.select();
    helper.setSelectionRange(0, helper.value.length);

    const copied = document.execCommand("copy");

    document.body.removeChild(helper);

    if (!copied) {
        throw new Error("Fallback copy failed");
    }
};

const copyTemplate = async () => {
    try {
        if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(inquiryTemplate);
        } else {
            fallbackCopy();
        }

        setStatus("相談テンプレをコピーしました。メッセージ欄にそのまま貼り付けて使えます。", true);
    } catch (error) {
        try {
            fallbackCopy();
            setStatus("相談テンプレをコピーしました。メッセージ欄にそのまま貼り付けて使えます。", true);
        } catch (fallbackError) {
            setStatus("コピーに失敗しました。ブラウザの権限設定を確認してください。");
        }
    }
};

templateButtons.forEach((button) => {
    button.addEventListener("click", copyTemplate);
});

const observer = new IntersectionObserver(
    (entries) => {
        entries.forEach((entry) => {
            if (entry.isIntersecting) {
                entry.target.classList.add("is-visible");
                observer.unobserve(entry.target);
            }
        });
    },
    {
        threshold: 0.18,
        rootMargin: "0px 0px -40px 0px"
    }
);

document.querySelectorAll(".reveal").forEach((section) => {
    if (!section.classList.contains("is-visible")) {
        observer.observe(section);
    }
});
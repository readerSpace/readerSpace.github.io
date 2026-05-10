import csv
from pathlib import Path

import matplotlib
import numpy as np

matplotlib.use("Agg")
import matplotlib.pyplot as plt

from main import fit_entropy_growth_rate, select_representative_record


def read_records_csv(path):
    records = []
    with path.open("r", encoding="utf-8", newline="") as file:
        reader = csv.DictReader(file)
        for row in reader:
            parsed = {}
            for key, value in row.items():
                if key == "chaos_region":
                    parsed[key] = value
                elif key == "Positive_lyapunov_count":
                    parsed[key] = int(value)
                else:
                    parsed[key] = float(value)
            records.append(parsed)
    return records


def read_entropy_csv(path):
    rows = []
    with path.open("r", encoding="utf-8", newline="") as file:
        reader = csv.DictReader(file)
        for row in reader:
            rows.append({key: float(value) for key, value in row.items()})

    return {
        "times": np.array([row["time"] for row in rows], dtype=float),
        "weak_chaos_entropy": np.array([row["weak_chaos_entropy"] for row in rows], dtype=float),
        "strong_chaos_entropy": np.array([row["strong_chaos_entropy"] for row in rows], dtype=float),
    }


def build_entropy_growth_results(records, entropy_curves):
    results = {}

    for region_name, entropy_key in [
        ("weak_chaos", "weak_chaos_entropy"),
        ("strong_chaos", "strong_chaos_entropy"),
    ]:
        record = select_representative_record(records, region_name)
        fit = fit_entropy_growth_rate(entropy_curves["times"], entropy_curves[entropy_key])
        results[region_name] = {
            "record": record,
            "slope": float(fit["slope"]),
        }

    weak_slope = results["weak_chaos"]["slope"]
    strong_slope = results["strong_chaos"]["slope"]
    summary = {
        "strong_faster_than_weak": bool(np.isfinite(weak_slope) and np.isfinite(strong_slope) and strong_slope > weak_slope),
        "slope_ratio_strong_to_weak": float(strong_slope / weak_slope) if np.isfinite(weak_slope) and weak_slope > 1e-12 and np.isfinite(strong_slope) else np.nan,
    }
    return results, summary


def plot_entropy_growth_rate_only(results, summary, output_path):
    fig, ax = plt.subplots(1, 1, figsize=(8.8, 5.8), constrained_layout=True)

    x_positions = np.arange(2)
    bar_width = 0.24
    slope_values = [results["weak_chaos"]["slope"], results["strong_chaos"]["slope"]]
    lambda_values = [
        results["weak_chaos"]["record"]["Lyapunov_exponent"],
        results["strong_chaos"]["record"]["Lyapunov_exponent"],
    ]
    hks_values = [
        results["weak_chaos"]["record"]["KS_entropy_Pesin"],
        results["strong_chaos"]["record"]["KS_entropy_Pesin"],
    ]

    ax.bar(x_positions - bar_width, slope_values, width=bar_width, color=["#60a5fa", "#f87171"], label=r"$dS/dt$ fit")
    ax.bar(x_positions, lambda_values, width=bar_width, color=["#2563eb", "#dc2626"], label=r"$\lambda_1$")
    ax.bar(x_positions + bar_width, hks_values, width=bar_width, color=["#93c5fd", "#fca5a5"], label=r"$h_{KS}$")
    ax.set_xticks(x_positions)
    ax.set_xticklabels(["Weak chaos", "Strong chaos"])
    ax.set_ylabel("rate [nats / time]")
    ax.set_title("Entropy-growth rate vs local chaos indicators")
    ax.grid(alpha=0.22, linestyle="--", linewidth=0.7)
    ax.legend(loc="upper left", fontsize=10, frameon=True)

    ratio_text = "n/a" if not np.isfinite(summary["slope_ratio_strong_to_weak"]) else f"{summary['slope_ratio_strong_to_weak']:.2f}"
    ax.text(
        0.5,
        0.97,
        (
            f"strong > weak slope: {summary['strong_faster_than_weak']}\n"
            f"strong/weak slope ratio: {ratio_text}"
        ),
        transform=ax.transAxes,
        ha="center",
        va="top",
        fontsize=10,
        bbox={"facecolor": "white", "alpha": 0.86, "edgecolor": "#d1d5db"},
    )

    fig.savefig(output_path, dpi=180)
    plt.close(fig)


def main():
    base_dir = Path(__file__).resolve().parent
    records_path = base_dir / "double_pendulum_chaos_complexity.csv"
    entropy_path = base_dir / "double_pendulum_entropy_production.csv"
    output_path = base_dir / "double_pendulum_entropy_growth_rate.png"

    records = read_records_csv(records_path)
    entropy_curves = read_entropy_csv(entropy_path)
    results, summary = build_entropy_growth_results(records, entropy_curves)
    plot_entropy_growth_rate_only(results, summary, output_path)
    print(f"Saved entropy-growth plot: {output_path}")


if __name__ == "__main__":
    main()
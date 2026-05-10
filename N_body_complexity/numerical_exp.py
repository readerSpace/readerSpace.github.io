# n_body_extra_analysis.py
# PyTorch-based extra diagnostics for N-body chaos / complexity experiments

import os
import math
import numpy as np
import pandas as pd
import torch
import matplotlib.pyplot as plt
import networkx as nx
from pathlib import Path

import main as experiment_main

BASE_DIR = Path(__file__).resolve().parent
DEVICE = experiment_main.select_device("auto")
OUTDIR = BASE_DIR / "extra_analysis_outputs"
OUTDIR.mkdir(parents=True, exist_ok=True)
TRAJECTORY_CACHE_PATH = BASE_DIR / "trajectories.pt"
OTOC_DISTANCE_CACHE_PATH = BASE_DIR / "otoc_distance.pt"
OTOC_MEAN_CACHE_PATH = BASE_DIR / "otoc_mean.pt"
DISTANCE_CENTERS_PATH = BASE_DIR / "distance_centers.npy"
OTOC_TIMES_PATH = BASE_DIR / "otoc_times.npy"
FINITE_LAMBDA_CACHE_PATH = BASE_DIR / "finite_lambda.pt"
LYAPUNOV_SPECTRA_CACHE_PATH = BASE_DIR / "lyapunov_spectra.pt"
ANALYSIS_SAMPLE_STRIDE = 4


# ============================================================
# Utility
# ============================================================

def to_torch(x):
    if isinstance(x, torch.Tensor):
        return x.to(device=DEVICE, dtype=torch.float32)
    return torch.tensor(x, device=DEVICE, dtype=torch.float32)


def to_numpy(x):
    if isinstance(x, torch.Tensor):
        return x.detach().cpu().numpy()
    return np.asarray(x)


def shannon_entropy_from_labels(labels, eps=1e-12):
    labels = labels.flatten()
    unique, counts = torch.unique(labels, return_counts=True)
    p = counts.float() / counts.sum()
    return -(p * torch.log2(p + eps)).sum()


def coarse_labels(x, bins=16):
    """
    x: [T, dim] or [N, dim]
    return integer cell labels.
    """
    x = to_torch(x)
    xmin = x.min(dim=0).values
    xmax = x.max(dim=0).values
    z = (x - xmin) / (xmax - xmin + 1e-12)
    q = torch.clamp((z * bins).long(), 0, bins - 1)

    dim = q.shape[-1]
    powers = (bins ** torch.arange(dim, device=DEVICE)).long()
    labels = (q * powers).sum(dim=-1)
    return labels


def lz_complexity_binary(seq):
    """
    Simple Lempel-Ziv complexity for binary/int sequence.
    """
    s = ''.join(map(str, seq))
    i, k, l = 0, 1, 1
    c = 1
    n = len(s)
    while True:
        if i + k >= n or l + k >= n:
            c += 1
            break
        if s[i:i+k] == s[l:l+k]:
            k += 1
        else:
            i += 1
            if i == l:
                c += 1
                l += k
                if l >= n:
                    break
                i, k = 0, 1
            else:
                k = 1
    return c / max(n, 1)


def mutual_information_discrete(x, y, bins=16, eps=1e-12):
    lx = coarse_labels(x[:, None] if x.ndim == 1 else x, bins)
    ly = coarse_labels(y[:, None] if y.ndim == 1 else y, bins)

    xy = lx * (ly.max() + 1) + ly

    hx = shannon_entropy_from_labels(lx, eps)
    hy = shannon_entropy_from_labels(ly, eps)
    hxy = shannon_entropy_from_labels(xy, eps)
    return hx + hy - hxy


def build_experiment_context():
    config = experiment_main.make_config(quick=False)
    system = experiment_main.PlanarNBodySystem(config.masses, device=DEVICE, softening=config.softening)
    return config, system


def center_state_batch(state_batch, masses):
    positions = state_batch[:, :, :2]
    velocities = state_batch[:, :, 2:]
    weights = masses[None, :, None]
    total_mass = torch.sum(masses)
    center_of_mass = torch.sum(positions * weights, dim=1, keepdim=True) / total_mass
    center_velocity = torch.sum(velocities * weights, dim=1, keepdim=True) / total_mass
    centered = state_batch.clone()
    centered[:, :, :2] = positions - center_of_mass
    centered[:, :, 2:] = velocities - center_velocity
    return centered


def records_from_dataframe(df):
    return df.to_dict("records")


def build_initial_states(df, config):
    states = []
    for record in records_from_dataframe(df):
        states.append(
            experiment_main.build_three_body_initial_state(
                config,
                outer_radius=record["outer_radius_0"],
                outer_speed_scale=record["outer_speed_scale_0"],
                outer_phase=record["outer_phase_0"],
            )
        )
    return np.asarray(states, dtype=float)


@torch.no_grad()
def build_trajectories(df, config, system, sample_stride=ANALYSIS_SAMPLE_STRIDE):
    initial_states = build_initial_states(df, config)
    states = torch.as_tensor(initial_states, dtype=system.dtype, device=DEVICE)
    snapshots = []

    for step in range(int(config.flow_steps)):
        states = system.rk4_step(states, config.dt)
        if step >= config.flow_discard and (step - config.flow_discard) % int(sample_stride) == 0:
            state_view = states.reshape(states.shape[0], system.body_count, 4)
            centered = center_state_batch(state_view, system.masses)
            snapshots.append(centered.detach().cpu().to(dtype=torch.float32))

    return torch.stack(snapshots, dim=1)


def build_spectra(df):
    spectrum_columns = sorted(
        [column for column in df.columns if column.startswith("Lyapunov_") and column.split("_")[1].isdigit()],
        key=lambda column: int(column.split("_")[1]),
    )
    return torch.tensor(df[spectrum_columns].to_numpy(), device=DEVICE, dtype=torch.float32)


def bin_otoc_by_distance(trial, distance_edges):
    pair_distances = np.asarray(trial["pair_distances"], dtype=float)
    pair_otoc = np.asarray(trial["pair_otoc"], dtype=float)
    curves = []
    for bin_index in range(len(distance_edges) - 1):
        low = float(distance_edges[bin_index])
        high = float(distance_edges[bin_index + 1])
        selected = []
        for target_body in range(pair_distances.shape[0]):
            for source_body in range(pair_distances.shape[1]):
                if target_body == source_body:
                    continue
                distance_value = float(pair_distances[target_body, source_body])
                in_bin = (low <= distance_value < high) or (
                    bin_index == len(distance_edges) - 2 and low <= distance_value <= high
                )
                if in_bin:
                    selected.append(pair_otoc[:, target_body, source_body])

        if selected:
            curves.append(np.mean(np.stack(selected, axis=0), axis=0))
        else:
            curves.append(np.full(pair_otoc.shape[0], np.nan, dtype=float))

    return np.stack(curves, axis=0)


def build_otoc_artifacts(df, config, system):
    trials = []
    for record in records_from_dataframe(df):
        initial_state = experiment_main.build_three_body_initial_state(
            config,
            outer_radius=record["outer_radius_0"],
            outer_speed_scale=record["outer_speed_scale_0"],
            outer_phase=record["outer_phase_0"],
        )
        center_state = experiment_main.advance_state(system, initial_state, dt=config.dt, steps=config.otoc_settle_steps)
        trial = experiment_main.simulate_otoc_finite_difference(
            system,
            center_state,
            dt=config.dt,
            steps=config.otoc_steps,
            sample_interval=config.otoc_sample_interval,
            eps=config.otoc_eps,
        )
        trials.append(trial)

    distance_edges = experiment_main.build_otoc_distance_edges({"all_runs": trials}, bin_count=config.otoc_distance_bin_count)
    distance_centers = 0.5 * (distance_edges[:-1] + distance_edges[1:])
    otoc_distance = np.stack([bin_otoc_by_distance(trial, distance_edges) for trial in trials], axis=0)
    finite_lambda = np.stack([np.asarray(trial["finite_time_lyapunov"], dtype=float) for trial in trials], axis=0)
    otoc_mean = np.stack([np.asarray(trial["average_cross_otoc"], dtype=float) for trial in trials], axis=0)
    otoc_times = np.asarray(trials[0]["times"], dtype=float)
    return otoc_distance, otoc_mean, distance_centers, otoc_times, finite_lambda


# ============================================================
# Load data
# ============================================================

def load_data():
    """
    Modify this section to match your actual filenames.
    Required:
      trajectories: [n_runs, T, n_bodies, 4]
      classes: weak/strong/intermediate labels
      lambda1: [n_runs]
      h_ks: [n_runs]
      compression: [n_runs]
    Optional:
      otoc_distance: [n_runs, n_distance_bins, T]
      finite_lambda: [n_runs, T]
    """

    df = pd.read_csv(BASE_DIR / "n_body_chaos_complexity.csv")
    config, system = build_experiment_context()

    if TRAJECTORY_CACHE_PATH.exists():
        cached = torch.load(TRAJECTORY_CACHE_PATH, map_location=DEVICE)
        trajectories = cached["trajectories"] if isinstance(cached, dict) else cached
        trajectories = trajectories.to(device=DEVICE, dtype=torch.float32)
    else:
        trajectories = build_trajectories(df, config, system)
        torch.save({"trajectories": trajectories.cpu(), "sample_stride": ANALYSIS_SAMPLE_STRIDE}, TRAJECTORY_CACHE_PATH)

    if LYAPUNOV_SPECTRA_CACHE_PATH.exists():
        spectra = torch.load(LYAPUNOV_SPECTRA_CACHE_PATH, map_location=DEVICE).to(dtype=torch.float32)
    else:
        spectra = build_spectra(df)
        torch.save(spectra.cpu(), LYAPUNOV_SPECTRA_CACHE_PATH)

    have_otoc_cache = (
        OTOC_DISTANCE_CACHE_PATH.exists()
        and OTOC_MEAN_CACHE_PATH.exists()
        and DISTANCE_CENTERS_PATH.exists()
        and OTOC_TIMES_PATH.exists()
        and FINITE_LAMBDA_CACHE_PATH.exists()
    )
    if have_otoc_cache:
        otoc_distance = torch.load(OTOC_DISTANCE_CACHE_PATH, map_location=DEVICE).to(dtype=torch.float32)
        otoc_mean = torch.load(OTOC_MEAN_CACHE_PATH, map_location=DEVICE).to(dtype=torch.float32)
        finite_lambda = torch.load(FINITE_LAMBDA_CACHE_PATH, map_location=DEVICE).to(dtype=torch.float32)
        distance_centers = np.load(DISTANCE_CENTERS_PATH)
        otoc_times = np.load(OTOC_TIMES_PATH)
    else:
        otoc_distance_np, otoc_mean_np, distance_centers, otoc_times, finite_lambda_np = build_otoc_artifacts(df, config, system)
        otoc_distance = torch.tensor(otoc_distance_np, device=DEVICE, dtype=torch.float32)
        otoc_mean = torch.tensor(otoc_mean_np, device=DEVICE, dtype=torch.float32)
        finite_lambda = torch.tensor(finite_lambda_np, device=DEVICE, dtype=torch.float32)
        torch.save(otoc_distance.cpu(), OTOC_DISTANCE_CACHE_PATH)
        torch.save(otoc_mean.cpu(), OTOC_MEAN_CACHE_PATH)
        torch.save(finite_lambda.cpu(), FINITE_LAMBDA_CACHE_PATH)
        np.save(DISTANCE_CENTERS_PATH, distance_centers)
        np.save(OTOC_TIMES_PATH, otoc_times)

    data = {
        "df": df,
        "trajectories": trajectories,
        "classes": df["chaos_region"].to_numpy(),
        "lambda1": to_torch(df["Lyapunov_exponent"].to_numpy()),
        "h_ks": to_torch(df["KS_entropy_Pesin"].to_numpy()),
        "compression": to_torch(df["LZMA_ratio"].to_numpy()),
        "otoc_distance": otoc_distance,
        "otoc_mean": otoc_mean,
        "distance_centers": distance_centers,
        "otoc_times": otoc_times,
        "finite_lambda": finite_lambda,
        "spectra": spectra,
        "sample_dt": config.dt * ANALYSIS_SAMPLE_STRIDE,
    }
    return data


# ============================================================
# A. Scrambling time and butterfly front
# ============================================================

def plot_scrambling_time_from_otoc(otoc_distance, distance_centers, threshold=1e3, tag="", time_axis=None):
    """
    otoc_distance: [n_runs, n_r_bins, T]
    distance_centers: [n_r_bins]
    """
    C = np.asarray(to_numpy(otoc_distance), dtype=float)
    n_runs, n_r, T = C.shape
    if time_axis is None:
        time_axis = np.arange(T, dtype=float)
    else:
        time_axis = np.asarray(time_axis, dtype=float)

    tstars = np.full((n_runs, n_r), np.nan, dtype=float)

    for run_index in range(n_runs):
        for distance_index in range(n_r):
            hit = np.where(C[run_index, distance_index] >= threshold)[0]
            if len(hit) > 0:
                tstars[run_index, distance_index] = time_axis[hit[0]]

    mean_t = np.nanmean(tstars, axis=0)
    std_t = np.nanstd(tstars, axis=0)

    r = np.asarray(distance_centers)

    plt.figure(figsize=(7, 5))
    plt.errorbar(r, mean_t, yerr=std_t, marker="o", capsize=4)
    plt.xlabel("distance r")
    plt.ylabel(r"scrambling time $t_*(r)$")
    plt.title(rf"Butterfly front: $C(t_*)={threshold}$ {tag}")
    plt.grid(True, alpha=0.3)
    plt.tight_layout()
    plt.savefig(OUTDIR / f"butterfly_front_{tag}.png", dpi=180)
    plt.close()

    return tstars


# ============================================================
# C. Intermittency: finite-time Lyapunov burst distribution
# ============================================================

def plot_finite_time_lambda_bursts(finite_lambda, classes, threshold_quantile=0.9):
    """
    finite_lambda: [n_runs, T]
    """
    L = to_torch(finite_lambda)

    plt.figure(figsize=(8, 5))

    for cls in sorted(set(classes)):
        idx = np.where(classes == cls)[0]
        if len(idx) == 0:
            continue

        vals = L[idx].flatten()
        vals = vals[torch.isfinite(vals)]
        plt.hist(vals.detach().cpu().numpy(), bins=60, alpha=0.45, density=True, label=cls)

    plt.xlabel(r"finite-time $\lambda(t)$")
    plt.ylabel("density")
    plt.title("Intermittency: finite-time Lyapunov burst distribution")
    plt.legend()
    plt.grid(True, alpha=0.3)
    plt.tight_layout()
    plt.savefig(f"{OUTDIR}/finite_time_lambda_burst_distribution.png", dpi=180)
    plt.close()

    # burst count per run
    q = torch.quantile(L[torch.isfinite(L)], threshold_quantile)
    burst_counts = (L > q).sum(dim=1).detach().cpu().numpy()

    plt.figure(figsize=(7, 5))
    for cls in sorted(set(classes)):
        idx = np.where(classes == cls)[0]
        plt.scatter(idx, burst_counts[idx], label=cls)
    plt.xlabel("run id")
    plt.ylabel("burst count")
    plt.title(f"Lyapunov burst count above q={threshold_quantile}")
    plt.legend()
    plt.grid(True, alpha=0.3)
    plt.tight_layout()
    plt.savefig(f"{OUTDIR}/finite_time_lambda_burst_counts.png", dpi=180)
    plt.close()

    return burst_counts


# ============================================================
# D. Recurrence vs OTOC
# ============================================================

def recurrence_times(state, eps=0.05, max_lag=500):
    """
    state: [T, dim]
    return recurrence lag list.
    """
    X = to_torch(state)
    T = X.shape[0]
    rec = []

    for lag in range(1, min(max_lag, T)):
        d = torch.norm(X[lag:] - X[:-lag], dim=-1)
        if torch.any(d < eps):
            rec.append(lag)

    return np.array(rec)


def plot_recurrence_vs_otoc(trajectories, otoc_mean, classes, eps=0.05):
    """
    trajectories: [n_runs,T,n_bodies,4]
    otoc_mean: [n_runs,T] or [n_runs]
    """
    X = to_torch(trajectories)
    n_runs = X.shape[0]

    rec_median = []
    for i in range(n_runs):
        # reduced phase space using two planets theta, omega approx
        state = X[i, :, 1:, :].reshape(X.shape[1], -1)
        rec = recurrence_times(state, eps=eps)
        rec_median.append(np.nan if len(rec) == 0 else np.median(rec))

    rec_median = np.array(rec_median)

    O = to_torch(otoc_mean)
    if O.ndim == 2:
        Oscore = torch.log10(O[:, -1] + 1e-12).detach().cpu().numpy()
    else:
        Oscore = torch.log10(O + 1e-12).detach().cpu().numpy()

    plt.figure(figsize=(7, 5))
    for cls in sorted(set(classes)):
        idx = np.where(classes == cls)[0]
        plt.scatter(rec_median[idx], Oscore[idx], label=cls, alpha=0.8)

    plt.xlabel("median recurrence time")
    plt.ylabel(r"log final OTOC")
    plt.title("Recurrence vs OTOC")
    plt.legend()
    plt.grid(True, alpha=0.3)
    plt.tight_layout()
    plt.savefig(f"{OUTDIR}/recurrence_vs_otoc.png", dpi=180)
    plt.close()


# ============================================================
# Multi-scale entropy
# ============================================================

def plot_multiscale_entropy(trajectories, classes, bins_list=(4, 8, 16, 32, 64, 128)):
    X = to_torch(trajectories)
    n_runs, T = X.shape[:2]

    ent = torch.zeros((n_runs, len(bins_list)), device=DEVICE)

    for i in range(n_runs):
        state = X[i, :, 1:, :].reshape(T, -1)
        for j, b in enumerate(bins_list):
            labels = coarse_labels(state, bins=b)
            ent[i, j] = shannon_entropy_from_labels(labels) / math.log2(max(T, 2))

    plt.figure(figsize=(8, 5))
    for cls in sorted(set(classes)):
        idx = np.where(classes == cls)[0]
        mean = ent[idx].mean(0).detach().cpu().numpy()
        std = ent[idx].std(0).detach().cpu().numpy()
        plt.plot(bins_list, mean, marker="o", label=cls)
        plt.fill_between(bins_list, mean - std, mean + std, alpha=0.15)

    plt.xscale("log", base=2)
    plt.xlabel("coarse-graining bins")
    plt.ylabel("normalized entropy")
    plt.title("Multi-scale entropy")
    plt.legend()
    plt.grid(True, alpha=0.3)
    plt.tight_layout()
    plt.savefig(f"{OUTDIR}/multiscale_entropy.png", dpi=180)
    plt.close()

    return ent.detach().cpu().numpy()


# ============================================================
# Symbolic partition optimization
# ============================================================

def plot_partition_robustness(trajectories, classes, bins_list=(4, 8, 16, 32, 64), dims_list=(1, 2, 4, 8)):
    X = to_torch(trajectories)
    n_runs, T = X.shape[:2]

    scores = {}

    for d in dims_list:
        vals = torch.zeros((n_runs, len(bins_list)), device=DEVICE)
        for i in range(n_runs):
            state = X[i, :, 1:, :].reshape(T, -1)
            state = state[:, :min(d, state.shape[1])]

            for j, b in enumerate(bins_list):
                labels = coarse_labels(state, bins=b)
                seq = labels.detach().cpu().numpy().astype(int)
                vals[i, j] = lz_complexity_binary(seq % 2)

        scores[d] = vals.detach().cpu().numpy()

    plt.figure(figsize=(8, 5))
    for d, vals in scores.items():
        weak = vals[np.array(classes) == "weak_chao s"] if False else None
        mean = np.nanmean(vals, axis=0)
        plt.plot(bins_list, mean, marker="o", label=f"dim={d}")

    plt.xscale("log", base=2)
    plt.xlabel("bins")
    plt.ylabel("mean symbolic LZ complexity")
    plt.title("Symbolic partition robustness")
    plt.legend()
    plt.grid(True, alpha=0.3)
    plt.tight_layout()
    plt.savefig(f"{OUTDIR}/symbolic_partition_robustness.png", dpi=180)
    plt.close()

    return scores


# ============================================================
# Fractal dimension vs compression
# ============================================================

def box_counting_dimension(points, bins_list=(4, 8, 16, 32, 64)):
    X = to_torch(points)
    counts = []

    for b in bins_list:
        labels = coarse_labels(X, bins=b)
        counts.append(torch.unique(labels).numel())

    counts = np.array(counts, dtype=float)
    scales = np.array(bins_list, dtype=float)

    valid = counts > 0
    coeff = np.polyfit(np.log(scales[valid]), np.log(counts[valid]), 1)
    return coeff[0], counts


def plot_fractal_dimension_vs_compression(trajectories, compression, classes):
    X = to_torch(trajectories)
    compression = to_torch(compression).detach().cpu().numpy()

    dims = []
    for i in range(X.shape[0]):
        state = X[i, :, 1:, :].reshape(X.shape[1], -1)
        d, _ = box_counting_dimension(state)
        dims.append(d)

    dims = np.array(dims)

    plt.figure(figsize=(7, 5))
    for cls in sorted(set(classes)):
        idx = np.where(classes == cls)[0]
        plt.scatter(dims[idx], compression[idx], label=cls)

    plt.xlabel("box-counting dimension estimate")
    plt.ylabel("compression ratio")
    plt.title("Fractal dimension vs compression")
    plt.legend()
    plt.grid(True, alpha=0.3)
    plt.tight_layout()
    plt.savefig(f"{OUTDIR}/fractal_dimension_vs_compression.png", dpi=180)
    plt.close()


# ============================================================
# KS entropy vs compression
# ============================================================

def plot_ks_vs_compression(h_ks, compression, classes):
    h = to_torch(h_ks).detach().cpu().numpy()
    c = to_torch(compression).detach().cpu().numpy()

    plt.figure(figsize=(7, 5))
    for cls in sorted(set(classes)):
        idx = np.where(classes == cls)[0]
        plt.scatter(h[idx], c[idx], label=cls)

    r = np.corrcoef(h, c)[0, 1]
    plt.xlabel(r"$h_{KS}$")
    plt.ylabel("compression ratio")
    plt.title(rf"$h_{{KS}}$ vs compression, r={r:.3f}")
    plt.legend()
    plt.grid(True, alpha=0.3)
    plt.tight_layout()
    plt.savefig(f"{OUTDIR}/ks_vs_compression.png", dpi=180)
    plt.close()


# ============================================================
# Predictive information / AIS
# ============================================================

def predictive_information(series, past=8, future=8, bins=8):
    """
    series: [T] or [T,dim]
    I(past; future)
    """
    X = to_torch(series)
    if X.ndim == 1:
        X = X[:, None]

    T = X.shape[0]
    n = T - past - future
    if n <= 5:
        return torch.tensor(float("nan"), device=DEVICE)

    P = torch.stack([X[i:i+past].flatten() for i in range(n)])
    F = torch.stack([X[i+past:i+past+future].flatten() for i in range(n)])

    return mutual_information_discrete(P, F, bins=bins)


def plot_predictive_information(trajectories, classes, past_list=(2, 4, 8, 16), future=8):
    X = to_torch(trajectories)
    n_runs = X.shape[0]

    PI = torch.zeros((n_runs, len(past_list)), device=DEVICE)

    for i in range(n_runs):
        # use radius of outer planet as scalar observable
        pos = X[i, :, 2, :2]
        r = torch.norm(pos, dim=-1)

        for j, p in enumerate(past_list):
            PI[i, j] = predictive_information(r, past=p, future=future, bins=8)

    plt.figure(figsize=(8, 5))
    for cls in sorted(set(classes)):
        idx = np.where(classes == cls)[0]
        mean = torch.nanmean(PI[idx], dim=0).detach().cpu().numpy()
        plt.plot(past_list, mean, marker="o", label=cls)

    plt.xlabel("past window")
    plt.ylabel(r"$I(\mathrm{past};\mathrm{future})$")
    plt.title("Predictive information / AIS")
    plt.legend()
    plt.grid(True, alpha=0.3)
    plt.tight_layout()
    plt.savefig(f"{OUTDIR}/predictive_information_AIS.png", dpi=180)
    plt.close()

    return PI.detach().cpu().numpy()


# ============================================================
# Diffusion coefficient
# ============================================================

def plot_diffusion_coefficient(trajectories, classes, dt=1.0):
    X = to_torch(trajectories)
    n_runs, T = X.shape[:2]

    Dvals = []
    for i in range(n_runs):
        pos = X[i, :, 1:, :2].reshape(T, -1)
        disp2 = torch.mean((pos - pos[0]) ** 2, dim=1)
        t = torch.arange(T, device=DEVICE).float() * dt
        start = T // 3
        slope = torch.polyfit if False else None
        coeff = np.polyfit(t[start:].detach().cpu().numpy(), disp2[start:].detach().cpu().numpy(), 1)
        Dvals.append(coeff[0] / 2)

    Dvals = np.array(Dvals)

    plt.figure(figsize=(7, 5))
    for cls in sorted(set(classes)):
        idx = np.where(classes == cls)[0]
        plt.scatter(idx, Dvals[idx], label=cls)

    plt.xlabel("run id")
    plt.ylabel("diffusion coefficient estimate")
    plt.title("Diffusion coefficient")
    plt.legend()
    plt.grid(True, alpha=0.3)
    plt.tight_layout()
    plt.savefig(f"{OUTDIR}/diffusion_coefficient.png", dpi=180)
    plt.close()

    return Dvals


# ============================================================
# Recurrence time distribution
# ============================================================

def plot_recurrence_distribution(trajectories, classes, eps=0.05):
    X = to_torch(trajectories)

    plt.figure(figsize=(8, 5))
    for cls in sorted(set(classes)):
        all_rec = []
        idxs = np.where(classes == cls)[0]
        for i in idxs:
            state = X[i, :, 1:, :].reshape(X.shape[1], -1)
            rec = recurrence_times(state, eps=eps)
            all_rec.extend(rec.tolist())

        if len(all_rec) > 0:
            plt.hist(all_rec, bins=50, alpha=0.45, density=True, label=cls)

    plt.xlabel("recurrence time")
    plt.ylabel("density")
    plt.title("Poincaré recurrence time distribution")
    plt.legend()
    plt.grid(True, alpha=0.3)
    plt.tight_layout()
    plt.savefig(f"{OUTDIR}/recurrence_time_distribution.png", dpi=180)
    plt.close()


# ============================================================
# Finite-time entropy production burst
# ============================================================

def plot_entropy_production_bursts(trajectories, classes, bins=32):
    X = to_torch(trajectories)
    n_runs, T = X.shape[:2]

    burst_series = []
    for i in range(n_runs):
        state = X[i, :, 1:, :].reshape(T, -1)
        labels = coarse_labels(state, bins=bins)

        Ht = []
        for t in range(5, T):
            Ht.append(shannon_entropy_from_labels(labels[:t]).item())
        Ht = np.array(Ht)
        dH = np.diff(Ht)
        burst_series.append(dH)

    plt.figure(figsize=(8, 5))
    for cls in sorted(set(classes)):
        vals = []
        idx = np.where(classes == cls)[0]
        for i in idx:
            vals.extend(burst_series[i])
        plt.hist(vals, bins=50, alpha=0.45, density=True, label=cls)

    plt.xlabel(r"$\Delta S(t)$")
    plt.ylabel("density")
    plt.title("Finite-time entropy production bursts")
    plt.legend()
    plt.grid(True, alpha=0.3)
    plt.tight_layout()
    plt.savefig(f"{OUTDIR}/entropy_production_bursts.png", dpi=180)
    plt.close()


# ============================================================
# Fractal dimension growth
# ============================================================

def plot_fractal_dimension_growth(trajectories, classes, bins_list=(4, 8, 16, 32), windows=(20, 40, 80, 120)):
    X = to_torch(trajectories)
    n_runs, T = X.shape[:2]

    Dgrowth = torch.full((n_runs, len(windows)), float("nan"), device=DEVICE)

    for i in range(n_runs):
        state = X[i, :, 1:, :].reshape(T, -1)
        for j, w in enumerate(windows):
            if w < T:
                d, _ = box_counting_dimension(state[:w], bins_list=bins_list)
                Dgrowth[i, j] = d

    plt.figure(figsize=(8, 5))
    for cls in sorted(set(classes)):
        idx = np.where(classes == cls)[0]
        mean = torch.nanmean(Dgrowth[idx], dim=0).detach().cpu().numpy()
        plt.plot(windows, mean, marker="o", label=cls)

    plt.xlabel("time window")
    plt.ylabel("box-counting dimension")
    plt.title("Fractal dimension growth")
    plt.legend()
    plt.grid(True, alpha=0.3)
    plt.tight_layout()
    plt.savefig(f"{OUTDIR}/fractal_dimension_growth.png", dpi=180)
    plt.close()


# ============================================================
# Transport network: cell transition graph
# ============================================================

def plot_transport_network(trajectory, bins=16, max_edges=80, filename="transport_network.png"):
    """
    single trajectory: [T,n_bodies,4]
    """
    X = to_torch(trajectory)
    T = X.shape[0]
    state = X[:, 1:, :].reshape(T, -1)
    labels = coarse_labels(state, bins=bins).detach().cpu().numpy()

    edges = {}
    for a, b in zip(labels[:-1], labels[1:]):
        if a == b:
            continue
        edges[(int(a), int(b))] = edges.get((int(a), int(b)), 0) + 1

    edges_sorted = sorted(edges.items(), key=lambda kv: kv[1], reverse=True)[:max_edges]

    G = nx.DiGraph()
    for (a, b), w in edges_sorted:
        G.add_edge(a, b, weight=w)

    plt.figure(figsize=(8, 7))
    pos = nx.spring_layout(G, seed=0)
    widths = [0.5 + 3.0 * G[u][v]["weight"] / max(1, max(edges.values())) for u, v in G.edges]
    nx.draw_networkx_nodes(G, pos, node_size=80)
    nx.draw_networkx_edges(G, pos, width=widths, alpha=0.55, arrows=True)
    plt.title("Transport network: coarse cell transitions")
    plt.axis("off")
    plt.tight_layout()
    plt.savefig(f"{OUTDIR}/{filename}", dpi=180)
    plt.close()


# ============================================================
# TE network and causal graph reconstruction
# ============================================================

def transfer_entropy_discrete(x, y, bins=8):
    """
    TE x -> y:
    I(y_future ; x_past | y_past)
    Simple plug-in estimator.
    """
    x = to_torch(x).flatten()
    y = to_torch(y).flatten()

    xp = x[:-1]
    yp = y[:-1]
    yf = y[1:]

    lx = coarse_labels(xp[:, None], bins)
    ly = coarse_labels(yp[:, None], bins)
    lf = coarse_labels(yf[:, None], bins)

    base = bins + 1
    a = lf * base + ly
    b = ly
    c = lf * base * base + ly * base + lx
    d = ly * base + lx

    return shannon_entropy_from_labels(a) + shannon_entropy_from_labels(d) - shannon_entropy_from_labels(c) - shannon_entropy_from_labels(b)


def plot_te_network(trajectory, bins=8):
    """
    trajectory: [T,n_bodies,4]
    Uses radial distance of each body.
    """
    X = to_torch(trajectory)
    T, n_bodies = X.shape[:2]
    radii = torch.norm(X[:, :, :2], dim=-1)

    TE = np.zeros((n_bodies, n_bodies))
    for i in range(n_bodies):
        for j in range(n_bodies):
            if i != j:
                TE[i, j] = transfer_entropy_discrete(radii[:, i], radii[:, j], bins=bins).item()

    G = nx.DiGraph()
    for i in range(n_bodies):
        G.add_node(i)

    threshold = np.percentile(TE[TE > 0], 60) if np.any(TE > 0) else 0
    for i in range(n_bodies):
        for j in range(n_bodies):
            if i != j and TE[i, j] > threshold:
                G.add_edge(i, j, weight=TE[i, j])

    plt.figure(figsize=(6, 5))
    pos = nx.circular_layout(G)
    widths = [1 + 5 * G[u][v]["weight"] / (TE.max() + 1e-12) for u, v in G.edges]
    nx.draw(G, pos, with_labels=True, node_size=800, width=widths, arrows=True)
    plt.title("TE causal graph reconstruction")
    plt.tight_layout()
    plt.savefig(f"{OUTDIR}/te_network.png", dpi=180)
    plt.close()

    return TE


# ============================================================
# Edge-of-chaos scan: Lyapunov vs TE / complexity
# ============================================================

def plot_edge_of_chaos(lambda1, te_score=None, compression=None, classes=None):
    lam = to_torch(lambda1).detach().cpu().numpy()

    if te_score is not None:
        y = to_torch(te_score).detach().cpu().numpy()
        ylabel = "TE score"
        fname = "edge_of_chaos_lambda_vs_TE.png"
    else:
        y = to_torch(compression).detach().cpu().numpy()
        ylabel = "complexity / compression"
        fname = "edge_of_chaos_lambda_vs_complexity.png"

    plt.figure(figsize=(7, 5))
    if classes is None:
        plt.scatter(lam, y)
    else:
        for cls in sorted(set(classes)):
            idx = np.where(classes == cls)[0]
            plt.scatter(lam[idx], y[idx], label=cls)

    plt.xlabel(r"$\lambda_1$")
    plt.ylabel(ylabel)
    plt.title("Edge-of-chaos scan")
    if classes is not None:
        plt.legend()
    plt.grid(True, alpha=0.3)
    plt.tight_layout()
    plt.savefig(f"{OUTDIR}/{fname}", dpi=180)
    plt.close()


# ============================================================
# Full Lyapunov spectrum and Kaplan-Yorke dimension
# ============================================================

def kaplan_yorke_dimension(spectrum):
    """
    spectrum: [dim], sorted descending
    """
    lam = torch.sort(to_torch(spectrum), descending=True).values
    csum = torch.cumsum(lam, dim=0)

    positive = torch.where(csum >= 0)[0]
    if len(positive) == 0:
        return torch.tensor(0.0, device=DEVICE)

    j = positive[-1].item()
    if j + 1 >= len(lam):
        return torch.tensor(float(len(lam)), device=DEVICE)

    return j + 1 + csum[j] / torch.abs(lam[j + 1] + 1e-12)


def plot_full_spectrum_and_dky(spectra, classes):
    """
    spectra: [n_runs, dim]
    """
    S = to_torch(spectra)
    S_sorted = torch.sort(S, dim=1, descending=True).values
    Dky = torch.stack([kaplan_yorke_dimension(s) for s in S_sorted])

    plt.figure(figsize=(8, 5))
    for cls in sorted(set(classes)):
        idx = np.where(classes == cls)[0]
        mean = S_sorted[idx].mean(0).detach().cpu().numpy()
        plt.plot(mean, marker="o", label=cls)

    plt.axhline(0, ls="--", color="gray")
    plt.xlabel("spectrum index")
    plt.ylabel(r"$\lambda_i$")
    plt.title("Full Lyapunov spectrum")
    plt.legend()
    plt.grid(True, alpha=0.3)
    plt.tight_layout()
    plt.savefig(f"{OUTDIR}/full_lyapunov_spectrum.png", dpi=180)
    plt.close()

    plt.figure(figsize=(7, 5))
    for cls in sorted(set(classes)):
        idx = np.where(classes == cls)[0]
        plt.scatter(idx, Dky[idx].detach().cpu().numpy(), label=cls)
    plt.xlabel("run id")
    plt.ylabel(r"$D_{KY}$")
    plt.title("Kaplan-Yorke dimension")
    plt.legend()
    plt.grid(True, alpha=0.3)
    plt.tight_layout()
    plt.savefig(f"{OUTDIR}/kaplan_yorke_dimension.png", dpi=180)
    plt.close()

    return Dky.detach().cpu().numpy()


# ============================================================
# Symbolic KS entropy
# ============================================================

def plot_symbolic_ks_entropy(trajectories, classes, bins=16, block_lengths=(1, 2, 3, 4, 5)):
    X = to_torch(trajectories)
    n_runs, T = X.shape[:2]

    Hblock = torch.zeros((n_runs, len(block_lengths)), device=DEVICE)

    for i in range(n_runs):
        state = X[i, :, 1:, :].reshape(T, -1)
        labels = coarse_labels(state, bins=bins)

        for j, L in enumerate(block_lengths):
            if T <= L:
                Hblock[i, j] = float("nan")
                continue

            base = labels.max() + 1
            words = torch.zeros(T - L + 1, dtype=torch.long, device=DEVICE)
            for k in range(L):
                words += labels[k:T-L+1+k] * (base ** k)
            Hblock[i, j] = shannon_entropy_from_labels(words)

    # entropy rate estimate H(L+1)-H(L)
    rate = Hblock[:, 1:] - Hblock[:, :-1]

    plt.figure(figsize=(8, 5))
    for cls in sorted(set(classes)):
        idx = np.where(classes == cls)[0]
        mean = torch.nanmean(rate[idx], dim=0).detach().cpu().numpy()
        plt.plot(block_lengths[1:], mean, marker="o", label=cls)

    plt.xlabel("block length L")
    plt.ylabel(r"$H(L)-H(L-1)$")
    plt.title("Symbolic KS entropy estimate")
    plt.legend()
    plt.grid(True, alpha=0.3)
    plt.tight_layout()
    plt.savefig(f"{OUTDIR}/symbolic_ks_entropy.png", dpi=180)
    plt.close()


# ============================================================
# Local entropy production map: encounter-based
# ============================================================

def plot_local_entropy_production_map(trajectory, bins=32):
    """
    Marks where entropy production bursts occur in x-y plane.
    """
    X = to_torch(trajectory)
    T, n_bodies = X.shape[:2]

    state = X[:, 1:, :].reshape(T, -1)
    labels = coarse_labels(state, bins=bins)

    Ht = []
    for t in range(5, T):
        Ht.append(shannon_entropy_from_labels(labels[:t]).item())
    Ht = np.array(Ht)
    dH = np.diff(Ht)

    burst_t = np.where(dH > np.quantile(dH, 0.9))[0] + 6

    pos = X[:, :, :2].detach().cpu().numpy()

    plt.figure(figsize=(7, 7))
    for b in range(n_bodies):
        plt.plot(pos[:, b, 0], pos[:, b, 1], alpha=0.35, label=f"body {b}")

    for t in burst_t:
        plt.scatter(pos[t, :, 0], pos[t, :, 1], s=40)

    plt.xlabel("x")
    plt.ylabel("y")
    plt.title("Local entropy production map: burst encounters")
    plt.axis("equal")
    plt.grid(True, alpha=0.3)
    plt.legend()
    plt.tight_layout()
    plt.savefig(f"{OUTDIR}/local_entropy_production_map.png", dpi=180)
    plt.close()


# ============================================================
# Crutchfield-style statistical complexity, simplified
# ============================================================

def statistical_complexity_markov(labels):
    """
    Simplified statistical complexity:
    entropy of empirical causal states approximated by next-symbol distributions.
    """
    labels = np.asarray(labels, dtype=int)
    symbols = np.unique(labels)
    trans = {}

    for a, b in zip(labels[:-1], labels[1:]):
        if a not in trans:
            trans[a] = []
        trans[a].append(b)

    distributions = []
    weights = []

    for a in symbols:
        nxt = np.array(trans.get(a, []), dtype=int)
        if len(nxt) == 0:
            continue
        counts = np.array([np.sum(nxt == s) for s in symbols], dtype=float)
        p = counts / counts.sum()
        distributions.append(np.round(p, 2).tobytes())
        weights.append(len(nxt))

    _, inv = np.unique(distributions, return_inverse=True)
    weights = np.asarray(weights, dtype=float)

    state_weights = np.zeros(inv.max() + 1)
    for k, w in zip(inv, weights):
        state_weights[k] += w

    p = state_weights / state_weights.sum()
    return -(p * np.log2(p + 1e-12)).sum()


def plot_statistical_complexity(trajectories, classes, bins=16):
    X = to_torch(trajectories)
    n_runs, T = X.shape[:2]

    Cmu = []
    for i in range(n_runs):
        state = X[i, :, 1:, :].reshape(T, -1)
        labels = coarse_labels(state, bins=bins).detach().cpu().numpy()
        Cmu.append(statistical_complexity_markov(labels))

    Cmu = np.array(Cmu)

    plt.figure(figsize=(7, 5))
    for cls in sorted(set(classes)):
        idx = np.where(classes == cls)[0]
        plt.scatter(idx, Cmu[idx], label=cls)

    plt.xlabel("run id")
    plt.ylabel(r"statistical complexity $C_\mu$")
    plt.title("Crutchfield-style statistical complexity")
    plt.legend()
    plt.grid(True, alpha=0.3)
    plt.tight_layout()
    plt.savefig(f"{OUTDIR}/statistical_complexity.png", dpi=180)
    plt.close()

    return Cmu


# ============================================================
# Causal emergence proxy
# ============================================================

def plot_causal_emergence_proxy(trajectories, classes, bins_micro=32, bins_macro=8):
    """
    Very simplified proxy:
    causal emergence score = TE_macro - TE_micro
    using radial observables.
    """
    X = to_torch(trajectories)
    n_runs = X.shape[0]

    scores = []
    for i in range(n_runs):
        radii = torch.norm(X[i, :, :, :2], dim=-1)

        # micro: body 1 -> body 2
        te_micro = transfer_entropy_discrete(radii[:, 1], radii[:, 2], bins=bins_micro)

        # macro: center-of-mass inner/outer grouping
        macro_a = radii[:, 1]
        macro_b = radii[:, 2]
        te_macro = transfer_entropy_discrete(macro_a, macro_b, bins=bins_macro)

        scores.append((te_macro - te_micro).item())

    scores = np.array(scores)

    plt.figure(figsize=(7, 5))
    for cls in sorted(set(classes)):
        idx = np.where(classes == cls)[0]
        plt.scatter(idx, scores[idx], label=cls)

    plt.axhline(0, ls="--", color="gray")
    plt.xlabel("run id")
    plt.ylabel("TE_macro - TE_micro")
    plt.title("Causal emergence proxy")
    plt.legend()
    plt.grid(True, alpha=0.3)
    plt.tight_layout()
    plt.savefig(f"{OUTDIR}/causal_emergence_proxy.png", dpi=180)
    plt.close()

    return scores


# ============================================================
# Main
# ============================================================

def main():
    data = load_data()
    df = data["df"]
    trajectories = data["trajectories"]
    classes = data["classes"]
    lambda1 = data["lambda1"]
    h_ks = data["h_ks"]
    compression = data["compression"]
    otoc_distance = data["otoc_distance"]
    otoc_mean = data["otoc_mean"]
    distance_centers = data["distance_centers"]
    otoc_times = data["otoc_times"]
    finite_lambda = data["finite_lambda"]
    spectra = data["spectra"]
    sample_dt = data["sample_dt"]

    plot_multiscale_entropy(trajectories, classes)
    plot_partition_robustness(trajectories, classes)

    if compression is not None:
        plot_fractal_dimension_vs_compression(trajectories, compression, classes)
        plot_edge_of_chaos(lambda1, compression=compression, classes=classes)

    if h_ks is not None and compression is not None:
        plot_ks_vs_compression(h_ks, compression, classes)

    plot_scrambling_time_from_otoc(
        otoc_distance,
        distance_centers,
        threshold=1e3,
        tag="all",
        time_axis=otoc_times,
    )
    plot_finite_time_lambda_bursts(finite_lambda, classes)
    plot_recurrence_vs_otoc(trajectories, otoc_mean, classes)
    plot_predictive_information(trajectories, classes)
    plot_diffusion_coefficient(trajectories, classes, dt=sample_dt)
    plot_recurrence_distribution(trajectories, classes)
    plot_entropy_production_bursts(trajectories, classes)
    plot_fractal_dimension_growth(trajectories, classes)

    plot_transport_network(trajectories[0], filename="transport_network_run0.png")
    plot_te_network(trajectories[0])
    plot_full_spectrum_and_dky(spectra, classes)
    plot_symbolic_ks_entropy(trajectories, classes)
    plot_local_entropy_production_map(trajectories[0])
    plot_statistical_complexity(trajectories, classes)
    plot_causal_emergence_proxy(trajectories, classes)

    print(f"Saved figures to: {OUTDIR}")


if __name__ == "__main__":
    main()

# 計測する量
# (A) scrambling time
# C(t∗)=CthresholdC(t_*) = C_{threshold}C(t∗​)=Cthreshold​
# を距離ごとに測る。

# (B) butterfly front
# t∗(r)t_*(r)t∗​(r)
# を測る。
# weakではfrontが出るかも。

# (C) intermittency解析
# finite-time λ の burst 分布。

# (D) recurrence vs OTOC
# Poincaré recurrence と相関。

# (A) multi-scale entropy
# スケールごと entropy。

# (B) symbolic partition optimization
# partition変えたときの頑健性。

# (C) fractal dimension vs compression
# かなり関係する。

# (D) KS entropyとの比較
# hKS↔compression rateh_{KS} \leftrightarrow \text{compression rate}hKS​↔compression rate
# (E) predictive information
# Ipast:futureI_{\text{past:future}}Ipast:future​
# chaos と noise の差が出やすい。

# (A) diffusion coefficient
# D=lim⁡t→∞⟨(Δx)2⟩2tD = \lim_{t\to\infty} \frac{\langle (\Delta x)^2\rangle}{2t}D=t→∞lim​2t⟨(Δx)2⟩​
# (B) recurrence time distribution
# sticky chaos を見れる。

# (C) finite-time entropy production
# burst統計。

# (D) fractal dimension growth
# occupied manifold の次元。

# (E) transport network
# セル遷移グラフ。

# (A) active information storage
# AIS=I(Xpast;Xfuture)AIS = I(X_{past};X_{future})AIS=I(Xpast​;Xfuture​)
# (B) predictive information
# I(past;future)I(past;future)I(past;future)
# (C) integrated information
# Φ\PhiΦ
# (D) causal graph reconstruction
# TE network。

# (E) edge-of-chaos scan
# Lyapunov vs TE。

# (A) full Lyapunov spectrum
# λ1,λ2,…\lambda_1,\lambda_2,\dotsλ1​,λ2​,…
# (B) Kaplan–Yorke dimension
# DKYD_{KY}DKY​
# (C) symbolic KS entropy
# partitionベース。

# (D) finite-time KS fluctuation
# burst解析。

# (E) local entropy production map
# どの encounter が entropy 作るか。

# (A) edge-of-chaos curve
# C(λ)C(\lambda)C(λ)
# を高分解能で測る。

# (B) complexity peak 探索
# 中程度 λ で最大化するか。

# (D) statistical complexity
# Crutchfield complexity。

# (E) causal emergence
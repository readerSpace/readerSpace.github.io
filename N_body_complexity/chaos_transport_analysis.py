"""
chaos_transport_analysis_pytorch.py
    activity = activity.float()
    finite_values = activity[torch.isfinite(activity)]
    if finite_values.numel() == 0:
        return AvalancheResult(float("nan"), 0, float("nan"), float("nan"), float("nan"), float("nan"), [], [])
    threshold = float(torch.quantile(finite_values, threshold_quantile).item())
    sanitized = torch.where(torch.isfinite(activity), activity, torch.full_like(activity, threshold - 1.0))
    sizes, durations = extract_avalanches(sanitized, threshold)

Implemented analyses:
1. Butterfly velocity v_B quantification
2. Transfer operator analysis: Koopman and Perron-Frobenius via Ulam/EDMD-style discretization
3. Transition matrix eigenvalues and mixing timescale
4. Persistent homology for transport topology, using ripser if installed
5. Avalanche scaling-law / power-law check
6. ε-machine reconstruction / causal state extraction from symbolic sequences
7. Graph entropy for transport networks
8. Transfer entropy network for causal transport channels
9. Community detection / metastable basin extraction
10. High-resolution edge-of-chaos scan for complexity peaks

Expected data format:
- trajectories: Tensor [n_runs, T, n_nodes, d] or [n_runs, T, d]
- perturbation_distance: Optional Tensor [n_runs, T, n_nodes] for butterfly front
- lambda_values: Optional Tensor [n_runs]

This script is modular: replace simulate_system(lambda_value, ...) with your own simulator,
or load saved tensors with --input path/to/data.pt.

Example:
    python chaos_transport_analysis_pytorch.py --input data.pt --out results

If data.pt contains:
    {
      "trajectories": torch.Tensor,
      "perturbation_distance": torch.Tensor,   # optional
      "lambda_values": torch.Tensor,           # optional
      "classes": list[str]                     # optional
    }
"""

from __future__ import annotations

import argparse
import json
import math
import os
import warnings
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Dict, List, Optional, Tuple, Any

import numpy as np
import pandas as pd
import torch
import torch.nn.functional as F

try:
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
except Exception:
    plt = None

try:
    from scipy import stats
    from scipy.sparse.csgraph import connected_components
except Exception:
    stats = None
    connected_components = None

try:
    import networkx as nx
except Exception:
    nx = None

try:
    from ripser import ripser
except Exception:
    ripser = None

import numerical_exp as ne


BASE_DIR = Path(__file__).resolve().parent
DEFAULT_OUTDIR = BASE_DIR / "chaos_transport_outputs"
CLASS_ORDER = ["weak_chaos", "intermediate", "strong_chaos"]
CLASS_COLORS = {
    "weak_chaos": "#3c7dc4",
    "intermediate": "#8a8f99",
    "strong_chaos": "#d05f3f",
}
EDGE_METRIC_SPECS = [
    ("predictive_information", "Predictive information"),
    ("statistical_complexity", "Statistical complexity"),
    ("te_total", "Total transfer entropy"),
    ("graph_entropy_node", "Graph entropy"),
]


# ============================================================
# Utility
# ============================================================


def ensure_dir(path: str) -> None:
    os.makedirs(path, exist_ok=True)


def to_numpy(x: Any) -> np.ndarray:
    if isinstance(x, torch.Tensor):
        return x.detach().cpu().numpy()
    return np.asarray(x)


def safe_log(x: torch.Tensor, eps: float = 1e-12) -> torch.Tensor:
    return torch.log(torch.clamp(x, min=eps))


def entropy_from_probs(p: torch.Tensor, dim: int = -1, eps: float = 1e-12) -> torch.Tensor:
    p = p / torch.clamp(p.sum(dim=dim, keepdim=True), min=eps)
    return -(p * safe_log(p, eps)).sum(dim=dim)


def nanmean_torch(x: torch.Tensor, dim: int) -> torch.Tensor:
    mask = torch.isfinite(x)
    counts = mask.sum(dim=dim)
    sums = torch.where(mask, x, torch.zeros_like(x)).sum(dim=dim)
    mean = sums / torch.clamp(counts, min=1).to(dtype=x.dtype)
    return torch.where(counts > 0, mean, torch.full_like(mean, float("nan")))


def nanstd_torch(x: torch.Tensor, dim: int) -> torch.Tensor:
    mask = torch.isfinite(x)
    counts = mask.sum(dim=dim)
    mean = nanmean_torch(x, dim=dim)
    expanded_mean = mean.unsqueeze(dim)
    centered = torch.where(mask, x - expanded_mean, torch.zeros_like(x))
    var = (centered ** 2).sum(dim=dim) / torch.clamp(counts, min=1).to(dtype=x.dtype)
    std = torch.sqrt(var)
    return torch.where(counts > 0, std, torch.full_like(std, float("nan")))


def linear_fit_torch(x: torch.Tensor, y: torch.Tensor) -> Tuple[torch.Tensor, torch.Tensor]:
    """Return slope, intercept for y = slope*x + intercept."""
    x = x.float()
    y = y.float()
    xm = x.mean()
    ym = y.mean()
    denom = torch.clamp(((x - xm) ** 2).sum(), min=1e-12)
    slope = ((x - xm) * (y - ym)).sum() / denom
    intercept = ym - slope * xm
    return slope, intercept


def standardize_features(x: torch.Tensor, eps: float = 1e-8) -> torch.Tensor:
    return (x - x.mean(dim=0, keepdim=True)) / (x.std(dim=0, keepdim=True) + eps)


def flatten_trajectories(trajectories: torch.Tensor) -> torch.Tensor:
    """
    Convert [R,T,N,D] or [R,T,D] into [R,T,F].
    """
    if trajectories.ndim == 4:
        R, T, N, D = trajectories.shape
        return trajectories.reshape(R, T, N * D)
    if trajectories.ndim == 3:
        return trajectories
    raise ValueError("trajectories must have shape [R,T,N,D] or [R,T,D]")


# ============================================================
# 1. Butterfly velocity
# ============================================================

@dataclass
class ButterflyResult:
    velocity: float
    slope_dt_dr: float
    intercept: float
    threshold: float
    r_values: List[float]
    t_star_mean: List[float]
    t_star_std: List[float]


def butterfly_velocity(
    perturbation_distance: torch.Tensor,
    r_values: torch.Tensor,
    time_values: Optional[torch.Tensor] = None,
    threshold: float = 1e-3,
    min_points: int = 2,
) -> ButterflyResult:
    """
    Estimate butterfly velocity from front arrival time t_*(r).

    perturbation_distance: [R,T,N] or [T,N]
        A perturbation amplitude at distance bin/node r.
    r_values: [N]
    time_values: [T], default arange(T)

    t_*(r) = first time when mean perturbation exceeds threshold.
    Fit t_*(r) = a r + b. Then v_B = 1/a.
    """
    if perturbation_distance.ndim == 2:
        perturbation_distance = perturbation_distance.unsqueeze(0)
    R, T, N = perturbation_distance.shape
    device = perturbation_distance.device
    if time_values is None:
        time_values = torch.arange(T, device=device, dtype=torch.float32)
    else:
        time_values = time_values.to(device=device, dtype=torch.float32)
    r_values = r_values.to(device=device, dtype=torch.float32)

    arrived = perturbation_distance >= threshold
    t_star = torch.full((R, N), float("nan"), device=device)
    for i in range(N):
        for run in range(R):
            idx = torch.nonzero(arrived[run, :, i], as_tuple=False)
            if idx.numel() > 0:
                t_star[run, i] = time_values[idx[0, 0]]

    t_mean = nanmean_torch(t_star, dim=0)
    t_std = torch.nan_to_num(nanstd_torch(t_star, dim=0), nan=0.0)
    mask = torch.isfinite(t_mean)
    if mask.sum() < min_points:
        return ButterflyResult(float("nan"), float("nan"), float("nan"), threshold, to_numpy(r_values).tolist(), to_numpy(t_mean).tolist(), to_numpy(t_std).tolist())

    slope, intercept = linear_fit_torch(r_values[mask], t_mean[mask])
    v = 1.0 / slope if slope.abs() > 1e-12 else torch.tensor(float("inf"), device=device)
    return ButterflyResult(float(v.item()), float(slope.item()), float(intercept.item()), threshold, to_numpy(r_values).tolist(), to_numpy(t_mean).tolist(), to_numpy(t_std).tolist())


# ============================================================
# 2. Transfer operators: Koopman / Perron-Frobenius
# ============================================================

@dataclass
class TransferOperatorResult:
    n_bins: int
    koopman_eigenvalues_real: List[float]
    koopman_eigenvalues_imag: List[float]
    pf_eigenvalues_real: List[float]
    pf_eigenvalues_imag: List[float]
    transition_matrix: List[List[float]]


def pca_reduce_torch(x: torch.Tensor, n_components: int = 2) -> torch.Tensor:
    x = standardize_features(x)
    U, S, Vh = torch.linalg.svd(x, full_matrices=False)
    return x @ Vh[:n_components].T


def discretize_states(x: torch.Tensor, n_bins_per_dim: int = 8) -> Tuple[torch.Tensor, int]:
    """
    x: [M, q] continuous states.
    Return discrete labels [M] using q-dimensional grid.
    """
    q = x.shape[1]
    mins = x.min(dim=0).values
    maxs = x.max(dim=0).values
    widths = torch.clamp(maxs - mins, min=1e-8)
    z = torch.floor((x - mins) / widths * n_bins_per_dim).long()
    z = torch.clamp(z, 0, n_bins_per_dim - 1)
    labels = torch.zeros(x.shape[0], dtype=torch.long, device=x.device)
    base = 1
    for j in range(q):
        labels += z[:, j] * base
        base *= n_bins_per_dim
    return labels, base


def transition_matrix_from_labels(labels_t: torch.Tensor, labels_tp1: torch.Tensor, n_states: int, eps: float = 1e-12) -> torch.Tensor:
    P = torch.zeros((n_states, n_states), dtype=torch.float64, device=labels_t.device)
    idx = labels_t * n_states + labels_tp1
    counts = torch.bincount(idx, minlength=n_states * n_states).reshape(n_states, n_states).double()
    P += counts
    row_sum = P.sum(dim=1, keepdim=True)
    P = P / torch.clamp(row_sum, min=eps)
    return P.float()


def transfer_operators(
    trajectories: torch.Tensor,
    n_components: int = 2,
    n_bins_per_dim: int = 8,
    top_k: int = 12,
) -> TransferOperatorResult:
    """
    Ulam-style discretized transfer operators.

    Perron-Frobenius operator: P_ij = Pr[x_{t+1}=j | x_t=i]
    Koopman operator on indicator observables is K = P^T.
    """
    X = flatten_trajectories(trajectories)  # [R,T,F]
    R, T, Fdim = X.shape
    X0 = X[:, :-1, :].reshape(-1, Fdim)
    X1 = X[:, 1:, :].reshape(-1, Fdim)
    both = torch.cat([X0, X1], dim=0)
    reduced = pca_reduce_torch(both, n_components=n_components)
    z0 = reduced[: X0.shape[0]]
    z1 = reduced[X0.shape[0] :]
    labels_all, n_states = discretize_states(torch.cat([z0, z1], dim=0), n_bins_per_dim=n_bins_per_dim)
    labels0 = labels_all[: z0.shape[0]]
    labels1 = labels_all[z0.shape[0] :]

    P = transition_matrix_from_labels(labels0, labels1, n_states=n_states)
    eig_pf = torch.linalg.eigvals(P)
    eig_k = torch.linalg.eigvals(P.T)

    order_pf = torch.argsort(torch.abs(eig_pf), descending=True)[:top_k]
    order_k = torch.argsort(torch.abs(eig_k), descending=True)[:top_k]
    eig_pf = eig_pf[order_pf]
    eig_k = eig_k[order_k]

    return TransferOperatorResult(
        n_bins=n_states,
        koopman_eigenvalues_real=to_numpy(eig_k.real).tolist(),
        koopman_eigenvalues_imag=to_numpy(eig_k.imag).tolist(),
        pf_eigenvalues_real=to_numpy(eig_pf.real).tolist(),
        pf_eigenvalues_imag=to_numpy(eig_pf.imag).tolist(),
        transition_matrix=to_numpy(P).tolist(),
    )


# ============================================================
# 3. Transition matrix eigenvalue / mixing timescale
# ============================================================

@dataclass
class MixingResult:
    lambda2_abs: float
    spectral_gap: float
    mixing_timescale: float
    eigenvalues_abs_top: List[float]


def mixing_timescale(P: torch.Tensor, dt: float = 1.0, top_k: int = 10) -> MixingResult:
    eig = torch.linalg.eigvals(P)
    abs_eig = torch.sort(torch.abs(eig), descending=True).values
    lambda2 = abs_eig[1] if abs_eig.numel() > 1 else torch.tensor(float("nan"), device=P.device)
    gap = 1.0 - lambda2
    tau = -dt / torch.log(torch.clamp(lambda2, min=1e-12, max=1 - 1e-12))
    return MixingResult(float(lambda2.item()), float(gap.item()), float(tau.item()), to_numpy(abs_eig[:top_k]).tolist())


# ============================================================
# 4. Persistent homology / transport topology
# ============================================================

@dataclass
class PersistentHomologyResult:
    available: bool
    h0_pairs: List[List[float]]
    h1_pairs: List[List[float]]
    h0_lifetimes: List[float]
    h1_lifetimes: List[float]
    note: str


def persistent_homology_transport(
    trajectories: torch.Tensor,
    n_points: int = 1000,
    n_components: int = 3,
) -> PersistentHomologyResult:
    """
    Compute persistent homology on sampled trajectory point cloud.
    Requires: pip install ripser
    """
    if ripser is None:
        return PersistentHomologyResult(False, [], [], [], [], "ripser not installed; run `pip install ripser`.")
    X = flatten_trajectories(trajectories)
    pts = X.reshape(-1, X.shape[-1])
    if pts.shape[0] > n_points:
        idx = torch.randperm(pts.shape[0], device=pts.device)[:n_points]
        pts = pts[idx]
    pts_red = pca_reduce_torch(pts, n_components=n_components)
    dgms = ripser(to_numpy(pts_red), maxdim=1)["dgms"]
    h0 = dgms[0].tolist()
    h1 = dgms[1].tolist() if len(dgms) > 1 else []
    def lifetimes(pairs):
        out = []
        for b, d in pairs:
            if np.isfinite(d):
                out.append(float(d - b))
        return out
    return PersistentHomologyResult(True, h0, h1, lifetimes(h0), lifetimes(h1), "H1 long lifetimes indicate loop/cyclic transport channels.")


# ============================================================
# 5. Avalanche scaling law
# ============================================================

@dataclass
class AvalancheResult:
    threshold: float
    n_avalanches: int
    size_alpha_mle: float
    duration_alpha_mle: float
    size_powerlaw_r2: float
    duration_powerlaw_r2: float
    sizes: List[float]
    durations: List[float]


def extract_avalanches(activity: torch.Tensor, threshold: float) -> Tuple[torch.Tensor, torch.Tensor]:
    """
    activity: [T] or [R,T]. Avalanche = contiguous segment above threshold.
    size = sum(activity-threshold) inside segment, duration = length.
    """
    if activity.ndim == 1:
        activity = activity.unsqueeze(0)
    sizes = []
    durations = []
    for seq in activity:
        above = seq > threshold
        start = None
        for t, val in enumerate(above.tolist() + [False]):
            if val and start is None:
                start = t
            elif (not val) and start is not None:
                end = t
                seg = seq[start:end]
                sizes.append(torch.clamp(seg - threshold, min=0).sum())
                durations.append(torch.tensor(end - start, device=activity.device, dtype=torch.float32))
                start = None
    if not sizes:
        return torch.empty(0, device=activity.device), torch.empty(0, device=activity.device)
    return torch.stack(sizes).float(), torch.stack(durations).float()


def powerlaw_mle_alpha(x: torch.Tensor, xmin: Optional[float] = None) -> float:
    x = x[x > 0].float()
    if x.numel() < 3:
        return float("nan")
    if xmin is None:
        xmin = float(torch.quantile(x, 0.1).item())
    xt = x[x >= xmin]
    if xt.numel() < 3:
        return float("nan")
    alpha = 1.0 + xt.numel() / torch.clamp(torch.log(xt / xmin).sum(), min=1e-12)
    return float(alpha.item())


def loglog_hist_r2(x: torch.Tensor, n_bins: int = 20) -> float:
    x = x[x > 0].float()
    if x.numel() < 5:
        return float("nan")
    xmin, xmax = x.min(), x.max()
    if xmax <= xmin:
        return float("nan")
    bins = torch.logspace(torch.log10(xmin), torch.log10(xmax), n_bins + 1, device=x.device)
    hist = torch.histc(x, bins=n_bins, min=float(xmin.item()), max=float(xmax.item()))
    centers = 0.5 * (bins[:-1] + bins[1:])
    mask = hist > 0
    if mask.sum() < 3:
        return float("nan")
    lx = torch.log(centers[mask])
    ly = torch.log(hist[mask])
    slope, intercept = linear_fit_torch(lx, ly)
    pred = slope * lx + intercept
    ss_res = ((ly - pred) ** 2).sum()
    ss_tot = ((ly - ly.mean()) ** 2).sum()
    return float((1 - ss_res / torch.clamp(ss_tot, min=1e-12)).item())


def avalanche_scaling(activity: torch.Tensor, threshold_quantile: float = 0.75) -> AvalancheResult:
    activity = activity.float()
    finite_values = activity[torch.isfinite(activity)]
    if finite_values.numel() == 0:
        return AvalancheResult(float("nan"), 0, float("nan"), float("nan"), float("nan"), float("nan"), [], [])
    threshold = float(torch.quantile(finite_values, threshold_quantile).item())
    sanitized = torch.where(torch.isfinite(activity), activity, torch.full_like(activity, threshold - 1.0))
    sizes, durations = extract_avalanches(sanitized, threshold)
    return AvalancheResult(
        threshold=threshold,
        n_avalanches=int(sizes.numel()),
        size_alpha_mle=powerlaw_mle_alpha(sizes),
        duration_alpha_mle=powerlaw_mle_alpha(durations),
        size_powerlaw_r2=loglog_hist_r2(sizes),
        duration_powerlaw_r2=loglog_hist_r2(durations),
        sizes=to_numpy(sizes).tolist(),
        durations=to_numpy(durations).tolist(),
    )


# ============================================================
# 6. ε-machine reconstruction
# ============================================================

@dataclass
class EpsilonMachineResult:
    n_causal_states: int
    state_labels: List[int]
    transition_counts: List[List[int]]
    morphs: Dict[str, List[float]]
    statistical_complexity: float


def symbolize_series(x: torch.Tensor, n_symbols: int = 4) -> torch.Tensor:
    """Quantile symbolic encoding of a 1D series."""
    x = x.flatten().float()
    qs = torch.quantile(x, torch.linspace(0, 1, n_symbols + 1, device=x.device)[1:-1])
    return torch.bucketize(x, qs).long()


def epsilon_machine_reconstruction(
    symbols: torch.Tensor,
    past_len: int = 3,
    future_len: int = 1,
    n_symbols: Optional[int] = None,
    morph_tol: float = 0.08,
) -> EpsilonMachineResult:
    """
    Simple ε-machine reconstruction:
    - group histories with similar future conditional distributions (morphs)
    - these groups are causal states.

    symbols: [T] integer symbols.
    """
    symbols = symbols.flatten().long()
    if n_symbols is None:
        n_symbols = int(symbols.max().item() + 1)
    T = symbols.numel()
    hist_counts: Dict[Tuple[int, ...], torch.Tensor] = {}
    for t in range(past_len, T - future_len):
        past = tuple(symbols[t - past_len : t].tolist())
        fut = int(symbols[t].item())
        if past not in hist_counts:
            hist_counts[past] = torch.zeros(n_symbols, dtype=torch.float64)
        hist_counts[past][fut] += 1

    morphs = {past: counts / torch.clamp(counts.sum(), min=1.0) for past, counts in hist_counts.items()}
    causal_state_of: Dict[Tuple[int, ...], int] = {}
    reps: List[torch.Tensor] = []
    for past, morph in morphs.items():
        assigned = False
        for k, rep in enumerate(reps):
            if torch.linalg.norm(morph - rep, ord=1) < morph_tol:
                causal_state_of[past] = k
                reps[k] = 0.5 * (reps[k] + morph)
                assigned = True
                break
        if not assigned:
            causal_state_of[past] = len(reps)
            reps.append(morph.clone())

    n_states = len(reps)
    state_seq = []
    for t in range(past_len, T - future_len):
        past = tuple(symbols[t - past_len : t].tolist())
        state_seq.append(causal_state_of[past])
    trans = torch.zeros((n_states, n_states), dtype=torch.int64)
    for a, b in zip(state_seq[:-1], state_seq[1:]):
        trans[a, b] += 1
    state_counts = torch.bincount(torch.tensor(state_seq, dtype=torch.long), minlength=n_states).double()
    p_states = state_counts / torch.clamp(state_counts.sum(), min=1.0)
    C_mu = float(entropy_from_probs(p_states).item())

    morphs_out = {str(k): to_numpy(v).tolist() for k, v in zip(range(n_states), reps)}
    return EpsilonMachineResult(n_states, state_seq, to_numpy(trans).tolist(), morphs_out, C_mu)


# ============================================================
# 7. Graph entropy
# ============================================================

@dataclass
class GraphEntropyResult:
    node_strength_entropy: float
    edge_weight_entropy: float
    von_neumann_laplacian_entropy: float
    n_nodes: int
    n_edges_positive: int


def graph_entropy(W: torch.Tensor, eps: float = 1e-12) -> GraphEntropyResult:
    """
    W: weighted adjacency matrix [N,N], nonnegative preferred.
    """
    W = torch.clamp(W.float(), min=0)
    N = W.shape[0]
    strengths = W.sum(dim=1)
    p_node = strengths / torch.clamp(strengths.sum(), min=eps)
    H_node = entropy_from_probs(p_node, dim=0, eps=eps)

    ew = W[W > 0]
    if ew.numel() > 0:
        p_edge = ew / torch.clamp(ew.sum(), min=eps)
        H_edge = entropy_from_probs(p_edge, dim=0, eps=eps)
    else:
        H_edge = torch.tensor(0.0)

    D = torch.diag(strengths)
    L = D - W
    tr = torch.trace(L)
    if tr > eps:
        rho = L / tr
        evals = torch.linalg.eigvalsh((rho + rho.T) / 2)
        evals = torch.clamp(evals, min=0)
        H_vn = entropy_from_probs(evals, dim=0, eps=eps)
    else:
        H_vn = torch.tensor(0.0)
    return GraphEntropyResult(float(H_node.item()), float(H_edge.item()), float(H_vn.item()), N, int((W > 0).sum().item()))


# ============================================================
# 8. Transfer Entropy network
# ============================================================

@dataclass
class TENetworkResult:
    te_matrix: List[List[float]]
    threshold: float
    adjacency: List[List[float]]
    graph_entropy: GraphEntropyResult


def discretize_by_quantiles(x: torch.Tensor, n_bins: int = 4) -> torch.Tensor:
    flat = x.flatten().float()
    qs = torch.quantile(flat, torch.linspace(0, 1, n_bins + 1, device=x.device)[1:-1])
    return torch.bucketize(x.float(), qs).long()


def transfer_entropy_pair(x: torch.Tensor, y: torch.Tensor, n_bins: int = 4, eps: float = 1e-12) -> float:
    """
    TE X->Y = I(Y_{t+1}; X_t | Y_t) for symbolic/discretized series.
    x,y: [T]
    """
    xs = discretize_by_quantiles(x, n_bins)
    ys = discretize_by_quantiles(y, n_bins)
    yt1 = ys[1:]
    yt = ys[:-1]
    xt = xs[:-1]
    B = n_bins

    idx_xyz = yt1 * B * B + yt * B + xt
    p_xyz = torch.bincount(idx_xyz, minlength=B**3).double().reshape(B, B, B)
    p_xyz = p_xyz / torch.clamp(p_xyz.sum(), min=eps)

    p_yx = p_xyz.sum(dim=0)  # y_t, x_t
    p_yy = p_xyz.sum(dim=2)  # y_{t+1}, y_t
    p_y = p_yy.sum(dim=0)    # y_t

    te = torch.tensor(0.0, dtype=torch.float64, device=x.device)
    for a in range(B):
        for b in range(B):
            for c in range(B):
                p = p_xyz[a, b, c]
                if p > 0:
                    p1 = p / torch.clamp(p_yx[b, c], min=eps)  # p(y_{t+1}|y_t,x_t)
                    p2 = p_yy[a, b] / torch.clamp(p_y[b], min=eps)  # p(y_{t+1}|y_t)
                    te += p * torch.log(torch.clamp(p1 / torch.clamp(p2, min=eps), min=eps))
    return float(te.item())


def te_network(node_series: torch.Tensor, n_bins: int = 4, threshold_quantile: float = 0.8) -> TENetworkResult:
    """
    node_series: [T,N] scalar activity per node.
    """
    if node_series.ndim != 2:
        raise ValueError("node_series must be [T,N]")
    T, N = node_series.shape
    TE = torch.zeros((N, N), dtype=torch.float32)
    for i in range(N):
        for j in range(N):
            if i != j:
                TE[i, j] = transfer_entropy_pair(node_series[:, i], node_series[:, j], n_bins=n_bins)
    vals = TE[TE > 0]
    thr = float(torch.quantile(vals, threshold_quantile).item()) if vals.numel() > 0 else 0.0
    A = torch.where(TE >= thr, TE, torch.zeros_like(TE))
    ge = graph_entropy(A)
    return TENetworkResult(to_numpy(TE).tolist(), thr, to_numpy(A).tolist(), ge)


# ============================================================
# 9. Community detection / metastable basins
# ============================================================

@dataclass
class CommunityResult:
    n_communities: int
    labels: List[int]
    modularity: Optional[float]
    note: str


def community_detection(W: torch.Tensor) -> CommunityResult:
    """
    Weighted community detection. Uses networkx Louvain if available,
    otherwise spectral sign split fallback.
    """
    Wnp = to_numpy(torch.clamp(W.float(), min=0))
    N = Wnp.shape[0]
    if nx is not None:
        G = nx.from_numpy_array(Wnp, create_using=nx.Graph)
        try:
            communities = nx.algorithms.community.louvain_communities(G, weight="weight", seed=0)
        except Exception:
            communities = nx.algorithms.community.greedy_modularity_communities(G, weight="weight")
        labels = np.zeros(N, dtype=int)
        for k, comm in enumerate(communities):
            for node in comm:
                labels[node] = k
        try:
            mod = nx.algorithms.community.modularity(G, communities, weight="weight")
        except Exception:
            mod = None
        return CommunityResult(len(communities), labels.tolist(), None if mod is None else float(mod), "networkx community detection")

    # fallback: Fiedler vector split
    Wt = torch.tensor(Wnp, dtype=torch.float32)
    D = torch.diag(Wt.sum(dim=1))
    L = D - Wt
    evals, evecs = torch.linalg.eigh((L + L.T) / 2)
    if N >= 2:
        fiedler = evecs[:, 1]
        labels = (fiedler > fiedler.median()).long()
    else:
        labels = torch.zeros(N, dtype=torch.long)
    return CommunityResult(int(labels.max().item() + 1), labels.tolist(), None, "fallback spectral bipartition")


# ============================================================
# 10. Edge-of-chaos high-resolution scan
# ============================================================

@dataclass
class EdgeScanPoint:
    lambda_value: float
    predictive_information: float
    statistical_complexity: float
    te_total: float
    graph_entropy_node: float


@dataclass
class EdgeScanResult:
    points: List[EdgeScanPoint]
    peak_predictive_information_lambda: float
    peak_statistical_complexity_lambda: float
    peak_te_lambda: float


def predictive_information_from_symbols(symbols: torch.Tensor, past_len: int = 3, future_len: int = 3, n_symbols: Optional[int] = None, eps: float = 1e-12) -> float:
    """Estimate I(past;future) from symbolic sequence."""
    s = symbols.flatten().long()
    if n_symbols is None:
        n_symbols = int(s.max().item() + 1)
    T = s.numel()
    if T < past_len + future_len + 2:
        return float("nan")
    past_ids = []
    future_ids = []
    for t in range(past_len, T - future_len):
        p = 0
        for a in s[t - past_len : t].tolist():
            p = p * n_symbols + int(a)
        f = 0
        for a in s[t : t + future_len].tolist():
            f = f * n_symbols + int(a)
        past_ids.append(p)
        future_ids.append(f)
    Pn = n_symbols ** past_len
    Fn = n_symbols ** future_len
    past_ids = torch.tensor(past_ids, device=s.device, dtype=torch.long)
    future_ids = torch.tensor(future_ids, device=s.device, dtype=torch.long)
    joint = torch.bincount(past_ids * Fn + future_ids, minlength=Pn * Fn).double().reshape(Pn, Fn)
    joint = joint / torch.clamp(joint.sum(), min=eps)
    pp = joint.sum(dim=1, keepdim=True)
    pf = joint.sum(dim=0, keepdim=True)
    mask = joint > 0
    mi = (joint[mask] * torch.log(torch.clamp(joint[mask] / torch.clamp((pp @ pf)[mask], min=eps), min=eps))).sum()
    return float(mi.item())


def default_complexity_from_series(series: torch.Tensor, n_symbols: int = 4) -> Tuple[float, float]:
    symbols = symbolize_series(series, n_symbols=n_symbols)
    em = epsilon_machine_reconstruction(symbols, past_len=3, morph_tol=0.08)
    pi = predictive_information_from_symbols(symbols, past_len=3, future_len=3, n_symbols=n_symbols)
    return pi, em.statistical_complexity


def simulate_system(lambda_value: float, n_steps: int = 512, n_nodes: int = 16, device: str = "cpu") -> torch.Tensor:
    """
    Placeholder toy simulator: coupled logistic-like map.
    Replace this with your N-body / CA / oscillator / transport model.

    Output: [T,N] scalar activity.
    """
    lam = torch.tensor(lambda_value, device=device)
    x = torch.rand(n_nodes, device=device)
    out = []
    coupling = torch.clamp(lam, 0, 0.45)
    r = 3.55 + 1.2 * torch.clamp(lam, 0, 0.35)
    for _ in range(n_steps):
        local = r * x * (1 - x)
        neigh = 0.5 * (torch.roll(local, 1) + torch.roll(local, -1))
        x = (1 - coupling) * local + coupling * neigh
        x = torch.remainder(x, 1.0)
        out.append(x.clone())
    return torch.stack(out, dim=0)


def edge_of_chaos_scan(
    lambda_grid: torch.Tensor,
    n_steps: int = 512,
    n_nodes: int = 16,
    device: str = "cpu",
) -> EdgeScanResult:
    points: List[EdgeScanPoint] = []
    for lam in lambda_grid.tolist():
        X = simulate_system(lam, n_steps=n_steps, n_nodes=n_nodes, device=device)  # [T,N]
        global_series = X.mean(dim=1)
        pi, Cmu = default_complexity_from_series(global_series)
        te_res = te_network(X, n_bins=4, threshold_quantile=0.8)
        te_total = float(torch.tensor(te_res.te_matrix).sum().item())
        points.append(EdgeScanPoint(float(lam), pi, Cmu, te_total, te_res.graph_entropy.node_strength_entropy))

    def peak(key: str) -> float:
        vals = np.array([getattr(p, key) for p in points], dtype=float)
        lams = np.array([p.lambda_value for p in points], dtype=float)
        if np.all(np.isnan(vals)):
            return float("nan")
        return float(lams[np.nanargmax(vals)])

    return EdgeScanResult(
        points=points,
        peak_predictive_information_lambda=peak("predictive_information"),
        peak_statistical_complexity_lambda=peak("statistical_complexity"),
        peak_te_lambda=peak("te_total"),
    )


# ============================================================
# Plotting helpers
# ============================================================


def plot_edge_scan(scan: EdgeScanResult, out_dir: str) -> None:
    if plt is None:
        return
    lams = [p.lambda_value for p in scan.points]
    metrics = {
        "predictive_information": [p.predictive_information for p in scan.points],
        "statistical_complexity": [p.statistical_complexity for p in scan.points],
        "te_total": [p.te_total for p in scan.points],
        "graph_entropy_node": [p.graph_entropy_node for p in scan.points],
    }
    for name, vals in metrics.items():
        plt.figure(figsize=(7, 4))
        plt.plot(lams, vals, marker="o")
        plt.xlabel("lambda")
        plt.ylabel(name)
        plt.title(f"edge-of-chaos scan: {name}")
        plt.grid(True, alpha=0.3)
        plt.tight_layout()
        plt.savefig(os.path.join(out_dir, f"edge_scan_{name}.png"), dpi=160)
        plt.close()


def plot_butterfly(res: ButterflyResult, out_dir: str) -> None:
    if plt is None:
        return
    r = np.array(res.r_values)
    t = np.array(res.t_star_mean)
    e = np.array(res.t_star_std)
    mask = np.isfinite(t)
    plt.figure(figsize=(7, 4))
    plt.errorbar(r[mask], t[mask], yerr=e[mask], marker="o", capsize=3)
    if np.isfinite(res.slope_dt_dr):
        xs = np.linspace(np.nanmin(r[mask]), np.nanmax(r[mask]), 100)
        plt.plot(xs, res.slope_dt_dr * xs + res.intercept, "--", label=f"v_B={res.velocity:.4g}")
        plt.legend()
    plt.xlabel("distance r")
    plt.ylabel("arrival time t*(r)")
    plt.title("Butterfly front")
    plt.grid(True, alpha=0.3)
    plt.tight_layout()
    plt.savefig(os.path.join(out_dir, "butterfly_velocity.png"), dpi=160)
    plt.close()


def ordered_classes(classes: np.ndarray) -> List[str]:
    labels = [str(label) for label in np.asarray(classes).tolist()]
    ordered = [class_name for class_name in CLASS_ORDER if class_name in labels]
    for label in labels:
        if label not in ordered:
            ordered.append(label)
    return ordered


def safe_mean(values: List[float]) -> float:
    arr = np.asarray(values, dtype=float)
    if arr.size == 0 or not np.any(np.isfinite(arr)):
        return float("nan")
    return float(np.nanmean(arr))


def compute_binned_mean(x: np.ndarray, y: np.ndarray, n_bins: int) -> Tuple[np.ndarray, np.ndarray]:
    x = np.asarray(x, dtype=float)
    y = np.asarray(y, dtype=float)
    mask = np.isfinite(x) & np.isfinite(y)
    if np.count_nonzero(mask) < 2:
        return np.asarray([], dtype=float), np.asarray([], dtype=float)

    x = x[mask]
    y = y[mask]
    if np.isclose(x.min(), x.max()):
        return np.asarray([x.min()], dtype=float), np.asarray([y.mean()], dtype=float)

    edges = np.linspace(x.min(), x.max(), n_bins + 1)
    centers = 0.5 * (edges[:-1] + edges[1:])
    means = np.full(n_bins, np.nan, dtype=float)
    for index in range(n_bins):
        if index == n_bins - 1:
            bin_mask = (x >= edges[index]) & (x <= edges[index + 1])
        else:
            bin_mask = (x >= edges[index]) & (x < edges[index + 1])
        if np.any(bin_mask):
            means[index] = np.nanmean(y[bin_mask])
    valid = np.isfinite(means)
    return centers[valid], means[valid]


def infer_node_series_all_runs(trajectories: torch.Tensor) -> Optional[torch.Tensor]:
    if trajectories.ndim != 4:
        return None
    dX = torch.linalg.norm(trajectories[:, 1:] - trajectories[:, :-1], dim=-1)
    pad = dX[:, :1] * 0
    return torch.cat([pad, dX], dim=1)


def load_pipeline_data(args: argparse.Namespace) -> Dict[str, Any]:
    if args.input:
        raw = torch.load(args.input, map_location="cuda" if args.cuda and torch.cuda.is_available() else "cpu")
        if isinstance(raw, torch.Tensor):
            return {"trajectories": raw.float(), "sample_dt": args.dt}
        data = dict(raw)
        if "trajectories" in data and data["trajectories"] is not None:
            data["trajectories"] = data["trajectories"].float()
        if "perturbation_distance" in data and data["perturbation_distance"] is not None:
            data["perturbation_distance"] = data["perturbation_distance"].float()
        if "lambda_values" in data and data["lambda_values"] is not None:
            data["lambda_values"] = data["lambda_values"].float()
        if "classes" in data and data["classes"] is not None:
            data["classes"] = np.asarray(data["classes"])
        data.setdefault("sample_dt", args.dt)
        return data

    if (BASE_DIR / "n_body_chaos_complexity.csv").exists():
        return ne.load_data()

    device = "cuda" if args.cuda and torch.cuda.is_available() else "cpu"
    lambda_grid = torch.linspace(args.lambda_min, args.lambda_max, args.n_lambda, device=device)
    sims = []
    for lam in lambda_grid:
        sims.append(simulate_system(float(lam.item()), n_steps=args.n_steps, n_nodes=args.n_nodes, device=device))
    trajectories = torch.stack(sims, dim=0).unsqueeze(-1)
    return {
        "trajectories": trajectories,
        "lambda_values": lambda_grid,
        "classes": np.asarray(["scan"] * trajectories.shape[0]),
        "sample_dt": args.dt,
        "mode": "demo",
    }


def summarize_butterfly_by_class(
    otoc_distance: torch.Tensor,
    classes: np.ndarray,
    distance_centers: np.ndarray,
    time_values: np.ndarray,
    threshold: float,
) -> Tuple[Dict[str, ButterflyResult], List[Dict[str, Any]]]:
    results: Dict[str, ButterflyResult] = {}
    rows: List[Dict[str, Any]] = []
    r_values = torch.as_tensor(distance_centers, device=otoc_distance.device, dtype=torch.float32)
    t_values = torch.as_tensor(time_values, device=otoc_distance.device, dtype=torch.float32)

    for class_name in ordered_classes(classes):
        idx = np.where(classes == class_name)[0]
        if idx.size == 0:
            continue
        # numerical_exp cache stores [R, n_distance_bins, T]
        class_curves = otoc_distance[idx].permute(0, 2, 1)
        result = butterfly_velocity(class_curves, r_values, time_values=t_values, threshold=threshold)
        results[class_name] = result
        rows.append(
            {
                "experiment": "butterfly_front",
                "class": class_name,
                "threshold": threshold,
                "front_slope": result.slope_dt_dr,
                "front_intercept": result.intercept,
                "butterfly_velocity": result.velocity,
                "mean_scrambling_time": safe_mean(result.t_star_mean),
            }
        )

    return results, rows


def plot_butterfly_by_class(results_by_class: Dict[str, ButterflyResult], out_dir: Path) -> None:
    if plt is None or not results_by_class:
        return

    fig, ax = plt.subplots(figsize=(7.2, 5.2))
    for class_name in ordered_classes(np.asarray(list(results_by_class.keys()))):
        result = results_by_class[class_name]
        r = np.asarray(result.r_values, dtype=float)
        t = np.asarray(result.t_star_mean, dtype=float)
        e = np.asarray(result.t_star_std, dtype=float)
        mask = np.isfinite(r) & np.isfinite(t)
        if np.count_nonzero(mask) == 0:
            continue
        color = CLASS_COLORS.get(class_name, None)
        ax.errorbar(r[mask], t[mask], yerr=e[mask], marker="o", capsize=3, linewidth=1.8, color=color, label=class_name)
        if np.isfinite(result.slope_dt_dr):
            xs = np.linspace(np.nanmin(r[mask]), np.nanmax(r[mask]), 100)
            ax.plot(xs, result.slope_dt_dr * xs + result.intercept, linestyle="--", color=color)

    ax.set_xlabel("distance r")
    ax.set_ylabel(r"scrambling time $t_*(r)$")
    ax.set_title("Chaos transport butterfly front")
    ax.grid(True, alpha=0.3)
    ax.legend(frameon=False)
    fig.tight_layout()
    fig.savefig(out_dir / "chaos_transport_butterfly_front.png", dpi=180)
    plt.close(fig)


def summarize_transfer_by_class(
    trajectories: torch.Tensor,
    classes: np.ndarray,
    dt: float,
    n_components: int,
    n_bins_per_dim: int,
) -> Tuple[Dict[str, Dict[str, Any]], List[Dict[str, Any]]]:
    results: Dict[str, Dict[str, Any]] = {}
    rows: List[Dict[str, Any]] = []
    for class_name in ordered_classes(classes):
        idx = np.where(classes == class_name)[0]
        if idx.size == 0:
            continue
        subset = trajectories[idx]
        transfer_result = transfer_operators(subset, n_components=n_components, n_bins_per_dim=n_bins_per_dim)
        transition_matrix = torch.tensor(transfer_result.transition_matrix, device=subset.device, dtype=torch.float32)
        mixing_result = mixing_timescale(transition_matrix, dt=dt)
        results[class_name] = {
            "transfer": transfer_result,
            "mixing": mixing_result,
        }
        rows.append(
            {
                "experiment": "mixing",
                "class": class_name,
                "n_states": transfer_result.n_bins,
                "lambda2_abs": mixing_result.lambda2_abs,
                "spectral_gap": mixing_result.spectral_gap,
                "mixing_timescale": mixing_result.mixing_timescale,
            }
        )
    return results, rows


def plot_transfer_operator_summary(results_by_class: Dict[str, Dict[str, Any]], out_dir: Path) -> None:
    if plt is None or not results_by_class:
        return

    fig, axes = plt.subplots(1, 2, figsize=(12.2, 5.0))
    theta = np.linspace(0, 2 * np.pi, 512)
    axes[0].plot(np.cos(theta), np.sin(theta), linestyle="--", color="#bbbbbb", linewidth=1.0)

    class_names = ordered_classes(np.asarray(list(results_by_class.keys())))
    tau_values = []
    for class_name in class_names:
        entry = results_by_class[class_name]
        transfer_result = entry["transfer"]
        mixing_result = entry["mixing"]
        pf_eigs = np.asarray(transfer_result.pf_eigenvalues_real) + 1j * np.asarray(transfer_result.pf_eigenvalues_imag)
        color = CLASS_COLORS.get(class_name, None)
        axes[0].scatter(pf_eigs.real, pf_eigs.imag, s=48, alpha=0.82, color=color, label=class_name)
        tau_values.append(mixing_result.mixing_timescale)

    axes[0].set_xlabel("Re")
    axes[0].set_ylabel("Im")
    axes[0].set_title("Perron-Frobenius spectra")
    axes[0].grid(True, alpha=0.25)
    axes[0].set_aspect("equal", adjustable="box")
    axes[0].legend(frameon=False)

    bars = axes[1].bar(range(len(class_names)), tau_values, color=[CLASS_COLORS.get(name, "#777777") for name in class_names])
    axes[1].set_xticks(range(len(class_names)), class_names, rotation=20)
    axes[1].set_ylabel("mixing timescale")
    axes[1].set_title("Transfer-operator mixing")
    axes[1].grid(True, axis="y", alpha=0.25)
    for bar, class_name in zip(bars, class_names):
        mixing_result = results_by_class[class_name]["mixing"]
        axes[1].text(
            bar.get_x() + bar.get_width() / 2,
            bar.get_height(),
            f"gap={mixing_result.spectral_gap:.3f}",
            ha="center",
            va="bottom",
            fontsize=9,
        )

    fig.tight_layout()
    fig.savefig(out_dir / "chaos_transport_transfer_operator.png", dpi=180)
    plt.close(fig)


def summarize_persistent_homology_by_class(
    trajectories: torch.Tensor,
    classes: np.ndarray,
    n_points: int,
) -> Tuple[Dict[str, PersistentHomologyResult], List[Dict[str, Any]]]:
    results: Dict[str, PersistentHomologyResult] = {}
    rows: List[Dict[str, Any]] = []
    for class_name in ordered_classes(classes):
        idx = np.where(classes == class_name)[0]
        if idx.size == 0:
            continue
        result = persistent_homology_transport(trajectories[idx], n_points=n_points)
        results[class_name] = result
        rows.append(
            {
                "experiment": "persistent_homology",
                "class": class_name,
                "available": result.available,
                "h1_count": len(result.h1_lifetimes),
                "h1_lifetime_mean": safe_mean(result.h1_lifetimes),
                "note": result.note,
            }
        )
    return results, rows


def plot_persistent_homology_summary(results_by_class: Dict[str, PersistentHomologyResult], out_dir: Path) -> None:
    if plt is None or not any(result.available for result in results_by_class.values()):
        return

    class_names = []
    mean_lifetimes = []
    for class_name in ordered_classes(np.asarray(list(results_by_class.keys()))):
        result = results_by_class[class_name]
        if not result.available:
            continue
        class_names.append(class_name)
        mean_lifetimes.append(safe_mean(result.h1_lifetimes))

    if not class_names:
        return

    fig, ax = plt.subplots(figsize=(7.0, 4.4))
    ax.bar(range(len(class_names)), mean_lifetimes, color=[CLASS_COLORS.get(name, "#777777") for name in class_names])
    ax.set_xticks(range(len(class_names)), class_names, rotation=20)
    ax.set_ylabel("mean H1 lifetime")
    ax.set_title("Persistent homology of transport trajectories")
    ax.grid(True, axis="y", alpha=0.25)
    fig.tight_layout()
    fig.savefig(out_dir / "chaos_transport_persistent_homology.png", dpi=180)
    plt.close(fig)


def summarize_avalanche_by_class(
    activity: torch.Tensor,
    classes: np.ndarray,
    threshold_quantile: float,
) -> Tuple[Dict[str, AvalancheResult], List[Dict[str, Any]]]:
    results: Dict[str, AvalancheResult] = {}
    rows: List[Dict[str, Any]] = []
    for class_name in ordered_classes(classes):
        idx = np.where(classes == class_name)[0]
        if idx.size == 0:
            continue
        result = avalanche_scaling(activity[idx], threshold_quantile=threshold_quantile)
        results[class_name] = result
        rows.append(
            {
                "experiment": "avalanche",
                "class": class_name,
                "threshold": result.threshold,
                "n_avalanches": result.n_avalanches,
                "size_alpha_mle": result.size_alpha_mle,
                "duration_alpha_mle": result.duration_alpha_mle,
                "size_powerlaw_r2": result.size_powerlaw_r2,
                "duration_powerlaw_r2": result.duration_powerlaw_r2,
            }
        )
    return results, rows


def _plot_log_hist(ax: Any, values: List[float], color: str, label: str) -> None:
    arr = np.asarray(values, dtype=float)
    arr = arr[np.isfinite(arr) & (arr > 0)]
    if arr.size < 2:
        return
    low = arr.min()
    high = arr.max()
    if np.isclose(low, high):
        ax.scatter([low], [1.0], color=color, label=label)
        return
    bins = np.logspace(np.log10(low), np.log10(high), 13)
    hist, edges = np.histogram(arr, bins=bins)
    centers = np.sqrt(edges[:-1] * edges[1:])
    mask = hist > 0
    if np.any(mask):
        ax.loglog(centers[mask], hist[mask], marker="o", color=color, linewidth=1.8, label=label)


def plot_avalanche_summary(results_by_class: Dict[str, AvalancheResult], out_dir: Path) -> None:
    if plt is None or not results_by_class:
        return

    fig, axes = plt.subplots(1, 2, figsize=(12.0, 4.8))
    for class_name in ordered_classes(np.asarray(list(results_by_class.keys()))):
        result = results_by_class[class_name]
        color = CLASS_COLORS.get(class_name, None)
        _plot_log_hist(axes[0], result.sizes, color, f"{class_name} α={result.size_alpha_mle:.2f}")
        _plot_log_hist(axes[1], result.durations, color, f"{class_name} α={result.duration_alpha_mle:.2f}")

    axes[0].set_xlabel("avalanche size")
    axes[0].set_ylabel("count")
    axes[0].set_title("Avalanche size distribution")
    axes[0].grid(True, alpha=0.25)
    handles, labels = axes[0].get_legend_handles_labels()
    if handles:
        axes[0].legend(handles, labels, frameon=False)

    axes[1].set_xlabel("avalanche duration")
    axes[1].set_ylabel("count")
    axes[1].set_title("Avalanche duration distribution")
    axes[1].grid(True, alpha=0.25)
    handles, labels = axes[1].get_legend_handles_labels()
    if handles:
        axes[1].legend(handles, labels, frameon=False)

    fig.tight_layout()
    fig.savefig(out_dir / "chaos_transport_avalanche_scaling.png", dpi=180)
    plt.close(fig)


def compute_run_metrics(
    trajectories: torch.Tensor,
    classes: np.ndarray,
    lambda_values: np.ndarray,
    n_symbols: int,
    past_len: int,
    morph_tol: float,
    te_threshold_quantile: float,
) -> Tuple[pd.DataFrame, Dict[str, Dict[str, Any]], List[Dict[str, Any]]]:
    node_series_all = infer_node_series_all_runs(trajectories)
    rows: List[Dict[str, Any]] = []
    summary_rows: List[Dict[str, Any]] = []
    te_by_class: Dict[str, List[np.ndarray]] = {}
    adjacency_by_class: Dict[str, List[np.ndarray]] = {}

    for run_index in range(trajectories.shape[0]):
        class_name = str(classes[run_index])
        global_series = trajectories[run_index].reshape(trajectories.shape[1], -1).mean(dim=1)
        symbols = symbolize_series(global_series, n_symbols=n_symbols)
        epsilon_result = epsilon_machine_reconstruction(symbols, past_len=past_len, morph_tol=morph_tol)
        predictive_information = predictive_information_from_symbols(symbols, past_len=past_len, future_len=past_len, n_symbols=n_symbols)

        te_total = float("nan")
        graph_result = GraphEntropyResult(float("nan"), float("nan"), float("nan"), 0, 0)
        community_result = CommunityResult(0, [], None, "no node series")
        adjacency_matrix = None
        te_matrix = None
        if node_series_all is not None:
            te_result = te_network(node_series_all[run_index], n_bins=n_symbols, threshold_quantile=te_threshold_quantile)
            te_matrix = np.asarray(te_result.te_matrix, dtype=float)
            adjacency_matrix = np.asarray(te_result.adjacency, dtype=float)
            te_total = float(np.nansum(te_matrix))
            graph_result = te_result.graph_entropy
            community_result = community_detection(torch.tensor(adjacency_matrix, device=trajectories.device, dtype=torch.float32))
            te_by_class.setdefault(class_name, []).append(te_matrix)
            adjacency_by_class.setdefault(class_name, []).append(adjacency_matrix)

        rows.append(
            {
                "run_index": run_index,
                "chaos_region": class_name,
                "Lyapunov_exponent": float(lambda_values[run_index]) if lambda_values is not None else float("nan"),
                "predictive_information": predictive_information,
                "statistical_complexity": epsilon_result.statistical_complexity,
                "n_causal_states": epsilon_result.n_causal_states,
                "te_total": te_total,
                "graph_entropy_node": graph_result.node_strength_entropy,
                "graph_entropy_edge": graph_result.edge_weight_entropy,
                "graph_entropy_vn": graph_result.von_neumann_laplacian_entropy,
                "n_communities": community_result.n_communities,
            }
        )

    metrics_df = pd.DataFrame(rows)

    class_networks: Dict[str, Dict[str, Any]] = {}
    for class_name in ordered_classes(classes):
        subset = metrics_df.loc[metrics_df["chaos_region"] == class_name]
        if subset.empty:
            continue
        summary_rows.append(
            {
                "experiment": "complexity",
                "class": class_name,
                "predictive_information_mean": float(subset["predictive_information"].mean()),
                "statistical_complexity_mean": float(subset["statistical_complexity"].mean()),
                "te_total_mean": float(subset["te_total"].mean()),
                "graph_entropy_node_mean": float(subset["graph_entropy_node"].mean()),
                "n_causal_states_mean": float(subset["n_causal_states"].mean()),
            }
        )

        adjacency_samples = adjacency_by_class.get(class_name, [])
        if adjacency_samples:
            mean_adjacency = np.mean(np.stack(adjacency_samples, axis=0), axis=0)
            graph_result = graph_entropy(torch.tensor(mean_adjacency, device=trajectories.device, dtype=torch.float32))
            community_result = community_detection(torch.tensor(mean_adjacency, device=trajectories.device, dtype=torch.float32))
            class_networks[class_name] = {
                "mean_adjacency": mean_adjacency,
                "graph_entropy": graph_result,
                "community_detection": community_result,
            }
            summary_rows.append(
                {
                    "experiment": "te_network",
                    "class": class_name,
                    "graph_entropy_node": graph_result.node_strength_entropy,
                    "graph_entropy_edge": graph_result.edge_weight_entropy,
                    "graph_entropy_vn": graph_result.von_neumann_laplacian_entropy,
                    "n_communities": community_result.n_communities,
                }
            )

    return metrics_df, class_networks, summary_rows


def plot_te_networks(class_networks: Dict[str, Dict[str, Any]], out_dir: Path) -> None:
    if plt is None or not class_networks:
        return

    class_names = ordered_classes(np.asarray(list(class_networks.keys())))
    fig, axes = plt.subplots(1, len(class_names), figsize=(4.2 * len(class_names), 4.0), squeeze=False)
    vmax = max(np.nanmax(entry["mean_adjacency"]) for entry in class_networks.values())
    vmax = float(vmax) if np.isfinite(vmax) and vmax > 0 else 1.0
    image = None
    for axis, class_name in zip(axes[0], class_names):
        entry = class_networks[class_name]
        image = axis.imshow(entry["mean_adjacency"], cmap="magma", vmin=0.0, vmax=vmax)
        graph_result = entry["graph_entropy"]
        community_result = entry["community_detection"]
        axis.set_title(
            f"{class_name}\nH={graph_result.node_strength_entropy:.3f}, C={community_result.n_communities}",
            fontsize=10,
        )
        axis.set_xlabel("target node")
        axis.set_ylabel("source node")

    if image is not None:
        fig.colorbar(image, ax=axes.ravel().tolist(), shrink=0.82)
    fig.tight_layout()
    fig.savefig(out_dir / "chaos_transport_te_networks.png", dpi=180)
    plt.close(fig)


def summarize_edge_of_chaos(metrics_df: pd.DataFrame, n_bins: int) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    lambda_values = metrics_df["Lyapunov_exponent"].to_numpy(dtype=float)
    for metric, _ in EDGE_METRIC_SPECS:
        centers, means = compute_binned_mean(lambda_values, metrics_df[metric].to_numpy(dtype=float), n_bins=n_bins)
        if centers.size == 0:
            continue
        peak_index = int(np.nanargmax(means))
        rows.append(
            {
                "experiment": "edge_of_chaos",
                "metric": metric,
                "peak_lambda_bin_center": float(centers[peak_index]),
                "peak_metric_mean": float(means[peak_index]),
            }
        )
    return rows


def plot_edge_metrics(metrics_df: pd.DataFrame, out_dir: Path, n_bins: int) -> None:
    if plt is None or metrics_df.empty:
        return

    lambda_values = metrics_df["Lyapunov_exponent"].to_numpy(dtype=float)
    classes = metrics_df["chaos_region"].to_numpy()
    fig, axes = plt.subplots(2, 2, figsize=(12.0, 9.0))
    axes = axes.ravel()

    for axis, (metric, title) in zip(axes, EDGE_METRIC_SPECS):
        values = metrics_df[metric].to_numpy(dtype=float)
        for class_name in ordered_classes(classes):
            mask = classes == class_name
            axis.scatter(
                lambda_values[mask],
                values[mask],
                s=42,
                alpha=0.8,
                color=CLASS_COLORS.get(class_name, None),
                label=class_name,
            )
        centers, means = compute_binned_mean(lambda_values, values, n_bins=n_bins)
        if centers.size > 0:
            axis.plot(centers, means, color="#222222", linewidth=2.2, label="binned mean")
        axis.set_xlabel(r"Lyapunov exponent $\lambda_1$")
        axis.set_ylabel(metric)
        axis.set_title(title)
        axis.grid(True, alpha=0.25)

    handles, labels = axes[0].get_legend_handles_labels()
    axes[0].legend(handles, labels, frameon=False, fontsize=9)
    fig.tight_layout()
    fig.savefig(out_dir / "chaos_transport_edge_scan.png", dpi=180)
    plt.close(fig)


def save_tabular_outputs(metrics_df: pd.DataFrame, summary_rows: List[Dict[str, Any]], out_dir: Path, sample_dt: float) -> None:
    metrics_df.to_csv(out_dir / "chaos_transport_metrics.csv", index=False)
    summary_df = pd.DataFrame(summary_rows)
    summary_df.to_csv(out_dir / "chaos_transport_summary.csv", index=False)

    lines = [
        "Chaos transport analysis",
        "- class-wise butterfly front from cached N-body OTOC bins",
        "- class-wise transfer operators and mixing timescales",
        "- avalanche scaling from finite-time Lyapunov activity",
        "- epsilon-machine / predictive information / TE-network diagnostics",
        f"- sample_dt: {sample_dt:.4f}",
        "",
    ]

    for row in summary_rows:
        experiment = row.get("experiment")
        if experiment == "butterfly_front":
            lines.append(
                f"butterfly_front {row['class']}: mean_t*={row['mean_scrambling_time']:.4f}, "
                f"slope={row['front_slope']:.4f}, v_B={row['butterfly_velocity']:.4f}"
            )
        elif experiment == "mixing":
            lines.append(
                f"mixing {row['class']}: lambda2={row['lambda2_abs']:.4f}, gap={row['spectral_gap']:.4f}, "
                f"tau={row['mixing_timescale']:.4f}, n_states={row['n_states']}"
            )
        elif experiment == "persistent_homology":
            lines.append(
                f"persistent_homology {row['class']}: available={row['available']}, "
                f"mean_H1_lifetime={row['h1_lifetime_mean']:.4f}"
            )
        elif experiment == "avalanche":
            lines.append(
                f"avalanche {row['class']}: n={row['n_avalanches']}, size_alpha={row['size_alpha_mle']:.4f}, "
                f"duration_alpha={row['duration_alpha_mle']:.4f}, size_r2={row['size_powerlaw_r2']:.4f}"
            )
        elif experiment == "complexity":
            lines.append(
                f"complexity {row['class']}: PI={row['predictive_information_mean']:.4f}, "
                f"Cmu={row['statistical_complexity_mean']:.4f}, TE={row['te_total_mean']:.4f}, "
                f"graph_H={row['graph_entropy_node_mean']:.4f}"
            )
        elif experiment == "te_network":
            lines.append(
                f"te_network {row['class']}: H_node={row['graph_entropy_node']:.4f}, "
                f"H_edge={row['graph_entropy_edge']:.4f}, communities={row['n_communities']}"
            )
        elif experiment == "edge_of_chaos":
            lines.append(
                f"edge_of_chaos {row['metric']}: peak near lambda={row['peak_lambda_bin_center']:.4f}, "
                f"mean={row['peak_metric_mean']:.4f}"
            )

    (out_dir / "chaos_transport_summary.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")


# ============================================================
# Main pipeline
# ============================================================


def infer_activity_from_trajectories(trajectories: torch.Tensor) -> torch.Tensor:
    """
    Returns global activity [R,T] using stepwise norm change.
    """
    X = flatten_trajectories(trajectories)
    dX = torch.linalg.norm(X[:, 1:, :] - X[:, :-1, :], dim=-1)
    pad = dX[:, :1] * 0
    return torch.cat([pad, dX], dim=1)


def infer_node_series(trajectories: torch.Tensor) -> Optional[torch.Tensor]:
    """
    Return [T,N] node activity from first run if trajectories are [R,T,N,D].
    """
    if trajectories.ndim != 4:
        return None
    X = trajectories[0]
    dX = torch.linalg.norm(X[1:] - X[:-1], dim=-1)
    pad = dX[:1] * 0
    return torch.cat([pad, dX], dim=0)


def save_json(obj: Any, path: str) -> None:
    def convert(o):
        if hasattr(o, "__dataclass_fields__"):
            return asdict(o)
        if isinstance(o, torch.Tensor):
            return to_numpy(o).tolist()
        if isinstance(o, np.ndarray):
            return o.tolist()
        if isinstance(o, (np.floating, np.integer)):
            return o.item()
        raise TypeError(type(o).__name__)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, indent=2, ensure_ascii=False, default=convert)


def run_pipeline(args: argparse.Namespace) -> Dict[str, Any]:
    out_dir = Path(args.out)
    ensure_dir(str(out_dir))
    data = load_pipeline_data(args)

    trajectories = data.get("trajectories", None)
    if trajectories is None:
        raise ValueError("No trajectories found. Provide --input data.pt with key 'trajectories'.")

    trajectories = trajectories.float()
    device = str(trajectories.device)
    classes = np.asarray(data.get("classes", ["all"] * trajectories.shape[0]))
    lambda_tensor = data.get("lambda1", data.get("lambda_values", None))
    lambda_values = to_numpy(lambda_tensor).astype(float) if lambda_tensor is not None else np.full(trajectories.shape[0], np.nan)
    sample_dt = float(data.get("sample_dt", args.dt))

    results: Dict[str, Any] = {
        "device": device,
        "output_dir": str(out_dir),
        "sample_dt": sample_dt,
    }
    summary_rows: List[Dict[str, Any]] = []

    otoc_distance = data.get("otoc_distance", data.get("perturbation_distance", None))
    distance_centers = data.get("distance_centers", data.get("r_values", None))
    otoc_times = data.get("otoc_times", None)
    if otoc_distance is not None and distance_centers is not None:
        if otoc_times is None:
            otoc_times = np.arange(otoc_distance.shape[-1], dtype=float) * sample_dt
        butterfly_by_class, butterfly_rows = summarize_butterfly_by_class(
            otoc_distance.float(),
            classes,
            np.asarray(distance_centers, dtype=float),
            np.asarray(otoc_times, dtype=float),
            threshold=args.butterfly_threshold,
        )
        results["butterfly_by_class"] = butterfly_by_class
        summary_rows.extend(butterfly_rows)
        plot_butterfly_by_class(butterfly_by_class, out_dir)

    transfer_by_class, mixing_rows = summarize_transfer_by_class(
        trajectories,
        classes,
        dt=sample_dt,
        n_components=args.transfer_components,
        n_bins_per_dim=args.transfer_bins,
    )
    results["transfer_by_class"] = transfer_by_class
    summary_rows.extend(mixing_rows)
    plot_transfer_operator_summary(transfer_by_class, out_dir)

    persistent_by_class, persistent_rows = summarize_persistent_homology_by_class(trajectories, classes, n_points=args.ph_points)
    results["persistent_homology_by_class"] = persistent_by_class
    summary_rows.extend(persistent_rows)
    plot_persistent_homology_summary(persistent_by_class, out_dir)

    activity = data.get("finite_lambda", None)
    if activity is None:
        activity = infer_activity_from_trajectories(trajectories)
    avalanche_by_class, avalanche_rows = summarize_avalanche_by_class(activity.float(), classes, threshold_quantile=args.avalanche_quantile)
    results["avalanche_by_class"] = avalanche_by_class
    summary_rows.extend(avalanche_rows)
    plot_avalanche_summary(avalanche_by_class, out_dir)

    metrics_df, class_networks, complexity_rows = compute_run_metrics(
        trajectories,
        classes,
        lambda_values,
        n_symbols=args.symbols,
        past_len=args.past_len,
        morph_tol=args.morph_tol,
        te_threshold_quantile=args.te_threshold_quantile,
    )
    results["metrics_table"] = metrics_df.to_dict("records")
    results["class_networks"] = class_networks
    summary_rows.extend(complexity_rows)
    plot_te_networks(class_networks, out_dir)

    if np.any(np.isfinite(metrics_df["Lyapunov_exponent"].to_numpy(dtype=float))):
        edge_rows = summarize_edge_of_chaos(metrics_df, n_bins=args.edge_bins)
        summary_rows.extend(edge_rows)
        results["edge_of_chaos"] = edge_rows
        plot_edge_metrics(metrics_df, out_dir, n_bins=args.edge_bins)
    elif args.do_edge_scan:
        lambda_grid = torch.linspace(args.lambda_min, args.lambda_max, args.n_lambda, device=trajectories.device)
        scan = edge_of_chaos_scan(lambda_grid, n_steps=args.n_steps, n_nodes=args.n_nodes, device=device)
        results["edge_scan"] = scan
        plot_edge_scan(scan, str(out_dir))

    save_tabular_outputs(metrics_df, summary_rows, out_dir, sample_dt=sample_dt)
    results["summary_rows"] = summary_rows
    save_json(results, str(out_dir / "analysis_results.json"))
    return results


def build_argparser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser()
    p.add_argument("--input", type=str, default=None, help="Optional .pt file containing trajectories and optional perturbation_distance.")
    p.add_argument("--out", type=str, default=str(DEFAULT_OUTDIR))
    p.add_argument("--cuda", action="store_true")
    p.add_argument("--dt", type=float, default=1.0)

    p.add_argument("--butterfly-threshold", type=float, default=1e3)
    p.add_argument("--transfer-components", type=int, default=2)
    p.add_argument("--transfer-bins", type=int, default=6)
    p.add_argument("--ph-points", type=int, default=1000)
    p.add_argument("--avalanche-quantile", type=float, default=0.9)
    p.add_argument("--symbols", type=int, default=4)
    p.add_argument("--past-len", type=int, default=3)
    p.add_argument("--morph-tol", type=float, default=0.08)
    p.add_argument("--te-threshold-quantile", type=float, default=0.8)
    p.add_argument("--edge-bins", type=int, default=10)

    p.add_argument("--do-edge-scan", action="store_true")
    p.add_argument("--lambda-min", type=float, default=0.04)
    p.add_argument("--lambda-max", type=float, default=0.20)
    p.add_argument("--n-lambda", type=int, default=81)
    p.add_argument("--n-steps", type=int, default=512)
    p.add_argument("--n-nodes", type=int, default=16)
    return p


if __name__ == "__main__":
    args = build_argparser().parse_args()
    results = run_pipeline(args)
    print(json.dumps({k: (asdict(v) if hasattr(v, "__dataclass_fields__") else str(v)[:200]) for k, v in results.items()}, indent=2, ensure_ascii=False))
    print(f"\nSaved results to: {os.path.abspath(args.out)}")

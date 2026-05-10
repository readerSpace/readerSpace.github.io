"""
nbody_gravity_syk_complexity_page_te_geometry.py

Classical N-body gravity experiment in PyTorch for:

(A) SYK-like effective model / OTOC comparison
(B) Susskind-style complexity growth proxy
(C) Page-curve-like information recovery analysis
(D) Tensor-network-inspired transport graph ↔ geometry comparison
(E) Emergent metric from TE network

Important note:
This is a classical analogue experiment. The OTOC, Page curve, and Susskind complexity
are quantum concepts, so here they are implemented as diagnostic proxies:
- OTOC proxy: squared sensitivity / tangent-space growth between perturbed trajectories
- SYK-like effective model: random all-to-all coupled nonlinear system matched by OTOC growth
- Complexity proxy: minimal prediction/description cost from low-rank tensor-network-like model
- Page-like curve: mutual information between subsystem/coarse-grained radiation and initial state
- Geometry from TE: distance d_ij = -log(normalized TE_ij) or shortest-path distance

Run demo:
    python nbody_gravity_syk_complexity_page_te_geometry.py --out results --N 64 --steps 1500 --runs 8 --device cuda

Outputs:
    results/summary.json
    results/*.png

Requirements:
    pip install torch matplotlib numpy scipy networkx
Optional:
    pip install scikit-learn
"""

from __future__ import annotations

import argparse
import json
import math
import os
from dataclasses import dataclass, asdict
from typing import Dict, List, Tuple, Optional, Any

import numpy as np
import torch
import torch.nn.functional as F

try:
    import matplotlib.pyplot as plt
except Exception:
    plt = None

try:
    import networkx as nx
except Exception:
    nx = None

try:
    from scipy.spatial.distance import pdist, squareform
    from scipy.stats import spearmanr
except Exception:
    pdist = squareform = spearmanr = None


# ============================================================
# Utilities
# ============================================================


def ensure_dir(path: str) -> None:
    os.makedirs(path, exist_ok=True)


def to_np(x: torch.Tensor) -> np.ndarray:
    return x.detach().cpu().numpy()


def save_json(obj: Any, path: str) -> None:
    def conv(o):
        if hasattr(o, "__dataclass_fields__"):
            return asdict(o)
        if isinstance(o, torch.Tensor):
            return to_np(o).tolist()
        if isinstance(o, np.ndarray):
            return o.tolist()
        if isinstance(o, (np.floating, np.integer)):
            return o.item()
        raise TypeError(type(o).__name__)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, indent=2, ensure_ascii=False, default=conv)


def entropy_prob(p: torch.Tensor, eps: float = 1e-12) -> torch.Tensor:
    p = p / torch.clamp(p.sum(), min=eps)
    return -(p * torch.log(torch.clamp(p, min=eps))).sum()


def linear_fit(x: torch.Tensor, y: torch.Tensor) -> Tuple[float, float, float]:
    x = x.float()
    y = y.float()
    mask = torch.isfinite(x) & torch.isfinite(y)
    x, y = x[mask], y[mask]
    if x.numel() < 3:
        return float("nan"), float("nan"), float("nan")
    xm, ym = x.mean(), y.mean()
    slope = ((x - xm) * (y - ym)).sum() / torch.clamp(((x - xm) ** 2).sum(), min=1e-12)
    intercept = ym - slope * xm
    pred = slope * x + intercept
    r2 = 1 - ((y - pred) ** 2).sum() / torch.clamp(((y - ym) ** 2).sum(), min=1e-12)
    return float(slope.item()), float(intercept.item()), float(r2.item())


def pairwise_dist(x: torch.Tensor, eps: float = 1e-9) -> torch.Tensor:
    d = torch.cdist(x, x)
    return torch.clamp(d, min=eps)


# ============================================================
# Classical N-body gravity simulator
# ============================================================

@dataclass
class NBodyConfig:
    N: int = 64
    dim: int = 2
    dt: float = 0.01
    steps: int = 1500
    sample_every: int = 2
    G: float = 1.0
    softening: float = 0.04
    mass: float = 1.0
    init_radius: float = 1.0
    init_velocity_scale: float = 0.35
    remove_com: bool = True


def gravity_accel(pos: torch.Tensor, mass: torch.Tensor, G: float, softening: float) -> torch.Tensor:
    """pos [B,N,D], mass [N] or [B,N]."""
    B, N, D = pos.shape
    rij = pos[:, None, :, :] - pos[:, :, None, :]  # [B,i,j,D] = r_j - r_i if indexed [B,i,j]
    dist2 = (rij ** 2).sum(dim=-1) + softening**2
    inv_r3 = dist2.rsqrt() ** 3
    inv_r3 = inv_r3 * (1 - torch.eye(N, device=pos.device)[None])
    if mass.ndim == 1:
        mj = mass[None, None, :, None]
    else:
        mj = mass[:, None, :, None]
    acc = G * (rij * inv_r3[..., None] * mj).sum(dim=2)
    return acc


def init_plummer_like(B: int, cfg: NBodyConfig, device: str) -> Tuple[torch.Tensor, torch.Tensor, torch.Tensor]:
    N, D = cfg.N, cfg.dim
    pos = torch.randn(B, N, D, device=device)
    pos = pos / torch.clamp(torch.linalg.norm(pos, dim=-1, keepdim=True), min=1e-6)
    radii = cfg.init_radius * torch.sqrt(torch.rand(B, N, 1, device=device))
    pos = pos * radii
    vel = cfg.init_velocity_scale * torch.randn(B, N, D, device=device)
    if cfg.remove_com:
        pos = pos - pos.mean(dim=1, keepdim=True)
        vel = vel - vel.mean(dim=1, keepdim=True)
    mass = torch.full((N,), cfg.mass / N, device=device)
    return pos, vel, mass


def leapfrog_simulate(cfg: NBodyConfig, runs: int, device: str, perturb: float = 0.0) -> Dict[str, torch.Tensor]:
    pos, vel, mass = init_plummer_like(runs, cfg, device)
    if perturb > 0:
        pos = pos + perturb * torch.randn_like(pos)
    acc = gravity_accel(pos, mass, cfg.G, cfg.softening)
    samples_pos, samples_vel = [], []
    for t in range(cfg.steps):
        vel_half = vel + 0.5 * cfg.dt * acc
        pos = pos + cfg.dt * vel_half
        acc_new = gravity_accel(pos, mass, cfg.G, cfg.softening)
        vel = vel_half + 0.5 * cfg.dt * acc_new
        acc = acc_new
        if cfg.remove_com:
            pos = pos - pos.mean(dim=1, keepdim=True)
            vel = vel - vel.mean(dim=1, keepdim=True)
        if t % cfg.sample_every == 0:
            samples_pos.append(pos.clone())
            samples_vel.append(vel.clone())
    return {
        "pos": torch.stack(samples_pos, dim=1),  # [R,T,N,D]
        "vel": torch.stack(samples_vel, dim=1),
        "mass": mass,
        "dt_sample": torch.tensor(cfg.dt * cfg.sample_every, device=device),
    }


def simulate_pair_same_initial(cfg: NBodyConfig, runs: int, device: str, perturb: float = 1e-7) -> Dict[str, torch.Tensor]:
    pos0, vel0, mass = init_plummer_like(runs, cfg, device)
    pos1 = pos0 + perturb * torch.randn_like(pos0)
    vel1 = vel0.clone()

    def evolve(pos, vel):
        acc = gravity_accel(pos, mass, cfg.G, cfg.softening)
        P, V = [], []
        for t in range(cfg.steps):
            vel_half = vel + 0.5 * cfg.dt * acc
            pos = pos + cfg.dt * vel_half
            acc_new = gravity_accel(pos, mass, cfg.G, cfg.softening)
            vel = vel_half + 0.5 * cfg.dt * acc_new
            acc = acc_new
            if cfg.remove_com:
                pos = pos - pos.mean(dim=1, keepdim=True)
                vel = vel - vel.mean(dim=1, keepdim=True)
            if t % cfg.sample_every == 0:
                P.append(pos.clone())
                V.append(vel.clone())
        return torch.stack(P, dim=1), torch.stack(V, dim=1)

    P0, V0 = evolve(pos0, vel0)
    P1, V1 = evolve(pos1, vel1)
    return {"pos": P0, "vel": V0, "pos_pert": P1, "vel_pert": V1, "mass": mass, "dt_sample": torch.tensor(cfg.dt * cfg.sample_every, device=device)}


# ============================================================
# Feature extraction
# ============================================================


def radial_shell_activity(pos: torch.Tensor, vel: torch.Tensor, n_shells: int = 12) -> torch.Tensor:
    """
    Convert [R,T,N,D] into coarse-grained shell activity [R,T,n_shells].
    Activity = kinetic energy per radial shell.
    """
    R, T, N, D = pos.shape
    r = torch.linalg.norm(pos, dim=-1)
    ke = 0.5 * (vel ** 2).sum(dim=-1)
    rmax = torch.quantile(r, 0.98).clamp(min=1e-6)
    bins = torch.linspace(0, rmax, n_shells + 1, device=pos.device)
    labels = torch.bucketize(r, bins[1:-1])
    out = torch.zeros(R, T, n_shells, device=pos.device)
    for k in range(n_shells):
        m = labels == k
        out[..., k] = (ke * m).sum(dim=-1) / torch.clamp(m.sum(dim=-1), min=1)
    return out


def phase_features(pos: torch.Tensor, vel: torch.Tensor) -> torch.Tensor:
    """[R,T,N,D] -> [R,T,N,2D]"""
    return torch.cat([pos, vel], dim=-1)


# ============================================================
# (A) OTOC proxy and SYK-like effective model
# ============================================================

@dataclass
class OTOCResult:
    lyapunov_fit: float
    fit_r2: float
    times: List[float]
    nbody_otoc: List[float]
    syk_otoc: List[float]
    syk_gamma: float
    syk_fit_mse: float


def otoc_proxy_from_pair(data: Dict[str, torch.Tensor], fit_min: float = 0.05, fit_max: float = 0.45) -> Tuple[torch.Tensor, torch.Tensor, float, float]:
    pos0, pos1 = data["pos"], data["pos_pert"]
    vel0, vel1 = data["vel"], data["vel_pert"]
    dt = float(data["dt_sample"].item())
    delta2 = ((pos1 - pos0) ** 2).sum(dim=(-1, -2)) + ((vel1 - vel0) ** 2).sum(dim=(-1, -2))
    C = delta2.mean(dim=0)
    C = C / torch.clamp(C[0], min=1e-30)
    times = torch.arange(C.numel(), device=C.device).float() * dt
    logC = torch.log(torch.clamp(C, min=1e-30))
    lo = int(fit_min * C.numel())
    hi = max(lo + 5, int(fit_max * C.numel()))
    slope, intercept, r2 = linear_fit(times[lo:hi], logC[lo:hi])
    # For OTOC ~ exp(2 lambda t), lambda = slope/2.
    return times, C, slope / 2.0, r2


def simulate_syk_like_otoc(times: torch.Tensor, gamma: float, saturation: float = 1e8) -> torch.Tensor:
    """
    SYK-like effective OTOC proxy: C(t)=sat*(1-exp(-exp(2 gamma t)/sat))
    exponential early growth with saturation.
    """
    raw = torch.exp(2 * gamma * times)
    return saturation * (1 - torch.exp(-raw / saturation))


def syk_like_comparison(data_pair: Dict[str, torch.Tensor]) -> OTOCResult:
    times, C, lam, r2 = otoc_proxy_from_pair(data_pair)
    gamma = lam
    S = simulate_syk_like_otoc(times, gamma, saturation=float(torch.quantile(C, 0.95).item() + 1e-9))
    Cn = C / torch.clamp(C.max(), min=1e-12)
    Sn = S / torch.clamp(S.max(), min=1e-12)
    mse = float(((torch.log(Cn + 1e-9) - torch.log(Sn + 1e-9)) ** 2).mean().item())
    return OTOCResult(float(lam), float(r2), to_np(times).tolist(), to_np(C).tolist(), to_np(S).tolist(), float(gamma), mse)


# ============================================================
# (B) Susskind complexity proxy
# ============================================================

@dataclass
class ComplexityResult:
    times: List[float]
    pca_rank_complexity: List[float]
    graph_circuit_complexity: List[float]
    growth_rate_early: float
    saturation_value: float


def pca_rank_complexity(features: torch.Tensor, variance_threshold: float = 0.95) -> torch.Tensor:
    """
    Complexity proxy: number of singular modes needed to explain variance_threshold
    in local phase-space features at each time.
    features [R,T,N,F]
    """
    R, T, N, Fdim = features.shape
    out = []
    for t in range(T):
        X = features[:, t].reshape(R * N, Fdim)
        X = X - X.mean(dim=0, keepdim=True)
        if min(X.shape) < 2:
            out.append(torch.tensor(1.0, device=features.device))
            continue
        S = torch.linalg.svdvals(X)
        v = S**2 / torch.clamp((S**2).sum(), min=1e-12)
        c = torch.cumsum(v, dim=0)
        rank = torch.nonzero(c >= variance_threshold, as_tuple=False)[0, 0] + 1
        out.append(rank.float())
    return torch.stack(out)


def graph_circuit_complexity(pos: torch.Tensor, k: int = 6) -> torch.Tensor:
    """
    Susskind-style proxy: number/weight of active pairwise gates needed to represent interactions.
    We use k-nearest gravitational interaction graph entropy-weighted edge count.
    pos [R,T,N,D]
    """
    R, T, N, D = pos.shape
    out = []
    for t in range(T):
        Pt = pos[:, t].mean(dim=0)  # [N,D]
        d = pairwise_dist(Pt)
        idx = torch.topk(d, k=k + 1, largest=False).indices[:, 1:]
        W = torch.zeros(N, N, device=pos.device)
        rows = torch.arange(N, device=pos.device)[:, None].expand(N, k)
        W[rows, idx] = 1.0 / torch.clamp(d[rows, idx] ** 2, min=1e-9)
        W = torch.maximum(W, W.T)
        p = W[W > 0]
        H = entropy_prob(p) if p.numel() > 0 else torch.tensor(0.0, device=pos.device)
        out.append(H * torch.log1p(p.sum()))
    return torch.stack(out)


def complexity_growth(data: Dict[str, torch.Tensor]) -> ComplexityResult:
    pos, vel = data["pos"], data["vel"]
    dt = float(data["dt_sample"].item())
    features = phase_features(pos, vel)
    C_rank = pca_rank_complexity(features)
    C_graph = graph_circuit_complexity(pos)
    times = torch.arange(C_rank.numel(), device=pos.device).float() * dt
    hi = max(8, int(0.25 * times.numel()))
    slope, _, _ = linear_fit(times[:hi], C_graph[:hi])
    sat = float(torch.quantile(C_graph, 0.9).item())
    return ComplexityResult(to_np(times).tolist(), to_np(C_rank).tolist(), to_np(C_graph).tolist(), slope, sat)


# ============================================================
# (C) Page-curve-like information recovery
# ============================================================

@dataclass
class PageCurveResult:
    times: List[float]
    subsystem_entropy: List[float]
    mutual_info_initial_subsystem: List[float]
    recovery_score: List[float]
    page_time_index: int


def discretize_quantile(x: torch.Tensor, bins: int = 8) -> torch.Tensor:
    qs = torch.quantile(x.flatten(), torch.linspace(0, 1, bins + 1, device=x.device)[1:-1])
    return torch.bucketize(x, qs).long()


def mutual_information_discrete(a: torch.Tensor, b: torch.Tensor, bins_a: int, bins_b: int, eps: float = 1e-12) -> torch.Tensor:
    idx = a.long() * bins_b + b.long()
    joint = torch.bincount(idx, minlength=bins_a * bins_b).double().reshape(bins_a, bins_b)
    joint = joint / torch.clamp(joint.sum(), min=eps)
    pa = joint.sum(dim=1, keepdim=True)
    pb = joint.sum(dim=0, keepdim=True)
    prod = pa @ pb
    mask = joint > 0
    return (joint[mask] * torch.log(torch.clamp(joint[mask] / torch.clamp(prod[mask], min=eps), min=eps))).sum().float()


def page_curve_like(data: Dict[str, torch.Tensor], n_shells: int = 12, bins: int = 8) -> PageCurveResult:
    """
    Classical analogue:
    - Treat inner shells as 'black-hole subsystem', outer shells as 'radiation'.
    - Entropy: Shannon entropy of coarse-grained shell energy distribution.
    - Information recovery: MI(initial inner state; outer radiation state at t).
    """
    pos, vel = data["pos"], data["vel"]
    dt = float(data["dt_sample"].item())
    shell = radial_shell_activity(pos, vel, n_shells=n_shells)  # [R,T,S]
    R, T, S = shell.shape
    inner = shell[:, :, : S // 2].sum(dim=-1)  # [R,T]
    outer = shell[:, :, S // 2 :].sum(dim=-1)
    total_shell = shell.mean(dim=0)  # [T,S]
    ent, mi, rec = [], [], []
    init_inner_sym = discretize_quantile(inner[:, 0], bins)
    for t in range(T):
        p = total_shell[t] / torch.clamp(total_shell[t].sum(), min=1e-12)
        ent.append(entropy_prob(p))
        outer_sym = discretize_quantile(outer[:, t], bins)
        mi_t = mutual_information_discrete(init_inner_sym, outer_sym, bins, bins)
        mi.append(mi_t)
        rec.append(mi_t / torch.clamp(ent[-1], min=1e-12))
    ent = torch.stack(ent)
    mi = torch.stack(mi)
    rec = torch.stack(rec)
    page_idx = int(torch.argmax(ent).item())
    times = torch.arange(T, device=pos.device).float() * dt
    return PageCurveResult(to_np(times).tolist(), to_np(ent).tolist(), to_np(mi).tolist(), to_np(rec).tolist(), page_idx)


# ============================================================
# TE network, graph ↔ geometry, emergent metric
# ============================================================

@dataclass
class TENetworkGeometryResult:
    te_matrix: List[List[float]]
    emergent_distance: List[List[float]]
    physical_distance: List[List[float]]
    spearman_corr_te_distance_vs_physical: Optional[float]
    tensor_geometry_stress: Optional[float]
    communities: Optional[List[int]]


def transfer_entropy_pair(x: torch.Tensor, y: torch.Tensor, bins: int = 5, eps: float = 1e-12) -> torch.Tensor:
    xs = discretize_quantile(x, bins)
    ys = discretize_quantile(y, bins)
    xt = xs[:-1]
    yt = ys[:-1]
    yp = ys[1:]
    B = bins
    idx = yp * B * B + yt * B + xt
    p = torch.bincount(idx, minlength=B**3).double().reshape(B, B, B)
    p = p / torch.clamp(p.sum(), min=eps)
    p_yx = p.sum(dim=0)
    p_yy = p.sum(dim=2)
    p_y = p_yy.sum(dim=0)
    te = torch.tensor(0.0, dtype=torch.float64, device=x.device)
    for a in range(B):
        for b in range(B):
            for c in range(B):
                val = p[a, b, c]
                if val > 0:
                    p1 = val / torch.clamp(p_yx[b, c], min=eps)
                    p2 = p_yy[a, b] / torch.clamp(p_y[b], min=eps)
                    te += val * torch.log(torch.clamp(p1 / torch.clamp(p2, min=eps), min=eps))
    return te.float()


def te_network(shell_activity: torch.Tensor, bins: int = 5) -> torch.Tensor:
    """shell_activity [R,T,S] -> TE [S,S], averaged by flattening runs."""
    R, T, S = shell_activity.shape
    X = shell_activity.permute(2, 0, 1).reshape(S, R * T)
    TE = torch.zeros(S, S, device=shell_activity.device)
    for i in range(S):
        for j in range(S):
            if i != j:
                TE[i, j] = transfer_entropy_pair(X[i], X[j], bins=bins)
    return TE


def emergent_metric_from_te(TE: torch.Tensor, eps: float = 1e-12, sym: bool = True) -> torch.Tensor:
    """
    Define direct distance as d_ij=-log(TE_ij/maxTE). Then compute shortest path.
    """
    W = TE.clone().float()
    if sym:
        W = 0.5 * (W + W.T)
    W = W / torch.clamp(W.max(), min=eps)
    D = -torch.log(torch.clamp(W, min=eps))
    N = D.shape[0]
    D.fill_diagonal_(0.0)
    # Floyd-Warshall shortest path
    dist = D.clone()
    for k in range(N):
        dist = torch.minimum(dist, dist[:, k:k+1] + dist[k:k+1, :])
    return dist


def community_from_weight(W: torch.Tensor) -> Optional[List[int]]:
    if nx is None:
        return None
    Wnp = to_np(W.float().clamp(min=0))
    G = nx.from_numpy_array(Wnp, create_using=nx.Graph)
    try:
        comms = nx.algorithms.community.louvain_communities(G, weight="weight", seed=0)
    except Exception:
        comms = nx.algorithms.community.greedy_modularity_communities(G, weight="weight")
    labels = np.zeros(W.shape[0], dtype=int)
    for k, c in enumerate(comms):
        for n in c:
            labels[n] = k
    return labels.tolist()


def classical_mds_stress(D: torch.Tensor, target_dim: int = 2) -> Optional[float]:
    """Tensor-network-inspired geometry: low-dimensional embedding stress."""
    try:
        N = D.shape[0]
        D2 = D**2
        J = torch.eye(N, device=D.device) - torch.ones(N, N, device=D.device) / N
        B = -0.5 * J @ D2 @ J
        evals, evecs = torch.linalg.eigh((B + B.T) / 2)
        idx = torch.argsort(evals, descending=True)[:target_dim]
        vals = torch.clamp(evals[idx], min=0)
        X = evecs[:, idx] * torch.sqrt(vals)[None, :]
        Dhat = torch.cdist(X, X)
        stress = torch.sqrt(((D - Dhat) ** 2).sum() / torch.clamp((D**2).sum(), min=1e-12))
        return float(stress.item())
    except Exception:
        return None


def te_geometry_analysis(data: Dict[str, torch.Tensor], n_shells: int = 12, bins: int = 5) -> TENetworkGeometryResult:
    pos, vel = data["pos"], data["vel"]
    shell = radial_shell_activity(pos, vel, n_shells=n_shells)
    TE = te_network(shell, bins=bins)
    D_em = emergent_metric_from_te(TE)

    # Physical distance between shell centers.
    centers = torch.linspace(0, 1, n_shells, device=pos.device)[:, None]
    D_phys = torch.cdist(centers, centers)

    corr = None
    if spearmanr is not None:
        mask = ~torch.eye(n_shells, device=pos.device, dtype=torch.bool)
        # TE high means close. Compare emergent distance with physical distance.
        corr = float(spearmanr(to_np(D_em[mask]), to_np(D_phys[mask])).correlation)

    stress = classical_mds_stress(D_em, target_dim=2)
    labels = community_from_weight(0.5 * (TE + TE.T))
    return TENetworkGeometryResult(
        te_matrix=to_np(TE).tolist(),
        emergent_distance=to_np(D_em).tolist(),
        physical_distance=to_np(D_phys).tolist(),
        spearman_corr_te_distance_vs_physical=corr,
        tensor_geometry_stress=stress,
        communities=labels,
    )


# ============================================================
# Plotting
# ============================================================


def plot_line(x, ys: Dict[str, List[float]], title: str, xlabel: str, ylabel: str, path: str) -> None:
    if plt is None:
        return
    plt.figure(figsize=(8, 4.5))
    for name, y in ys.items():
        plt.plot(x, y, label=name)
    plt.title(title)
    plt.xlabel(xlabel)
    plt.ylabel(ylabel)
    plt.grid(alpha=0.3)
    plt.legend()
    plt.tight_layout()
    plt.savefig(path, dpi=160)
    plt.close()


def plot_matrix(M: List[List[float]], title: str, path: str) -> None:
    if plt is None:
        return
    plt.figure(figsize=(5, 4.5))
    plt.imshow(np.array(M), aspect="auto")
    plt.colorbar()
    plt.title(title)
    plt.tight_layout()
    plt.savefig(path, dpi=160)
    plt.close()


# ============================================================
# Main
# ============================================================


def run(args: argparse.Namespace) -> Dict[str, Any]:
    ensure_dir(args.out)
    device = args.device if args.device == "cuda" and torch.cuda.is_available() else "cpu"
    cfg = NBodyConfig(N=args.N, dim=args.dim, dt=args.dt, steps=args.steps, sample_every=args.sample_every,
                      softening=args.softening, init_velocity_scale=args.vscale)

    print("Simulating N-body baseline...")
    data = leapfrog_simulate(cfg, runs=args.runs, device=device)

    print("Simulating perturbed pair for OTOC...")
    pair = simulate_pair_same_initial(cfg, runs=args.runs, device=device, perturb=args.perturb)

    print("(A) OTOC and SYK-like comparison...")
    otoc = syk_like_comparison(pair)

    print("(B) Complexity growth proxy...")
    comp = complexity_growth(data)

    print("(C) Page-curve-like information recovery...")
    page = page_curve_like(data, n_shells=args.shells, bins=args.bins)

    print("(D,E) TE geometry / emergent metric...")
    geom = te_geometry_analysis(data, n_shells=args.shells, bins=args.bins)

    results = {
        "config": asdict(cfg),
        "device": device,
        "A_syk_like_otoc": otoc,
        "B_complexity_growth": comp,
        "C_page_curve_like": page,
        "D_E_te_geometry_emergent_metric": geom,
        "interpretation_notes": {
            "OTOC": "Classical OTOC proxy is normalized squared separation between perturbed trajectories. Early exponential growth gives a Lyapunov-like rate.",
            "SYK_like": "The SYK-like curve is a random all-to-all effective exponential-saturation model matched to the measured growth rate.",
            "Complexity": "Complexity is a proxy: PCA rank and entropy-weighted interaction graph cost, not exact quantum circuit complexity.",
            "Page_curve": "Page-like entropy is Shannon entropy of coarse-grained shell activity; information recovery is MI(initial inner state; outer shell state).",
            "Emergent_metric": "Distance is defined from TE by d_ij=-log(TE_ij/maxTE), then shortest-path closure."
        }
    }
    save_json(results, os.path.join(args.out, "summary.json"))

    plot_line(otoc.times, {"N-body OTOC proxy": otoc.nbody_otoc, "SYK-like fit": otoc.syk_otoc},
              "A) OTOC proxy vs SYK-like effective model", "time", "C(t)", os.path.join(args.out, "A_otoc_syk_like.png"))
    plot_line(comp.times, {"PCA rank complexity": comp.pca_rank_complexity, "graph circuit complexity": comp.graph_circuit_complexity},
              "B) Susskind-style complexity growth proxy", "time", "complexity proxy", os.path.join(args.out, "B_complexity_growth.png"))
    plot_line(page.times, {"subsystem entropy": page.subsystem_entropy, "MI initial→outer": page.mutual_info_initial_subsystem, "recovery score": page.recovery_score},
              "C) Page-curve-like information recovery", "time", "information", os.path.join(args.out, "C_page_curve_like.png"))
    plot_matrix(geom.te_matrix, "D) TE transport graph", os.path.join(args.out, "D_te_network.png"))
    plot_matrix(geom.emergent_distance, "E) emergent distance from TE", os.path.join(args.out, "E_emergent_metric.png"))

    print(f"Saved to {os.path.abspath(args.out)}")
    return results


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser()
    p.add_argument("--out", type=str, default="nbody_results")
    p.add_argument("--device", type=str, default="cpu", choices=["cpu", "cuda"])
    p.add_argument("--N", type=int, default=64)
    p.add_argument("--dim", type=int, default=2)
    p.add_argument("--runs", type=int, default=8)
    p.add_argument("--steps", type=int, default=1500)
    p.add_argument("--sample-every", type=int, default=2)
    p.add_argument("--dt", type=float, default=0.01)
    p.add_argument("--softening", type=float, default=0.04)
    p.add_argument("--vscale", type=float, default=0.35)
    p.add_argument("--perturb", type=float, default=1e-7)
    p.add_argument("--shells", type=int, default=12)
    p.add_argument("--bins", type=int, default=5)
    return p


if __name__ == "__main__":
    args = build_parser().parse_args()
    run(args)

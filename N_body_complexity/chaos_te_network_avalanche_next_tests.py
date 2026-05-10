"""
chaos_te_network_avalanche_next_tests.py

Next-step validation toolkit for chaos transport experiments.

From chaos_transport_te_network results:
(A) betweenness centrality: bottleneck nodes
(B) eigenvector centrality: hub dominance
(C) assortativity: similar-node coupling
(D) modularity: metastable basin extraction
(E) spectral gap: information mixing rate

From chaos_transport_avalanche_scaling results:
(A) large-sample avalanche generation / batch aggregation
(B) CCDF P(S > s) on log-log axes
(C) power-law vs lognormal comparison using Clauset-Shalizi-Newman style fitting
(D) avalanche spatial structure: front propagation, cluster shape, fractal dimension

Input options:
1. Load existing analysis_results.json from previous script.
2. Load tensors directly from .pt:
   {
       "te_matrices": {"weak_chaos": Tensor[N,N], ...} OR Tensor[C,N,N],
       "activity": Tensor[R,T,N] or Tensor[T,N],
       "classes": list[str] optional
   }
3. Demo mode creates synthetic data.

Example:
    python chaos_te_network_avalanche_next_tests.py \
        --json results/analysis_results.json \
        --out next_results

    python chaos_te_network_avalanche_next_tests.py \
        --pt data.pt --out next_results --n-bootstrap 1000

Notes:
- TE matrices should be nonnegative directed adjacency matrices.
- Avalanche activity should be node-level activity [R,T,N] or [T,N].
- Power-law conclusions require many events; use --n-bootstrap 100 to 1000 if your simulator or data supports many runs.
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import os
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Dict, List, Tuple, Optional, Any

import numpy as np
import torch

try:
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
except Exception:
    plt = None

try:
    import networkx as nx
except Exception:
    nx = None

try:
    from scipy import stats
except Exception:
    stats = None

import numerical_exp as ne


BASE_DIR = Path(__file__).resolve().parent
DEFAULT_PREVIOUS_JSON = BASE_DIR / "chaos_transport_outputs" / "analysis_results.json"
DEFAULT_OUTDIR = BASE_DIR / "chaos_te_network_avalanche_outputs"
CLASS_ORDER = ["weak_chaos", "intermediate", "strong_chaos"]
CLASS_COLORS = {
    "weak_chaos": "#3c7dc4",
    "intermediate": "#8a8f99",
    "strong_chaos": "#d05f3f",
}


# ============================================================
# Utility
# ============================================================


def ensure_dir(path: str) -> None:
    os.makedirs(path, exist_ok=True)


def to_np(x: torch.Tensor) -> np.ndarray:
    if isinstance(x, torch.Tensor):
        return x.detach().cpu().numpy()
    return np.asarray(x)


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


def ordered_classes(names: List[str] | np.ndarray) -> List[str]:
    labels = [str(name) for name in np.asarray(names).tolist()]
    ordered = [class_name for class_name in CLASS_ORDER if class_name in labels]
    for label in labels:
        if label not in ordered:
            ordered.append(label)
    return ordered


def write_csv_rows(rows: List[Dict[str, Any]], path: Path) -> None:
    if not rows:
        path.write_text("", encoding="utf-8")
        return

    fieldnames: List[str] = []
    for row in rows:
        for key in row.keys():
            if key not in fieldnames:
                fieldnames.append(key)

    with open(path, "w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        for row in rows:
            writer.writerow(row)


def infer_node_activity_all_runs(trajectories: torch.Tensor) -> torch.Tensor:
    if trajectories.ndim != 4:
        raise ValueError("trajectories must have shape [R,T,N,D] to infer node activity")
    dX = torch.linalg.norm(trajectories[:, 1:] - trajectories[:, :-1], dim=-1)
    pad = dX[:, :1] * 0
    return torch.cat([pad, dX], dim=1)


def load_repository_activity(device: str) -> Dict[str, torch.Tensor]:
    data = ne.load_data()
    trajectories = data["trajectories"].to(device=device, dtype=torch.float32)
    classes = np.asarray(data["classes"])
    activity = infer_node_activity_all_runs(trajectories)
    grouped: Dict[str, torch.Tensor] = {}
    for class_name in ordered_classes(classes):
        idx = np.where(classes == class_name)[0]
        if idx.size == 0:
            continue
        grouped[class_name] = activity[idx]
    return grouped


def event_mean(values: List[float]) -> float:
    arr = np.asarray(values, dtype=float)
    if arr.size == 0 or not np.any(np.isfinite(arr)):
        return float("nan")
    return float(np.nanmean(arr))


def entropy_prob(p: torch.Tensor, eps: float = 1e-12) -> torch.Tensor:
    p = torch.clamp(p.float(), min=0)
    p = p / torch.clamp(p.sum(), min=eps)
    return -(p * torch.log(torch.clamp(p, min=eps))).sum()


def normalize_adjacency(W: torch.Tensor, eps: float = 1e-12) -> torch.Tensor:
    W = torch.clamp(W.float(), min=0)
    W = W.clone()
    W.fill_diagonal_(0.0)
    if W.max() > 0:
        W = W / torch.clamp(W.max(), min=eps)
    return W


def row_stochastic(W: torch.Tensor, eps: float = 1e-12) -> torch.Tensor:
    W = torch.clamp(W.float(), min=0)
    W = W.clone()
    W.fill_diagonal_(0.0)
    rowsum = W.sum(dim=1, keepdim=True)
    N = W.shape[0]
    # If isolated row, use weak self-loop to avoid NaNs.
    P = W / torch.clamp(rowsum, min=eps)
    isolated = rowsum.squeeze(-1) <= eps
    if isolated.any():
        P[isolated] = 0.0
        P[isolated, isolated] = 1.0
    return P


# ============================================================
# TE network metrics
# ============================================================

@dataclass
class TENetworkMetricResult:
    class_name: str
    n_nodes: int
    betweenness: List[float]
    bottleneck_node: int
    eigenvector_centrality: List[float]
    hub_node: int
    assortativity_strength: float
    assortativity_degree: Optional[float]
    modularity: Optional[float]
    communities: List[int]
    n_communities: int
    spectral_gap: float
    lambda2_abs: float
    mixing_timescale: float
    stationary_entropy: float
    notes: Dict[str, str]


def torch_eigenvector_centrality(W: torch.Tensor, n_iter: int = 200, eps: float = 1e-12) -> torch.Tensor:
    """
    Directed eigenvector centrality proxy using incoming influence W^T.
    x <- W^T x, normalized.
    """
    W = normalize_adjacency(W)
    N = W.shape[0]
    x = torch.ones(N, device=W.device) / math.sqrt(N)
    A = W.T
    for _ in range(n_iter):
        y = A @ x
        n = torch.linalg.norm(y)
        if n <= eps:
            return torch.zeros_like(x)
        x = y / n
    return torch.clamp(x, min=0)


def torch_spectral_gap(W: torch.Tensor, eps: float = 1e-12) -> Tuple[float, float, float, torch.Tensor]:
    """
    Mixing of directed TE graph via row-stochastic Markov matrix P.
    gap = 1 - |lambda_2|.
    tau = -1/log(|lambda_2|).
    """
    P = row_stochastic(W, eps=eps)
    eig = torch.linalg.eigvals(P)
    vals = torch.sort(torch.abs(eig), descending=True).values
    lambda2 = vals[1] if vals.numel() > 1 else torch.tensor(float("nan"), device=W.device)
    gap = 1.0 - lambda2
    tau = -1.0 / torch.log(torch.clamp(lambda2, min=eps, max=1.0 - eps))
    return float(gap.item()), float(lambda2.item()), float(tau.item()), P


def stationary_distribution(P: torch.Tensor, n_iter: int = 2000, eps: float = 1e-12) -> torch.Tensor:
    N = P.shape[0]
    pi = torch.ones(N, device=P.device) / N
    for _ in range(n_iter):
        pi2 = pi @ P
        if torch.linalg.norm(pi2 - pi) < 1e-10:
            break
        pi = pi2
    return pi / torch.clamp(pi.sum(), min=eps)


def weighted_assortativity_strength(W: torch.Tensor, eps: float = 1e-12) -> float:
    """
    Weighted assortativity by node strength.
    Positive: strong nodes tend to connect to strong nodes.
    Negative: hub-to-periphery / disassortative.
    """
    W = normalize_adjacency(W)
    N = W.shape[0]
    s_out = W.sum(dim=1)
    s_in = W.sum(dim=0)
    strength = 0.5 * (s_in + s_out)
    edges = torch.nonzero(W > 0, as_tuple=False)
    if edges.shape[0] < 2:
        return float("nan")
    weights = W[edges[:, 0], edges[:, 1]]
    x = strength[edges[:, 0]]
    y = strength[edges[:, 1]]
    w = weights / torch.clamp(weights.sum(), min=eps)
    mx = (w * x).sum()
    my = (w * y).sum()
    cov = (w * (x - mx) * (y - my)).sum()
    vx = (w * (x - mx) ** 2).sum()
    vy = (w * (y - my) ** 2).sum()
    return float((cov / torch.sqrt(torch.clamp(vx * vy, min=eps))).item())


def networkx_metrics(W: torch.Tensor) -> Tuple[List[float], Optional[float], Optional[float], List[int], int]:
    """
    Returns betweenness, degree assortativity, modularity, labels, n_communities.
    Uses distances = 1 / weight for betweenness.
    """
    N = W.shape[0]
    Wnp = to_np(normalize_adjacency(W))
    if nx is None:
        return [float("nan")] * N, None, None, [0] * N, 1

    G_dir = nx.from_numpy_array(Wnp, create_using=nx.DiGraph)
    for u, v, d in G_dir.edges(data=True):
        weight = d.get("weight", 0.0)
        d["distance"] = 1.0 / max(weight, 1e-12)

    bet = nx.betweenness_centrality(G_dir, weight="distance", normalized=True)
    bet_list = [float(bet.get(i, 0.0)) for i in range(N)]

    G_und = nx.from_numpy_array(0.5 * (Wnp + Wnp.T), create_using=nx.Graph)
    for u, v, d in G_und.edges(data=True):
        weight = d.get("weight", 0.0)
        d["distance"] = 1.0 / max(weight, 1e-12)

    try:
        assort_degree = float(nx.degree_assortativity_coefficient(G_und, weight="weight"))
    except Exception:
        assort_degree = None

    try:
        comms = nx.algorithms.community.louvain_communities(G_und, weight="weight", seed=0)
    except Exception:
        try:
            comms = nx.algorithms.community.greedy_modularity_communities(G_und, weight="weight")
        except Exception:
            comms = [set(range(N))]

    labels = np.zeros(N, dtype=int)
    for k, c in enumerate(comms):
        for node in c:
            labels[node] = k
    try:
        mod = float(nx.algorithms.community.modularity(G_und, comms, weight="weight"))
    except Exception:
        mod = None
    return bet_list, assort_degree, mod, labels.tolist(), len(comms)


def analyze_te_network(W: torch.Tensor, class_name: str) -> TENetworkMetricResult:
    W = normalize_adjacency(W)
    N = W.shape[0]
    bet, assort_degree, modularity, labels, n_comms = networkx_metrics(W)
    ev = torch_eigenvector_centrality(W)
    gap, l2, tau, P = torch_spectral_gap(W)
    pi = stationary_distribution(P)
    Hpi = entropy_prob(pi)
    bottleneck = int(np.nanargmax(np.array(bet))) if len(bet) > 0 else -1
    hub = int(torch.argmax(ev).item()) if ev.numel() > 0 else -1
    return TENetworkMetricResult(
        class_name=class_name,
        n_nodes=N,
        betweenness=bet,
        bottleneck_node=bottleneck,
        eigenvector_centrality=to_np(ev).tolist(),
        hub_node=hub,
        assortativity_strength=weighted_assortativity_strength(W),
        assortativity_degree=assort_degree,
        modularity=modularity,
        communities=labels,
        n_communities=n_comms,
        spectral_gap=gap,
        lambda2_abs=l2,
        mixing_timescale=tau,
        stationary_entropy=float(Hpi.item()),
        notes={
            "betweenness": "High value means the node lies on many shortest causal-transport paths; candidate bottleneck.",
            "eigenvector_centrality": "High value means the node receives influence from influential nodes; hub dominance proxy.",
            "assortativity": "Positive means similar-strength nodes couple; negative means hub-periphery coupling.",
            "modularity": "Higher modularity suggests separated metastable basins in the TE graph.",
            "spectral_gap": "Larger gap means faster Markov mixing on the TE network; smaller gap means long-lived modes."
        },
    )


# ============================================================
# Avalanche extraction and statistics
# ============================================================

@dataclass
class AvalancheEvent:
    run: int
    start: int
    end: int
    duration: int
    size: float
    area: int
    max_front_radius: float
    front_velocity: float
    fractal_dimension_box: float
    radius_of_gyration: float
    anisotropy: float


@dataclass
class AvalancheScalingResult:
    class_name: str
    threshold: float
    n_events: int
    size_alpha: float
    size_xmin: float
    duration_alpha: float
    duration_xmin: float
    powerlaw_lognormal_llr_size: float
    powerlaw_lognormal_p_size: Optional[float]
    powerlaw_lognormal_llr_duration: float
    powerlaw_lognormal_p_duration: Optional[float]
    ccdf_size_x: List[float]
    ccdf_size_y: List[float]
    ccdf_duration_x: List[float]
    ccdf_duration_y: List[float]
    events: List[AvalancheEvent]
    notes: Dict[str, str]


def connected_components_binary(binary: torch.Tensor) -> List[torch.Tensor]:
    """
    binary [T,N] event mask. Connected components in 1D space + time with 4-neighborhood.
    Returns list of coordinates [M,2] = (t,node).
    """
    T, N = binary.shape
    visited = torch.zeros_like(binary, dtype=torch.bool)
    comps = []
    for t in range(T):
        for n in range(N):
            if not binary[t, n] or visited[t, n]:
                continue
            stack = [(t, n)]
            visited[t, n] = True
            coords = []
            while stack:
                a, b = stack.pop()
                coords.append((a, b))
                neigh = [(a - 1, b), (a + 1, b), (a, b - 1), (a, b + 1)]
                for aa, bb in neigh:
                    if 0 <= aa < T and 0 <= bb < N and binary[aa, bb] and not visited[aa, bb]:
                        visited[aa, bb] = True
                        stack.append((aa, bb))
            comps.append(torch.tensor(coords, device=binary.device, dtype=torch.long))
    return comps


def box_count_fractal_dimension(coords: torch.Tensor, eps: float = 1e-12) -> float:
    """
    Box-counting dimension for component coordinates in [time,node] plane.
    Small samples are noisy; use as diagnostic only.
    """
    if coords.shape[0] < 5:
        return float("nan")
    xy = coords.float()
    xy = xy - xy.min(dim=0).values
    span = torch.clamp(xy.max(dim=0).values, min=1.0)
    xy = xy / span
    scales = torch.tensor([2, 3, 4, 6, 8, 12, 16], device=coords.device).float()
    Ns, inv_eps = [], []
    for s in scales:
        grid = torch.floor(xy * s).long()
        grid = torch.clamp(grid, 0, int(s.item()) - 1)
        labels = grid[:, 0] * int(s.item()) + grid[:, 1]
        Ns.append(torch.unique(labels).numel())
        inv_eps.append(float(s.item()))
    Ns = torch.tensor(Ns, device=coords.device).float()
    inv_eps = torch.tensor(inv_eps, device=coords.device).float()
    mask = Ns > 1
    if mask.sum() < 3:
        return float("nan")
    x = torch.log(inv_eps[mask])
    y = torch.log(Ns[mask])
    xm, ym = x.mean(), y.mean()
    slope = ((x - xm) * (y - ym)).sum() / torch.clamp(((x - xm) ** 2).sum(), min=eps)
    return float(slope.item())


def cluster_shape_metrics(coords: torch.Tensor) -> Tuple[float, float]:
    """Return radius of gyration and anisotropy from covariance eigenvalues."""
    if coords.shape[0] < 2:
        return float("nan"), float("nan")
    xy = coords.float()
    centered = xy - xy.mean(dim=0, keepdim=True)
    rg = torch.sqrt((centered**2).sum(dim=1).mean())
    C = centered.T @ centered / max(coords.shape[0] - 1, 1)
    evals = torch.linalg.eigvalsh(C)
    evals = torch.clamp(evals, min=0)
    anis = (evals[-1] - evals[0]) / torch.clamp(evals.sum(), min=1e-12)
    return float(rg.item()), float(anis.item())


def front_metrics(coords: torch.Tensor, source_node: Optional[int] = None) -> Tuple[float, float]:
    """Max front radius and velocity in node-space per unit time."""
    if coords.shape[0] < 2:
        return 0.0, 0.0
    t = coords[:, 0].float()
    n = coords[:, 1].float()
    if source_node is None:
        source_node = int(n[t.argmin()].item())
    radius = torch.abs(n - float(source_node))
    maxr = float(radius.max().item())
    duration = float(torch.clamp(t.max() - t.min() + 1, min=1).item())
    return maxr, maxr / duration


def extract_spatial_avalanches(activity: torch.Tensor, threshold: float, min_area: int = 2) -> List[AvalancheEvent]:
    """
    activity [R,T,N] or [T,N]. Extract connected spacetime clusters above threshold.
    """
    if activity.ndim == 2:
        activity = activity.unsqueeze(0)
    events: List[AvalancheEvent] = []
    R, T, N = activity.shape
    for r in range(R):
        binary = activity[r] > threshold
        comps = connected_components_binary(binary)
        for coords in comps:
            if coords.shape[0] < min_area:
                continue
            ts = coords[:, 0]
            ns = coords[:, 1]
            vals = activity[r, ts, ns]
            start = int(ts.min().item())
            end = int(ts.max().item()) + 1
            dur = end - start
            size = float(torch.clamp(vals - threshold, min=0).sum().item())
            area = int(coords.shape[0])
            max_front, vf = front_metrics(coords)
            Df = box_count_fractal_dimension(coords)
            rg, anis = cluster_shape_metrics(coords)
            events.append(AvalancheEvent(r, start, end, dur, size, area, max_front, vf, Df, rg, anis))
    return events


def mle_powerlaw_alpha(x: torch.Tensor, xmin: float) -> float:
    xt = x[x >= xmin]
    if xt.numel() < 3:
        return float("nan")
    alpha = 1.0 + xt.numel() / torch.clamp(torch.log(xt / xmin).sum(), min=1e-12)
    return float(alpha.item())


def ks_distance_powerlaw(x: torch.Tensor, xmin: float, alpha: float) -> float:
    xt = torch.sort(x[x >= xmin]).values.float()
    n = xt.numel()
    if n < 3 or not math.isfinite(alpha):
        return float("inf")
    empirical = torch.arange(1, n + 1, device=x.device).float() / n
    # continuous Pareto CDF: F(x)=1-(x/xmin)^(1-alpha)
    model = 1.0 - (xt / xmin) ** (1.0 - alpha)
    return float(torch.max(torch.abs(empirical - model)).item())


def fit_powerlaw_clauset(x: torch.Tensor, n_xmin_candidates: int = 40) -> Tuple[float, float, float]:
    """
    Clauset-Shalizi-Newman style:
    choose xmin minimizing KS distance, then MLE alpha.
    Returns alpha, xmin, KS.
    """
    x = x[x > 0].float()
    if x.numel() < 10:
        return float("nan"), float("nan"), float("nan")
    xs = torch.sort(torch.unique(x)).values
    if xs.numel() > n_xmin_candidates:
        q = torch.linspace(0.05, 0.7, n_xmin_candidates, device=x.device)
        candidates = torch.quantile(x, q)
        candidates = torch.unique(candidates)
    else:
        candidates = xs[:-2]
    best = (float("nan"), float("nan"), float("inf"))
    for xmin_t in candidates:
        xmin = float(xmin_t.item())
        if (x >= xmin).sum() < 8:
            continue
        alpha = mle_powerlaw_alpha(x, xmin)
        ks = ks_distance_powerlaw(x, xmin, alpha)
        if ks < best[2]:
            best = (alpha, xmin, ks)
    return best


def lognormal_mle_params(x: torch.Tensor, xmin: float) -> Tuple[float, float]:
    xt = x[x >= xmin].float()
    lx = torch.log(torch.clamp(xt, min=1e-12))
    mu = lx.mean()
    sigma = lx.std(unbiased=False).clamp(min=1e-6)
    return float(mu.item()), float(sigma.item())


def loglik_powerlaw(x: torch.Tensor, xmin: float, alpha: float, eps: float = 1e-12) -> torch.Tensor:
    xt = x[x >= xmin].float()
    if xt.numel() == 0 or not math.isfinite(alpha):
        return torch.tensor(float("nan"), device=x.device)
    # continuous Pareto pdf: (alpha-1)/xmin * (x/xmin)^(-alpha)
    ll = torch.log(torch.tensor(alpha - 1.0, device=x.device).clamp(min=eps)) - torch.log(torch.tensor(xmin, device=x.device)) - alpha * torch.log(xt / xmin)
    return ll.sum()


def loglik_lognormal_truncated(x: torch.Tensor, xmin: float, mu: float, sigma: float, eps: float = 1e-12) -> torch.Tensor:
    xt = x[x >= xmin].float()
    if xt.numel() == 0:
        return torch.tensor(float("nan"), device=x.device)
    lx = torch.log(torch.clamp(xt, min=eps))
    mu_t = torch.tensor(mu, device=x.device)
    sig_t = torch.tensor(sigma, device=x.device).clamp(min=1e-6)
    ll = -torch.log(xt * sig_t * math.sqrt(2 * math.pi)) - 0.5 * ((lx - mu_t) / sig_t) ** 2
    # truncate normalization P(X>=xmin) = 1 - Phi((log xmin - mu)/sigma)
    if stats is not None:
        z = (math.log(max(xmin, eps)) - mu) / sigma
        surv = max(float(stats.norm.sf(z)), eps)
        ll = ll - math.log(surv)
    return ll.sum()


def likelihood_ratio_powerlaw_lognormal(x: torch.Tensor, xmin: float, alpha: float) -> Tuple[float, Optional[float]]:
    """
    Positive LLR favors power-law. Negative favors lognormal.
    p-value is an approximate Vuong z-test if scipy is available.
    """
    xt = x[x >= xmin].float()
    if xt.numel() < 8:
        return float("nan"), None
    mu, sigma = lognormal_mle_params(x, xmin)

    eps = 1e-12
    ll_pl_each = torch.log(torch.tensor(alpha - 1.0, device=x.device).clamp(min=eps)) - math.log(max(xmin, eps)) - alpha * torch.log(xt / xmin)
    lx = torch.log(torch.clamp(xt, min=eps))
    ll_ln_each = -torch.log(xt * sigma * math.sqrt(2 * math.pi)) - 0.5 * ((lx - mu) / sigma) ** 2
    if stats is not None:
        z = (math.log(max(xmin, eps)) - mu) / sigma
        surv = max(float(stats.norm.sf(z)), eps)
        ll_ln_each = ll_ln_each - math.log(surv)
    diff = ll_pl_each - ll_ln_each
    llr = float(diff.sum().item())
    pval = None
    if stats is not None and diff.numel() > 2 and float(diff.std().item()) > 1e-12:
        z = float((diff.mean() / (diff.std(unbiased=True) / math.sqrt(diff.numel()))).item())
        pval = float(2 * stats.norm.sf(abs(z)))
    return llr, pval


def ccdf(x: torch.Tensor) -> Tuple[torch.Tensor, torch.Tensor]:
    x = torch.sort(x[x > 0].float()).values
    n = x.numel()
    if n == 0:
        return x, x
    # P(X >= x_i)
    y = torch.arange(n, 0, -1, device=x.device).float() / n
    return x, y


def analyze_avalanches(activity: torch.Tensor, class_name: str, threshold_quantile: float = 0.9, min_area: int = 2) -> AvalancheScalingResult:
    finite_values = activity[torch.isfinite(activity)].float()
    if finite_values.numel() == 0:
        return AvalancheScalingResult(
            class_name=class_name,
            threshold=float("nan"),
            n_events=0,
            size_alpha=float("nan"),
            size_xmin=float("nan"),
            duration_alpha=float("nan"),
            duration_xmin=float("nan"),
            powerlaw_lognormal_llr_size=float("nan"),
            powerlaw_lognormal_p_size=None,
            powerlaw_lognormal_llr_duration=float("nan"),
            powerlaw_lognormal_p_duration=None,
            ccdf_size_x=[],
            ccdf_size_y=[],
            ccdf_duration_x=[],
            ccdf_duration_y=[],
            events=[],
            notes={"warning": "No finite activity values were available."},
        )
    threshold = float(torch.quantile(finite_values, threshold_quantile).item())
    sanitized = torch.where(torch.isfinite(activity), activity.float(), torch.full_like(activity.float(), threshold - 1.0))
    events = extract_spatial_avalanches(sanitized, threshold, min_area=min_area)
    sizes = torch.tensor([e.size for e in events], device=activity.device).float()
    durations = torch.tensor([e.duration for e in events], device=activity.device).float()

    a_s, xmin_s, _ = fit_powerlaw_clauset(sizes)
    a_d, xmin_d, _ = fit_powerlaw_clauset(durations)
    llr_s, p_s = likelihood_ratio_powerlaw_lognormal(sizes, xmin_s, a_s) if math.isfinite(xmin_s) else (float("nan"), None)
    llr_d, p_d = likelihood_ratio_powerlaw_lognormal(durations, xmin_d, a_d) if math.isfinite(xmin_d) else (float("nan"), None)
    xs, ys = ccdf(sizes)
    xd, yd = ccdf(durations)

    return AvalancheScalingResult(
        class_name=class_name,
        threshold=threshold,
        n_events=len(events),
        size_alpha=a_s,
        size_xmin=xmin_s,
        duration_alpha=a_d,
        duration_xmin=xmin_d,
        powerlaw_lognormal_llr_size=llr_s,
        powerlaw_lognormal_p_size=p_s,
        powerlaw_lognormal_llr_duration=llr_d,
        powerlaw_lognormal_p_duration=p_d,
        ccdf_size_x=to_np(xs).tolist(),
        ccdf_size_y=to_np(ys).tolist(),
        ccdf_duration_x=to_np(xd).tolist(),
        ccdf_duration_y=to_np(yd).tolist(),
        events=events,
        notes={
            "CCDF": "Use P(S>=s) on log-log axes; it is less noisy than histogram tails.",
            "LLR": "Positive log-likelihood ratio favors power-law over lognormal; negative favors lognormal.",
            "p_value": "Approximate Vuong test p-value when scipy is available. Low p means the sign of LLR is more reliable.",
            "fractal_dimension_box": "Box-counting dimension of each spacetime avalanche cluster. Needs large clusters for reliability.",
            "front_velocity": "Max node-distance reached divided by event duration."
        },
    )


# ============================================================
# Large-sample aggregation / synthetic bootstrapping
# ============================================================


def bootstrap_activity_segments(activity: torch.Tensor, n_bootstrap: int, segment_len: Optional[int] = None) -> torch.Tensor:
    """
    Increases apparent sample count by random segment resampling.
    This does NOT replace independent simulations, but is useful for pipeline testing.
    For real evidence, generate independent trajectories instead.
    """
    if activity.ndim == 2:
        activity = activity.unsqueeze(0)
    R, T, N = activity.shape
    if segment_len is None:
        segment_len = T
    out = []
    for _ in range(n_bootstrap):
        r = torch.randint(0, R, (1,), device=activity.device).item()
        if segment_len >= T:
            out.append(activity[r])
        else:
            start = torch.randint(0, T - segment_len + 1, (1,), device=activity.device).item()
            out.append(activity[r, start:start + segment_len])
    return torch.stack(out, dim=0)


def demo_data(device: str = "cpu") -> Tuple[Dict[str, torch.Tensor], Dict[str, torch.Tensor]]:
    """Synthetic TE matrices and avalanche activity for testing."""
    names = ["weak_chaos", "intermediate", "strong_chaos"]
    te = {}
    for name in names:
        N = 3
        W = torch.rand(N, N, device=device) * 0.005
        W.fill_diagonal_(0.0)
        if name == "weak_chaos":
            W[0, 1] += 0.03
            W[2, 1] += 0.02
        elif name == "intermediate":
            W += torch.rand(N, N, device=device) * 0.015
            W.fill_diagonal_(0.0)
        else:
            W += torch.rand(N, N, device=device) * 0.008
            W[1, 0] += 0.02
            W.fill_diagonal_(0.0)
        te[name] = W

    activity = {}
    R, T, N = 80, 400, 32
    for name in names:
        base = 0.05 * torch.randn(R, T, N, device=device).abs()
        if name == "strong_chaos":
            # rare broad bursts
            for r in range(R):
                for _ in range(5):
                    t0 = torch.randint(0, T - 50, (1,), device=device).item()
                    n0 = torch.randint(0, N, (1,), device=device).item()
                    dur = torch.randint(10, 60, (1,), device=device).item()
                    width = torch.randint(2, 8, (1,), device=device).item()
                    for dt in range(dur):
                        center = min(N - 1, max(0, n0 + dt // 10))
                        lo, hi = max(0, center - width), min(N, center + width + 1)
                        base[r, t0 + dt, lo:hi] += 0.5 * torch.rand(1, device=device)
        else:
            for r in range(R):
                for _ in range(8):
                    t0 = torch.randint(0, T - 20, (1,), device=device).item()
                    n0 = torch.randint(0, N, (1,), device=device).item()
                    dur = torch.randint(4, 18, (1,), device=device).item()
                    base[r, t0:t0 + dur, n0] += 0.4 * torch.rand(1, device=device)
        activity[name] = base
    return te, activity


# ============================================================
# Loading previous outputs
# ============================================================


def load_from_json(path: str, device: str) -> Tuple[Dict[str, torch.Tensor], Dict[str, torch.Tensor]]:
    """
    Reads previous analysis_results.json if it contains te_network or class-specific data.
    Returns te_matrices, activity_dict possibly empty.
    """
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    te_mats: Dict[str, torch.Tensor] = {}
    activity: Dict[str, torch.Tensor] = {}

    # Case 1: {"te_networks": {class: matrix}}
    if "te_networks" in data:
        for k, v in data["te_networks"].items():
            te_mats[k] = torch.tensor(v, device=device).float()

    # Case 1b: output structure from chaos_transport_analysis.py
    if "class_networks" in data and isinstance(data["class_networks"], dict):
        for class_name, payload in data["class_networks"].items():
            if isinstance(payload, dict) and "mean_adjacency" in payload:
                te_mats[str(class_name)] = torch.tensor(payload["mean_adjacency"], device=device).float()

    # Case 2: single te_network from previous script
    if "te_network" in data and isinstance(data["te_network"], dict):
        if "te_matrix" in data["te_network"]:
            te_mats["all"] = torch.tensor(data["te_network"]["te_matrix"], device=device).float()
        if "adjacency" in data["te_network"] and "all" not in te_mats:
            te_mats["all"] = torch.tensor(data["te_network"]["adjacency"], device=device).float()

    # Case 3: avalanche event sizes only cannot recover spatial structure.
    # We still expose no activity if raw activity is absent.
    return te_mats, activity


def load_from_pt(path: str, device: str) -> Tuple[Dict[str, torch.Tensor], Dict[str, torch.Tensor]]:
    data = torch.load(path, map_location=device)
    te_mats: Dict[str, torch.Tensor] = {}
    activity: Dict[str, torch.Tensor] = {}
    names = data.get("classes", None)

    if "te_matrices" in data:
        tm = data["te_matrices"]
        if isinstance(tm, dict):
            for k, v in tm.items():
                te_mats[str(k)] = v.to(device).float()
        else:
            tm = tm.to(device).float()
            if tm.ndim == 2:
                te_mats["all"] = tm
            elif tm.ndim == 3:
                for i in range(tm.shape[0]):
                    name = names[i] if names is not None and i < len(names) else f"class_{i}"
                    te_mats[str(name)] = tm[i]

    if "activity" in data:
        act = data["activity"]
        if isinstance(act, dict):
            for k, v in act.items():
                activity[str(k)] = v.to(device).float()
        else:
            act = act.to(device).float()
            if act.ndim in (2, 3):
                activity["all"] = act
            elif act.ndim == 4:
                # [C,R,T,N]
                for i in range(act.shape[0]):
                    name = names[i] if names is not None and i < len(names) else f"class_{i}"
                    activity[str(name)] = act[i]

    return te_mats, activity


# ============================================================
# Plotting
# ============================================================


def plot_centrality(res: TENetworkMetricResult, out_dir: str) -> None:
    if plt is None:
        return
    x = np.arange(res.n_nodes)
    color = CLASS_COLORS.get(res.class_name, "#444444")
    plt.figure(figsize=(8, 4))
    plt.plot(x, res.betweenness, marker="o", color=color, label="betweenness")
    plt.plot(x, res.eigenvector_centrality, marker="s", color="#222222", label="eigenvector")
    plt.axvline(res.bottleneck_node, linestyle="--", alpha=0.5, color=color, label=f"bottleneck={res.bottleneck_node}")
    plt.axvline(res.hub_node, linestyle=":", alpha=0.5, color="#222222", label=f"hub={res.hub_node}")
    plt.title(f"TE network centrality: {res.class_name}")
    plt.xlabel("node")
    plt.ylabel("centrality")
    plt.grid(alpha=0.3)
    plt.legend()
    plt.tight_layout()
    plt.savefig(os.path.join(out_dir, f"chaos_te_network_centrality_{res.class_name}.png"), dpi=160)
    plt.close()


def plot_ccdf(res: AvalancheScalingResult, out_dir: str) -> None:
    if plt is None:
        return
    color = CLASS_COLORS.get(res.class_name, "#444444")
    plt.figure(figsize=(7, 5))
    if len(res.ccdf_size_x) > 0:
        plt.loglog(res.ccdf_size_x, res.ccdf_size_y, marker="o", linestyle="none", color=color, label=f"size alpha={res.size_alpha:.2f}")
    if len(res.ccdf_duration_x) > 0:
        plt.loglog(res.ccdf_duration_x, res.ccdf_duration_y, marker="s", linestyle="none", color="#222222", label=f"duration alpha={res.duration_alpha:.2f}")
    plt.title(f"Avalanche CCDF: {res.class_name}")
    plt.xlabel("x")
    plt.ylabel("P(X >= x)")
    plt.grid(alpha=0.3, which="both")
    plt.legend()
    plt.tight_layout()
    plt.savefig(os.path.join(out_dir, f"chaos_avalanche_ccdf_{res.class_name}.png"), dpi=160)
    plt.close()


def plot_avalanche_shape_summary(res: AvalancheScalingResult, out_dir: str) -> None:
    if plt is None or not res.events:
        return
    rg = np.array([e.radius_of_gyration for e in res.events], dtype=float)
    area = np.array([e.area for e in res.events], dtype=float)
    fd = np.array([e.fractal_dimension_box for e in res.events], dtype=float)
    vf = np.array([e.front_velocity for e in res.events], dtype=float)

    plt.figure(figsize=(7, 5))
    mask = np.isfinite(rg) & np.isfinite(area) & (rg > 0) & (area > 0)
    if mask.sum() > 0:
        plt.loglog(rg[mask], area[mask], marker="o", linestyle="none", color=CLASS_COLORS.get(res.class_name, "#444444"))
    plt.title(f"Avalanche cluster shape: {res.class_name}")
    plt.xlabel("radius of gyration")
    plt.ylabel("cluster area")
    plt.grid(alpha=0.3, which="both")
    plt.tight_layout()
    plt.savefig(os.path.join(out_dir, f"chaos_avalanche_cluster_shape_{res.class_name}.png"), dpi=160)
    plt.close()

    plt.figure(figsize=(7, 4))
    if np.isfinite(fd).any():
        plt.hist(fd[np.isfinite(fd)], bins=20, alpha=0.8, label="box fractal dimension")
    plt.title(f"Fractal dimension distribution: {res.class_name}")
    plt.xlabel("D_box")
    plt.ylabel("count")
    plt.grid(alpha=0.3)
    plt.tight_layout()
    plt.savefig(os.path.join(out_dir, f"chaos_avalanche_fractal_dimension_{res.class_name}.png"), dpi=160)
    plt.close()

    plt.figure(figsize=(7, 4))
    plt.hist(vf[np.isfinite(vf)], bins=20, alpha=0.8)
    plt.title(f"Front propagation velocity: {res.class_name}")
    plt.xlabel("front velocity [nodes / time step]")
    plt.ylabel("count")
    plt.grid(alpha=0.3)
    plt.tight_layout()
    plt.savefig(os.path.join(out_dir, f"chaos_avalanche_front_velocity_{res.class_name}.png"), dpi=160)
    plt.close()


def te_metric_summary_row(res: TENetworkMetricResult) -> Dict[str, Any]:
    return {
        "class_name": res.class_name,
        "n_nodes": res.n_nodes,
        "bottleneck_node": res.bottleneck_node,
        "hub_node": res.hub_node,
        "assortativity_strength": res.assortativity_strength,
        "assortativity_degree": res.assortativity_degree,
        "modularity": res.modularity,
        "n_communities": res.n_communities,
        "spectral_gap": res.spectral_gap,
        "lambda2_abs": res.lambda2_abs,
        "mixing_timescale": res.mixing_timescale,
        "stationary_entropy": res.stationary_entropy,
    }


def avalanche_summary_row(res: AvalancheScalingResult) -> Dict[str, Any]:
    return {
        "class_name": res.class_name,
        "threshold": res.threshold,
        "n_events": res.n_events,
        "size_alpha": res.size_alpha,
        "size_xmin": res.size_xmin,
        "duration_alpha": res.duration_alpha,
        "duration_xmin": res.duration_xmin,
        "powerlaw_lognormal_llr_size": res.powerlaw_lognormal_llr_size,
        "powerlaw_lognormal_p_size": res.powerlaw_lognormal_p_size,
        "powerlaw_lognormal_llr_duration": res.powerlaw_lognormal_llr_duration,
        "powerlaw_lognormal_p_duration": res.powerlaw_lognormal_p_duration,
        "mean_area": event_mean([event.area for event in res.events]),
        "mean_front_velocity": event_mean([event.front_velocity for event in res.events]),
        "mean_fractal_dimension": event_mean([event.fractal_dimension_box for event in res.events]),
        "mean_radius_of_gyration": event_mean([event.radius_of_gyration for event in res.events]),
        "mean_anisotropy": event_mean([event.anisotropy for event in res.events]),
    }


def avalanche_event_rows(res: AvalancheScalingResult) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    for event in res.events:
        rows.append(
            {
                "class_name": res.class_name,
                "run": event.run,
                "start": event.start,
                "end": event.end,
                "duration": event.duration,
                "size": event.size,
                "area": event.area,
                "max_front_radius": event.max_front_radius,
                "front_velocity": event.front_velocity,
                "fractal_dimension_box": event.fractal_dimension_box,
                "radius_of_gyration": event.radius_of_gyration,
                "anisotropy": event.anisotropy,
            }
        )
    return rows


def save_summary_outputs(results: Dict[str, Any], out_dir: Path) -> None:
    te_rows = [te_metric_summary_row(res) for res in results["te_network_metrics"].values()]
    avalanche_rows = [avalanche_summary_row(res) for res in results["avalanche_scaling"].values()]
    event_rows: List[Dict[str, Any]] = []
    for res in results["avalanche_scaling"].values():
        event_rows.extend(avalanche_event_rows(res))

    write_csv_rows(te_rows, out_dir / "chaos_te_network_summary.csv")
    write_csv_rows(avalanche_rows, out_dir / "chaos_avalanche_summary.csv")
    write_csv_rows(event_rows, out_dir / "chaos_avalanche_events.csv")

    lines = [
        "Chaos TE network and avalanche validation",
        f"- sources: {', '.join(results.get('sources', []))}",
        f"- output_dir: {out_dir}",
        "",
    ]
    for row in te_rows:
        lines.append(
            f"te_network {row['class_name']}: bottleneck={row['bottleneck_node']}, hub={row['hub_node']}, "
            f"gap={row['spectral_gap']:.4f}, tau={row['mixing_timescale']:.4f}, modularity={row['modularity']}"
        )
    for row in avalanche_rows:
        lines.append(
            f"avalanche {row['class_name']}: events={row['n_events']}, size_alpha={row['size_alpha']:.4f}, "
            f"duration_alpha={row['duration_alpha']:.4f}, mean_front_velocity={row['mean_front_velocity']:.4f}, "
            f"mean_Dbox={row['mean_fractal_dimension']:.4f}"
        )
    if results.get("warnings"):
        lines.append("")
        lines.append("Warnings:")
        for warning in results["warnings"]:
            lines.append(f"- {warning}")
    (out_dir / "chaos_te_network_avalanche_summary.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")


# ============================================================
# Main pipeline
# ============================================================


def run(args: argparse.Namespace) -> Dict[str, Any]:
    out_dir = Path(args.out)
    ensure_dir(out_dir)
    device = "cuda" if args.device in {"auto", "cuda"} and torch.cuda.is_available() else "cpu"

    te_mats: Dict[str, torch.Tensor] = {}
    activity: Dict[str, torch.Tensor] = {}
    sources: List[str] = []

    if args.json:
        te_mats, activity = load_from_json(args.json, device)
        sources.append(f"json:{args.json}")
    elif args.pt:
        te_mats, activity = load_from_pt(args.pt, device)
        sources.append(f"pt:{args.pt}")
    elif DEFAULT_PREVIOUS_JSON.exists():
        te_mats, activity = load_from_json(str(DEFAULT_PREVIOUS_JSON), device)
        sources.append(f"json:{DEFAULT_PREVIOUS_JSON}")
    else:
        te_mats, activity = demo_data(device)
        sources.append("demo_data")

    if not activity and (BASE_DIR / "n_body_chaos_complexity.csv").exists():
        activity = load_repository_activity(device)
        if activity:
            sources.append("repo:trajectories.pt")

    if not te_mats and DEFAULT_PREVIOUS_JSON.exists() and not args.pt:
        te_mats, _ = load_from_json(str(DEFAULT_PREVIOUS_JSON), device)
        if te_mats:
            sources.append(f"json:{DEFAULT_PREVIOUS_JSON}")

    results: Dict[str, Any] = {
        "device": device,
        "output_dir": str(out_dir),
        "sources": sources,
        "te_network_metrics": {},
        "avalanche_scaling": {},
        "warnings": [],
    }

    if not te_mats:
        results["warnings"].append("No TE matrices found. Provide --pt with te_matrices, or ensure chaos_transport_outputs/analysis_results.json exists.")
    for name in ordered_classes(list(te_mats.keys())):
        W = te_mats[name]
        res = analyze_te_network(W, name)
        results["te_network_metrics"][name] = res
        plot_centrality(res, str(out_dir))

    if not activity:
        results["warnings"].append("No raw node-level activity found. Avalanche spatial structure requires node activity [R,T,N].")
    for name in ordered_classes(list(activity.keys())):
        act = activity[name]
        if args.n_bootstrap > 0:
            act_eval = bootstrap_activity_segments(act, n_bootstrap=args.n_bootstrap, segment_len=args.segment_len)
        else:
            act_eval = act
        res = analyze_avalanches(act_eval, name, threshold_quantile=args.threshold_quantile, min_area=args.min_area)
        results["avalanche_scaling"][name] = res
        plot_ccdf(res, str(out_dir))
        plot_avalanche_shape_summary(res, str(out_dir))

    save_summary_outputs(results, out_dir)
    save_json(results, os.path.join(out_dir, "next_validation_results.json"))
    return results


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser()
    p.add_argument("--json", type=str, default=None, help="previous analysis_results.json")
    p.add_argument("--pt", type=str, default=None, help=".pt file with te_matrices and/or activity")
    p.add_argument("--out", type=str, default=str(DEFAULT_OUTDIR))
    p.add_argument("--device", type=str, default="auto", choices=["cpu", "cuda", "auto"])
    p.add_argument("--threshold-quantile", type=float, default=0.90)
    p.add_argument("--min-area", type=int, default=2)
    p.add_argument("--n-bootstrap", type=int, default=0, help="segment bootstrap count; use 100-1000 for pipeline testing, but prefer independent simulations")
    p.add_argument("--segment-len", type=int, default=None)
    return p


if __name__ == "__main__":
    args = build_parser().parse_args()
    out = run(args)
    print(json.dumps({
        "saved": os.path.abspath(args.out),
        "te_classes": list(out["te_network_metrics"].keys()),
        "avalanche_classes": list(out["avalanche_scaling"].keys()),
        "warnings": out["warnings"],
    }, indent=2, ensure_ascii=False))

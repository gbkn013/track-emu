"""Pure ETA engine — no I/O (AGENTS.md §6.4).

The engine takes ``now`` as a parameter (no hidden ``datetime.now()``) so it is
deterministic and unit-testable. All datetimes are timezone-aware IST.

Domain enums (``EtaSource``, ``DataMode``, ``Confidence``, ``PositionKind``)
live in :mod:`app.domain.models`; the engine's own output types and functions are
here.
"""

from .engine import (  # noqa: F401
    JourneyResult,
    Position,
    RunEta,
    StopEta,
    compute_run_eta,
    journey_between,
)

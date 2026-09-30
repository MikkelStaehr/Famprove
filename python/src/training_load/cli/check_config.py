"""`check-config`: validate every job's configuration at once, before any job runs.

The daily workflow's first step. Prints each problem (variable name and reason, never a value)
and exits 2 when there is any, so a new or edited secret fails in one run with the full list.
Reads the environment, plus the repo-root ``.env.local`` locally.
"""

import logging
import os
from collections.abc import Sequence

from training_load.config import all_problems, load_dotenv_file

log = logging.getLogger(__name__)


def main(argv: Sequence[str] | None = None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    load_dotenv_file()
    problems = all_problems(os.environ)
    for problem in problems:
        log.error("%s", problem)
    if problems:
        log.error("%d configuration problems: nothing was run", len(problems))
        return 2
    log.info("configuration OK for collect-intervals, collect-strength, compute, collect-plan")
    return 0

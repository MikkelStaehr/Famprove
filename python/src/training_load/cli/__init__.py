"""Console entry points (see [project.scripts]). Each ``main`` wires config, HTTP and the data
layer, then calls ``run``, which takes every dependency as an argument so tests can inject
fakes. Exit codes: 0 ok, 2 ConfigError (message lists the missing/invalid vars), any other
exception propagates (traceback in the CI log, exit 1).
"""

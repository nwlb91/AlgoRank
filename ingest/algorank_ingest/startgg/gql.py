"""A tiny GraphQL document builder with self-healing field/argument removal.

Queries are declared as nested dict "specs" rather than strings so that, when
the live API rejects a field or argument (schemas drift over time), the
offending name can be removed from the spec and the query retried — with the
removal recorded in the database for audit. This lets us request every field
we believe exists without risking hard failures.

Spec format:
    {"id": None, "slots": {"__args": {"includeByes": "true"}, "id": None, ...}}
`__args` values are either literal GraphQL strings or nested dicts (rendered
as input objects, whose keys can also be dropped individually).
"""

from __future__ import annotations

import copy
import re
from typing import Any

ARGS_KEY = "__args"


def render_args_inner(args: dict[str, Any]) -> str:
    parts = []
    for key, value in args.items():
        if isinstance(value, dict):
            if not value:
                continue
            parts.append(f"{key}: {{{render_args_inner(value)}}}")
        else:
            parts.append(f"{key}: {value}")
    return ", ".join(parts)


def render_selection(spec: dict[str, Any], indent: int = 1) -> str:
    pad = "  " * indent
    lines = []
    for name, sub in spec.items():
        if name == ARGS_KEY:
            continue
        if sub is None:
            lines.append(f"{pad}{name}")
        elif isinstance(sub, dict):
            args = sub.get(ARGS_KEY) or {}
            arg_sql = f"({render_args_inner(args)})" if args else ""
            body = render_selection(sub, indent + 1)
            if body.strip():
                lines.append(f"{pad}{name}{arg_sql} {{\n{body}\n{pad}}}")
            else:
                lines.append(f"{pad}{name}{arg_sql}")
    return "\n".join(lines)


def render_document(op_name: str, variables: dict[str, str], root: dict[str, Any]) -> str:
    var_sql = ", ".join(f"${k}: {v}" for k, v in variables.items())
    head = f"query {op_name}({var_sql})" if var_sql else f"query {op_name}"
    return f"{head} {{\n{render_selection(root)}\n}}"


def _drop_key_anywhere(node: Any, name: str, *, in_args: bool) -> bool:
    """Remove every occurrence of `name` (a field or an argument key)."""
    dropped = False
    if not isinstance(node, dict):
        return False
    if in_args:
        args = node.get(ARGS_KEY)
        if isinstance(args, dict) and _drop_from_args(args, name):
            dropped = True
    else:
        if name in node and name != ARGS_KEY:
            del node[name]
            dropped = True
    for key, sub in list(node.items()):
        if key == ARGS_KEY and not in_args:
            continue
        if isinstance(sub, dict):
            if _drop_key_anywhere(sub, name, in_args=in_args):
                dropped = True
    return dropped


def _drop_from_args(args: dict, name: str) -> bool:
    dropped = False
    if name in args:
        del args[name]
        dropped = True
    for value in list(args.values()):
        if isinstance(value, dict) and _drop_from_args(value, name):
            dropped = True
    return dropped


class QuerySpec:
    """A named query whose spec can lose fields/args/variables at runtime."""

    def __init__(self, name: str, variables: dict[str, str], root: dict[str, Any]):
        self.name = name
        self.variables = dict(variables)
        self.root = copy.deepcopy(root)
        self._rendered: str | None = None

    def render(self) -> str:
        if self._rendered is None:
            self._rendered = render_document(self.name, self.variables, self.root)
        return self._rendered

    def drop_field(self, field: str) -> bool:
        ok = _drop_key_anywhere(self.root, field, in_args=False)
        self._rendered = None
        return ok

    def drop_argument(self, arg: str) -> bool:
        ok = _drop_key_anywhere(self.root, arg, in_args=True)
        self._rendered = None
        return ok

    def drop_variable(self, var: str) -> bool:
        if var in self.variables:
            del self.variables[var]
            self._rendered = None
            return True
        return False


# Error message patterns the self-healing logic understands.
RE_UNKNOWN_FIELD = re.compile(r'Cannot query field "(\w+)"')
RE_UNKNOWN_ARG = re.compile(r'Unknown argument "(\w+)"')
RE_UNKNOWN_INPUT_FIELD = re.compile(r'Field "(\w+)" is not defined by type')
RE_UNUSED_VARIABLE = re.compile(r'Variable "\$(\w+)" is never used')
RE_UNDEFINED_VARIABLE = re.compile(r'Variable "\$(\w+)" is not defined')
RE_COMPLEXITY = re.compile(r"complexity|maximum of 1000 objects", re.IGNORECASE)


def classify_graphql_error(message: str) -> tuple[str, str] | None:
    """Return (kind, name) for a self-healable error, or None."""
    m = RE_UNKNOWN_FIELD.search(message)
    if m:
        return ("field", m.group(1))
    m = RE_UNKNOWN_ARG.search(message)
    if m:
        return ("argument", m.group(1))
    m = RE_UNKNOWN_INPUT_FIELD.search(message)
    if m:
        return ("argument", m.group(1))
    m = RE_UNUSED_VARIABLE.search(message)
    if m:
        return ("variable", m.group(1))
    m = RE_UNDEFINED_VARIABLE.search(message)
    if m:
        return ("variable", m.group(1))
    return None


def is_complexity_error(message: str) -> bool:
    return bool(RE_COMPLEXITY.search(message))

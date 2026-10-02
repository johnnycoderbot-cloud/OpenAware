"""Validate the planning repository using Python's standard library only.

This checks artifacts and execution dependencies. It does not test a runtime app.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from urllib.parse import unquote

ROOT = Path(__file__).resolve().parents[1]
ERRORS: list[str] = []
REQUIRED_DOCS = [
    "README.md", "PLAN.md", "LICENSE", "CONTRIBUTING.md", "SECURITY.md",
    "docs/product-spec.md", "docs/ux-spec.md", "docs/architecture.md",
    "docs/contracts.md", "docs/integrations.md", "docs/security-privacy.md",
    "docs/roadmap.md", "docs/testing-release.md", "docs/decisions.md",
    "docs/github-tracking.md", ".omx/plans/foundation-requirements.md",
    ".omx/plans/foundation.md", ".omx/plans/foundation-verification.md",
    ".omx/plans/brownfield-map.md", ".omx/research/summary.md",
    ".omx/logs/execution-ledger.md", "assets/app-concept.png",
]


def fail(message: str) -> None:
    ERRORS.append(message)


def relative(path: Path) -> str:
    return path.relative_to(ROOT).as_posix()


def prose(text: str) -> str:
    return re.sub(r"^(```|~~~).*?^\1[^\n]*$", "", text, flags=re.M | re.S)


def anchors(path: Path) -> set[str]:
    result: set[str] = set()
    seen: dict[str, int] = {}
    text = prose(path.read_text(encoding="utf-8-sig"))
    for heading in re.findall(r"^#{1,6}\s+(.+?)\s*#*\s*$", text, flags=re.M):
        heading = re.sub(r"\[([^]]+)\]\([^)]*\)", r"\1", heading)
        slug = re.sub(r"[^\w\- ]", "", heading.lower()).replace(" ", "-")
        count = seen.get(slug, 0)
        seen[slug] = count + 1
        result.add(f"{slug}-{count}" if count else slug)
    result.update(re.findall(r'<a\s+(?:id|name)=["\']([^"\']+)', text))
    return result


def check_links(path: Path) -> None:
    text = prose(path.read_text(encoding="utf-8-sig"))
    for target in re.findall(r"!?\[[^\]\n]*\]\(([^)\n]+)\)", text):
        target = target.strip().split(' "', 1)[0].strip("<>")
        if re.match(r"^[a-z][a-z0-9+.-]*:", target, flags=re.I):
            if target.lower().startswith("file:"):
                fail(f"{relative(path)}: local file URI in published documentation")
            continue
        name, _, anchor = target.partition("#")
        if name.startswith("/"):
            fail(f"{relative(path)}: absolute local link {name}")
            continue
        resolved = (path.parent / unquote(name.split("?", 1)[0])).resolve() if name else path
        if not resolved.is_relative_to(ROOT):
            fail(f"{relative(path)}: link escapes repository: {target}")
        elif not resolved.exists():
            fail(f"{relative(path)}: missing link target: {target}")
        elif anchor and resolved.suffix == ".md" and unquote(anchor) not in anchors(resolved):
            fail(f"{relative(path)}: missing anchor: {target}")


def check_slices() -> int:
    manifest = ROOT / ".omx/plans/implementation-slices.json"
    try:
        document = json.loads(manifest.read_text(encoding="utf-8-sig"))
    except (OSError, ValueError) as error:
        fail(f"Slice manifest cannot be read: {error}")
        return 0
    slices = document.get("slices")
    if not isinstance(slices, list) or not slices:
        fail("Slice manifest must contain a nonempty slices array")
        return 0
    by_id: dict[str, dict] = {}
    graph: dict[str, list[str]] = {}
    for item in slices:
        identifier = item.get("id", "")
        if not re.fullmatch(r"OA-\d{3}", identifier):
            fail(f"Invalid slice ID: {identifier}")
        if identifier in by_id:
            fail(f"Duplicate slice ID: {identifier}")
        by_id[identifier] = item
        for field in ("title", "phase", "estimate", "gate", "deliverable"):
            if not isinstance(item.get(field), str) or not item[field].strip():
                fail(f"{identifier}: missing string {field}")
        for field in ("files", "acceptance", "verification"):
            value = item.get(field)
            if not isinstance(value, list) or not value or any(not isinstance(v, str) or not v.strip() for v in value):
                fail(f"{identifier}: missing nonempty {field} list")
        dependencies = item.get("depends_on")
        if not isinstance(dependencies, list) or any(not isinstance(d, str) for d in dependencies):
            fail(f"{identifier}: depends_on must be a string array")
            dependencies = []
        graph[identifier] = dependencies
        units = item.get("work_units")
        if not isinstance(units, list) or not units or any(
            not isinstance(unit, dict) or any(
                not isinstance(unit.get(field), str) or not unit[field].strip()
                for field in ("title", "estimate")
            ) for unit in units
        ):
            fail(f"{identifier}: missing work units with titles and estimates")
        for name in item.get("files", []):
            if re.match(r"^[A-Za-z]:|^/|^\\", name) or ".." in Path(name).parts:
                fail(f"{identifier}: invalid proposed repository path {name}")
        if not isinstance(item.get("requirement_ids"), list) or not item["requirement_ids"]:
            fail(f"{identifier}: missing requirement_ids traceability")
    requirements = set(re.findall(r"OA-[A-Z]{2,5}-\d{3}", (ROOT / "docs/product-spec.md").read_text(encoding="utf-8-sig")))
    coverage: set[str] = set()
    for identifier, item in by_id.items():
        for dependency in graph[identifier]:
            if dependency not in by_id or dependency == identifier:
                fail(f"{identifier}: invalid dependency {dependency}")
        for requirement in item.get("requirement_ids", []):
            if requirement not in requirements:
                fail(f"{identifier}: unknown requirement {requirement}")
            coverage.add(requirement)
    if requirements - coverage:
        fail("Requirements without an implementation slice: " + ", ".join(sorted(requirements - coverage)))
    expected_coverage = {
        requirement: [identifier for identifier, item in by_id.items() if requirement in item["requirement_ids"]]
        for requirement in sorted(requirements)
    }
    if document.get("requirement_coverage") != expected_coverage:
        fail("Top-level requirement_coverage must match slice requirement_ids")
    visiting: set[str] = set()
    visited: set[str] = set()

    def visit(identifier: str) -> None:
        if identifier in visiting:
            fail(f"Dependency cycle includes {identifier}")
            return
        if identifier in visited or identifier not in graph:
            return
        visiting.add(identifier)
        for dependency in graph[identifier]:
            visit(dependency)
        visiting.remove(identifier)
        visited.add(identifier)

    for identifier in graph:
        visit(identifier)
    roadmap = (ROOT / "docs/roadmap.md").read_text(encoding="utf-8-sig")
    for identifier in by_id:
        if identifier not in roadmap:
            fail(f"{identifier}: absent from roadmap")
    return len(slices)


def main() -> int:
    for name in REQUIRED_DOCS:
        if not (ROOT / name).is_file():
            fail(f"Missing required artifact: {name}")
    markdown = [p for p in ROOT.rglob("*.md") if not any(part in {".git", "node_modules", "work", "state", "sessions", "team"} for part in p.relative_to(ROOT).parts)]
    for path in markdown:
        check_links(path)
        text = path.read_text(encoding="utf-8-sig")
        if "\ufffd" in text:
            fail(f"{relative(path)}: Unicode replacement character in public documentation")
        if re.search(r"[A-Za-z]:[\\/]Users[\\/]", text):
            fail(f"{relative(path)}: host-specific user path in public documentation")
    count = check_slices() if (ROOT / "docs/product-spec.md").exists() else 0
    if ERRORS:
        print("Planning validation failed:")
        for error in ERRORS:
            print("- " + error)
        return 1
    print(f"PASS: {len(markdown)} Markdown files, required artifacts, local links/anchors, {count} slices, acyclic dependencies, and requirement coverage.")
    print("Runtime capture, providers, Bionic compatibility, and performance are not tested by this check.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

export type TeamSkill = {
  id: string;
  label: string;
  body: string;
};

export const BUILTIN_SKILLS: TeamSkill[] = [
  {
    id: "test-driven",
    label: "Test-Driven",
    body: "Write a failing test first, then the minimum code to make it pass. Every new code path needs corresponding test coverage.",
  },
  {
    id: "keep-ci-green",
    label: "Keep CI Green",
    body: "After every meaningful change, run the project linter, type checker, and test suite. Don't proceed until they pass.",
  },
  {
    id: "incremental-commits",
    label: "Incremental Commits",
    body: "Make small, atomic git commits after each meaningful change. Each commit must be independently valid and have a clear, descriptive message.",
  },
  {
    id: "dry",
    label: "DRY Principle",
    body: "Eliminate duplication aggressively. Extract shared logic into reusable utilities or hooks; consolidate repeated patterns into a single source of truth.",
  },
  {
    id: "accessibility",
    label: "Accessibility",
    body: "All UI changes meet WCAG 2.1 AA: semantic HTML, ARIA labels, keyboard navigation, sufficient contrast.",
  },
  {
    id: "documentation",
    label: "Documentation",
    body: "Document all exported functions and complex logic. Update README or relevant docs when behavior changes.",
  },
  {
    id: "performance",
    label: "Performance",
    body: "Avoid unnecessary re-renders, N+1 queries, and inefficient data structures. Profile before and after changes when feasible.",
  },
  {
    id: "self-review",
    label: "Self Code Review",
    body: "Before marking work done, do a thorough self-review for bugs, security issues, edge cases, and adherence to project conventions.",
  },
  {
    id: "refactor-only",
    label: "Refactor Only",
    body: "Restructure and improve code quality without changing external behavior. Existing tests must still pass; no new features unless directly required by the refactor.",
  },
  {
    id: "monorepo-aware",
    label: "Monorepo Aware",
    body: "Respect package boundaries — shared types live in shared packages. Check cross-package impacts and run affected tests across packages.",
  },
];

export function renderSkillsMarkdown(skillIds: string[], custom: TeamSkill[] = []): string {
  const all = [...BUILTIN_SKILLS, ...custom];
  const selected = skillIds
    .map((id) => all.find((s) => s.id === id))
    .filter((s): s is TeamSkill => Boolean(s));
  if (selected.length === 0) return "";
  return selected.map((s) => `- **${s.label}** — ${s.body}`).join("\n");
}

export function findSkill(id: string, custom: TeamSkill[] = []): TeamSkill | undefined {
  return [...BUILTIN_SKILLS, ...custom].find((s) => s.id === id);
}
